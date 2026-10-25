'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  testMode: process.env.DRIVEPLAY_TEST === '1',
  playerPreload: pathToFileURL(path.join(__dirname, 'player-preload.js')).toString(),
  nativePlayerPage: pathToFileURL(
    path.join(__dirname, 'renderer', 'native', 'player.html')
  ).toString(),

  fetchFolder: (id) => ipcRenderer.invoke('drive:fetchFolder', id),
  fetchTitle: (id) => ipcRenderer.invoke('drive:fetchTitle', id),

  loadStore: (name) => ipcRenderer.invoke('store:load', name),
  saveStore: (name, data) => ipcRenderer.invoke('store:save', name, data),

  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  openVLC: (id) => ipcRenderer.invoke('vlc:open', id),
  download: (id, filename) => ipcRenderer.invoke('download:start', id, filename),
  cancelDownload: () => ipcRenderer.invoke('download:cancel'),
  revealDownload: () => ipcRenderer.invoke('download:reveal'),

  registerPlayer: (id) => ipcRenderer.send('player:register', id),
  setPlayerMode: (mode) => ipcRenderer.send('player:mode', mode),
  seekPlayer: (time) => ipcRenderer.send('player:seek', time),
  setPlayerMuted: (muted) => ipcRenderer.send('player:mute', muted),
  setPlayerFill: (enabled) => ipcRenderer.send('player:fill', !!enabled),
  setPlayerActive: (active) => ipcRenderer.send('player:active', !!active),
  setAutoFullscreenEnabled: (enabled) =>
    ipcRenderer.send('auto-fullscreen:enabled', !!enabled),
  resetAutoFullscreen: () => ipcRenderer.send('auto-fullscreen:reset'),

  setFullscreen: (value) => ipcRenderer.invoke('window:fullscreen', value),
  setTitle: (title) => ipcRenderer.send('window:title', title),
  updateMenu: (settings) => ipcRenderer.send('menu:update', settings),
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('window:fullscreen-changed', (_event, value) => callback(!!value));
  },

  appVersion: () => ipcRenderer.invoke('app:version'),
  getLaunchLink: () => ipcRenderer.invoke('app:launchLink'),

  onDownload: (callback) => {
    ipcRenderer.on('download:state', (_event, state) => callback(state));
  },
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:action', (_event, action) => callback(action));
  },
  onOpenLink: (callback) => {
    ipcRenderer.on('app:openLink', (_event, link) => callback(link));
  },
});
