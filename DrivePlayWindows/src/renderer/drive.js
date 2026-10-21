const ID = '[A-Za-z0-9_-]{10,}';

const collator = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
});

export function parseTarget(input) {
  const text = String(input || '').trim();
  if (!text) return null;

  const folderPatterns = [
    new RegExp(`/folders/(${ID})`),
    new RegExp(`/drive/folders/(${ID})`),
    new RegExp(`[?&]id=(${ID})`),
  ];

  const looksLikeFolder = /\/folders\/|embeddedfolderview/i.test(text);
  if (looksLikeFolder) {
    for (const pattern of folderPatterns) {
      const match = text.match(pattern);
      if (match) return { kind: 'folder', id: match[1] };
    }
  }

  const filePatterns = [
    new RegExp(`/file/d/(${ID})`),
    new RegExp(`[?&]id=(${ID})`),
    new RegExp(`/d/(${ID})`),
  ];

  for (const pattern of filePatterns) {
    const match = text.match(pattern);
    if (match) return { kind: 'file', id: match[1] };
  }

  if (new RegExp(`^${ID}$`).test(text)) {
    return { kind: 'file', id: text };
  }

  return null;
}

export function folderURL(id) {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function fileViewURL(id) {
  return `https://drive.google.com/file/d/${id}/view`;
}

export function previewURL(id) {
  return `https://drive.google.com/file/d/${id}/preview?autoplay=1`;
}

export function directURL(id) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

export function fileExtension(name) {
  const text = String(name || '');
  if (!text.includes('.')) return '';
  return text.split('.').pop().toUpperCase();
}

export function naturalCompare(first, second) {
  const result = collator.compare(String(first || ''), String(second || ''));
  if (result !== 0) return result;
  return 0;
}

const episodePatterns = [
  /\bS(\d{1,2})\s*[._ -]?\s*E(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{1,3})\b/i,
  /\bT(?:EMPORADA)?\s*(\d{1,2})\s*(?:EP|E|EPIS[OÓ]DIO)\s*(\d{1,3})\b/i,
  /\bSEASON\s*(\d{1,2})\s*EPISODE\s*(\d{1,3})\b/i,
];

export function episodeKey(name) {
  const text = String(name || '');
  for (const pattern of episodePatterns) {
    const match = text.match(pattern);
    if (match) {
      const season = Number.parseInt(match[1], 10);
      const episode = Number.parseInt(match[2], 10);
      if (Number.isFinite(season) && Number.isFinite(episode)) {
        return { season, episode };
      }
    }
  }
  return { season: null, episode: null };
}

export function compareEpisodes(first, second) {
  const a = episodeKey(first.name);
  const b = episodeKey(second.name);

  if (a.season != null && b.season != null) {
    if (a.season !== b.season) return a.season - b.season;
    const episodeA = a.episode == null ? Number.MAX_SAFE_INTEGER : a.episode;
    const episodeB = b.episode == null ? Number.MAX_SAFE_INTEGER : b.episode;
    if (episodeA !== episodeB) return episodeA - episodeB;
  } else if (a.season != null) {
    return -1;
  } else if (b.season != null) {
    return 1;
  }

  const byName = naturalCompare(first.name, second.name);
  if (byName !== 0) return byName;
  return String(first.id || '').localeCompare(String(second.id || ''));
}

export function sortFolderEntries(entries) {
  return [...entries].sort((first, second) => {
    if (first.isFolder !== second.isFolder) return first.isFolder ? -1 : 1;
    const byName = naturalCompare(first.name, second.name);
    if (byName !== 0) return byName;
    return String(first.id || '').localeCompare(String(second.id || ''));
  });
}

export function sortEpisodes(entries) {
  return [...entries].sort(compareEpisodes);
}

export function entrySubtitle(entry) {
  const parts = [];
  if (entry.isFolder) {
    parts.push('Pasta');
  } else {
    const extension = fileExtension(entry.name);
    if (extension) parts.push(extension);
  }
  if (entry.modified && String(entry.modified).trim()) {
    parts.push(String(entry.modified).trim());
  }
  return parts.join(' · ');
}

export function thumbnailURL(entry) {
  const raw = entry && entry.thumbnail ? String(entry.thumbnail) : '';
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

export function escapeHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(seconds) {
  const total = Math.max(Math.round(Number(seconds) || 0), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const number = value / 1024 ** index;
  const decimals = index === 0 ? 0 : number >= 100 ? 0 : number >= 10 ? 1 : 2;
  return `${number.toFixed(decimals)} ${units[index]}`;
}

export function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value));
  }
  return String(value).replace(/["\\]/g, '\\$&');
}
