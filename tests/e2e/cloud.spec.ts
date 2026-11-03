import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash, X509Certificate } from 'node:crypto';
import { startServer } from '../../src/server/app.js';
import type { Overview, Settings, Recording } from '../../src/shared/types.js';

test('云端网站和采集安装引导：绑定、直播、云录像、喊话、重启和撤销', async ({
  browser,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-cloud-e2e-'));
  const desktopDirectory = join(directory, 'collector');
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('端口分配失败');
  const port = address.port;
  await new Promise<void>((done) => listener.close(() => done()));
  const origin = `https://localhost:${port}`;
  const service = await startServer({
    dataDirectory: join(directory, 'server'),
    webDirectory: resolve('dist'),
    host: '127.0.0.1',
    port,
    publicOrigin: origin,
  });
  const viewerContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  const certificate = new X509Certificate(service.certificates.cert);
  const spki = createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = () =>
    electron.launch({
      ...(process.env.XY_DESKTOP_EXE ? { executablePath: process.env.XY_DESKTOP_EXE } : {}),
      args: [
        ...(process.env.XY_DESKTOP_EXE ? [] : ['.']),
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--ignore-certificate-errors-spki-list=${spki}`,
      ],
      env: {
        ...process.env,
        XY_DATA_DIR: desktopDirectory,
        XY_LOCAL_MODE: '',
        XY_CLOUD_ORIGIN: origin,
        NODE_EXTRA_CA_CERTS: service.certificates.caPath,
      },
    });
  try {
    const viewer = await viewerContext.newPage();
    await viewer.goto(origin);
    await expect(viewer.getByText('教室画面加密连接，录像保存在云端')).toBeVisible();
    await viewer.getByLabel('访问密码', { exact: true }).fill(service.getInitialPassword()!);
    await viewer.getByRole('button', { name: '进入教室' }).click();
    await viewer.getByRole('button', { name: '录制与设置', exact: true }).click();
    await viewer.getByRole('button', { name: '生成绑定码', exact: true }).click();
    const code = await viewer.locator('.help-card code').textContent();
    expect(code).toMatch(/^[A-F0-9]{12}$/);
    desktop = await launch();
    const window = await desktop.firstWindow();
    await expect(window.getByRole('heading', { name: '连接一次，以后自动运行' })).toBeVisible();
    await expect(window.locator('#origin')).toHaveValue(origin);
    await window.locator('#code').fill(code!);
    await window.locator('#auto-start').uncheck();
    await window.getByRole('button', { name: '连接教室', exact: true }).click();
    await expect(window.getByText('服务运行中', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(
      window.getByText('已绑定教室 · 保持联网即可自动连接。录像按网站中的计划执行，保存在云端。'),
    ).toBeVisible();
    const encrypted = await readFile(join(desktopDirectory, 'cloud-binding.json'), 'utf8');
    expect(encrypted).not.toContain('token');
    await window.screenshot({ path: 'test-results/cloud-collector.png', fullPage: true });
    await viewer.getByRole('button', { name: '实时教室', exact: true }).click();
    await expect(viewer.getByText('白板在线', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: '开始观看', exact: true }).click();
    await expect(viewer.getByText('实时画面', { exact: true })).toBeVisible();
    await expect
      .poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await viewer.screenshot({ path: 'test-results/cloud-live.png', fullPage: true });
    const overview = (await (
      await viewerContext.request.get(`${origin}/api/overview`)
    ).json()) as Overview;
    const settings: Settings = {
      ...overview.settings,
      recordingEnabled: true,
      schedules: [
        { id: 'am', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' },
        { id: 'pm', days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' },
      ],
    };
    expect(
      (
        await viewerContext.request.put(`${origin}/api/settings`, {
          data: settings,
          headers: { Origin: origin },
        })
      ).ok(),
    ).toBe(true);
    await expect(window.getByText('正在录像', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: '停止观看' }).click();
    await viewer.waitForTimeout(2500);
    await expect(window.getByText('正在录像', { exact: true })).toBeVisible();
    await viewerContext.request.put(`${origin}/api/settings`, {
      data: { ...settings, recordingEnabled: false },
      headers: { Origin: origin },
    });
    await expect
      .poll(
        async () => {
          const records = (await (
            await viewerContext.request.get(`${origin}/api/recordings`)
          ).json()) as Recording[];
          return records.some((record) => record.status === 'ready');
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const talk = viewer.getByRole('button', { name: /按住说话/ });
    await talk.hover();
    await viewer.mouse.down();
    await viewer.waitForTimeout(1400);
    await viewer.mouse.up();
    await expect(viewer.getByText('上一条语音已播放')).toBeVisible({ timeout: 20000 });
    await desktop.close();
    desktop = undefined;
    desktop = await launch();
    const resumed = await desktop.firstWindow();
    await expect(resumed.getByText('服务运行中', { exact: true })).toBeVisible({ timeout: 30000 });
    expect(
      (
        await viewerContext.request.delete(`${origin}/api/device`, { headers: { Origin: origin } })
      ).ok(),
    ).toBe(true);
    await expect(resumed.getByText('绑定已解除，请从托盘重新绑定教室')).toBeVisible();
  } finally {
    if (desktop && testInfo.status !== testInfo.expectedStatus)
      await testInfo.attach('collector-screen', {
        body: await (await desktop.firstWindow()).screenshot(),
        contentType: 'image/png',
      });
    await viewerContext.close();
    await desktop?.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
