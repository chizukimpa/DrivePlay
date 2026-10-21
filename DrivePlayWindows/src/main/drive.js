'use strict';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const VIDEO_EXTENSIONS = new Set([
  'mkv', 'mp4', 'm4v', 'avi', 'mov', 'webm', 'ts', 'm2ts',
  'mpg', 'mpeg', 'wmv', 'flv', 'ogv', '3gp',
]);

const ERRORS = {
  notPublic:
    'Não foi possível abrir a pasta. Compartilhe como “qualquer pessoa com o link”.',
  unreadable:
    'A pasta não pôde ser lida. Verifique a conexão e tente novamente.',
  network:
    'Não foi possível conectar ao Google Drive. Verifique a internet e tente novamente.',
};

function decodeEntities(value) {
  if (!value) return '';
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function firstMatch(pattern, text) {
  const match = new RegExp(pattern, 's').exec(text);
  return match && match[1] != null ? match[1] : null;
}

function parseTitle(html) {
  const raw = firstMatch('<title>(.*?)</title>', html);
  if (!raw) return null;
  const name = decodeEntities(raw).trim();
  return name || null;
}

function parseEntries(html) {
  const chunks = html.split('<div class="flip-entry"').slice(1);
  const entries = [];

  for (const chunk of chunks) {
    const id = firstMatch('id="entry-([^"]+)"', chunk);
    const rawName = firstMatch('flip-entry-title">(.*?)</div>', chunk);
    if (!id || !rawName) continue;

    const name = decodeEntities(rawName).trim();
    if (!name) continue;

    const isFolder =
      chunk.includes('drive-sprite-folder') || chunk.includes('aria-label="Folder"');
    const mime = firstMatch('type/([a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+)', chunk);
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const isVideo = (mime && mime.startsWith('video/')) || VIDEO_EXTENSIONS.has(ext);

    const modifiedRaw = firstMatch('flip-entry-last-modified"><div>(.*?)</div>', chunk);
    const thumbRaw = firstMatch('flip-entry-thumb"><img src="([^"]+)"', chunk);

    entries.push({
      id,
      name,
      isFolder,
      isVideo,
      modified: modifiedRaw ? decodeEntities(modifiedRaw).trim() : null,
      thumbnail: thumbRaw ? decodeEntities(thumbRaw).trim() : null,
      mimeType: mime || null,
    });
  }

  return entries;
}

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFolder(folderID) {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderID)}`;

  let response;
  try {
    response = await fetchWithTimeout(url);
  } catch (error) {
    return { ok: false, error: ERRORS.network };
  }

  if (!response.ok) {
    return { ok: false, error: ERRORS.unreadable };
  }

  let html;
  try {
    html = await response.text();
  } catch (error) {
    return { ok: false, error: ERRORS.unreadable };
  }

  if (!html.includes('id="flip-contents"') && !html.includes('flip-entry')) {
    return { ok: false, error: ERRORS.notPublic };
  }

  const name = parseTitle(html) || 'Google Drive';
  return {
    ok: true,
    content: {
      id: folderID,
      name,
      entries: parseEntries(html),
    },
  };
}

async function fetchTitle(fileID) {
  const url = `https://drive.google.com/file/d/${encodeURIComponent(fileID)}/view`;
  let response;
  try {
    response = await fetchWithTimeout(url, 15000);
  } catch (error) {
    return { ok: false, error: ERRORS.network };
  }

  if (!response.ok) return { ok: false, error: ERRORS.unreadable };

  let html;
  try {
    html = await response.text();
  } catch (error) {
    return { ok: false, error: ERRORS.unreadable };
  }

  const title = parseTitle(html);
  if (!title) return { ok: true, title: null };

  return {
    ok: true,
    title: decodeEntities(title.replace(/ - Google Drive$/, '')).trim() || null,
  };
}

module.exports = {
  fetchFolder,
  fetchTitle,
  parseEntries,
  decodeEntities,
  ERRORS,
};
