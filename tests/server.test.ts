import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { connect } from 'node:tls';
import type { IncomingHttpHeaders } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../src/server/app.js';
import type { Overview, Settings } from '../src/shared/types.js';

let directory: string;
let service: Awaited<ReturnType<typeof startServer>>;
let cookie = '';

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    authenticated?: boolean;
  } = {},
) {
  const method = options.method ?? 'GET';
  const content = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: any }>(
    (resolve, reject) => {
      const call = https.request(
        {
          hostname: 'localhost',
          port: service.port,
          path,
          method,
          rejectUnauthorized: false,
          headers: {
            ...(options.authenticated === false ? {} : { Cookie: cookie }),
            ...(method === 'GET' ? {} : { Origin: `https://localhost:${service.port}` }),
            ...(content
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': String(Buffer.byteLength(content)),
                }
              : {}),
            ...options.headers,
          },
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on('data', (part) => parts.push(part));
          response.on('end', () => {
            const text = Buffer.concat(parts).toString();
            resolve({
              status: response.statusCode!,
              headers: response.headers,
              body: text ? JSON.parse(text) : null,
            });
          });
        },
      );
      call.on('error', reject);
      call.end(content);
    },
  );
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-api-'));
  await mkdir(join(directory, 'web'));
  await writeFile(join(directory, 'web/index.html'), '<!doctype html><title>test</title>');
  service = await startServer({
    dataDirectory: join(directory, 'data'),
    webDirectory: join(directory, 'web'),
    port: 0,
    host: '127.0.0.1',
  });
});

after(async () => {
  await service?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('认证保护接口，登录 Cookie 受限，初始配置默认关闭', async () => {
  assert.equal((await request('/api/overview', { authenticated: false })).status, 401);
  assert.equal(
    (await request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status,
    401,
  );
  const login = await request('/api/login', {
    method: 'POST',
    body: { password: service.getInitialPassword() },
  });
  assert.equal(login.status, 200);
  const session = login.headers['set-cookie']![0];
  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/);
  assert.match(session, /SameSite=Strict/);
  cookie = session.split(';')[0];
  const overview = (await request('/api/overview')).body as Overview;
  assert.equal(overview.settings.recordingEnabled, false);
  assert.deepEqual(overview.settings.schedules, []);
  assert.equal(overview.board.online, false);
  assert.equal('boardToken' in overview, false);
});

test('跨站写入被拒，设置校验并持久化，观看者不能使用采集接口', async () => {
  const overview = (await request('/api/overview')).body as Overview;
  assert.equal(
    (
      await request('/api/settings', {
        method: 'PUT',
        body: overview.settings,
        headers: { Origin: 'https://evil.test' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/settings', {
        method: 'PUT',
        body: { ...overview.settings, retentionDays: 5 },
      })
    ).status,
    400,
  );
  assert.equal((await request('/api/board/recordings/start', { method: 'POST' })).status, 403);
  assert.equal(
    (
      await request('/api/board/recordings/start', {
        method: 'POST',
        headers: { 'x-board-token': service.boardToken },
      })
    ).status,
    409,
  );
  const settings: Settings = { ...overview.settings, classroomName: '测试教室', retentionDays: 2 };
  assert.equal((await request('/api/settings', { method: 'PUT', body: settings })).status, 200);
  assert.equal((await request('/api/overview')).body.settings.classroomName, '测试教室');
});

test('白板令牌连接和状态转发，单观看者替换旧页面', async () => {
  const board = new WebSocket(`wss://localhost:${service.port}/ws`, ['board', service.boardToken], {
    rejectUnauthorized: false,
  });
  await once(board, 'open');
  board.send(
    JSON.stringify({ type: 'status', camera: 'idle', recording: false, cameras: [], error: '' }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await request('/api/overview')).body.board.online, true);
  const viewer = new WebSocket(`wss://localhost:${service.port}/ws`, {
    rejectUnauthorized: false,
    headers: { Cookie: cookie, Origin: `https://localhost:${service.port}` },
  });
  await once(viewer, 'open');
  const replaced = once(viewer, 'close');
  const next = new WebSocket(`wss://localhost:${service.port}/ws`, {
    rejectUnauthorized: false,
    headers: { Cookie: cookie, Origin: `https://localhost:${service.port}` },
  });
  await once(next, 'open');
  assert.equal((await replaced)[0], 4009);
  const nextClosed = once(next, 'close');
  next.close();
  await nextClosed;
  const boardClosed = once(board, 'close');
  board.close();
  await boardClosed;
  for (let index = 0; index < 20 && (await request('/api/overview')).body.board.online; index++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await request('/api/overview')).body.board.online, false);
});

test('修改密码删除初始明文，退出后接口不可用', async () => {
  const result = await request('/api/password', {
    method: 'POST',
    body: { currentPassword: service.getInitialPassword(), newPassword: 'new-test-password' },
  });
  assert.equal(result.status, 200);
  assert.equal(service.getInitialPassword(), null);
  assert.equal((await request('/api/logout', { method: 'POST' })).status, 200);
  assert.equal((await request('/api/overview')).status, 401);
  const login = await request('/api/login', {
    method: 'POST',
    body: { password: 'new-test-password' },
  });
  assert.equal(login.status, 200);
});

test('退出会在有限时间内关闭尚未发出 HTTP 请求的 TLS 预连接', async () => {
  const shutdownDirectory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-shutdown-'));
  const shutdownService = await startServer({
    dataDirectory: shutdownDirectory,
    webDirectory: join(directory, 'web'),
    port: 0,
    host: '127.0.0.1',
  });
  const connection = connect({
    host: '127.0.0.1',
    port: shutdownService.port,
    rejectUnauthorized: false,
  });
  try {
    await once(connection, 'secureConnect');
    const startedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        shutdownService.close(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('服务退出超过 4 秒')), 4000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.ok(Date.now() - startedAt < 3500);
  } finally {
    connection.destroy();
    await rm(shutdownDirectory, { recursive: true, force: true });
  }
});
