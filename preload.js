'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// В renderer попадает только этот узкий набор функций.
contextBridge.exposeInMainWorld('antiAfk', {
  listClients: () => ipcRenderer.invoke('clients:list'),
  start: (cfg) => ipcRenderer.invoke('session:start', {
    pid: cfg && cfg.pid,
    mode: cfg && cfg.mode,
    intervalSec: cfg && cfg.intervalSec,
  }),
  stop: () => ipcRenderer.invoke('session:stop'),
  getState: () => ipcRenderer.invoke('session:state'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  setAutoUpdate: (value) => ipcRenderer.invoke('update:set-auto', value === true),
  openUpdatePage: () => ipcRenderer.invoke('update:open'),
  onUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('session:state', handler);
    return () => ipcRenderer.removeListener('session:state', handler);
  },
});
