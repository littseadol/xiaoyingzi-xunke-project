import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Recording } from '../shared/types.js';
import type { Store } from './store.js';

const ffmpegPath =
  process.env.FFMPEG_BIN || (createRequire(import.meta.url)('ffmpeg-static') as string | null);

export class Recordings {
  private active: { record: Recording; index: number; lastChunk: number } | null = null;
  private jobs: string[] = [];
  private converting = false;
  private closing = false;
  private process: ChildProcess | null = null;
  private maintenanceRunning = false;

  constructor(
    private store: Store,
    readonly directory: string,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const record of this.store.listRecordings()) {
      if (record.status === 'writing') {
        this.store.saveRecording({
          ...record,
          status: 'interrupted',
          endedAt: new Date().toISOString(),
          error: '程序退出或设备断开，正在尝试恢复已收到的片段',
        });
        this.jobs.push(record.id);
      } else if (record.status === 'processing' || record.status === 'interrupted') {
        this.jobs.push(record.id);
      }
    }
    await this.maintenance();
    void this.runJobs();
  }

  path(id: string, kind: 'raw' | 'video' | 'temporary' = 'video'): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('录像编号不正确');
    return join(
      this.directory,
      `${id}${kind === 'raw' ? '.webm.part' : kind === 'temporary' ? '.partial.mp4' : '.mp4'}`,
    );
  }

  async freeBytes(): Promise<number | null> {
    try {
      const info = await statfs(this.directory);
      return info.bavail * info.bsize;
    } catch {
      return null;
    }
  }

  async storage(): Promise<{ freeBytes: number | null; videoBytes: number; directory: string }> {
    const filenames = await readdir(this.directory);
    const sizes = await Promise.all(
      filenames.map(
        async (filename) =>
          (await stat(join(this.directory, filename)).catch(() => null))?.size ?? 0,
      ),
    );
    return {
      freeBytes: await this.freeBytes(),
      videoBytes: sizes.reduce((total, size) => total + size, 0),
      directory: this.directory,
    };
  }

  async start(): Promise<Recording> {
    if (this.closing) throw new Error('服务正在退出');
    if (this.active) throw new Error('上一段录像尚未结束');
    if (this.jobs.length > 6) throw new Error('录像转码积压，请检查白板性能或磁盘');
    const free = await this.freeBytes();
    if (free !== null && free < 1024 ** 3) throw new Error('磁盘剩余空间不足 1 GB，录像已暂停');
    const record: Recording = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'writing',
      bytes: 0,
      error: '',
    };
    await appendFile(this.path(record.id, 'raw'), Buffer.alloc(0));
    this.active = { record, index: 0, lastChunk: Date.now() };
    this.store.saveRecording(record);
    return record;
  }

  async append(id: string, data: Buffer, index: number): Promise<void> {
    const active = this.active;
    if (!active || active.record.id !== id) throw new Error('录像片段已结束，请重新开始');
    if (index !== active.index) throw new Error('录像数据顺序不正确');
    if (active.record.bytes + data.length > 256 * 1024 ** 2)
      throw new Error('单段录像过大，已停止接收');
    await appendFile(this.path(id, 'raw'), data);
    active.index++;
    active.lastChunk = Date.now();
    active.record.bytes += data.length;
  }

  finish(id: string, interrupted = false): void {
    if (!this.active || this.active.record.id !== id) throw new Error('没有正在写入的录像');
    const record = this.active.record;
    this.active = null;
    this.store.saveRecording({
      ...record,
      status: interrupted ? 'interrupted' : 'processing',
      endedAt: new Date().toISOString(),
      error: interrupted ? '采集连接中断，尝试恢复片段' : '',
    });
    this.jobs.push(id);
    void this.runJobs();
  }

  find(id: string): Recording | undefined {
    return this.store.listRecordings().find((record) => record.id === id);
  }

  async maintenance(): Promise<void> {
    if (this.maintenanceRunning || this.closing) return;
    this.maintenanceRunning = true;
    try {
      if (this.active && Date.now() - this.active.lastChunk > 60000)
        this.finish(this.active.record.id, true);
      const cutoff = Date.now() - this.store.settings().retentionDays * 86400000;
      for (const record of this.store.listRecordings()) {
        if (
          ['writing', 'processing', 'interrupted'].includes(record.status) ||
          Date.parse(record.endedAt ?? record.startedAt) >= cutoff
        )
          continue;
        await this.remove(record.id);
      }
    } finally {
      this.maintenanceRunning = false;
    }
  }

  async remove(id: string): Promise<void> {
    const record = this.find(id);
    if (!record) throw new Error('录像不存在');
    if (['writing', 'processing', 'interrupted'].includes(record.status))
      throw new Error('录像正在写入或处理，请稍后再删除');
    for (const kind of ['raw', 'video', 'temporary'] as const) {
      await unlink(this.path(id, kind)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    this.store.deleteRecording(id);
  }

  private async runJobs(): Promise<void> {
    if (this.converting || this.closing) return;
    this.converting = true;
    try {
      while (this.jobs.length && !this.closing) {
        const id = this.jobs.shift()!;
        const record = this.find(id);
        if (!record) continue;
        try {
          this.store.saveRecording({ ...record, status: 'processing' });
          await this.convert(id);
          if (this.closing) break;
          await rename(this.path(id, 'temporary'), this.path(id));
          const info = await stat(this.path(id));
          this.store.saveRecording({ ...record, status: 'ready', bytes: info.size, error: '' });
          await unlink(this.path(id, 'raw')).catch(() => undefined);
        } catch (error) {
          if (!this.closing)
            this.store.saveRecording({
              ...record,
              status: 'failed',
              error: `录像处理失败：${error instanceof Error ? error.message : '未知错误'}`.slice(
                0,
                500,
              ),
            });
        }
      }
    } finally {
      this.converting = false;
    }
  }

  private convert(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!ffmpegPath) {
        reject(new Error('未找到 FFmpeg'));
        return;
      }
      const executable = ffmpegPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      const process = spawn(
        executable,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          this.path(id, 'raw'),
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '26',
          '-threads',
          '2',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          this.path(id, 'temporary'),
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      this.process = process;
      let detail = '';
      const timeout = setTimeout(() => process.kill(), 10 * 60000);
      process.stderr?.on('data', (data) => {
        detail = `${detail}${String(data)}`.slice(-1200);
      });
      process.once('error', (error) => {
        clearTimeout(timeout);
        this.process = null;
        reject(error);
      });
      process.once('exit', (code) => {
        clearTimeout(timeout);
        this.process = null;
        code === 0 ? resolve() : reject(new Error(detail || `编码器退出 (${code})`));
      });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.active) this.finish(this.active.record.id, true);
    const process = this.process;
    if (process) {
      await new Promise<void>((resolve) => {
        process.once('close', () => resolve());
        process.kill();
      });
    }
    while (this.converting) await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
