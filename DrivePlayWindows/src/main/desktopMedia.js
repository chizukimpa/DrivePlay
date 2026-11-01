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
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return 'linux-arm64';
    if (process.arch === 'ia32') return 'linux-ia32';
    return 'linux-x64';
  }
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

async function authCookieHeader(url) {
  const ses = session.fromPartition(PARTITION);
  const targets = new Set([url, 'https://drive.google.com/']);
  try { targets.add(new URL(url).origin + '/'); } catch (_) {}
  const parts = [];
  const seen = new Set();
  for (const target of targets) {
    let cookies = [];
    try { cookies = await ses.cookies.get({ url: target }); } catch (_) {}
    for (const cookie of cookies) {
      if (!cookie || !cookie.name || seen.has(cookie.name)) continue;
      seen.add(cookie.name);
      parts.push(cookie.name + '=' + cookie.value);
    }
  }
  return parts.join('; ');
}

/*
 * Media transfers use Node's fetch (undici), not session.fetch: Chromium's
 * network service crashes when several 1080p MKV ranges are streamed at the
 * same time, and every pending request then hangs forever. The session cookies
 * are copied into the request so private Drive files keep working.
 */
async function fetchUpstream(url, options) {
  const headers = { ...((options && options.headers) || {}) };
  const cookie = await authCookieHeader(url);
  if (cookie && !headers.Cookie) headers.Cookie = cookie;
  return fetch(url, { ...options, headers });
}

function discardBody(response) {
  try {
    const body = response && response.body;
    if (!body || body.locked) return;
    const pending = body.cancel();
    if (pending && pending.catch) pending.catch(() => {});
  } catch (_) {}
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

function looksLikeMedia(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
  if (buffer.slice(4, 8).toString() === 'ftyp') return true;
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'AVI ') return true;
  if (buffer[0] === 0x47) return true;
  if (buffer.slice(0, 3).toString() === 'FLV') return true;
  return false;
}

/**
 * Official Drive API with an API key. It uses the key project's quota, so it
 * is not affected by the anonymous "too many users" download limit. Works for
 * files shared with "anyone with the link".
 */
async function resolveViaApi(fileId, apiKey) {
  if (!apiKey) return null;
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId)
    + '?alt=media&supportsAllDrives=true&key=' + encodeURIComponent(apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetchUpstream(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        Range: 'bytes=0-2047',
      },
    });
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (response.status >= 400) {
      try { await response.arrayBuffer(); } catch (_) {}
      return null;
    }
    if (type.includes('text/html') || type.includes('application/json')) {
      discardBody(response);
      return null;
    }

    const contentRange = response.headers.get('content-range') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '', 10);
    let media;
    if (response.status === 206 || (Number.isFinite(contentLength) && contentLength <= 65536)) {
      const head = Buffer.from(await response.arrayBuffer());
      media = looksLikeMedia(head) || type.startsWith('video/');
    } else {
      media = type.startsWith('video/') || type === 'application/octet-stream' || !type;
      try {
        if (response.body && !response.body.locked) {
          const pending = response.body.cancel();
          if (pending && pending.catch) pending.catch(() => {});
        }
      } catch (_) {}
    }
    if (!media) return null;

    let length = -1;
    if (contentRange.includes('/')) {
      const total = parseInt(contentRange.split('/').pop(), 10);
      if (Number.isFinite(total)) length = total;
    } else if (Number.isFinite(contentLength) && contentLength > 65536) {
      length = contentLength;
    }
    return {
      url: response.url || url,
      contentType: type || 'application/octet-stream',
      length,
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDrive(fileId, apiKey) {
  if (apiKey) {
    const viaApi = await resolveViaApi(fileId, apiKey);
    if (viaApi) return viaApi;
  }

  let url = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);

  for (let hop = 0; hop < 6; hop += 1) {
    let response;
    try {
      response = await fetchUpstream(url, {
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
      discardBody(response);
      return { error: 'O Drive respondeu HTTP ' + response.status + ' para este arquivo.' };
    }

    const length = parseInt(response.headers.get('content-length') || '', 10);
    const resolved = {
      url: response.url || url,
      contentType: type,
      length: Number.isFinite(length) ? length : -1,
    };
    // Só precisamos dos cabeçalhos aqui; descartar o corpo libera a conexão
    // do Chromium para o ffmpeg e o player abrirem as próximas requisições.
    discardBody(response);
    return resolved;
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
        console.warn('DrivePlay: ffmpeg probe failed:', stderr.slice(-1200));
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
    console.log('DrivePlay media proxy', req.method, req.headers.range || '(no range)',
      entry.url.slice(0, 110));
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    };
    // Google's API answers 206 for ranged requests even when the full
    // download quota is exhausted. Players often start with no Range header
    // (ffmpeg does), so always ask for a range.
    headers.Range = req.headers.range || 'bytes=0-';

    // ffmpeg fecha a conexão assim que lê o cabeçalho do MKV, e o Chromium
    // cancela requisições ao trocar de faixa ou buscar. Sem abortar o fetch
    // do Chromium, cada uma dessas conexões fica presa no pool e o player
    // para de abrir novas requisições (ficava carregando para sempre).
    const controller = new AbortController();
    let clientGone = false;
    const abortUpstream = () => {
      if (clientGone) return;
      clientGone = true;
      try { controller.abort(); } catch (_) {}
    };
    res.on('close', abortUpstream);
    res.on('error', abortUpstream);

    let upstream;
    try {
      upstream = await fetchUpstream(entry.url, {
        redirect: 'follow',
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (clientGone || controller.signal.aborted) return;
      try {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Falha ao ler o vídeo: ' + error.message);
      } catch (_) {}
      return;
    }

    if (clientGone) {
      discardBody(upstream);
      return;
    }

    const type = String(upstream.headers.get('content-type') || '').toLowerCase();
    console.log('DrivePlay media upstream', upstream.status, type,
      upstream.headers.get('content-range') || '', upstream.headers.get('content-length') || '');
    if (type.includes('text/html')) {
      const html = await upstream.text();
      try {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(htmlError(html));
      } catch (_) {}
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

    if (clientGone) {
      discardBody(upstream);
      return;
    }
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === 'HEAD' || !upstream.body) {
      discardBody(upstream);
      res.end();
      return;
    }

    let stream;
    try {
      stream = Readable.fromWeb(upstream.body);
    } catch (error) {
      abortUpstream();
      discardBody(upstream);
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Falha ao ler o vídeo: ' + error.message);
      } catch (_) {}
      return;
    }
    stream.on('error', () => {
      abortUpstream();
      try { res.destroy(); } catch (_) {}
    });
    res.on('close', () => {
      abortUpstream();
      try { stream.destroy(); } catch (_) {}
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
