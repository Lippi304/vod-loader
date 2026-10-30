const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  setup: () => ipcRenderer.invoke('setup'),
  info: (url) => ipcRenderer.invoke('info', url),
  getDir: () => ipcRenderer.invoke('get-dir'),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  download: (opts) => ipcRenderer.invoke('download', opts),
  cancel: () => ipcRenderer.invoke('cancel'),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onSetupProgress: (cb) => ipcRenderer.on('setup-progress', (_e, p) => cb(p)),
});
