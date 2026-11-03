import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-portable-'));
const listener = createServer();
await new Promise((done) => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const executable = resolve('release/XiaoYingZi-0.1.0-win-x64.exe');
const child = spawn(
  executable,
  [
    `--remote-debugging-port=${port}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
  {
    env: { ...process.env, XY_DATA_DIR: directory, XY_LOCAL_MODE: '1' },
    windowsHide: true,
    stdio: 'ignore',
  },
);
child.on('error', (error) => console.error(error.message));
let browser;
try {
  const deadline = Date.now() + 60000;
  let endpoint;
  while (!endpoint && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`便携启动器提前退出 (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      endpoint = (await response.json()).webSocketDebuggerUrl;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (!endpoint) throw new Error('便携程序未在 60 秒内启动调试窗口');
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  await page.getByText('服务运行中', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText('有观看或录像任务时启动摄像头', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/portable-board.png', fullPage: true });
  console.log('便携 exe 自解压、HTTPS 服务、preload 与白板待命窗口验证通过；未启用物理摄像头。');
} finally {
  await browser?.close();
  if (child.exitCode === null && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    await new Promise((done) => setTimeout(done, 1000));
  }
  await rm(directory, { recursive: true, force: true });
}
