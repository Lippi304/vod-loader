const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const ytdlp = require('./lib/ytdlp');

const isMac = process.platform === 'darwin';
let win = null;
let current = null; // running download

// ---------- Settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (_) {
    return {};
  }
}
function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  } catch (_) {}
  return s;
}
function downloadDir() {
  const d = loadSettings().dir;
  return d && fs.existsSync(d) ? d : app.getPath('downloads');
}

// ---------- Window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 740,
    minWidth: 440,
    minHeight: 640,
    show: false,
    title: 'VOD Loader',
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: 'active',
    backgroundColor: isMac ? '#00000000' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Open external links in the browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Don't close by accident in the middle of a download.
  win.on('close', (e) => {
    if (!current) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep downloading', 'Cancel and close'],
      defaultId: 0,
      cancelId: 0,
      message: 'A download is still running.',
      detail: 'If you close the window, the running download and the queue will be cancelled.',
    });
    if (choice === 0) e.preventDefault();
    else current.cancel();
  });
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------- IPC ----------
ipcMain.handle('setup', async () => {
  const res = await ytdlp.ensure((p) => send('setup-progress', p));
  if (!res.installed) ytdlp.selfUpdate(); // keep it up to date in the background
  return { ok: true };
});

ipcMain.handle('info', async (_e, input) => ytdlp.getInfo(input));

ipcMain.handle('get-dir', () => {
  const dir = downloadDir();
  return { dir, name: path.basename(dir) };
});

ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose download folder',
    defaultPath: downloadDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  saveSettings({ dir: r.filePaths[0] });
  return { dir: r.filePaths[0], name: path.basename(r.filePaths[0]) };
});

ipcMain.handle('download', async (_e, opts) => {
  if (current) throw new Error('A download is already running.');
  const job = ytdlp.download({ ...opts, dir: downloadDir() }, (p) => {
    send('progress', p);
    // Progress in the Dock (Mac) or the taskbar (Windows)
    if (win && !win.isDestroyed()) win.setProgressBar(p.pct == null ? 2 : p.pct);
  });
  current = job;
  try {
    const res = await job.done;
    return { ok: true, filePath: res.filePath };
  } catch (err) {
    if (err.cancelled) return { ok: false, cancelled: true };
    throw err;
  } finally {
    current = null;
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
});

ipcMain.handle('cancel', () => {
  if (current) current.cancel();
});

ipcMain.handle('reveal', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  else shell.openPath(downloadDir());
});

// ---------- Lifecycle ----------
app.whenReady().then(() => {
  // Keep the default menu on the Mac (otherwise ⌘V does not work).
  if (!isMac) Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (current) current.cancel();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
