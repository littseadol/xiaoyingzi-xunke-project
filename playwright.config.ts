import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const browsers = [
  process.env.XY_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  use: {
    ignoreHTTPSErrors: true,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: browsers.find((path): path is string => Boolean(path && existsSync(path))),
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--enable-features=RunVideoCaptureServiceInBrowserProcess',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
