const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  session,
  dialog,
  safeStorage,
  powerSaveBlocker,
} = require('electron');
const { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let boardWindow, tray, binding, reconnect, settingsPath, blocker;
let quitting = false;
let shuttingDown = false;
const setupUrl = pathToFileURL(path.join(__dirname, 'setup.html')).href;
const configuredOrigin = process.env.XY_CLOUD_ORIGIN || require('./cloud-defaults.json').origin;
if (process.env.XY_DATA_DIR) {
  mkdirSync(process.env.XY_DATA_DIR, { recursive: true });
  app.setPath('userData', path.resolve(process.env.XY_DATA_DIR));
}
if (process.platform === 'win32')
  app.commandLine.appendSwitch('enable-features', 'RunVideoCaptureServiceInBrowserProcess');
const isBoard = (contents) =>
  Boolean(
    boardWindow &&
    contents?.id === boardWindow.webContents.id &&
    binding &&
    contents.getURL() === `${binding.origin}/board`,
  );
const isSetup = (contents) =>
  Boolean(
    boardWindow && contents?.id === boardWindow.webContents.id && contents.getURL() === setupUrl,
  );
const assertSetup = (event) => {
  if (!isSetup(event.sender)) throw new Error('仅连接页面可操作');
};
const assertBoard = (event) => {
  if (!isBoard(event.sender)) throw new Error('仅采集页面可操作');
};
function forget() {
  binding = null;
  if (existsSync(settingsPath)) unlinkSync(settingsPath);
}
async function connect() {
  clearTimeout(reconnect);
  if (!binding || quitting || shuttingDown) return;
  try {
    const response = await fetch(`${binding.origin}/api/board/session`, {
      headers: { 'x-board-token': binding.token },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (response.status === 403) {
      forget();
      await boardWindow.loadFile(path.join(__dirname, 'setup.html'));
      return;
    }
    if (!response.ok) throw new Error('网站暂不可用');
    await boardWindow.loadURL(`${binding.origin}/board`);
  } catch {
    if (!quitting && !shuttingDown) {
      tray?.setToolTip('小影子 · 正在重新连接网站');
      reconnect = setTimeout(connect, 5000);
    }
  }
}
async function start() {
  settingsPath = path.join(app.getPath('userData'), 'cloud-binding.json');
  try {
    const stored = JSON.parse(readFileSync(settingsPath, 'utf8'));
    binding = {
      origin: stored.origin,
      token: safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')),
    };
  } catch {
    binding = null;
  }
  boardWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 800,
    minHeight: 620,
    title: '小影子 · 教室采集端',
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isBoard(contents) && permission === 'media' && !details.mediaTypes?.includes('audio')),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) => isBoard(contents) && permission === 'media',
  );
  boardWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  boardWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== setupUrl && url !== `${binding?.origin}/board`) event.preventDefault();
  });
  boardWindow.webContents.on('will-redirect', (event) => event.preventDefault());
  boardWindow.webContents.on('render-process-gone', () => {
    if (!quitting) reconnect = setTimeout(connect, 3000);
  });
  boardWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      boardWindow.hide();
    }
  });
  ipcMain.handle('setup-info', (event) => {
    assertSetup(event);
    return {
      origin: binding?.origin || configuredOrigin || '',
      reconnecting: Boolean(binding),
      preset: Boolean(configuredOrigin),
      version: app.getVersion(),
    };
  });
  ipcMain.handle('pair-device', async (event, value) => {
    assertSetup(event);
    const origin = new URL(String(value?.origin ?? ''));
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error('请填写完整的 HTTPS 网站地址，例如 https://class.example.com');
    if (configuredOrigin && origin.origin !== new URL(configuredOrigin).origin)
      throw new Error('请使用安装包预设的网站地址');
    const code = String(value?.code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code)) throw new Error('请填写网站生成的 12 位绑定码');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('无法安全保存绑定信息，请联系维护者');
    const response = await fetch(`${origin.origin}/api/device/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok || !/^[a-f0-9]{64}$/.test(result.token ?? ''))
      throw new Error(result.error || '绑定失败');
    const next = { origin: origin.origin, token: result.token };
    writeFileSync(
      settingsPath,
      JSON.stringify({
        origin: next.origin,
        encrypted: safeStorage.encryptString(next.token).toString('base64'),
      }),
      { mode: 0o600 },
    );
    binding = next;
    if (app.isPackaged && typeof value.autoStart === 'boolean')
      app.setLoginItemSettings({ openAtLogin: value.autoStart, path: app.getPath('exe') });
    setTimeout(() => void connect(), 200);
    return { ok: true };
  });
  ipcMain.handle('bootstrap', (event) => {
    assertBoard(event);
    tray.setToolTip('小影子 · 已连接教室网站');
    return {
      deployment: 'cloud',
      boardToken: binding.token,
      addresses: [binding.origin],
      initialPassword: null,
      dataDirectory: app.getPath('userData'),
      autoStart: app.getLoginItemSettings().openAtLogin,
    };
  });
  ipcMain.handle('auto-start', (event, enabled) => {
    assertBoard(event);
    if (!app.isPackaged || typeof enabled !== 'boolean')
      throw new Error('请在安装版中设置开机运行');
    app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') });
    return app.getLoginItemSettings().openAtLogin;
  });
  const bitmap = Buffer.alloc(32 * 32 * 4);
  for (let row = 0; row < 32; row++)
    for (let column = 0; column < 32; column++) {
      const lens =
        (column >= 6 && column <= 19 && row >= 10 && row <= 22) ||
        (column >= 21 && column <= 26 && Math.abs(row - 16) <= column - 19);
      bitmap.set(lens ? [255, 255, 255, 255] : [239, 117, 47, 255], (row * 32 + column) * 4);
    }
  const icon = nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 });
  boardWindow.setIcon(icon);
  tray = new Tray(icon);
  tray.setToolTip('小影子 · 教室采集端');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开采集端', click: () => boardWindow.show() },
      {
        label: '重新绑定教室',
        click: async () => {
          const answer = await dialog.showMessageBox(boardWindow, {
            type: 'question',
            buttons: ['取消', '重新绑定'],
            defaultId: 0,
            message: '重新绑定会停止当前采集，需要网站生成新的绑定码。',
          });
          if (answer.response !== 1) return;
          clearTimeout(reconnect);
          forget();
          await boardWindow.loadFile(path.join(__dirname, 'setup.html'));
          boardWindow.show();
        },
      },
      { type: 'separator' },
      { label: '退出并停止采集', click: () => app.quit() },
    ]),
  );
  tray.on('double-click', () => boardWindow.show());
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  await boardWindow.loadFile(path.join(__dirname, 'setup.html'));
  if (binding) void connect();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    boardWindow?.show();
    boardWindow?.focus();
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox('小影子启动失败', `${error.message}\n请将此提示发给维护者。`);
      quitting = true;
      app.quit();
    });
}
app.on('window-all-closed', () => {});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(reconnect);
  void (async () => {
    if (boardWindow && !boardWindow.webContents.isDestroyed() && isBoard(boardWindow.webContents))
      await new Promise((done) => {
        const timeout = setTimeout(done, 12000);
        ipcMain.once('shutdown-ready', (sender) => {
          if (sender.sender.id === boardWindow.webContents.id) {
            clearTimeout(timeout);
            done();
          }
        });
        boardWindow.webContents.send('prepare-shutdown');
      });
    if (blocker !== undefined && powerSaveBlocker.isStarted(blocker))
      powerSaveBlocker.stop(blocker);
    tray?.destroy();
    quitting = true;
    app.quit();
  })().catch(() => {
    quitting = true;
    app.quit();
  });
});
