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
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveProfile: (profile) => ipcRenderer.invoke('profiles:save', {
    id: profile && profile.id,
    name: profile && profile.name,
    mode: profile && profile.mode,
    intervalSec: profile && profile.intervalSec,
  }),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  setNotifications: (value) => ipcRenderer.invoke('settings:set-notifications', value === true),
  openRepository: () => ipcRenderer.invoke('repo:open'),
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
  onHistory: (callback) => {
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('history:state', handler);
    return () => ipcRenderer.removeListener('history:state', handler);
  },
});
