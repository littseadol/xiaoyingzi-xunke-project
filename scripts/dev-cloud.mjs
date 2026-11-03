import { createHash, X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, _electron as electron } from '@playwright/test';
import { startServer } from '../dist-server/server/app.js';
import { attachDevelopmentDownloads } from './dev-downloads.mjs';

const directory = resolve('data/cloud-dev');
const port = Number(process.env.XY_PORT ?? 8443);
const origin = `https://localhost:${port}`;
const service = await startServer({
  dataDirectory: join(directory, 'server'),
  webDirectory: resolve('dist'),
  publicOrigin: origin,
  port,
  host: '127.0.0.1',
  downloadDirectory: resolve('deploy/downloads'),
});
const certificate = new X509Certificate(service.certificates.cert);
const spki = createHash('sha256')
  .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
const synthetic = process.env.XY_REAL_DEVICES !== '1';
const mediaArgs = synthetic
  ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  : [];
const certificateArg = `--ignore-certificate-errors-spki-list=${spki}`;
const browserPath = [
  process.env.XY_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => candidate && existsSync(candidate));
let browser, desktop;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await desktop?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await service.close();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => void close().then(() => process.exit(0)));
process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  if (input.trim().toLowerCase() === 'q') void close().then(() => process.exit(0));
});
try {
  browser = await chromium.launch({
    headless: false,
    executablePath: browserPath,
    args: [
      ...mediaArgs,
      certificateArg,
      '--start-maximized',
      '--enable-features=RunVideoCaptureServiceInBrowserProcess',
    ],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  attachDevelopmentDownloads(page);
  await page.goto(origin);
  desktop = await electron.launch({
    args: ['.', ...mediaArgs, certificateArg],
    env: {
      ...process.env,
      XY_LOCAL_MODE: '',
      XY_CLOUD_ORIGIN: origin,
      XY_DATA_DIR: join(directory, 'collector'),
      NODE_EXTRA_CA_CERTS: service.certificates.caPath,
    },
  });
  console.log(`本机模拟网站：${origin}`);
  console.log(`访问密码：${service.getInitialPassword() ?? '已修改，请使用你设置的密码'}`);
  console.log(
    synthetic ? '当前使用合成摄像头/麦克风，不会启用物理设备。' : '当前允许使用真实摄像头/麦克风。',
  );
  console.log('登录网站 → 录制与设置 → 生成绑定码 → 在采集端填写绑定码。');
  console.log(
    '开发证书例外仅在本次独立进程生效。Ctrl+C 或输入 q 回车结束；数据保留在 data/cloud-dev。',
  );
  browser.once('disconnected', () => {
    if (!closing) void close().then(() => process.exit(0));
  });
} catch (error) {
  console.error(error.message);
  await close();
  process.exitCode = 1;
}
