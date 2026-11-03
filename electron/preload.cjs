const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setupInfo: () => ipcRenderer.invoke('setup-info'),
  pairDevice: (value) => ipcRenderer.invoke('pair-device', value),
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  setAutoStart: (enabled) => ipcRenderer.invoke('auto-start', enabled),
  openDataDirectory: () => ipcRenderer.invoke('open-data-directory'),
  onShutdown: (callback) => {
    const listener = () =>
      Promise.resolve(callback()).finally(() => ipcRenderer.send('shutdown-ready'));
    ipcRenderer.on('prepare-shutdown', listener);
    return () => ipcRenderer.removeListener('prepare-shutdown', listener);
  },
});
