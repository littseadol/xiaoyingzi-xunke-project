import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';

const service = await startServer({
  dataDirectory: resolve(process.env.XY_DATA_DIR ?? 'data'),
  webDirectory: fileURLToPath(new URL('../../dist', import.meta.url)),
  port: Number(process.env.XY_PORT ?? 8443),
  publicOrigin: process.env.XY_PUBLIC_ORIGIN,
  proxyHttp: process.env.XY_PROXY_HTTP === '1',
  host: process.env.XY_HOST ?? '127.0.0.1',
  downloadDirectory: process.env.XY_DOWNLOAD_DIR ? resolve(process.env.XY_DOWNLOAD_DIR) : undefined,
  turn: process.env.XY_TURN_SECRET
    ? {
        secret: process.env.XY_TURN_SECRET,
        urls: (process.env.XY_TURN_URLS ?? '').split(',').filter(Boolean),
      }
    : undefined,
});
console.log(`小影子服务已启动：\n${service.addresses.join('\n')}\n数据目录：${service.directory}`);
if (process.env.XY_PUBLIC_ORIGIN)
  console.log(`公网地址：${process.env.XY_PUBLIC_ORIGIN}；仅允许反向代理经 HTTPS 提交来源头。`);
console.log(
  '仅启动后端不会采集摄像头。请使用 npm start 启动白板端；首次访问密码见数据目录 initial-password.txt。',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void service.close().then(() => process.exit(0));
  });
