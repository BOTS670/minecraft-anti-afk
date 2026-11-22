'use strict';

const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { validateStart } = require('./src/validation');
const { isProcessAlive } = require('./src/clients');
const { Scheduler } = require('./src/scheduler');
const { Session } = require('./src/session');
const { listClients, sendAction } = require('./src/windows');
const { UpdateService } = require('./src/updater');
const pkg = require('./package.json');

const INDEX_PATH = path.join(__dirname, 'renderer', 'index.html');
const INDEX_URL = pathToFileURL(INDEX_PATH).href;

let win = null;

const session = new Session({
  sendAction,
  isAlive: isProcessAlive,
  scheduler: new Scheduler(),
  onChange: (state) => {
    if (win && !win.isDestroyed()) win.webContents.send('session:state', state);
  },
});

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let contents;
  try {
    contents = fs.readFileSync(settingsPath(), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { autoUpdateCheck: true };
    console.warn('Не удалось прочитать настройки обновлений:', error);
    return { autoUpdateCheck: true };
  }

  try {
    const settings = JSON.parse(contents);
    return { autoUpdateCheck: settings && settings.autoUpdateCheck !== false };
  } catch (error) {
    console.warn('Файл настроек обновлений повреждён:', error);
    return { autoUpdateCheck: true };
  }
}

function saveSettings(settings) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings));
}

let updates = null;

function createUpdates() {
  updates = new UpdateService({
    repo: pkg.antiAfk && pkg.antiAfk.updateRepo,
    currentVersion: pkg.version,
    autoCheck: loadSettings().autoUpdateCheck,
    fetchFn: (url, options) => net.fetch(url, options),
    onChange: (state) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:state', state);
    },
  });
  updates.start();
}

// Принимаем IPC только от нашего собственного окна и нашего файла.
function assertTrusted(event) {
  const frame = event.senderFrame;
  if (!win || event.sender !== win.webContents || !frame || frame.url !== INDEX_URL) {
    throw new Error('Недоверенный отправитель IPC');
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrusted(event);
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}

handle('clients:list', () => listClients());

handle('session:start', async (payload) => {
  const { pid, mode, intervalSec } = validateStart(payload);
  // Принимаем только PID, который реально найден как клиент Minecraft.
  const client = (await listClients()).find((c) => c.pid === pid);
  if (!client) throw new Error('Клиент Minecraft с таким PID не найден. Обновите список.');
  session.start({ client, mode, intervalSec });
  return session.snapshot();
});

handle('session:stop', () => {
  session.stop();
  return session.snapshot();
});

handle('session:state', () => session.snapshot());

handle('update:state', () => updates.snapshot());
handle('update:check', () => updates.check());
handle('update:install', async () => {
  const result = await updates.install();
  if (result.restart) setImmediate(() => app.quit());
  return result;
});
handle('update:set-auto', (value) => {
  if (typeof value !== 'boolean') throw new TypeError('Ожидается true/false');
  updates.setAutoCheck(value);
  saveSettings({ autoUpdateCheck: value });
  return updates.snapshot();
});
handle('update:open', async () => {
  const url = updates.openTarget();
  if (!url || !url.startsWith('https://github.com/')) throw new Error('Нет доступного обновления');
  await shell.openExternal(url);
  return true;
});

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    title: 'Minecraft Anti-AFK',
    backgroundColor: '#1c2127',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.loadFile(INDEX_PATH);
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    createUpdates();
    createWindow();
  });
  app.on('before-quit', () => {
    session.stop('Приложение закрыто');
    if (updates) updates.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
