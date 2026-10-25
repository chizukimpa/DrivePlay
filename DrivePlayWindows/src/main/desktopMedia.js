'use strict';

/*
 * Desktop media backend for the native (Chromium + ffmpeg) player.
 *
 * - Resolves a Google Drive file id to the original download URL using the
 *   DrivePlay session cookies (no quota-bypass trick: if Drive answers with its
 *   download-quota page, the caller can fall back to the preview player).
 * - Serves the file (or a local file) through a 127.0.0.1 HTTP server with
 *   byte-range support, so <video> can seek.
 * - Probes the audio/subtitle tracks with ffmpeg and extracts the selected
 *   alternate track on demand, cached under the userData directory.
 */

const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const PARTITION = 'persist:driveplay';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const VIDEO_MIME = {
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  ogv: 'video/ogg',
};

function extensionOf(name) {
  const match = /\.([a-z0-9]{2,5})$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function mimeFor(name) {
  return VIDEO_MIME[extensionOf(name)] || 'video/mp4';
}

function cacheRoot() {
  const root = path.join(app.getPath('userData'), 'media-cache');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function platformKey() {
  if (process.platform === 'win32') return 'win32-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  return process.platform + '-' + process.arch;
}

function ffmpegPath() {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  const candidates = [
    path.join(process.resourcesPath || '', 'ffmpeg', name),
    path.join(process.resourcesPath || '', name),
    path.join(app.getAppPath(), 'tools', 'ffmpeg', platformKey(), name),
    path.join(app.getAppPath(), 'tools', 'ffmpeg', 'darwin-x64', name),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function htmlError(html) {
  const page = String(html || '').toLowerCase();
  if (page.includes('limite ultrapassado') || page.includes('quota exceeded')
    || page.includes('too many users')) {
    return 'O Google Drive atingiu o limite de downloads deste arquivo. '
      + 'Use “Abrir no navegador” com uma conta Google ou aguarde algumas horas.';
  }
  if (page.includes('fazer login') || page.includes('sign in')
    || page.includes('accounts.google.com')) {
    return 'O Google Drive pediu login para este arquivo. Entre na sua conta no navegador.';
  }
  if (page.includes('acesso negado') || page.includes('access denied')
    || page.includes('permissão')) {
    return 'Você não tem permissão para abrir este arquivo no Drive.';
  }
  return 'O Google Drive devolveu uma página em vez do vídeo.';
}

async function resolveDrive(fileId) {
  const ses = session.fromPartition(PARTITION);
  let url = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);

  for (let hop = 0; hop < 6; hop += 1) {
    let response;
    try {
      response = await ses.fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });
    } catch (error) {
      return { error: 'Falha de rede ao resolver o vídeo: ' + error.message };
    }

    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) {
      const html = await response.text();
      const confirm = /name="confirm"\s+value="([^"]+)"/i.exec(html);
      const uuid = /name="uuid"\s+value="([^"]+)"/i.exec(html);
      if (confirm) {
        url = 'https://drive.usercontent.google.com/download?id='
          + encodeURIComponent(fileId) + '&export=download&confirm=' + confirm[1]
          + (uuid ? '&uuid=' + uuid[1] : '');
        continue;
      }
      return { error: htmlError(html) };
    }

    if (response.status >= 400) {
      return { error: 'O Drive respondeu HTTP ' + response.status + ' para este arquivo.' };
    }

    const length = parseInt(response.headers.get('content-length') || '', 10);
    return {
      url: response.url || url,
      contentType: type,
      length: Number.isFinite(length) ? length : -1,
    };
  }

  return { error: 'Não foi possível resolver o endereço do vídeo no Drive.' };
}

function parseDuration(text) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return 0;
  return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
}

function parseTracks(stderr) {
  const text = String(stderr || '');
  const lines = text.split(/\r?\n/);
  const streams = [];
  let current = null;
  let videoWidth = 0;
  let videoHeight = 0;

  for (const line of lines) {
    const stream = /Stream #0:(\d+)(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle|Attachment):\s*([^,]+)/i.exec(line);
    if (stream) {
      current = {
        streamIndex: parseInt(stream[1], 10),
        language: stream[2] || '',
        kind: stream[3].toLowerCase(),
        codec: stream[4].trim(),
        label: '',
        isDefault: /\(default\)/i.test(line),
      };
      streams.push(current);
      if (current.kind === 'video' && !videoWidth) {
        const size = /(\d{2,5})x(\d{2,5})/.exec(line);
        if (size) {
          videoWidth = parseInt(size[1], 10);
          videoHeight = parseInt(size[2], 10);
        }
      }
      continue;
    }
    const title = /^\s*title\s*:\s*(.+)$/i.exec(line);
    if (title && current && !current.label) {
      current.label = decodeEntities(title[1]).trim();
    }
  }

  const audio = [];
  const textTracks = [];
  for (const item of streams) {
    if (item.kind === 'audio') {
      audio.push({
        index: audio.length,
        streamIndex: item.streamIndex,
        label: item.label || item.language || ('Faixa ' + (audio.length + 1)),
        language: item.language,
        codec: item.codec,
        default: item.isDefault,
        selected: false,
      });
    } else if (item.kind === 'subtitle') {
      textTracks.push({
        index: textTracks.length,
        streamIndex: item.streamIndex,
        label: item.label || item.language || ('Legenda ' + (textTracks.length + 1)),
        language: item.language,
        codec: item.codec,
        default: item.isDefault,
        selected: false,
      });
    }
  }

  if (audio.length) {
    const preferred = audio.findIndex((item) => item.default);
    audio[preferred >= 0 ? preferred : 0].selected = true;
  }

  return {
    duration: parseDuration(text),
    videoWidth,
    videoHeight,
    audio,
    text: textTracks,
  };
}

function probe(mediaUrl, timeoutMs) {
  return new Promise((resolve) => {
    let stderr = '';
    let done = false;
    let child;
    try {
      child = spawn(ffmpegPath(), ['-hide_banner', '-i', mediaUrl], {
        windowsHide: true,
      });
    } catch (error) {
      resolve({ error: 'ffmpeg não encontrado: ' + error.message });
      return;
    }

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ error: 'O ffmpeg demorou demais para ler o cabeçalho do vídeo.' });
    }, timeoutMs || 25000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 300000) stderr = stderr.slice(-150000);
    });
    child.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ error: 'Não foi possível executar o ffmpeg: ' + error.message });
    });
    child.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const tracks = parseTracks(stderr);
      if (!tracks.audio.length && !tracks.text.length && !tracks.videoWidth) {
        const firstError = /(Invalid data|moov atom not found|No such file|Server returned|Error opening input)/i.exec(stderr);
        resolve({
          error: 'O ffmpeg não reconheceu o vídeo'
            + (firstError ? ' (' + firstError[1] + ').' : '.'),
        });
        return;
      }
      resolve(tracks);
    });
  });
}

function extract(mediaUrl, kind, streamIndex, key, duration, onProgress) {
  return new Promise((resolve) => {
    const dir = path.join(cacheRoot(), key);
    fs.mkdirSync(dir, { recursive: true });
    const ext = kind === 'audio' ? '.m4a' : '.vtt';
    const file = path.join(dir, (kind === 'audio' ? 'a' : 's') + streamIndex + ext);

    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 0) {
        resolve({ file });
        return;
      }
    }

    const temp = path.join(dir, (kind === 'audio' ? 'a' : 's') + streamIndex + '.tmp' + ext);
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-nostats',
      '-progress', 'pipe:1', '-i', mediaUrl,
      '-map', '0:' + streamIndex,
    ];
    if (kind === 'audio') {
      args.push('-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
    } else {
      args.push('-c:s', 'webvtt');
    }
    args.push(temp);

    let child;
    try {
      child = spawn(ffmpegPath(), args, { windowsHide: true });
    } catch (error) {
      resolve({ error: error.message });
      return;
    }

    let stderr = '';
    let lastSent = 0;
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = /out_time_ms=(\d+)/g;
      let m;
      let value = null;
      while ((m = match.exec(text))) value = parseInt(m[1], 10) / 1000000;
      if (value != null && typeof onProgress === 'function') {
        const now = Date.now();
        if (now - lastSent > 250) {
          lastSent = now;
          onProgress(duration > 0 ? Math.min(0.99, value / duration) : 0);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
    }, 30 * 60 * 1000);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: 'ffmpeg: ' + error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        try { fs.unlinkSync(temp); } catch (_) {}
        const detail = stderr.trim().split(/\r?\n/).pop() || ('código ' + code);
        resolve({ error: 'Falha ao preparar a faixa: ' + detail });
        return;
      }
      try {
        fs.renameSync(temp, file);
      } catch (error) {
        resolve({ error: 'Não foi possível salvar a faixa: ' + error.message });
        return;
      }
      if (typeof onProgress === 'function') onProgress(1);
      resolve({ file });
    });
  });
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;
  let start = match[1] === '' ? null : parseInt(match[1], 10);
  let end = match[2] === '' ? null : parseInt(match[2], 10);
  if (start == null && end == null) return null;
  if (start == null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end == null) {
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function serveLocalFile(file, req, res, mime) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const size = stat.size;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime || 'application/octet-stream');

  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  if (req.headers.range && !range) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + size });
    res.end();
    return;
  }
  if (range) {
    res.writeHead(206, {
      'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + size,
      'Content-Length': range.end - range.start + 1,
    });
    const stream = fs.createReadStream(file, { start: range.start, end: range.end });
    stream.on('error', () => {
      try { res.destroy(); } catch (_) {}
    });
    res.on('close', () => {
      try { stream.destroy(); } catch (_) {}
    });
    stream.pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Length': size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    try { res.destroy(); } catch (_) {}
  });
  res.on('close', () => {
    try { stream.destroy(); } catch (_) {}
  });
  stream.pipe(res);
}

class MediaServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.entries = new Map();
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        try {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(error.message);
        } catch (_) {}
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  register(key, entry) {
    this.entries.set(key, entry);
  }

  unregister(key) {
    this.entries.delete(key);
  }

  mediaUrl(key) {
    return 'http://127.0.0.1:' + this.port + '/media/' + encodeURIComponent(key);
  }

  cacheUrl(key, file) {
    return 'http://127.0.0.1:' + this.port + '/cache/' + encodeURIComponent(key)
      + '/' + encodeURIComponent(path.basename(file));
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/cache/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const key = decodeURIComponent(parts[1] || '');
      const name = decodeURIComponent(parts[2] || '');
      if (!key || !name || name.includes('/') || name.includes('\\')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = path.join(cacheRoot(), key, name);
      const mime = name.endsWith('.vtt') ? 'text/vtt; charset=utf-8'
        : (name.endsWith('.m4a') ? 'audio/mp4' : 'application/octet-stream');
      serveLocalFile(file, req, res, mime);
      return;
    }

    if (url.pathname.startsWith('/media/')) {
      const key = decodeURIComponent(url.pathname.slice('/media/'.length));
      const entry = this.entries.get(key);
      if (!entry) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (entry.localPath) {
        serveLocalFile(entry.localPath, req, res, entry.mime);
        return;
      }
      await this.proxyDrive(entry, req, res);
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    res.writeHead(404);
    res.end();
  }

  async proxyDrive(entry, req, res) {
    const ses = session.fromPartition(PARTITION);
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    };
    if (req.headers.range) headers.Range = req.headers.range;

    let upstream;
    try {
      upstream = await ses.fetch(entry.url, {
        redirect: 'follow',
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
      });
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Falha ao ler o vídeo: ' + error.message);
      return;
    }

    const type = String(upstream.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) {
      const html = await upstream.text();
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(htmlError(html));
      return;
    }

    const passthrough = ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
    const responseHeaders = {
      'Content-Type': entry.mime || mimeFor(entry.name),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Accept-Ranges': 'bytes',
    };
    for (const name of passthrough) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }

    res.writeHead(upstream.status, responseHeaders);
    if (req.method === 'HEAD' || !upstream.body) {
      try { if (upstream.body) upstream.body.cancel(); } catch (_) {}
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => {
      try { res.destroy(); } catch (_) {}
    });
    res.on('close', () => {
      try { stream.destroy(); } catch (_) {}
      try { upstream.body.cancel(); } catch (_) {}
    });
    stream.pipe(res);
  }
}

module.exports = {
  MediaServer,
  resolveDrive,
  probe,
  extract,
  ffmpegPath,
  mimeFor,
  extensionOf,
  cacheRoot,
  htmlError,
  parseTracks,
};
