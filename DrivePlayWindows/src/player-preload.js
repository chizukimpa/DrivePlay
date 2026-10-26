'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function sendNative(type, data) {
  try {
    ipcRenderer.sendToHost('native', { type, data: data || {} });
  } catch (_) {}
}

function reportActivity() {
  try { ipcRenderer.send('player:activity'); } catch (_) {}
}

window.addEventListener('pointermove', reportActivity, { passive: true });
window.addEventListener('pointerdown', reportActivity, { passive: true });
window.addEventListener('keydown', reportActivity, true);
window.addEventListener('wheel', reportActivity, { passive: true });
window.addEventListener('focus', reportActivity);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) reportActivity();
});
reportActivity();

// Bridge used by the native (ffmpeg + Chromium) player page.
contextBridge.exposeInMainWorld('DesktopPlayer', {
  prepare: (payload) => ipcRenderer.invoke('native:prepare', payload),
  extract: (payload) => ipcRenderer.invoke('native:extract', payload),
  onProgress: (callback) => {
    try {
      ipcRenderer.on('native:extract-progress', (_event, data) => callback(data));
    } catch (_) {}
  },

  ready: (data) => sendNative('ready', data),
  saveProgress: (id, title, time, duration) =>
    sendNative('progress', { id, title, time, duration }),
  saveSettings: (patch) => sendNative('settings', patch),
  setFill: (enabled) => sendNative('fill', { enabled: !!enabled }),
  previous: () => sendNative('previous'),
  next: () => sendNative('next'),
  close: () => sendNative('close'),
  openExternal: () => sendNative('external'),
  failed: (error) => sendNative('failed', { error: String(error || '') }),
});

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.__driveplayTick) return;

  const payload = { ...data.__driveplayTick, topHref: window.location.href };
  try {
    ipcRenderer.sendToHost('tick', payload);
  } catch (_) {}
});
