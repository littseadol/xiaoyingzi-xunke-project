import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startServer } from '../../src/server/app.js';
import type { Overview, Recording, Settings } from '../../src/shared/types.js';

test('合成设备完成网页直播、录像回放下载、语音发送播放和移动布局', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-browser-'));
  const service = await startServer({
    dataDirectory: directory,
    webDirectory: resolve('dist'),
    port: 0,
    host: '127.0.0.1',
  });
  const origin = `https://localhost:${service.port}`;
  const boardContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['camera'],
  });
  const viewerContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors: string[] = [];
  try {
    await boardContext.addInitScript(
      (bootstrap) => {
        (window as any).desktop = {
          bootstrap: async () => bootstrap,
          onShutdown: () => () => {},
          setAutoStart: async () => false,
          openDataDirectory: async () => {},
        };
      },
      {
        boardToken: service.boardToken,
        addresses: [origin],
        initialPassword: service.getInitialPassword(),
        dataDirectory: directory,
        autoStart: false,
      },
    );
    const boardPage = await boardContext.newPage();
    boardPage.on('pageerror', (error) => pageErrors.push(error.message));
    await boardPage.goto(`${origin}/board`);
    await expect(boardPage.getByText('服务运行中', { exact: true })).toBeVisible();
    const page = await viewerContext.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin);
    await page.getByLabel('访问密码', { exact: true }).fill(service.getInitialPassword()!);
    await page.getByRole('button', { name: '进入教室' }).click();
    await expect(page.getByText('白板在线', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          ((await (await viewerContext.request.get(`${origin}/api/overview`)).json()) as Overview)
            .settings.recordingEnabled,
      )
      .toBe(false);
    await page.getByRole('button', { name: '开始观看', exact: true }).click();
    await expect(page.getByText('实时画面', { exact: true })).toBeVisible();
    await expect
      .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/live-desktop.png', fullPage: true });
    const settings = (
      (await (await viewerContext.request.get(`${origin}/api/overview`)).json()) as Overview
    ).settings;
    const enabled: Settings = {
      ...settings,
      recordingEnabled: true,
      schedules: [
        { id: 'all-am', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' },
        { id: 'all-pm', days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' },
      ],
    };
    expect(
      (
        await viewerContext.request.put(`${origin}/api/settings`, {
          data: enabled,
          headers: { Origin: origin },
        })
      ).ok(),
    ).toBe(true);
    await expect
      .poll(
        async () =>
          ((await (await viewerContext.request.get(`${origin}/api/overview`)).json()) as Overview)
            .board.recording,
      )
      .toBe(true);
    await page.getByRole('button', { name: '停止观看' }).click();
    await page.waitForTimeout(2500);
    expect(
      ((await (await viewerContext.request.get(`${origin}/api/overview`)).json()) as Overview).board
        .recording,
    ).toBe(true);
    await viewerContext.request.put(`${origin}/api/settings`, {
      data: { ...enabled, recordingEnabled: false },
      headers: { Origin: origin },
    });
    let records: Recording[] = [];
    await expect
      .poll(
        async () => {
          records = await (await viewerContext.request.get(`${origin}/api/recordings`)).json();
          return records.some((record) => record.status === 'ready');
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const ready = records.find((record) => record.status === 'ready')!;
    const download = await viewerContext.request.get(
      `${origin}/api/recordings/${ready.id}/video?download=1`,
    );
    expect(download.ok()).toBe(true);
    expect((await download.body()).length).toBeGreaterThan(1000);
    expect(download.headers()['content-disposition']).toContain('attachment');
    await page.getByRole('button', { name: '录像回放', exact: true }).click();
    await page.getByRole('button', { name: '回放', exact: true }).first().click();
    await expect
      .poll(() =>
        page.locator('.playback video').evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string;
    const decoded = spawnSync(
      ffmpeg,
      ['-nostdin', '-i', join(directory, 'recordings', `${ready.id}.mp4`), '-f', 'null', '-'],
      { windowsHide: true },
    );
    expect(decoded.status).toBe(0);
    expect(decoded.stderr.toString()).not.toContain('Audio:');
    await page.getByRole('button', { name: '实时教室', exact: true }).click();
    const talk = page.getByRole('button', { name: /按住说话/ });
    await talk.hover();
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await expect(page.getByText('上一条语音已播放')).toBeVisible({ timeout: 20000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/live-mobile.png', fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: '录制与设置', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '启用定时录像' })).not.toBeChecked();
    await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await viewerContext.close();
    await boardContext.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Windows Electron 桌面端默认待命，并能采集和播放喊话', async ({ browser }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-electron-'));
  let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const viewerContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone'],
  });
  try {
    desktop = await electron.launch({
      ...(process.env.XY_DESKTOP_EXE ? { executablePath: process.env.XY_DESKTOP_EXE } : {}),
      args: [
        ...(process.env.XY_DESKTOP_EXE ? [] : ['.']),
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
      env: { ...process.env, XY_DATA_DIR: directory, XY_LOCAL_MODE: '1' },
    });
    const window = await desktop.firstWindow();
    await expect(window.getByText('服务运行中', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(window.getByText('有观看或录像任务时启动摄像头', { exact: true })).toBeVisible();
    await expect(
      window.getByRole('checkbox', { name: 'Windows 登录后自动启动' }),
    ).not.toBeChecked();
    expect(
      (await readFile(join(directory, 'initial-password.txt'), 'utf8')).length,
    ).toBeGreaterThanOrEqual(12);
    await window.screenshot({ path: 'test-results/board-desktop.png', fullPage: true });
    const viewer = await viewerContext.newPage();
    await viewer.goto('https://localhost:8443');
    await viewer
      .getByLabel('访问密码', { exact: true })
      .fill((await readFile(join(directory, 'initial-password.txt'), 'utf8')).trim());
    await viewer.getByRole('button', { name: '进入教室' }).click();
    await viewer.getByRole('button', { name: '开始观看', exact: true }).click();
    await expect(viewer.getByText('实时画面', { exact: true })).toBeVisible();
    await expect
      .poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await expect(window.getByText('正在预览', { exact: true })).toBeVisible();
    const overview = (await (
      await viewerContext.request.get('https://localhost:8443/api/overview')
    ).json()) as Overview;
    const enabled: Settings = {
      ...overview.settings,
      recordingEnabled: true,
      schedules: [
        { id: 'all-am', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' },
        { id: 'all-pm', days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' },
      ],
    };
    expect(
      (
        await viewerContext.request.put('https://localhost:8443/api/settings', {
          data: enabled,
          headers: { Origin: 'https://localhost:8443' },
        })
      ).ok(),
    ).toBe(true);
    await expect(window.getByText('正在录像', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: '停止观看' }).click();
    await viewer.waitForTimeout(2500);
    await expect(window.getByText('正在录像', { exact: true })).toBeVisible();
    await viewerContext.request.put('https://localhost:8443/api/settings', {
      data: { ...enabled, recordingEnabled: false },
      headers: { Origin: 'https://localhost:8443' },
    });
    await expect
      .poll(
        async () => {
          const records = (await (
            await viewerContext.request.get('https://localhost:8443/api/recordings')
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
    await expect(window.getByText('有观看或录像任务时启动摄像头', { exact: true })).toBeVisible();
  } finally {
    if (desktop && testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('board-status', {
        body: await desktop.firstWindow().then((window) => window.locator('body').innerText()),
        contentType: 'text/plain',
      });
    }
    await viewerContext.close();
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
