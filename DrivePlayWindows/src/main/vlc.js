'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function candidates() {
  if (process.platform === 'win32') {
    const list = [];
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    list.push(path.join(programFiles, 'VideoLAN', 'VLC', 'vlc.exe'));
    list.push(path.join(programFilesX86, 'VideoLAN', 'VLC', 'vlc.exe'));
    if (localAppData) list.push(path.join(localAppData, 'Programs', 'VideoLAN', 'VLC', 'vlc.exe'));
    return list;
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/VLC.app/Contents/MacOS/VLC',
      path.join(process.env.HOME || '', 'Applications/VLC.app/Contents/MacOS/VLC'),
    ];
  }

  return ['/usr/bin/vlc', '/usr/local/bin/vlc', '/snap/bin/vlc'];
}

function findVLC() {
  for (const candidate of candidates()) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }

  if (process.platform === 'win32') {
    try {
      const output = execFileSync('where', ['vlc'], { encoding: 'utf8', windowsHide: true });
      const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first && fs.existsSync(first)) return first;
    } catch (_) {}
  } else {
    try {
      const output = execFileSync('which', ['vlc'], { encoding: 'utf8' });
      const first = output.trim();
      if (first && fs.existsSync(first)) return first;
    } catch (_) {}
  }

  return null;
}

function downloadPage() {
  if (process.platform === 'win32') {
    return 'https://www.videolan.org/vlc/download-windows.html';
  }
  if (process.platform === 'darwin') {
    return 'https://www.videolan.org/vlc/download-macosx.html';
  }
  return 'https://www.videolan.org/vlc/';
}

function open(id) {
  const vlc = findVLC();
  if (!vlc) {
    return { ok: false, code: 'notFound', downloadPage: downloadPage() };
  }

  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

  try {
    const child = spawn(vlc, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true, path: vlc };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { findVLC, open, downloadPage };
