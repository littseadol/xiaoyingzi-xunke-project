import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Store } from './store.js';
import { ensureCertificates, lanAddresses } from './certificates.js';
import {
  hasSameOrigin,
  isLoopback,
  passwordHash,
  passwordMatches,
  sameSecret,
  sessionCookie,
} from './security.js';
import { isRecordingDue, validateSettings } from './schedule.js';
import { Recordings } from './recordings.js';
import type { BoardStatus, Overview } from '../shared/types.js';
import { DeviceBinding, normalizeOrigin, turnServers, type TurnOptions } from './cloud.js';

export interface ServerOptions {
  dataDirectory: string;
  webDirectory: string;
  port?: number;
  host?: string;
  publicOrigin?: string;
  proxyHttp?: boolean;
  turn?: TurnOptions;
  downloadDirectory?: string;
}

export async function startServer(options: ServerOptions) {
  const publicOrigin = options.publicOrigin ? normalizeOrigin(options.publicOrigin) : null;
  if (options.proxyHttp && !publicOrigin)
    throw new Error('反向代理模式必须配置公开 HTTPS 网站地址');
  turnServers(options.turn);
  const directory = resolve(options.dataDirectory);
  await mkdir(directory, { recursive: true });
  await mkdir(join(directory, 'shouts'), { recursive: true });
  const store = await Store.open(directory);
  const initialPasswordPath = join(directory, 'initial-password.txt');
  if (!store.get<string>('passwordHash')) {
    const password = randomBytes(9).toString('base64url');
    await writeFile(initialPasswordPath, password, { mode: 0o600 });
    store.set('passwordHash', passwordHash(password));
  }
  const certificates = ensureCertificates(directory);
  const boardToken = randomBytes(32).toString('hex');
  const binding = new DeviceBinding(store);
  const recordings = new Recordings(store, join(directory, 'recordings'));
  await recordings.initialize();
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  let boardSocket: WebSocket | null = null;
  let viewerSocket: WebSocket | null = null;
  let watching = false;
  let watchId = '';
  let boardStatus: BoardStatus = {
    online: false,
    camera: 'idle',
    recording: false,
    cameras: [],
    error: '',
    lastSeen: null,
  };
  let shout: Overview['shout'] = null;
  let shoutFile: string | null = null;
  let shoutExpires = 0;
  let port = options.port ?? 8443;
  const app = express();
  app.disable('x-powered-by');
  const server = options.proxyHttp
    ? createHttpServer(app)
    : createHttpsServer({ key: certificates.key, cert: certificates.cert }, app);
  const connections = new Set<Duplex>();
  server.on('connection', (connection) => {
    connections.add(connection);
    connection.once('close', () => connections.delete(connection));
  });
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const hosts = new Set(['localhost', '127.0.0.1', ...lanAddresses()]);
  const hostAllowed = (host = '') =>
    publicOrigin ? host === new URL(publicOrigin).host : hosts.has(host.split(':')[0]);
  const deviceAuthorized = (token: string, address?: string) =>
    publicOrigin ? binding.authorized(token) : isLoopback(address) && sameSecret(token, boardToken);
  const boardAuthorized = (request: Request) =>
    deviceAuthorized(request.get('x-board-token') ?? '', request.socket.remoteAddress);
  const expectedOrigin = (host?: string) => publicOrigin ?? `https://${host}`;
  const viewerAuthorized = (cookie?: string) =>
    (sessions.get(sessionCookie(cookie)) ?? 0) > Date.now();
  const send = (socket: WebSocket | null, value: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const sendControl = () =>
    send(boardSocket, {
      type: 'control',
      recording: isRecordingDue(store.settings()),
      watching,
      watchId,
      cameraId: store.settings().cameraId,
      iceServers: turnServers(options.turn),
    });
  const overview = async (): Promise<Overview> => ({
    deployment: publicOrigin ? 'cloud' : 'local',
    settings: store.settings(),
    board: boardStatus,
    recordingDue: isRecordingDue(store.settings()),
    serverTime: new Date().toISOString(),
    storage: await recordings.storage(),
    shout,
  });
  const requireViewer = (request: Request, response: Response, next: NextFunction) => {
    if (!viewerAuthorized(request.headers.cookie)) {
      response.status(401).json({ error: '请先登录' });
      return;
    }
    next();
  };
  const requireBoard = (request: Request, response: Response, next: NextFunction) => {
    if (!boardAuthorized(request)) {
      response.status(403).json({ error: '仅白板采集端可访问' });
      return;
    }
    next();
  };
  app.use((request, response, next) => {
    if (!hostAllowed(request.headers.host)) {
      response.status(403).json({ error: '访问地址不受信任，请使用白板显示的地址' });
      return;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !boardAuthorized(request) &&
      !(publicOrigin ? request.headers.origin === publicOrigin : hasSameOrigin(request)) &&
      !(publicOrigin && request.path === '/api/device/claim')
    ) {
      response.status(403).json({ error: '请求来源不正确' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_request, response) => response.json({ ok: true, version: '0.2.0' }));
  app.get('/api/config', (_request, response) =>
    response.json({
      deployment: publicOrigin ? 'cloud' : 'local',
      installerAvailable: Boolean(
        options.downloadDirectory &&
        existsSync(join(options.downloadDirectory, 'XiaoYingZi-Setup.exe')),
      ),
    }),
  );
  app.get('/api/ice', requireViewer, (_request, response) =>
    response.json({ iceServers: turnServers(options.turn) }),
  );
  app.get('/api/device', requireViewer, (_request, response) => response.json(binding.status()));
  app.post('/api/device/invitation', requireViewer, (_request, response) => {
    if (!publicOrigin) {
      response.status(409).json({ error: '此功能仅用于云端绑定' });
      return;
    }
    response.json(binding.issue());
  });
  app.post('/api/device/claim', (request, response) => {
    if (!publicOrigin) {
      response.status(404).end();
      return;
    }
    try {
      const token = binding.claim(request.body?.code);
      boardSocket?.close(4009, '设备绑定已更新');
      response.json({ token });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : '绑定失败' });
    }
  });
  app.delete('/api/device', requireViewer, (_request, response) => {
    binding.revoke();
    boardSocket?.close(4003, '设备绑定已解除');
    response.json({ ok: true });
  });
  app.get('/api/board/session', requireBoard, (_request, response) => response.json({ ok: true }));
  app.get('/api/session', (request, response) =>
    response.json({ authenticated: viewerAuthorized(request.headers.cookie) }),
  );
  app.post('/api/login', (request, response) => {
    const address = request.socket.remoteAddress ?? 'unknown';
    let attempt = attempts.get(address);
    if (!attempt || attempt.until < Date.now()) {
      attempt = { count: 0, until: Date.now() + 60000 };
      attempts.set(address, attempt);
    }
    if (attempt.count >= 5) {
      response.status(429).json({ error: '尝试过多，请一分钟后再试' });
      return;
    }
    const password = request.body?.password;
    if (
      typeof password !== 'string' ||
      password.length > 128 ||
      !passwordMatches(password, store.get<string>('passwordHash')!)
    ) {
      attempt.count++;
      response.status(401).json({ error: '访问密码不正确' });
      return;
    }
    attempts.delete(address);
    const session = randomBytes(32).toString('hex');
    sessions.set(session, Date.now() + 86400000);
    response.setHeader(
      'Set-Cookie',
      `xy_session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
    );
    response.json({ ok: true });
  });
  app.post('/api/logout', requireViewer, (request, response) => {
    const session = sessionCookie(request.headers.cookie);
    sessions.delete(session);
    if (
      viewerSocket &&
      (viewerSocket as WebSocket & { viewerSession?: string }).viewerSession === session
    )
      viewerSocket.close(4001, '已退出登录');
    response.setHeader(
      'Set-Cookie',
      'xy_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    );
    response.json({ ok: true });
  });
  app.post('/api/password', requireViewer, async (request, response) => {
    const { currentPassword, newPassword } = request.body ?? {};
    if (
      typeof currentPassword !== 'string' ||
      currentPassword.length > 128 ||
      !passwordMatches(currentPassword, store.get<string>('passwordHash')!)
    ) {
      response.status(400).json({ error: '原密码不正确' });
      return;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      response.status(400).json({ error: '新密码需为 8—128 个字符' });
      return;
    }
    store.set('passwordHash', passwordHash(newPassword));
    await unlink(initialPasswordPath).catch(() => undefined);
    const current = sessionCookie(request.headers.cookie);
    for (const session of sessions.keys()) if (session !== current) sessions.delete(session);
    response.json({ ok: true });
  });
  app.get('/api/overview', requireViewer, async (_request, response) =>
    response.json(await overview()),
  );
  app.put('/api/settings', requireViewer, async (request, response) => {
    const settings = validateSettings(request.body);
    store.set('settings', settings);
    sendControl();
    await recordings.maintenance();
    response.json(settings);
  });
  app.get('/api/recordings', requireViewer, (request, response) => {
    const day = typeof request.query.date === 'string' ? request.query.date : '';
    const rows = store
      .listRecordings()
      .filter(
        (record) =>
          !day ||
          new Date(Date.parse(record.startedAt) + 8 * 3600000).toISOString().slice(0, 10) === day,
      );
    response.json(rows);
  });
  app.get('/api/recordings/:id/video', requireViewer, (request, response) => {
    const record = recordings.find(String(request.params.id));
    if (!record || record.status !== 'ready') {
      response.status(404).json({ error: '录像不存在或尚未处理完成' });
      return;
    }
    if (request.query.download === '1')
      response.attachment(`classroom-${record.startedAt.replaceAll(':', '-')}.mp4`);
    response.sendFile(recordings.path(record.id));
  });
  app.delete('/api/recordings/:id', requireViewer, async (request, response) => {
    await recordings.remove(String(request.params.id));
    response.json({ ok: true });
  });
  app.get('/certificate', (_request, response) => {
    if (publicOrigin) {
      response.status(404).end();
      return;
    }
    response.download(certificates.caPath, 'xiaoyingzi-root.crt');
  });
  app.get('/downloads/collector', requireViewer, (_request, response) => {
    const installer = options.downloadDirectory
      ? join(options.downloadDirectory, 'XiaoYingZi-Setup.exe')
      : null;
    if (!installer || !existsSync(installer)) {
      response.status(404).json({ error: '安装包尚未上传，请联系维护者' });
      return;
    }
    response.download(installer, 'XiaoYingZi-Setup.exe');
  });
  app.post(
    '/api/shouts',
    requireViewer,
    express.raw({ type: ['audio/webm', 'audio/mp4', 'audio/ogg'], limit: '2mb' }),
    async (request, response) => {
      if (!boardStatus.online) {
        response.status(409).json({ error: '白板未连接，无法喊话' });
        return;
      }
      if (shout && ['queued', 'playing'].includes(shout.status) && shoutExpires > Date.now()) {
        response.status(409).json({ error: '上一条语音尚未播放完成' });
        return;
      }
      if (!Buffer.isBuffer(request.body) || !request.body.length) {
        response.status(400).json({ error: '语音格式不支持或内容为空' });
        return;
      }
      const duration = Number(request.get('x-duration'));
      if (!Number.isFinite(duration) || duration <= 0 || duration > 21) {
        response.status(400).json({ error: '语音长度需在 20 秒以内' });
        return;
      }
      if (shoutFile) await unlink(shoutFile).catch(() => undefined);
      const id = randomUUID();
      const extension = request.is('audio/mp4') ? 'm4a' : request.is('audio/ogg') ? 'ogg' : 'webm';
      shoutFile = join(directory, 'shouts', `${id}.${extension}`);
      await writeFile(shoutFile, request.body);
      shout = { id, status: 'queued', error: '' };
      shoutExpires = Date.now() + 60000;
      send(boardSocket, { type: 'shout', id, mimeType: request.get('content-type') });
      response.json(shout);
    },
  );
  app.get('/api/board/shouts/:id', requireBoard, async (request, response) => {
    if (!shoutFile || !shout || shout.id !== request.params.id || shoutExpires < Date.now()) {
      response.status(404).end();
      return;
    }
    response.sendFile(shoutFile);
  });
  app.post('/api/board/recordings/start', requireBoard, async (_request, response) => {
    if (!isRecordingDue(store.settings())) {
      response.status(409).json({ error: '当前不在已开启的录像时段' });
      return;
    }
    response.json(await recordings.start());
  });
  app.post(
    '/api/board/recordings/:id/chunk',
    requireBoard,
    express.raw({ type: 'application/octet-stream', limit: '8mb' }),
    async (request, response) => {
      if (!Buffer.isBuffer(request.body)) {
        response.status(400).json({ error: '录像数据格式错误' });
        return;
      }
      await recordings.append(
        String(request.params.id),
        request.body,
        Number(request.get('x-chunk-index')),
      );
      response.json({ ok: true });
    },
  );
  app.post('/api/board/recordings/:id/finish', requireBoard, (request, response) => {
    recordings.finish(String(request.params.id), request.body?.interrupted === true);
    response.json({ ok: true });
  });
  app.get('/api/board/settings', requireBoard, (_request, response) =>
    response.json(store.settings()),
  );
  app.use('/api', (_request, response) => response.status(404).json({ error: '接口不存在' }));
  app.use(express.static(options.webDirectory, { index: false }));
  app.get(['/', '/board'], (_request, response) =>
    response.sendFile(join(resolve(options.webDirectory), 'index.html')),
  );
  app.use(
    (
      error: Error & { status?: number; type?: string },
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      console.error('[request]', error.message);
      response
        .status(error.status && error.status >= 400 && error.status < 500 ? error.status : 400)
        .json({ error: error.message || '请求处理失败' });
    },
  );

  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((item) => item.trim());
    const board =
      protocols[0] === 'board' &&
      deviceAuthorized(protocols[1] ?? '', request.socket.remoteAddress);
    const viewer =
      !board &&
      viewerAuthorized(request.headers.cookie) &&
      origin === expectedOrigin(request.headers.host);
    if (request.url !== '/ws' || !hostAllowed(request.headers.host) || (!board && !viewer)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    websocket.handleUpgrade(request, socket, head, (connection) => {
      (connection as WebSocket & { alive: boolean }).alive = true;
      connection.on('pong', () => {
        (connection as WebSocket & { alive: boolean }).alive = true;
      });
      if (board) {
        if (boardSocket) boardSocket.close(4009, '采集端已替换');
        boardSocket = connection;
        boardStatus = { ...boardStatus, online: true, lastSeen: new Date().toISOString() };
        sendControl();
      } else {
        if (viewerSocket) viewerSocket.close(4009, '另一个页面已打开');
        viewerSocket = connection;
        (connection as WebSocket & { viewerSession?: string }).viewerSession = sessionCookie(
          request.headers.cookie,
        );
        watching = false;
        sendControl();
        send(connection, { type: 'connected' });
      }
      connection.on('message', (raw) => {
        if ((board && connection !== boardSocket) || (!board && connection !== viewerSocket))
          return;
        try {
          const message = JSON.parse(raw.toString());
          if (board && message.type === 'status') {
            boardStatus = {
              online: true,
              camera: ['idle', 'starting', 'ready', 'error'].includes(message.camera)
                ? message.camera
                : 'error',
              recording: message.recording === true,
              cameras: Array.isArray(message.cameras)
                ? message.cameras
                    .slice(0, 20)
                    .filter(
                      (item: { deviceId?: unknown; label?: unknown }) =>
                        typeof item?.deviceId === 'string' && typeof item?.label === 'string',
                    )
                : [],
              error: String(message.error ?? '').slice(0, 500),
              lastSeen: new Date().toISOString(),
            };
            send(viewerSocket, { type: 'board-status', status: boardStatus });
          } else if (!board && message.type === 'watch') {
            if (message.enabled === true && !watching) watchId = randomUUID();
            watching = message.enabled === true;
            sendControl();
          } else if (
            message.type === 'signal' &&
            watching &&
            message.data &&
            JSON.stringify(message.data).length < 100000
          ) {
            send(board ? viewerSocket : boardSocket, { type: 'signal', data: message.data });
          } else if (
            board &&
            message.type === 'shout-status' &&
            shout &&
            shout.id === message.id &&
            ['playing', 'played', 'failed'].includes(message.status)
          ) {
            shout = {
              id: shout.id,
              status: message.status,
              error: String(message.error ?? '').slice(0, 300),
            };
          }
        } catch {
          send(connection, { type: 'error', error: '消息格式不正确' });
        }
      });
      connection.on('error', (error) => console.error('[socket]', error.message));
      connection.on('close', () => {
        if (board && connection === boardSocket) {
          boardSocket = null;
          boardStatus = { ...boardStatus, online: false, recording: false, camera: 'idle' };
          send(viewerSocket, { type: 'board-status', status: boardStatus });
        } else if (!board && connection === viewerSocket) {
          viewerSocket = null;
          watching = false;
          sendControl();
        }
      });
    });
  });
  const tick = setInterval(() => {
    sendControl();
    for (const [session, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(session);
    for (const [address, attempt] of attempts)
      if (attempt.until <= Date.now()) attempts.delete(address);
    if (
      viewerSocket &&
      !viewerAuthorized(
        `xy_session=${(viewerSocket as WebSocket & { viewerSession?: string }).viewerSession}`,
      )
    )
      viewerSocket.close(4001, '登录已过期');
    if (shout && ['queued', 'playing'].includes(shout.status) && shoutExpires <= Date.now())
      shout = { ...shout, status: 'failed', error: '白板播放超时，请检查扬声器与网络' };
    if (shoutFile && shoutExpires <= Date.now()) {
      void unlink(shoutFile).catch(() => undefined);
      shoutFile = null;
    }
  }, 3000);
  const heartbeat = setInterval(() => {
    for (const connection of websocket.clients) {
      const state = connection as WebSocket & { alive: boolean };
      if (!state.alive) {
        connection.terminate();
        continue;
      }
      state.alive = false;
      connection.ping();
    }
    void recordings.maintenance().catch((error) => console.error('[maintenance]', error));
  }, 30000);

  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, options.host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolveListen();
      });
    });
  } catch (error) {
    clearInterval(tick);
    clearInterval(heartbeat);
    await recordings.close();
    store.close();
    throw error;
  }
  const address = server.address();
  if (address && typeof address === 'object') port = address.port;

  return {
    port,
    boardToken,
    certificates,
    directory,
    addresses: publicOrigin
      ? [publicOrigin]
      : [
          ...lanAddresses().map((address) => `https://${address}:${port}`),
          `https://localhost:${port}`,
        ],
    getInitialPassword: () =>
      existsSync(initialPasswordPath) ? readFileSync(initialPasswordPath, 'utf8').trim() : null,
    close: async () => {
      clearInterval(tick);
      clearInterval(heartbeat);
      for (const connection of websocket.clients) connection.terminate();
      websocket.close();
      await new Promise<void>((resolveClose) => {
        const deadline = setTimeout(() => {
          for (const connection of connections) connection.destroy();
        }, 2000);
        server.close(() => {
          clearTimeout(deadline);
          resolveClose();
        });
      });
      await recordings.close();
      store.close();
    },
  };
}
