import { normalizeLibrary } from './library.js';

export const DEFAULT_SETTINGS = {
  skipIntro: false,
  introSeconds: 90,
  skipEnding: false,
  endingSeconds: 180,
  autoNext: true,
  resumePlayback: true,
  showSkipButtons: true,
  libraryMode: false,
  selectedCollectionID: null,
  lastFolderID: null,
  lastFileID: null,
  showSidebar: true,
};

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    skipIntro: !!input.skipIntro,
    skipEnding: !!input.skipEnding,
    autoNext: input.autoNext == null ? DEFAULT_SETTINGS.autoNext : !!input.autoNext,
    resumePlayback:
      input.resumePlayback == null ? DEFAULT_SETTINGS.resumePlayback : !!input.resumePlayback,
    showSkipButtons:
      input.showSkipButtons == null ? DEFAULT_SETTINGS.showSkipButtons : !!input.showSkipButtons,
    introSeconds: clamp(input.introSeconds, 5, 600, DEFAULT_SETTINGS.introSeconds),
    endingSeconds: clamp(input.endingSeconds, 5, 900, DEFAULT_SETTINGS.endingSeconds),
    libraryMode: !!input.libraryMode,
    selectedCollectionID:
      typeof input.selectedCollectionID === 'string' ? input.selectedCollectionID : null,
    lastFolderID: typeof input.lastFolderID === 'string' ? input.lastFolderID : null,
    lastFileID: typeof input.lastFileID === 'string' ? input.lastFileID : null,
    showSidebar: input.showSidebar == null ? true : !!input.showSidebar,
  };
}

export function normalizeProgress(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;

  for (const [id, value] of Object.entries(raw)) {
    if (!id || !value || typeof value !== 'object') continue;
    const time = Number(value.time);
    const duration = Number(value.duration);
    if (!Number.isFinite(time) || !Number.isFinite(duration)) continue;
    result[id] = {
      time: Math.max(time, 0),
      duration: Math.max(duration, 0),
      watched: !!value.watched,
    };
  }
  return result;
}

function normalizeRecentItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  return {
    id,
    title: String(raw.title || ''),
    added: raw.added || new Date().toISOString(),
  };
}

export function normalizeRecents(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    folders: Array.isArray(input.folders)
      ? input.folders.map(normalizeRecentItem).filter(Boolean)
      : [],
    items: Array.isArray(input.items)
      ? input.items.map(normalizeRecentItem).filter(Boolean)
      : [],
  };
}

export async function loadAll(api) {
  const [libraryRaw, progressRaw, settingsRaw, recentsRaw] = await Promise.all([
    api.loadStore('library'),
    api.loadStore('progress'),
    api.loadStore('settings'),
    api.loadStore('recents'),
  ]);

  return {
    library: normalizeLibrary(libraryRaw),
    progress: normalizeProgress(progressRaw),
    settings: normalizeSettings(settingsRaw),
    recents: normalizeRecents(recentsRaw),
  };
}

const timers = new Map();

export function saveNow(api, name, data) {
  const existing = timers.get(name);
  if (existing) {
    clearTimeout(existing);
    timers.delete(name);
  }
  return api.saveStore(name, data);
}

export function saveSoon(api, name, data, delay = 250) {
  const existing = timers.get(name);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(name);
    api.saveStore(name, data);
  }, delay);
  timers.set(name, timer);
}
