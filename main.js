'use strict';

const { app, BrowserWindow, ipcMain, shell, net, Notification } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { validateStart } = require('./src/validation');
const { isProcessAlive } = require('./src/clients');
const { Scheduler } = require('./src/scheduler');
const { Session } = require('./src/session');
const { listClients, sendAction } = require('./src/windows');
const { UpdateService } = require('./src/updater');
const { SettingsStore } = require('./src/settings-store');
const pkg = require('./package.json');

const INDEX_PATH = path.join(__dirname, 'renderer', 'index.html');
const INDEX_URL = pathToFileURL(INDEX_PATH).href;

let win = null;
let settingsStore = null;
let previousSessionState = null;

const session = new Session({
  sendAction,
  isAlive: isProcessAlive,
  scheduler: new Scheduler(),
  onChange: (state) => {
    if (settingsStore) recordSessionChanges(state);
    if (win && !win.isDestroyed()) win.webContents.send('session:state', state);
  },
});

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function recordSessionChanges(state) {
  const previous = previousSessionState;
  const modeName = { look: 'Камера', step: 'Шаг', jump: 'Прыжок' }[state.mode] || 'Активность';
  let historyChanged = false;
  try {
    if (state.status === 'running' && (!previous || previous.status !== 'running')) {
      settingsStore.recordHistory({
        type: 'started',
        title: 'Сессия запущена',
        detail: `${modeName} · ${state.intervalSec} сек.`,
      });
      historyChanged = true;
    }
    if (state.actionCount > (previous ? previous.actionCount : 0) && state.lastResult) {
      settingsStore.recordHistory({
        type: 'action',
        title: state.lastResult.ok ? 'Действие выполнено' : 'Ошибка действия',
        detail: state.lastResult.ok ? modeName : state.lastResult.error,
        ok: state.lastResult.ok,
      });
      historyChanged = true;
    }
    if (previous && previous.status === 'running' && state.status === 'stopped') {
      settingsStore.recordHistory({
        type: 'stopped',
        title: 'Сессия остановлена',
        detail: state.stopReason || 'Остановлено',
      });
      historyChanged = true;
      if (state.stopReason === 'Процесс Minecraft закрыт' && settingsStore.snapshot().notifications && Notification.isSupported()) {
        new Notification({ title: 'Minecraft Anti-AFK', body: 'Выбранный клиент Minecraft закрылся.' }).show();
      }
    }
  } catch (error) {
    console.error('Не удалось сохранить событие сессии:', error);
  }
  previousSessionState = state;
  if (historyChanged && win && !win.isDestroyed()) {
    win.webContents.send('history:state', settingsStore.snapshot());
  }
}

let updates = null;

function createUpdates() {
  updates = new UpdateService({
    repo: pkg.antiAfk && pkg.antiAfk.updateRepo,
    currentVersion: pkg.version,
    autoCheck: settingsStore.snapshot().autoUpdateCheck,
    fetchFn: (url, options) => net.fetch(url, options),
    installKind: app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer') : null,
    portablePath: process.env.PORTABLE_EXECUTABLE_FILE,
    executablePath: process.execPath,
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

handle('settings:get', () => settingsStore.snapshot());
handle('profiles:save', (profile) => {
  settingsStore.saveProfile(profile);
  return settingsStore.snapshot();
});
handle('profiles:delete', (id) => settingsStore.deleteProfile(id));
handle('history:clear', () => settingsStore.clearHistory());
handle('settings:set-notifications', (value) => settingsStore.setNotifications(value));
handle('repo:open', async () => {
  await shell.openExternal('https://github.com/BOTS670/minecraft-anti-afk');
  return true;
});
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
  settingsStore.setAutoUpdateCheck(value);
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
    width: 1100,
    height: 900,
    minWidth: 760,
    minHeight: 700,
    title: 'BLOCKTIME — Minecraft Anti-AFK',
    backgroundColor: '#101712',
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
    settingsStore = new SettingsStore(settingsPath());
    createUpdates();
    createWindow();
  }).catch((error) => {
    console.error('Не удалось запустить приложение:', error);
    app.quit();
  });
  app.on('before-quit', () => {
    session.stop('Приложение закрыто');
    if (updates) updates.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
