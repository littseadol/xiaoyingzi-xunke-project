import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  BoardStatus,
  Bootstrap,
  Overview,
  Recording,
  Settings,
  SignalData,
} from '../shared/types';
import { api, formatBytes, formatTime, socketAddress } from './api';
import { BoardController } from './board';
import './styles.css';

type IconName =
  | 'camera'
  | 'video'
  | 'settings'
  | 'mic'
  | 'play'
  | 'stop'
  | 'clock'
  | 'download'
  | 'shield'
  | 'arrow'
  | 'folder'
  | 'logout'
  | 'expand'
  | 'check'
  | 'trash';
const CloudContext = createContext(false);
function useCloud() {
  return useContext(CloudContext);
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="3" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    video: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M4 8h16M4 16h16M8 3v5m8-5v5M8 16v5m8-5v5" />
      </>
    ),
    settings: (
      <>
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        <path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      </>
    ),
    play: <path d="m9 5 10 7-10 7Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    folder: <path d="M3 7V4h6l3 3h9v13H3Z" />,
    logout: (
      <>
        <path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4" />
      </>
    ),
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    check: <path d="m5 12 4 4L19 6" />,
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Icon name="camera" size={24} />
      </span>
      <div>
        小影子<small>教室助手</small>
      </div>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cloud, setCloud] = useState(false);
  useEffect(() => {
    void api<{ deployment: string }>('/api/config').then((value) =>
      setCloud(value.deployment === 'cloud'),
    );
  }, []);
  useEffect(() => {
    if (location.pathname === '/board') return;
    void api<{ authenticated: boolean }>('/api/session')
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false));
    const expire = () => setAuthenticated(false);
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  if (location.pathname === '/board') return <BoardApp />;
  if (authenticated === null) return <div className="loading">正在连接教室服务…</div>;
  return (
    <CloudContext.Provider value={cloud}>
      {authenticated ? (
        <Dashboard onLogout={() => setAuthenticated(false)} />
      ) : (
        <Login onLogin={() => setAuthenticated(true)} />
      )}
    </CloudContext.Provider>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const cloud = useCloud();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-shell">
      <div className="login-intro">
        <Brand />
        <span className="eyebrow">在熟悉的校园里，安心看见</span>
        <h1>
          教室动态，
          <br />
          一眼就知道。
        </h1>
        <p>实时画面 · 定时录像 · 语音喊话</p>
        <div className="login-art">
          <Icon name="camera" size={100} />
          <span className="orbit one" />
          <span className="orbit two" />
          <span className="art-dot" />
        </div>
        <span className="privacy">
          <Icon name="shield" size={16} />{' '}
          {cloud ? '教室画面加密连接，录像保存在云端' : '画面与录像保存在白板本地'}
        </span>
      </div>
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void api('/api/login', { method: 'POST', body: JSON.stringify({ password }) })
            .then(onLogin)
            .catch((error) => setError(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <span className="eyebrow">欢迎回来</span>
        <h2>连接你的教室</h2>
        <p className="muted">
          {cloud ? '输入你的教室访问密码。' : '输入白板控制台显示的访问密码。'}
        </p>
        <label>
          访问密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={128}
            placeholder="请输入访问密码"
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="primary wide" disabled={busy}>
          {busy ? '正在连接…' : '进入教室'}
          <Icon name="arrow" />
        </button>
        <small className="muted">
          {cloud
            ? '首次使用时，先在白板安装采集端并绑定教室。'
            : '请连接学校局域网。首次使用时，请按部署说明信任本机证书。'}
        </small>
        {!cloud && (
          <a className="text-link" href="/certificate" download>
            下载此白板的局域网证书
          </a>
        )}
      </form>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const cloud = useCloud();
  const [tab, setTab] = useState<'live' | 'recordings' | 'settings'>('live');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [socketReady, setSocketReady] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [stats, setStats] = useState('');
  const [refreshSocket, setRefreshSocket] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const candidates = useRef<RTCIceCandidateInit[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const watching = useRef(false);
  const signalQueue = useRef(Promise.resolve());
  const previewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewGeneration = useRef(0);

  const stopLive = useCallback(() => {
    previewGeneration.current++;
    watching.current = false;
    if (previewTimeout.current) clearTimeout(previewTimeout.current);
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ type: 'watch', enabled: false }));
    peer.current?.close();
    peer.current = null;
    candidates.current = [];
    mediaStream.current = null;
    if (video.current) video.current.srcObject = null;
    setLive(false);
    setConnecting(false);
    setStats('');
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api<Overview>('/api/overview')
        .then((value) => {
          if (active) {
            setOverview(value);
            setError('');
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (disposed) return;
      const connection = new WebSocket(socketAddress());
      socket.current = connection;
      connection.onopen = () => {
        setSocketReady(true);
        setConnectionMessage('');
      };
      connection.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'board-status') {
          setOverview((previous) => (previous ? { ...previous, board: message.status } : previous));
          if (!message.status.online) {
            stopLive();
            setConnectionMessage('白板采集端已离线');
          }
        }
        if (message.type === 'signal' && watching.current) {
          signalQueue.current = signalQueue.current
            .then(async () => {
              const current = peer.current;
              if (!current) return;
              const data = message.data as SignalData;
              if (data.description) {
                await current.setRemoteDescription(data.description);
                for (const candidate of candidates.current.splice(0))
                  await current.addIceCandidate(candidate);
                const answer = await current.createAnswer();
                await current.setLocalDescription(answer);
                if (peer.current === current && connection.readyState === WebSocket.OPEN)
                  connection.send(
                    JSON.stringify({
                      type: 'signal',
                      data: { description: current.localDescription?.toJSON() },
                    }),
                  );
              } else if (data.candidate) {
                if (current.remoteDescription) await current.addIceCandidate(data.candidate);
                else candidates.current.push(data.candidate);
              }
            })
            .catch((error) => {
              stopLive();
              setConnectionMessage(error.message);
            });
        }
      };
      connection.onclose = (event) => {
        if (disposed) return;
        setSocketReady(false);
        stopLive();
        setConnectionMessage(
          event.code === 4009
            ? '另一个页面已连接。需要在此观看时，点击重新连接。'
            : '与白板服务断开，正在重新连接…',
        );
        if (event.code === 4001) {
          onLogout();
          return;
        }
        if (event.code !== 4009) reconnect = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      stopLive();
      socket.current?.close();
    };
  }, [refreshSocket]);

  useEffect(() => {
    if (tab === 'live' && video.current && mediaStream.current)
      video.current.srcObject = mediaStream.current;
  }, [tab]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!peer.current) return;
      void peer.current
        .getStats()
        .then((report) =>
          report.forEach((stat) => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'video')
              setStats(
                `${stat.frameWidth ?? '—'} × ${stat.frameHeight ?? '—'} · ${Math.round(stat.framesPerSecond ?? 0)} FPS`,
              );
          }),
        )
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const startLive = async () => {
    stopLive();
    const generation = previewGeneration.current;
    setConnectionMessage('');
    setConnecting(true);
    let iceServers: RTCIceServer[];
    try {
      iceServers = (await api<{ iceServers: RTCIceServer[] }>('/api/ice')).iceServers;
    } catch (error) {
      if (generation !== previewGeneration.current) return;
      setConnecting(false);
      setConnectionMessage(error instanceof Error ? error.message : '连接配置获取失败');
      return;
    }
    if (generation !== previewGeneration.current) return;
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setConnecting(false);
      return;
    }
    watching.current = true;
    const connection = new RTCPeerConnection({ iceServers });
    peer.current = connection;
    connection.ontrack = (event) => {
      mediaStream.current = event.streams[0];
      if (video.current) video.current.srcObject = event.streams[0];
    };
    connection.onicecandidate = (event) => {
      if (event.candidate && socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(
          JSON.stringify({ type: 'signal', data: { candidate: event.candidate.toJSON() } }),
        );
    };
    connection.onconnectionstatechange = () => {
      if (peer.current !== connection) return;
      if (connection.connectionState === 'connected') {
        setConnecting(false);
        setLive(true);
        if (previewTimeout.current) clearTimeout(previewTimeout.current);
      }
      if (
        connection.connectionState === 'failed' ||
        connection.connectionState === 'disconnected'
      ) {
        stopLive();
        setConnectionMessage('画面连接中断，请重新观看；若持续失败，请联系维护者检查网络。');
      }
    };
    previewTimeout.current = setTimeout(() => {
      stopLive();
      setConnectionMessage('未能获取画面，请检查白板摄像头及网络连接，或联系维护者。');
    }, 20000);
    socket.current?.send(JSON.stringify({ type: 'watch', enabled: true }));
  };

  const saveSettings = async (settings: Settings) => {
    const saved = await api<Settings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setOverview((previous) => (previous ? { ...previous, settings: saved } : previous));
    return saved;
  };

  const board = overview?.board;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="nav-label">工作空间</span>
        <nav>
          {(
            [
              { key: 'live', icon: 'camera', name: '实时教室' },
              { key: 'recordings', icon: 'video', name: '录像回放' },
              { key: 'settings', icon: 'settings', name: '录制与设置' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item.key)}
            >
              <Icon name={item.icon} />
              {item.name}
              {tab === item.key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Icon name="shield" />
          <strong>{cloud ? '打开网站，连接教室' : '校园内，安心连接'}</strong>
          <span>
            {cloud ? '录像保存在云端' : '录像保存在白板本地'}
            <br />
            只供个人访问使用
          </span>
        </div>
        <button
          className="logout"
          onClick={() => {
            void api('/api/logout', { method: 'POST' })
              .then(onLogout)
              .catch((error) => setError(error.message));
          }}
        >
          <Icon name="logout" size={17} />
          退出登录
        </button>
        <span className="version">小影子 v0.2 · {cloud ? '云端版' : '局域网版'}</span>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            我的工作空间 <span>/</span> {overview?.settings.classroomName ?? '教室'}
          </div>
          <span className={`badge ${board?.online ? 'green' : 'gray'}`}>
            <i />
            {board?.online ? '白板在线' : '白板未连接'}
          </span>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">CLASSROOM COMPANION</span>
              <h1>
                {tab === 'live' ? '实时教室' : tab === 'recordings' ? '录像回放' : '录制与设置'}
              </h1>
              <p>
                {tab === 'live'
                  ? '看一眼教室，把更多时间留给教学。'
                  : tab === 'recordings'
                    ? '按时间查找，回看教室里的每一段记录。'
                    : '按你的课表安排录像，其余交给小影子。'}
              </p>
            </div>
            <span className="date-label">
              <Icon name="clock" size={16} />
              北京时间
            </span>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {connectionMessage && (
            <div className="notice" role="status">
              {connectionMessage}
              {!socketReady && (
                <button
                  className="text-button"
                  onClick={() => setRefreshSocket((value) => value + 1)}
                >
                  重新连接
                </button>
              )}
            </div>
          )}
          {board?.error && (
            <div className="notice error" role="alert">
              白板提示：{board.error}
            </div>
          )}
          {!overview ? (
            <div className="empty card">正在读取白板状态…</div>
          ) : tab === 'live' ? (
            <>
              <div className="live-grid">
                <section className="camera-card card">
                  <div className="card-header">
                    <div>
                      <Icon name="camera" />
                      <strong>{overview.settings.classroomName}</strong>
                    </div>
                    <span className={`badge ${live ? 'blue' : 'gray'}`}>
                      {live ? '实时画面' : connecting ? '连接中' : '未观看'}
                    </span>
                  </div>
                  <div className="video-stage">
                    <video ref={video} autoPlay playsInline muted aria-label="教室实时画面" />
                    {!live && (
                      <div className="video-placeholder">
                        <span className="camera-halo">
                          <Icon name="camera" size={40} />
                        </span>
                        <h3>{connecting ? '正在连接教室…' : '教室画面，在这里相见'}</h3>
                        <p>
                          {board?.online
                            ? '开启观看，获取白板摄像头实时画面'
                            : '请先在教室白板上启动小影子程序'}
                        </p>
                        <button
                          className="primary"
                          disabled={!board?.online || !socketReady || connecting}
                          onClick={startLive}
                        >
                          <Icon name="play" size={18} />
                          {connecting ? '连接中…' : '开始观看'}
                        </button>
                      </div>
                    )}
                    {live && (
                      <>
                        <span className="live-tag">
                          <i />
                          LIVE
                        </span>
                        <span className="video-caption">
                          {overview.settings.classroomName} · 无声画面
                        </span>
                      </>
                    )}
                  </div>
                  <div className="video-toolbar">
                    <span className="muted">
                      <i className={`status-dot ${live ? 'online' : ''}`} />
                      {live
                        ? stats || '正在接收画面'
                        : cloud
                          ? '加密连接 · 云端管理'
                          : '局域网直连 · 无需云服务'}
                    </span>
                    <div>
                      {(live || connecting) && (
                        <button className="subtle" onClick={stopLive}>
                          <Icon name="stop" size={16} />
                          停止观看
                        </button>
                      )}
                      <button
                        className="icon-button"
                        title="全屏观看"
                        aria-label="全屏观看"
                        disabled={!live}
                        onClick={() => {
                          void video.current
                            ?.requestFullscreen?.()
                            .catch((error) => setConnectionMessage(error.message));
                        }}
                      >
                        <Icon name="expand" size={18} />
                      </button>
                    </div>
                  </div>
                </section>
                <aside className="live-aside">
                  <section className="card shout-card">
                    <div className="section-icon">
                      <Icon name="mic" />
                    </div>
                    <h3>跟教室说句话</h3>
                    <p className="muted">按住录音，松手后在教室播放。</p>
                    <ShoutButton disabled={!board?.online} shout={overview.shout} />
                    <p className="fine">最长 20 秒 · 通过白板扬声器播放</p>
                  </section>
                  <section className="card recording-card">
                    <div className="card-title">
                      <span className="section-icon purple">
                        <Icon name="clock" />
                      </span>
                      <h3>定时录像</h3>
                      <span className={`badge ${board?.recording ? 'red' : 'gray'}`}>
                        {board?.recording
                          ? '录制中'
                          : overview.recordingDue
                            ? '等待采集'
                            : overview.settings.recordingEnabled
                              ? '等待时段'
                              : '已关闭'}
                      </span>
                    </div>
                    <p className="muted">
                      {overview.settings.recordingEnabled
                        ? '按照设定时段自动录制，停止观看也不影响。'
                        : '默认关闭。设置录像时段后，可随时开启。'}
                    </p>
                    <button className="secondary wide" onClick={() => setTab('settings')}>
                      管理录制计划
                      <Icon name="arrow" size={16} />
                    </button>
                  </section>
                </aside>
              </div>
              <div className="summary-grid">
                <Summary
                  icon="shield"
                  title={cloud ? '云端保存' : '本地保存'}
                  value={cloud ? '随时查看教室录像' : '画面不上传云端'}
                  detail={cloud ? '白板需保持联网并运行采集端' : '手机与白板通过学校网络连接'}
                />
                <Summary
                  icon="video"
                  title="录像空间"
                  value={formatBytes(overview.storage.videoBytes)}
                  detail={`磁盘可用 ${formatBytes(overview.storage.freeBytes)}`}
                />
                <Summary
                  icon="clock"
                  title="自动清理"
                  value={`保留最近 ${overview.settings.retentionDays} 天`}
                  detail="过期录像自动删除，无需手动整理"
                />
              </div>
              <div className="quiet-note">
                <Icon name="shield" size={16} />
                {cloud
                  ? '白板需保持开机、联网并运行采集端；网络中断时画面和录制会受影响。'
                  : '离开学校网络后无法访问；白板需保持开机且程序运行。'}
              </div>
            </>
          ) : tab === 'recordings' ? (
            <RecordingsView />
          ) : (
            <SettingsView
              settings={overview.settings}
              board={overview.board}
              onSave={saveSettings}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Summary({
  icon,
  title,
  value,
  detail,
}: {
  icon: IconName;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="card summary">
      <span className="summary-icon">
        <Icon name={icon} />
      </span>
      <div>
        <span className="muted">{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}

function ShoutButton({ disabled, shout }: { disabled: boolean; shout: Overview['shout'] }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef<{
    released: boolean;
    cancelled: boolean;
    recorder: MediaRecorder | null;
    stream: MediaStream | null;
    startedAt: number;
    timer?: ReturnType<typeof setTimeout>;
    progress?: ReturnType<typeof setInterval>;
  } | null>(null);
  const pending = shout?.status === 'queued' || shout?.status === 'playing';
  const release = (cancelled = false) => {
    const task = current.current;
    if (!task) return;
    task.released = true;
    task.cancelled ||= cancelled;
    if (task.recorder?.state === 'recording') task.recorder.stop();
  };
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) release(true);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      release(true);
    };
  }, []);
  const begin = async () => {
    if (disabled || busy || pending || current.current) return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('请先信任白板证书，并通过 HTTPS 地址访问，才能使用手机麦克风。');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用新版 Chrome、Edge 或 Safari。');
      return;
    }
    const task = {
      released: false,
      cancelled: false,
      recorder: null as MediaRecorder | null,
      stream: null as MediaStream | null,
      startedAt: 0,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      progress: undefined as ReturnType<typeof setInterval> | undefined,
    };
    current.current = task;
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true },
        video: false,
      });
      task.stream = stream;
      if (task.released) {
        stream.getTracks().forEach((track) => track.stop());
        if (current.current === task) current.current = null;
        setBusy(false);
        return;
      }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error('当前浏览器不支持可用的录音格式');
      const recorder = new MediaRecorder(stream, { mimeType });
      task.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        clearTimeout(task.timer);
        clearInterval(task.progress);
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        current.current = null;
        const duration = Math.min(20, (Date.now() - task.startedAt) / 1000);
        if (task.cancelled || duration < 0.3 || !chunks.length) {
          setBusy(false);
          return;
        }
        void api('/api/shouts', {
          method: 'POST',
          headers: { 'Content-Type': mimeType, 'x-duration': String(duration) },
          body: new Blob(chunks, { type: mimeType }),
        })
          .catch((error) => setError(error.message))
          .finally(() => setBusy(false));
      };
      recorder.onerror = () => {
        task.cancelled = true;
        setError('麦克风录音失败，请重试');
        release(true);
      };
      task.startedAt = Date.now();
      recorder.start();
      setRecording(true);
      setSeconds(0);
      task.progress = setInterval(
        () => setSeconds(Math.floor((Date.now() - task.startedAt) / 1000)),
        200,
      );
      task.timer = setTimeout(() => release(), 20000);
    } catch (error) {
      task.stream?.getTracks().forEach((track) => track.stop());
      current.current = null;
      setBusy(false);
      setError(error instanceof Error ? error.message : '无法打开麦克风');
    }
  };
  return (
    <>
      <button
        type="button"
        className={`shout-button ${recording ? 'is-recording' : ''}`}
        disabled={disabled || pending}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          void begin();
        }}
        onPointerUp={() => release()}
        onPointerCancel={() => release(true)}
        onLostPointerCapture={() => release()}
        onKeyDown={(event) => {
          if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
            event.preventDefault();
            void begin();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            release();
          }
        }}
        onBlur={() => release(true)}
      >
        <Icon name="mic" size={28} />
        <strong>
          {recording
            ? `松手发送 · ${seconds}s`
            : busy
              ? '正在准备或发送…'
              : pending
                ? shout?.status === 'playing'
                  ? '教室正在播放…'
                  : '等待教室播放…'
                : '按住说话'}
        </strong>
        <span>{recording ? '离开页面将取消本次语音' : '松手后播放语音'}</span>
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {shout?.status === 'played' && !busy && (
        <p className="success-text">
          <Icon name="check" size={14} />
          上一条语音已播放
        </p>
      )}
      {shout?.status === 'failed' && <p className="inline-error">{shout.error}</p>}
    </>
  );
}

function RecordingsView() {
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<Recording[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Recording | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api<Recording[]>(`/api/recordings${date ? `?date=${date}` : ''}`)
        .then((result) => {
          if (active) {
            setRows(result);
            setError('');
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [date]);
  const labels: Record<Recording['status'], string> = {
    writing: '正在录制',
    processing: '正在生成 MP4',
    ready: '可回放',
    interrupted: '恢复处理中',
    failed: '处理失败',
  };
  return (
    <section className="card recordings-view">
      <div className="card-header">
        <div>
          <Icon name="video" />
          <strong>教室录像</strong>
          <span className="muted">{rows.length} 段</span>
        </div>
        <label className="date-filter">
          录像日期
          <input
            aria-label="筛选录像日期"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
      </div>
      <div className="notice soft">
        录像约每 5 分钟保存一段，结束后自动生成可回放的 MP4。录制不包含声音，时间按北京时间显示。
      </div>
      {error && <div className="notice error">{error}</div>}
      {selected && (
        <div className="playback">
          <div>
            <strong>{formatTime(selected.startedAt)}</strong>
            <button className="text-button" onClick={() => setSelected(null)}>
              关闭回放
            </button>
          </div>
          <video
            controls
            autoPlay
            playsInline
            src={`/api/recordings/${selected.id}/video`}
            onError={() => setError('录像播放失败，请重试或下载后播放')}
          />
        </div>
      )}
      {!rows.length ? (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="video" size={32} />
          </span>
          <h3>这里还没有录像</h3>
          <p>开启定时录像后，录制片段会出现在这里。</p>
        </div>
      ) : (
        <div className="recording-list">
          {rows.map((record) => (
            <article className="recording-row" key={record.id}>
              <span className="recording-thumb">
                <Icon name="video" size={23} />
              </span>
              <div className="recording-info">
                <strong>{formatTime(record.startedAt)}</strong>
                <span>
                  {record.endedAt ? `至 ${formatTime(record.endedAt)}` : '片段录制中'} ·{' '}
                  {formatBytes(record.bytes)}
                </span>
                {record.error && <small className="inline-error">{record.error}</small>}
              </div>
              <span
                className={`badge ${record.status === 'ready' ? 'green' : record.status === 'failed' ? 'red' : 'gray'}`}
              >
                {labels[record.status]}
              </span>
              <div className="row-actions">
                <button
                  className="secondary"
                  disabled={record.status !== 'ready'}
                  onClick={() => {
                    setSelected(record);
                    setError('');
                  }}
                >
                  <Icon name="play" size={16} />
                  回放
                </button>
                {record.status === 'ready' && (
                  <a
                    className="icon-button"
                    href={`/api/recordings/${record.id}/video?download=1`}
                    title="下载录像"
                    aria-label="下载录像"
                  >
                    <Icon name="download" size={18} />
                  </a>
                )}
                <button
                  className="icon-button danger"
                  title="删除录像"
                  aria-label="删除录像"
                  disabled={!['ready', 'failed'].includes(record.status)}
                  onClick={() => {
                    if (!window.confirm('确定永久删除这段录像吗？')) return;
                    void api(`/api/recordings/${record.id}`, { method: 'DELETE' })
                      .then(() => {
                        setRows((previous) => previous.filter((item) => item.id !== record.id));
                        if (selected?.id === record.id) setSelected(null);
                      })
                      .catch((error) => setError(error.message));
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsView({
  settings,
  board,
  onSave,
}: {
  settings: Settings;
  board: BoardStatus;
  onSave: (settings: Settings) => Promise<Settings>;
}) {
  const cloud = useCloud();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return (
    <div className="settings-grid">
      <form
        className="card settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage('');
          setError('');
          void onSave(draft)
            .then((saved) => {
              setDraft(saved);
              setMessage('设置已保存，白板将按新计划执行。');
            })
            .catch((error) => setError(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="card-title">
          <Icon name="clock" />
          <h3>自动录像计划</h3>
        </div>
        <div className="setting-toggle">
          <div>
            <strong>启用定时录像</strong>
            <p>仅在选定时段录制，无人观看也继续保存。</p>
          </div>
          <label className="switch">
            <input
              aria-label="启用定时录像"
              type="checkbox"
              checked={draft.recordingEnabled}
              onChange={(event) => setDraft({ ...draft, recordingEnabled: event.target.checked })}
            />
            <span />
          </label>
        </div>
        {draft.recordingEnabled && !draft.schedules.length && (
          <div className="notice">还没有录像时段，当前不会录制。请添加时段。</div>
        )}
        <div className="schedule-heading">
          <strong>录制时段</strong>
          <button
            type="button"
            className="text-button"
            disabled={draft.schedules.length >= 20}
            onClick={() =>
              setDraft({
                ...draft,
                schedules: [
                  ...draft.schedules,
                  { id: crypto.randomUUID(), days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00' },
                ],
              })
            }
          >
            ＋ 添加时段
          </button>
        </div>
        {!draft.schedules.length && (
          <div className="schedule-empty">
            尚未添加时段。可分别设置上午、下午，或不同星期的课表。
          </div>
        )}
        {draft.schedules.map((schedule, index) => (
          <div className="schedule-item" key={schedule.id}>
            <div className="schedule-item-title">
              <strong>时段 {index + 1}</strong>
              <button
                className="text-button danger"
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    schedules: draft.schedules.filter((item) => item.id !== schedule.id),
                  })
                }
              >
                移除
              </button>
            </div>
            <div className="day-picker">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <button
                  type="button"
                  aria-pressed={schedule.days.includes(day)}
                  className={schedule.days.includes(day) ? 'selected' : ''}
                  key={day}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      schedules: draft.schedules.map((item) =>
                        item.id === schedule.id
                          ? {
                              ...item,
                              days: item.days.includes(day)
                                ? item.days.filter((value) => value !== day)
                                : [...item.days, day],
                            }
                          : item,
                      ),
                    })
                  }
                >
                  周{days[day]}
                </button>
              ))}
            </div>
            <div className="time-inputs">
              <label>
                开始时间
                <input
                  aria-label={`时段${index + 1}开始时间`}
                  type="time"
                  required
                  value={schedule.start}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      schedules: draft.schedules.map((item) =>
                        item.id === schedule.id ? { ...item, start: event.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <span>至</span>
              <label>
                结束时间
                <input
                  aria-label={`时段${index + 1}结束时间`}
                  type="time"
                  required
                  value={schedule.end}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      schedules: draft.schedules.map((item) =>
                        item.id === schedule.id ? { ...item, end: event.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
            </div>
            {schedule.start > schedule.end && (
              <small className="muted">跨午夜：所选星期开始，次日结束。</small>
            )}
          </div>
        ))}
        <div className="form-grid">
          <label>
            录像保留
            <select
              value={draft.retentionDays}
              onChange={(event) =>
                setDraft({ ...draft, retentionDays: Number(event.target.value) })
              }
            >
              <option value={2}>最近 2 天</option>
              <option value={3}>最近 3 天</option>
            </select>
          </label>
          <label>
            教室名称
            <input
              maxLength={40}
              required
              value={draft.classroomName}
              onChange={(event) => setDraft({ ...draft, classroomName: event.target.value })}
            />
          </label>
        </div>
        <label>
          白板摄像头
          <select
            value={draft.cameraId}
            onChange={(event) => setDraft({ ...draft, cameraId: event.target.value })}
          >
            <option value="">系统默认摄像头</option>
            {board.cameras
              .filter((camera) => camera.deviceId)
              .map((camera) => (
                <option value={camera.deviceId} key={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
          </select>
        </label>
        <p className="fine">
          摄像头名称会在首次打开画面后更新。更换摄像头会结束当前录像片段并重新采集。
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="notice success" role="status">
            {message}
          </div>
        )}
        <div className="form-footer">
          <span className="muted">所有时段均按北京时间执行</span>
          <button className="primary" disabled={busy}>
            {busy ? '保存中…' : '保存设置'}
          </button>
        </div>
      </form>
      <aside>
        {cloud && <DevicePairing />}
        <section className="card help-card">
          <span className="section-icon purple">
            <Icon name="shield" />
          </span>
          <h3>{cloud ? '录像在云端，按期留存' : '录像在本地，安心留存'}</h3>
          <p>
            {cloud
              ? '录像保存在你的服务器，超过保留期限后自动删除。断网时不保证持续录制。'
              : '录像保存在教室白板硬盘，不上传云端。超过保留期限后会自动删除。'}
          </p>
          <p>保存期限从录像结束时间计算。磁盘不足 1 GB 时暂停新片段录制，请及时释放空间。</p>
          <p>白板需保持开机，程序需保持运行。关闭控制台窗口会缩到系统托盘。</p>
        </section>
        <PasswordForm />
      </aside>
    </div>
  );
}

function DevicePairing() {
  const [invitation, setInvitation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pairedAt, setPairedAt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [installer, setInstaller] = useState(false);
  useEffect(() => {
    void api<{ pairedAt: string | null }>('/api/device')
      .then((value) => setPairedAt(value.pairedAt))
      .catch((error) => setMessage(error.message));
    void api<{ installerAvailable: boolean }>('/api/config')
      .then((value) => setInstaller(value.installerAvailable))
      .catch((error) => setMessage(error.message));
  }, []);
  return (
    <section className="card help-card">
      <h3>连接教室白板</h3>
      <p>
        {pairedAt
          ? '教室已绑定。更换设备时，请生成新绑定码；原设备会被替换。'
          : '第一次使用：在白板下载并安装采集端，再输入下方绑定码。'}
      </p>
      {installer ? (
        <a className="secondary wide" href="/downloads/collector">
          下载 Windows 采集端
        </a>
      ) : (
        <p className="fine">采集端安装包尚未发布，请联系维护者提供。</p>
      )}
      <button
        className="primary wide"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage('');
          void api<{ code: string; expiresAt: string }>('/api/device/invitation', {
            method: 'POST',
          })
            .then(setInvitation)
            .catch((error) => setMessage(error.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? '正在生成…' : '生成绑定码'}
      </button>
      {invitation && (
        <div className="notice soft">
          <strong>
            绑定码：<code>{invitation.code}</code>
          </strong>
          <p>请在白板输入此码，10 分钟内有效，仅能使用一次。</p>
        </div>
      )}
      <p className="fine">网站地址：{location.origin}</p>
      {pairedAt && (
        <button
          className="text-button danger"
          disabled={busy}
          onClick={() => {
            if (!confirm('解除后白板会停止连接和录像，确认解除吗？')) return;
            setBusy(true);
            void api('/api/device', { method: 'DELETE' })
              .then(() => {
                setPairedAt(null);
                setInvitation(null);
                setMessage('已解除绑定。');
              })
              .catch((error) => setMessage(error.message))
              .finally(() => setBusy(false));
          }}
        >
          解除设备绑定
        </button>
      )}
      {message && (
        <p role="status" className="fine">
          {message}
        </p>
      )}
    </section>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card password-card"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void api('/api/password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        })
          .then(() => {
            setCurrentPassword('');
            setNewPassword('');
            setMessage('访问密码已修改。');
          })
          .catch((error) => setMessage(error.message))
          .finally(() => setBusy(false));
      }}
    >
      <h3>修改访问密码</h3>
      <label>
        原密码
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        新密码
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="至少 8 个字符"
        />
      </label>
      {message && (
        <p role="status" className="fine">
          {message}
        </p>
      )}
      <button className="secondary wide" disabled={busy}>
        更新密码
      </button>
    </form>
  );
}

function BoardApp() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [status, setStatus] = useState<BoardStatus | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const cloud = bootstrap?.deployment === 'cloud';
  useEffect(() => {
    if (!window.desktop) {
      setError('此页面仅用于白板桌面程序。观看教室请访问网站首页。');
      return;
    }
    let controller: BoardController | null = null;
    let disposed = false;
    let removeShutdown: (() => void) | undefined;
    void window.desktop
      .bootstrap()
      .then((value) => {
        if (disposed) return;
        setBootstrap(value);
        controller = new BoardController(value, (state, stream) => {
          setStatus(state);
          if (video.current) video.current.srcObject = stream;
        });
        removeShutdown = window.desktop!.onShutdown(() => controller!.close());
        controller.start();
      })
      .catch((error) => setError(error.message));
    return () => {
      disposed = true;
      removeShutdown?.();
      void controller?.close();
    };
  }, []);
  return (
    <div className="board-shell">
      <header>
        <Brand />
        <span className={`badge ${status?.online ? 'green' : 'gray'}`}>
          <i />
          {status?.online ? '服务运行中' : '正在连接'}
        </span>
      </header>
      <div className="board-heading">
        <span className="eyebrow">白板采集端</span>
        <h1>让教室，随时可见。</h1>
        <p>
          {cloud
            ? '已绑定教室。手机和电脑打开教室网站即可观看，关闭此窗口后继续在后台运行。'
            : '把下方地址输入手机或电脑浏览器，即可连接此教室。'}
        </p>
      </div>
      {error && <div className="notice error">{error}</div>}
      {status?.error && <div className="notice error">{status.error}</div>}
      <div className="board-grid">
        <section className="card board-connect">
          <h3>手机 / 电脑访问</h3>
          <p className="muted">
            {cloud
              ? '你的教室网站。日常观看、录像和喊话都在网站完成。'
              : '请连接学校局域网，优先使用对应校园网卡的地址。'}
          </p>
          {bootstrap?.addresses.map((address) => (
            <div className="address-row" key={address}>
              <code>{address}</code>
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(address)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch((error) => setError(error.message));
                }}
              >
                复制
              </button>
            </div>
          ))}
          {copied && <span className="success-text">访问地址已复制</span>}
          {!cloud && (
            <label className="password-display">
              {bootstrap?.initialPassword ? '首次访问密码' : '访问密码'}
              <code>{bootstrap?.initialPassword ?? '已设置个人密码'}</code>
            </label>
          )}
          {cloud ? (
            <div className="notice success">
              已绑定教室 · 保持联网即可自动连接。录像按网站中的计划执行，保存在云端。
            </div>
          ) : (
            <>
              <div className="notice soft">
                第一次使用：在观看设备上下载并信任此白板的根证书，再登录。手机录音喊话需要受信任的
                HTTPS 连接。操作方法见项目部署文档。
              </div>
              <div className="board-actions">
                <a className="secondary" href="/certificate" download>
                  <Icon name="download" size={16} />
                  导出根证书
                </a>
                <button
                  className="secondary"
                  onClick={() => {
                    void window.desktop?.openDataDirectory();
                  }}
                >
                  <Icon name="folder" size={16} />
                  数据目录
                </button>
              </div>
            </>
          )}
        </section>
        <section className="card board-preview">
          <div className="card-header">
            <strong>本机采集状态</strong>
            <span className={`badge ${status?.recording ? 'red' : 'gray'}`}>
              {status?.recording ? '正在录像' : status?.camera === 'ready' ? '正在预览' : '待命'}
            </span>
          </div>
          <div className="board-video">
            <video ref={video} autoPlay playsInline muted />
            {status?.camera !== 'ready' && (
              <div>
                <Icon name="camera" size={36} />
                <p>
                  {status?.camera === 'error'
                    ? '摄像头暂不可用'
                    : status?.camera === 'starting'
                      ? '正在打开摄像头'
                      : '有观看或录像任务时启动摄像头'}
                </p>
              </div>
            )}
          </div>
          <div className="board-details">
            <p>
              <span>录像模式</span>
              <strong>按网页端时间表执行 · 默认关闭</strong>
            </p>
            <p>
              <span>教室声音</span>
              <strong>不采集 · 支持扬声器喊话</strong>
            </p>
            <label className="autostart">
              <input
                type="checkbox"
                checked={bootstrap?.autoStart ?? false}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  void window.desktop
                    ?.setAutoStart(enabled)
                    .then((autoStart) =>
                      setBootstrap((previous) =>
                        previous ? { ...previous, autoStart } : previous,
                      ),
                    )
                    .catch((error) => setError(error.message));
                }}
              />
              Windows 登录后自动启动
            </label>
          </div>
        </section>
      </div>
      <footer className="board-footer">
        <Icon name="shield" size={17} />
        <span>关闭窗口后在托盘继续运行；从托盘退出将停止采集。请保持白板开机并避免系统休眠。</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
