import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { startServer } from '../../src/server/app.js';

test('使用说明图文、安装包、页面跳转及窗口/手机适配', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-guide-'));
  const downloads = join(directory, 'downloads');
  await mkdir(downloads);
  await writeFile(
    join(downloads, 'XiaoYingZi-Setup.exe'),
    'synthetic download fixture; never execute',
  );
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
    downloadDirectory: downloads,
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
  const page = await context.newPage();
  const { attachDevelopmentDownloads } = await import(
    new URL('../../scripts/dev-downloads.mjs', import.meta.url).href
  );
  const savedDownloads: string[] = [];
  const downloadErrors: Error[] = [];
  attachDevelopmentDownloads(page, {
    directory: join(directory, 'user-downloads'),
    onSaved: (filename: string) => savedDownloads.push(filename),
    onError: (error: Error) => downloadErrors.push(error),
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.getByLabel('访问密码', { exact: true }).fill(service.getInitialPassword()!);
    await page.getByRole('button', { name: '进入教室', exact: true }).click();
    await page.getByRole('heading', { name: '实时教室', exact: true }).waitFor();
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width: 1200, height: 850, windowState: 'normal' },
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1000);
    const initialWidth = await page.evaluate(() => innerWidth);
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width: 1700, height: 950 },
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(initialWidth + 300);
    expect(
      await page.evaluate(() =>
        Math.abs(document.querySelector('.app-shell')!.getBoundingClientRect().width - innerWidth),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() =>
        Math.abs(document.querySelector('.topbar')!.getBoundingClientRect().right - innerWidth),
      ),
    ).toBeLessThanOrEqual(1);

    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 740 },
    ]) {
      await page.setViewportSize(viewport);
      for (const name of ['实时教室', '使用说明', '录制与设置', '录像回放']) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${name} ${viewport.width}px`,
        ).toBe(true);
      }
      if (viewport.width >= 1024) {
        await page.getByRole('button', { name: '实时教室', exact: true }).click();
        const toolbar = await page.locator('.video-toolbar').boundingBox();
        expect(
          toolbar!.y + toolbar!.height,
          `观看操作应在 ${viewport.width}×${viewport.height} 内`,
        ).toBeLessThanOrEqual(viewport.height);
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: '使用说明', exact: true }).click();
    await expect(page.locator('.guide-illustration')).toHaveCount(6);
    await expect(page.getByRole('link', { name: '下载白板小助手', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/guide-desktop.png' });
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载白板小助手', exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe('XiaoYingZi-Setup.exe');
    await expect(page.getByRole('status').filter({ hasText: '已请求下载' })).toBeVisible();
    await expect.poll(() => savedDownloads.length).toBe(1);
    expect(basename(savedDownloads[0])).toBe('XiaoYingZi-Setup.exe');
    expect(await readFile(savedDownloads[0], 'utf8')).toBe(
      'synthetic download fixture; never execute',
    );
    await writeFile(savedDownloads[0], 'keep the existing file');
    await page.getByRole('link', { name: '下载白板小助手', exact: true }).click();
    await expect.poll(() => savedDownloads.length).toBe(2);
    expect(basename(savedDownloads[1])).toBe('XiaoYingZi-Setup (1).exe');
    expect(await readFile(savedDownloads[0], 'utf8')).toBe('keep the existing file');
    await page.getByRole('button', { name: '去录制与设置，生成绑定码', exact: true }).click();
    await expect(page.getByRole('heading', { name: '录制与设置', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '启用定时录像' })).not.toBeChecked();
    await page.getByRole('button', { name: '使用说明', exact: true }).click();
    await page.getByRole('button', { name: '去找录像', exact: true }).click();
    await expect(page.getByRole('heading', { name: '录像回放', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '使用说明', exact: true }).click();
    await page.getByText('一直显示“白板未连接”', { exact: true }).click();
    await expect(page.locator('.guide-faq details').first()).toHaveAttribute('open', '');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: '④ 跟教室说话', exact: true }).click();
    await page.screenshot({ path: 'test-results/guide-mobile.png' });
    await rm(join(downloads, 'XiaoYingZi-Setup.exe'));
    await page.getByRole('button', { name: '实时教室', exact: true }).click();
    await page.getByRole('button', { name: '使用说明', exact: true }).click();
    await expect(page.getByText('安装包还没放到网站上。', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: '下载白板小助手', exact: true })).toHaveCount(0);
    await context.close();
    expect(await readFile(savedDownloads[1], 'utf8')).toBe(
      'synthetic download fixture; never execute',
    );
    expect(downloadErrors).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
