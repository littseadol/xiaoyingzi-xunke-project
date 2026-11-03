import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import https from 'node:https';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Store } from '../src/server/store.js';
import { startServer } from '../src/server/app.js';
import { DeviceBinding, normalizeOrigin, turnServers } from '../src/server/cloud.js';

test('cloud origins reject insecure and credentialed addresses', () => {
  assert.equal(normalizeOrigin('https://class.example.com/'), 'https://class.example.com');
  for (const address of [
    'http://class.example.com',
    'https://user@class.example.com',
    'https://class.example.com/path',
  ])
    assert.throws(() => normalizeOrigin(address));
});

test('TURN credentials expire quickly and depend on deployment secret', () => {
  const options = { urls: ['turn:turn.example.com:3478'], secret: 'a'.repeat(64) };
  const first = turnServers(options, 1_800_000_000_000)[0];
  const next = turnServers(options, 1_800_000_001_000)[0];
  const other = turnServers({ ...options, secret: 'b'.repeat(64) }, 1_800_000_000_000)[0];
  assert.notEqual(first.username, next.username);
  assert.notEqual(first.credential, other.credential);
  assert.match(first.username!, /^1800003600:classroom$/);
  assert.throws(() => turnServers({ ...options, urls: [] }), /TURN/);
  assert.throws(() => turnServers({ ...options, urls: ['https://invalid.example.com'] }), /TURN/);
  assert.throws(() => turnServers({ ...options, secret: 'short' }), /TURN/);
});

test('pairing expiration, throttling, replacement and persistent credential boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-binding-restart-'));
  let store = await Store.open(directory);
  try {
    let binding = new DeviceBinding(store);
    const expired = binding.issue(0);
    assert.throws(() => binding.claim(expired.code, 600000), /已过期/);
    const invitation = binding.issue(1000000);
    for (let attempt = 0; attempt < 20; attempt++)
      assert.throws(() => binding.claim('invalid', 1000001), /不正确/);
    assert.throws(() => binding.claim(invitation.code, 1000002), /过多/);
    const token = binding.claim(invitation.code, 1060001);
    store.close();
    store = await Store.open(directory);
    binding = new DeviceBinding(store);
    assert.equal(binding.authorized(token), true);
    const replacement = binding.claim(binding.issue(2000000).code, 2000001);
    assert.equal(binding.authorized(token), false);
    assert.equal(binding.authorized(replacement), true);
    binding.revoke();
    store.close();
    store = await Store.open(directory);
    assert.equal(new DeviceBinding(store).authorized(replacement), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('pairing code is one-time and device token is revocable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-cloud-binding-'));
  const store = await Store.open(directory);
  const binding = new DeviceBinding(store);
  try {
    const invitation = binding.issue(1000);
    assert.throws(() => binding.claim('AAAAAAAAAAAA', 1001), /不正确/);
    const token = binding.claim(invitation.code.toLowerCase(), 1002);
    assert.equal(binding.authorized(token), true);
    assert.notEqual(store.get<{ digest: string }>('deviceBinding')?.digest, token);
    assert.throws(() => binding.claim(invitation.code, 1003), /不正确/);
    binding.revoke();
    assert.equal(binding.authorized(token), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cloud website authenticates one-time pairing and revoke disables collector access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-cloud-api-'));
  const webDirectory = join(directory, 'web');
  await mkdir(webDirectory);
  await writeFile(join(webDirectory, 'index.html'), '<!doctype html><title>cloud test</title>');
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const origin = `https://localhost:${port}`;
  const service = await startServer({
    dataDirectory: join(directory, 'data'),
    webDirectory,
    port,
    host: '127.0.0.1',
    publicOrigin: origin,
  });
  const request = (
    path: string,
    options: {
      method?: string;
      body?: unknown;
      cookie?: string;
      includeOrigin?: boolean;
      headers?: Record<string, string>;
    } = {},
  ) =>
    new Promise<{ status: number; body: any; cookie?: string }>((resolve, reject) => {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      const outgoing = https.request(
        {
          hostname: 'localhost',
          port,
          path,
          method: options.method ?? 'GET',
          rejectUnauthorized: false,
          headers: {
            ...(options.cookie ? { cookie: options.cookie } : {}),
            ...(options.includeOrigin ? { origin } : {}),
            ...(body
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
              : {}),
            ...options.headers,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            resolve({
              status: response.statusCode!,
              body: text ? JSON.parse(text) : null,
              cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
            });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  const boardSession = (token: string) =>
    new Promise<number>((resolve, reject) => {
      const outgoing = https.request(
        {
          hostname: 'localhost',
          port,
          path: '/api/board/session',
          rejectUnauthorized: false,
          headers: { 'x-board-token': token },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode!));
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  try {
    assert.equal((await request('/api/device')).status, 401);
    assert.equal((await request('/api/ice')).status, 401);
    assert.equal(
      (await request('/api/health', { headers: { Host: 'untrusted.example.com' } })).status,
      403,
    );
    assert.equal(
      (
        await request('/api/login', {
          method: 'POST',
          body: {},
          headers: { Origin: 'https://untrusted.example.com' },
        })
      ).status,
      403,
    );
    const login = await request('/api/login', {
      method: 'POST',
      body: { password: service.getInitialPassword() },
      includeOrigin: true,
    });
    assert.equal(login.status, 200);
    assert.ok(login.cookie);
    assert.equal(
      (await request('/api/device/invitation', { method: 'POST', cookie: login.cookie })).status,
      403,
    );
    const invitation = await request('/api/device/invitation', {
      method: 'POST',
      cookie: login.cookie,
      includeOrigin: true,
    });
    assert.equal(invitation.status, 200);
    assert.match(invitation.body.code, /^[A-F0-9]{12}$/);
    const paired = await request('/api/device/claim', {
      method: 'POST',
      body: { code: invitation.body.code },
    });
    assert.equal(paired.status, 200);
    assert.equal(await boardSession(paired.body.token), 200);
    assert.equal(
      (await request('/api/device/claim', { method: 'POST', body: { code: invitation.body.code } }))
        .status,
      400,
    );
    assert.equal(
      (
        await request('/api/device', {
          method: 'DELETE',
          cookie: login.cookie,
          includeOrigin: true,
        })
      ).status,
      200,
    );
    assert.equal(await boardSession(paired.body.token), 403);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reverse proxy HTTP keeps public Host/Origin and collector WebSocket authorization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-proxy-api-'));
  const origin = 'https://class.example.com';
  const service = await startServer({
    dataDirectory: directory,
    webDirectory: directory,
    port: 0,
    host: '127.0.0.1',
    publicOrigin: origin,
    proxyHttp: true,
    turn: { secret: 'a'.repeat(64), urls: ['turn:turn.example.com:3478?transport=tcp'] },
  });
  const base = `http://127.0.0.1:${service.port}`;
  const proxyRequest = (
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) =>
    new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest(
        url,
        { method: options.method, headers: options.headers },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk) => chunks.push(chunk));
          incoming.on('end', () => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers))
              if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }));
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(options.body);
    });
  let device: WebSocket | undefined;
  try {
    assert.equal((await proxyRequest(`${base}/api/health`)).status, 403);
    const login = await proxyRequest(`${base}/api/login`, {
      method: 'POST',
      headers: { Host: 'class.example.com', Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: service.getInitialPassword() }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie')!, /Secure; HttpOnly|HttpOnly; Secure/);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Host: 'class.example.com', Origin: origin, Cookie: cookie };
    const invitation = (await (
      await proxyRequest(`${base}/api/device/invitation`, { method: 'POST', headers })
    ).json()) as { code: string };
    const paired = (await (
      await proxyRequest(`${base}/api/device/claim`, {
        method: 'POST',
        headers: { Host: 'class.example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: invitation.code }),
      })
    ).json()) as { token: string };
    assert.equal(
      (
        await proxyRequest(`${base}/api/board/session`, {
          headers: { Host: 'class.example.com', 'x-board-token': service.boardToken },
        })
      ).status,
      403,
    );
    const ice = (await (await proxyRequest(`${base}/api/ice`, { headers })).json()) as {
      iceServers: unknown[];
    };
    assert.equal(ice.iceServers.length, 1);
    device = new WebSocket(`ws://127.0.0.1:${service.port}/ws`, ['board', paired.token], {
      headers: { Host: 'class.example.com', Origin: origin },
    });
    await once(device, 'open');
    const closed = once(device, 'close');
    assert.equal(
      (await proxyRequest(`${base}/api/device`, { method: 'DELETE', headers })).status,
      200,
    );
    assert.equal((await closed)[0], 4003);
    assert.equal(
      (
        await proxyRequest(`${base}/api/board/session`, {
          headers: { Host: 'class.example.com', 'x-board-token': paired.token },
        })
      ).status,
      403,
    );
  } finally {
    device?.terminate();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
