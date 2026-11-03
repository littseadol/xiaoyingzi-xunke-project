const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  session,
  shell,
  dialog,
  powerSaveBlocker,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { X509Certificate } = require('node:crypto');

let boardWindow;
let tray;
let service;
let quitting = false;
let shutdownStarted = false;
let blocker;

if (process.platform === 'win32')
  app.commandLine.appendSwitch('enable-features', 'RunVideoCaptureServiceInBrowserProcess');

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
      dialog.showErrorBox(
        '小影子启动失败',
        `${error.message}\n\n请确认 8443 端口未被占用，且数据目录可以写入。`,
      );
      quitting = true;
      app.quit();
    });
}

async function start() {
  const { startServer } = await import(
    pathToFileURL(path.join(app.getAppPath(), 'dist-server/server/app.js')).href
  );
  service = await startServer({
    dataDirectory: process.env.XY_DATA_DIR || path.join(app.getPath('userData'), 'data'),
    webDirectory: path.join(app.getAppPath(), 'dist'),
    port: 8443,
  });
  const origin = `https://localhost:${service.port}`;
  const trustedWindow = (webContents) =>
    Boolean(
      boardWindow &&
      webContents?.id === boardWindow.webContents.id &&
      webContents.getURL().startsWith(`${origin}/board`),
    );
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const fingerprint = new X509Certificate(request.certificate.data).fingerprint256
      .replaceAll(':', '')
      .toLowerCase();
    callback(
      request.hostname === 'localhost' && fingerprint === service.certificates.fingerprint ? 0 : -3,
    );
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(
      trustedWindow(webContents) &&
        permission === 'media' &&
        !details.mediaTypes?.includes('audio'),
    ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission) => trustedWindow(webContents) && permission === 'media',
  );
  boardWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 800,
    minHeight: 620,
    title: '小影子 · 白板采集端',
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
  boardWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  boardWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== `${origin}/board`) event.preventDefault();
  });
  boardWindow.webContents.on('render-process-gone', () => {
    if (!quitting) setTimeout(() => boardWindow?.loadURL(`${origin}/board`), 2000);
  });
  boardWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      boardWindow.hide();
    }
  });
  boardWindow.webContents.on('did-fail-load', (_event, code, description) =>
    console.error('[renderer]', code, description),
  );
  const assertLocal = (event) => {
    if (!trustedWindow(event.sender)) throw new Error('仅本地白板窗口可执行此操作');
  };
  ipcMain.handle('bootstrap', (event) => {
    assertLocal(event);
    return {
      boardToken: service.boardToken,
      addresses: service.addresses,
      initialPassword: service.getInitialPassword(),
      dataDirectory: service.directory,
      autoStart: app.getLoginItemSettings().openAtLogin,
    };
  });
  ipcMain.handle('auto-start', (event, enabled) => {
    assertLocal(event);
    if (!app.isPackaged) throw new Error('请在打包后的程序中设置开机启动');
    if (typeof enabled !== 'boolean') throw new Error('开机启动参数错误');
    if (process.env.PORTABLE_EXECUTABLE_FILE)
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.env.PORTABLE_EXECUTABLE_FILE,
      });
    else app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('open-data-directory', (event) => {
    assertLocal(event);
    return shell.openPath(service.directory);
  });
  const bitmap = Buffer.alloc(32 * 32 * 4);
  for (let row = 0; row < 32; row++) {
    for (let column = 0; column < 32; column++) {
      const lens =
        (column >= 6 && column <= 19 && row >= 10 && row <= 22) ||
        (column >= 21 && column <= 26 && Math.abs(row - 16) <= column - 19);
      const offset = (row * 32 + column) * 4;
      bitmap.set(lens ? [255, 255, 255, 255] : [239, 117, 47, 255], offset);
    }
  }
  const icon = nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 });
  boardWindow.setIcon(icon);
  tray = new Tray(icon);
  tray.setToolTip('小影子 · 教室摄像头服务运行中');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开白板控制台', click: () => boardWindow.show() },
      { label: '打开数据目录', click: () => shell.openPath(service.directory) },
      { type: 'separator' },
      { label: '退出并停止采集', click: () => app.quit() },
    ]),
  );
  tray.on('double-click', () => boardWindow.show());
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  await boardWindow.loadURL(`${origin}/board`);
}

app.on('window-all-closed', () => {});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void (async () => {
    if (boardWindow && !boardWindow.webContents.isDestroyed()) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 12000);
        ipcMain.once('shutdown-ready', (event) => {
          if (event.sender.id === boardWindow.webContents.id) {
            clearTimeout(timeout);
            resolve();
          }
        });
        boardWindow.webContents.send('prepare-shutdown');
      });
    }
    await service?.close();
    if (blocker !== undefined && powerSaveBlocker.isStarted(blocker))
      powerSaveBlocker.stop(blocker);
    tray?.destroy();
    quitting = true;
    app.quit();
  })().catch((error) => {
    console.error(error);
    quitting = true;
    app.quit();
  });
});
