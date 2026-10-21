'use strict';

const { ipcRenderer } = require('electron');

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.__driveplayTick) return;

  const payload = { ...data.__driveplayTick, topHref: window.location.href };
  try {
    ipcRenderer.sendToHost('tick', payload);
  } catch (_) {}
});
