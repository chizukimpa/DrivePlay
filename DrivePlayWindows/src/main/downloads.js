'use strict';

const { app, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let win = null;
let player = null;
let active = null;
let lastPath = null;
let lastProgressSent = 0;

const PLAYER_PARTITION = 'persist:driveplay';

const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function sanitizeFilename(input) {
  let name = String(input || '').trim();
  if (!name) name = 'video.mkv';
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  name = name.replace(/[. ]+$/g, '');
  if (!name) name = 'video.mkv';

  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  if (RESERVED_NAMES.has(base.toUpperCase())) name = `_${name}`;

  if (name.length > 180) {
    const suffix = ext || '';
    name = name.slice(0, 180 - suffix.length) + suffix;
  }
  return name;
}

function uniquePath(directory, filename) {
  let candidate = path.join(directory, filename);
  if (!fs.existsSync(candidate)) return candidate;

  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  for (let i = 1; i < 1000; i += 1) {
    candidate = path.join(directory, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(directory, `${base} (${Date.now()})${ext}`);
}

function send(state) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('download:state', state);
  }
}

function fail(message) {
  active = null;
  send({ state: 'failed', message });
}

function handleWillDownload(_event, item) {
  if (!active) {
    item.cancel();
    return;
  }

  const mime = String(item.getMimeType() || '').toLowerCase();
  if (mime.includes('text/html')) {
    item.cancel();
    fail('O Google Drive pediu uma confirmação. Use “Abrir no navegador” para baixar.');
    return;
  }

  const current = active;
  current.item = item;
  item.setSavePath(current.savePath);

  item.on('updated', (_e, state) => {
    const now = Date.now();
    if (now - lastProgressSent < 180 && state === 'progressing') return;
    lastProgressSent = now;

    const received = item.getReceivedBytes();
    const total = item.getTotalBytes();
    const progress = total > 0 ? Math.min(Math.max(received / total, 0), 1) : 0;
    send({
      state: 'downloading',
      progress,
      received,
      total,
      filename: current.filename,
    });
  });

  item.on('done', (_e, state) => {
    if (state === 'completed') {
      lastPath = item.getSavePath();
      active = null;
      send({ state: 'finished', path: lastPath, filename: current.filename });
    } else if (state === 'cancelled') {
      active = null;
      send({ state: 'idle' });
    } else {
      fail('O download foi interrompido. Verifique a conexão e tente novamente.');
    }
  });
}

function setupDownloads(mainWindow) {
  win = mainWindow;

  session.defaultSession.on('will-download', handleWillDownload);
  try {
    session.fromPartition(PLAYER_PARTITION).on('will-download', handleWillDownload);
  } catch (_) {}
}

function setPlayer(contents) {
  player = contents;
}

function start(id, filename) {
  if (active) {
    return { ok: false, error: 'Já existe um download em andamento.' };
  }
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'A janela não está disponível.' };
  }

  let name = sanitizeFilename(filename || 'video.mkv');
  if (!path.extname(name)) name += '.mkv';

  const savePath = uniquePath(app.getPath('downloads'), name);
  active = { id, filename: name, savePath, item: null };
  lastProgressSent = 0;

  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  if (player && !player.isDestroyed()) {
    player.downloadURL(url);
  } else {
    win.webContents.downloadURL(url);
  }
  return { ok: true, filename: name };
}

function cancel() {
  if (active && active.item) {
    active.item.cancel();
    active = null;
    send({ state: 'idle' });
    return { ok: true };
  }
  return { ok: false };
}

function reveal() {
  if (lastPath && fs.existsSync(lastPath)) {
    shell.showItemInFolder(lastPath);
    return { ok: true };
  }
  return { ok: false };
}

module.exports = {
  setupDownloads,
  setPlayer,
  start,
  cancel,
  reveal,
  sanitizeFilename,
};
