const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const ytdlp = require('./lib/ytdlp');
const installer = require('./lib/installer');

const isMac = process.platform === 'darwin';
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
let win = null;
let current = null; // running download
let updateReady = null; // { version } once an update has been downloaded

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
  // A window opened after the update was downloaded (Mac) still shows the notice.
  win.webContents.on('did-finish-load', () => {
    if (updateReady) send('update-ready', updateReady);
  });

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

ipcMain.handle('lookup', async (_e, input) => ytdlp.lookup(input));

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

// ---------- Updates ----------
// Checks GitHub Releases in the background and downloads a newer version by itself.
// It is installed on the next quit, or right away when the user clicks "Restart".
function setupUpdates() {
  if (!app.isPackaged) return; // not when started with `npm start`
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = { version: info.version };
    send('update-ready', updateReady);
  });
  autoUpdater.on('error', () => {}); // offline, rate limit, …: try again at the next check
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_MS);
}

ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());

// ---------- Install from the disk image ----------
// Started straight from the mounted DMG (double-click instead of drag): offer to move the app to
// Applications. The relaunched copy then ejects the disk image and moves the .dmg to the Trash.
const cleanupFile = () => path.join(app.getPath('userData'), 'installer-cleanup.json');

// Returns true when the app is moving, i.e. it is about to quit and relaunch from Applications.
function offerMoveToApplications() {
  const volume = isMac && app.isPackaged && !app.isInApplicationsFolder() ? installer.volumeOf(app.getPath('exe')) : null;
  if (!volume) return false;
  let dmg = null;
  try {
    dmg = installer.dmgForVolume(installer.mountedImages(), volume);
  } catch (_) {}
  const cleanUp = !!dmg && installer.isOurInstaller(dmg);
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Move to Applications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move VOD Loader to the Applications folder?',
    detail: cleanUp ? 'The installer will be ejected and moved to the Trash.' : undefined,
  });
  if (choice !== 0) return false;
  try {
    if (cleanUp) {
      fs.mkdirSync(path.dirname(cleanupFile()), { recursive: true });
      fs.writeFileSync(cleanupFile(), JSON.stringify({ volume, dmg, at: Date.now() }));
    }
    if (app.moveToApplicationsFolder()) return true;
  } catch (err) {
    dialog.showErrorBox('Could not move the app', err.message);
  }
  fs.rmSync(cleanupFile(), { force: true });
  return false;
}

// In the relaunched copy: eject the disk image and move the .dmg to the Trash.
async function finishInstall() {
  let job;
  try {
    job = JSON.parse(fs.readFileSync(cleanupFile(), 'utf8'));
  } catch (_) {
    return;
  }
  fs.rmSync(cleanupFile(), { force: true });
  const fresh = Date.now() - job.at < 60 * 60 * 1000;
  if (!fresh || !app.isInApplicationsFolder() || !installer.volumeOf(`${job.volume}/`) || !installer.isOurInstaller(job.dmg)) return;
  // The old copy may still be shutting down, so the volume can be busy for a moment.
  let ejected = false;
  for (let i = 0; i < 10 && !ejected; i++) {
    ejected = await installer.eject(job.volume);
    if (!ejected) await new Promise((r) => setTimeout(r, 1000));
  }
  if (ejected && fs.existsSync(job.dmg)) await shell.trashItem(job.dmg).catch(() => {});
}

// ---------- Lifecycle ----------
app.whenReady().then(() => {
  if (offerMoveToApplications()) return; // quits and relaunches from Applications
  // Keep the default menu on the Mac (otherwise ⌘V does not work).
  if (!isMac) Menu.setApplicationMenu(null);
  createWindow();
  setupUpdates();
  finishInstall();
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
