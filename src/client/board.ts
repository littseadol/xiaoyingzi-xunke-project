import type { BoardControl, BoardStatus, Bootstrap, Recording, SignalData } from '../shared/types';
import { api, socketAddress } from './api';

export interface DesktopBridge {
  bootstrap(): Promise<Bootstrap>;
  setAutoStart(enabled: boolean): Promise<boolean>;
  openDataDirectory(): Promise<void>;
  onShutdown(callback: () => Promise<void>): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

class Segment {
  private uploads = Promise.resolve();
  private queuedBytes = 0;
  private index = 0;
  private failed = false;
  private stopped: Promise<void>;
  private resolveStopped!: () => void;
  private timer: ReturnType<typeof setTimeout>;

  private constructor(
    private recorder: MediaRecorder,
    private record: Recording,
    private token: string,
    private onError: (message: string) => void,
    onComplete: () => void,
  ) {
    this.stopped = new Promise((resolve) => {
      this.resolveStopped = resolve;
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size || this.failed) return;
      this.queuedBytes += event.data.size;
      if (this.queuedBytes > 32 * 1024 ** 2) {
        this.fail('录像写入跟不上采集速度，已暂停并等待重试');
        return;
      }
      const index = this.index++;
      this.uploads = this.uploads
        .then(async () => {
          if (this.failed) return;
          await api(`/api/board/recordings/${record.id}/chunk`, {
            method: 'POST',
            body: event.data,
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-board-token': token,
              'x-chunk-index': String(index),
            },
          });
          this.queuedBytes -= event.data.size;
        })
        .catch((error) => this.fail(error instanceof Error ? error.message : '录像写入失败'));
    };
    recorder.onerror = () => this.fail('摄像头编码失败');
    recorder.onstop = () => {
      clearTimeout(this.timer);
      void this.uploads.then(async () => {
        await api(`/api/board/recordings/${record.id}/finish`, {
          method: 'POST',
          headers: { 'x-board-token': token },
          body: JSON.stringify({ interrupted: this.failed }),
        }).catch((error) => this.onError(error instanceof Error ? error.message : '录像结束失败'));
        this.resolveStopped();
        onComplete();
      });
    };
    this.timer = setTimeout(() => {
      void this.stop();
    }, 5 * 60000);
    recorder.start(1000);
  }

  static async create(
    stream: MediaStream,
    token: string,
    onError: (message: string) => void,
    onComplete: () => void,
  ): Promise<Segment> {
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw new Error('当前系统不支持 WebM 录像，请使用受支持的 Windows 白板端');
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1500000 });
    const record = await api<Recording>('/api/board/recordings/start', {
      method: 'POST',
      headers: { 'x-board-token': token },
    });
    return new Segment(recorder, record, token, onError, onComplete);
  }

  get active(): boolean {
    return this.recorder.state !== 'inactive';
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.onError(message);
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }

  async stop(): Promise<void> {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    await this.stopped;
  }
}

export class BoardController {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private candidates: RTCIceCandidateInit[] = [];
  private segment: Segment | null = null;
  private control: BoardControl = {
    type: 'control',
    recording: false,
    watching: false,
    watchId: '',
    cameraId: '',
  };
  private watchId = '';
  private selectedCamera = '';
  private reconciling = false;
  private pending = false;
  private closed = false;
  private retryAt = 0;
  private recordingRetryAt = 0;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private status: BoardStatus = {
    online: false,
    camera: 'idle',
    recording: false,
    cameras: [],
    error: '',
    lastSeen: null,
  };

  constructor(
    private bootstrap: Bootstrap,
    private onStatus: (status: BoardStatus, stream: MediaStream | null) => void,
  ) {}

  start(): void {
    this.connect();
    void this.enumerate();
    this.timer = setInterval(() => {
      this.reconcile();
      this.emit();
    }, 2000);
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChange);
  }

  private deviceChange = () => {
    this.retryAt = 0;
    void this.enumerate();
    this.reconcile();
  };

  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(socketAddress(), ['board', this.bootstrap.boardToken]);
    this.socket = socket;
    socket.onopen = () => {
      this.status.online = true;
      this.emit();
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'control') {
        this.control = message;
        this.reconcile();
      }
      if (message.type === 'signal')
        void this.signal(message.data).catch((error) => this.setError(error));
      if (message.type === 'shout') void this.playShout(message.id, message.mimeType);
    };
    socket.onerror = () => {
      this.status.error = '本地服务连接失败';
      this.emit();
    };
    socket.onclose = (event) => {
      this.status.online = false;
      this.control = { ...this.control, recording: false, watching: false };
      this.reconcile();
      this.emit();
      if (event.code === 4003) this.status.error = '绑定已解除，请从托盘重新绑定教室';
      if (!this.closed && event.code !== 4009 && event.code !== 4003)
        this.reconnect = setTimeout(() => this.connect(), 3000);
    };
  }

  private send(value: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private emit(): void {
    this.status.recording = this.segment?.active ?? false;
    this.status.lastSeen = new Date().toISOString();
    const status = { ...this.status, cameras: [...this.status.cameras] };
    this.onStatus(status, this.stream);
    this.send({ ...status, type: 'status' });
  }

  private setError(error: unknown): void {
    this.status.error = error instanceof Error ? error.message : String(error);
    this.emit();
  }

  private async enumerate(): Promise<void> {
    try {
      this.status.cameras = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `摄像头 ${index + 1}`,
        }));
      this.emit();
    } catch (error) {
      this.setError(error);
    }
  }

  private reconcile(): void {
    this.pending = true;
    if (this.reconciling || this.closed) return;
    this.reconciling = true;
    void (async () => {
      try {
        while (this.pending && !this.closed) {
          this.pending = false;
          const control = { ...this.control };
          if (this.stream && this.selectedCamera !== control.cameraId) await this.release();
          if (!control.recording && this.segment) {
            await this.segment.stop();
            this.segment = null;
          }
          if (!control.watching || this.watchId !== control.watchId) this.closePeer();
          this.watchId = control.watchId;
          if (!control.recording && !control.watching) {
            await this.release();
            this.status.camera = 'idle';
            this.emit();
            continue;
          }
          if (!this.stream && Date.now() >= this.retryAt) {
            this.status.camera = 'starting';
            this.emit();
            this.stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                ...(control.cameraId ? { deviceId: { exact: control.cameraId } } : {}),
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 15, max: 20 },
              },
            });
            this.selectedCamera = control.cameraId;
            this.stream.getVideoTracks()[0].onended = () => {
              void this.release().then(() => {
                this.status.camera = 'error';
                this.setError('摄像头已断开，等待重新连接');
                this.reconcile();
              });
            };
            this.status.camera = 'ready';
            this.status.error = '';
            await this.enumerate();
          }
          if (this.stream && control.watching && !this.peer) await this.createPeer();
          if (this.segment && !this.segment.active) {
            await this.segment.stop();
            this.segment = null;
          }
          if (
            this.stream &&
            control.recording &&
            !this.segment &&
            Date.now() >= this.recordingRetryAt
          ) {
            try {
              this.segment = await Segment.create(
                this.stream,
                this.bootstrap.boardToken,
                (message) => {
                  this.recordingRetryAt = Date.now() + 15000;
                  this.setError(message);
                },
                () => this.reconcile(),
              );
              this.status.error = '';
            } catch (error) {
              this.recordingRetryAt = Date.now() + 15000;
              this.setError(error);
            }
          }
          this.emit();
        }
      } catch (error) {
        this.retryAt = Date.now() + 5000;
        this.status.camera = 'error';
        this.setError(error);
      } finally {
        this.reconciling = false;
      }
    })();
  }

  private async createPeer(): Promise<void> {
    this.closePeer();
    const peer = new RTCPeerConnection({ iceServers: this.control.iceServers ?? [] });
    this.peer = peer;
    for (const track of this.stream!.getTracks()) peer.addTrack(track, this.stream!);
    peer.onicecandidate = (event) => {
      if (event.candidate)
        this.send({ type: 'signal', data: { candidate: event.candidate.toJSON() } });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        this.closePeer();
        this.setError('画面连接失败，请检查网络或联系维护者检查视频中继');
      }
    };
    const offer = await peer.createOffer();
    if (this.peer !== peer) return;
    await peer.setLocalDescription(offer);
    this.send({ type: 'signal', data: { description: peer.localDescription?.toJSON() } });
  }

  private async signal(data: SignalData): Promise<void> {
    const peer = this.peer;
    if (!peer) return;
    if (data.description) {
      await peer.setRemoteDescription(data.description);
      for (const candidate of this.candidates.splice(0)) await peer.addIceCandidate(candidate);
    } else if (data.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
      else this.candidates.push(data.candidate);
    }
  }

  private closePeer(): void {
    this.peer?.close();
    this.peer = null;
    this.candidates = [];
  }

  private async release(): Promise<void> {
    if (this.segment) {
      await this.segment.stop();
      this.segment = null;
    }
    this.closePeer();
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;
    this.selectedCamera = '';
  }

  private async playShout(id: string, mimeType: string): Promise<void> {
    if (this.audio) {
      this.send({ type: 'shout-status', id, status: 'failed', error: '扬声器正在播放另一条语音' });
      return;
    }
    try {
      const response = await fetch(`/api/board/shouts/${id}`, {
        headers: { 'x-board-token': this.bootstrap.boardToken },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('获取喊话语音失败');
      this.audioUrl = URL.createObjectURL(
        new Blob([await response.arrayBuffer()], { type: mimeType }),
      );
      const audio = new Audio(this.audioUrl);
      this.audio = audio;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('语音播放超时')), 30000);
        audio.onended = () => {
          clearTimeout(timeout);
          resolve();
        };
        audio.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('语音格式无法播放，请尝试 Chrome、Edge 或 Safari'));
        };
        void audio
          .play()
          .then(() => this.send({ type: 'shout-status', id, status: 'playing' }))
          .catch((error) => {
            clearTimeout(timeout);
            reject(error);
          });
      });
      this.send({ type: 'shout-status', id, status: 'played' });
    } catch (error) {
      this.send({
        type: 'shout-status',
        id,
        status: 'failed',
        error: error instanceof Error ? error.message : '播放失败',
      });
    } finally {
      this.audio?.pause();
      this.audio = null;
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reconnect) clearTimeout(this.reconnect);
    navigator.mediaDevices.removeEventListener('devicechange', this.deviceChange);
    this.audio?.pause();
    while (this.reconciling) await new Promise((resolve) => setTimeout(resolve, 50));
    await this.release();
    this.socket?.close();
  }
}
