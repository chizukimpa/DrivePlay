import { compareEpisodes } from './drive.js';

export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createDefaultCollection() {
  return {
    id: uuid(),
    name: 'Minha biblioteca',
    createdAt: new Date().toISOString(),
    isDefault: true,
    sources: [],
  };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    isFolder: !!raw.isFolder,
    isVideo: !!raw.isVideo,
    modified: raw.modified == null || raw.modified === '' ? null : String(raw.modified),
    thumbnail: raw.thumbnail == null || raw.thumbnail === '' ? null : String(raw.thumbnail),
    mimeType: raw.mimeType == null || raw.mimeType === '' ? null : String(raw.mimeType),
  };
}

function normalizeSource(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'file' ? 'file' : 'folder';
  const driveID = String(raw.driveID || '').trim();
  if (!driveID) return null;

  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(normalizeEntry).filter(Boolean)
    : [];

  return {
    id: String(raw.id || `${kind}:${driveID}`),
    kind,
    driveID,
    name: String(raw.name || 'Google Drive'),
    addedAt: raw.addedAt || new Date().toISOString(),
    entries,
  };
}

function normalizeCollection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;

  return {
    id: String(raw.id || uuid()),
    name,
    createdAt: raw.createdAt || new Date().toISOString(),
    isDefault: !!raw.isDefault,
    sources: Array.isArray(raw.sources) ? raw.sources.map(normalizeSource).filter(Boolean) : [],
  };
}

export function normalizeLibrary(raw) {
  let collections = [];
  if (Array.isArray(raw)) {
    collections = raw.map(normalizeCollection).filter(Boolean);
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.collections)) {
    collections = raw.collections.map(normalizeCollection).filter(Boolean);
  }

  if (collections.length === 0) {
    collections = [createDefaultCollection()];
  }

  const firstDefault = collections.findIndex((collection) => collection.isDefault);
  if (firstDefault === -1) {
    collections[0].isDefault = true;
  } else {
    collections.forEach((collection, index) => {
      collection.isDefault = index === firstDefault;
    });
  }

  return { collections };
}

export function defaultCollection(library) {
  return (
    library.collections.find((collection) => collection.isDefault) ||
    library.collections[0] ||
    null
  );
}

export function findCollection(library, collectionID) {
  if (!library || !Array.isArray(library.collections)) return null;
  return library.collections.find((collection) => collection.id === collectionID) || null;
}

export function aggregateEntries(library, collectionID) {
  const collection = findCollection(library, collectionID);
  if (!collection) return [];

  const seen = new Set();
  const result = [];

  for (const source of collection.sources) {
    for (const entry of source.entries) {
      if (!entry.isVideo || entry.isFolder) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      result.push(entry);
    }
  }

  return result.sort(compareEpisodes);
}

export function episodeCount(library, collectionID) {
  return aggregateEntries(library, collectionID).length;
}

export function sourceVideoCount(source) {
  return source.entries.filter((entry) => entry.isVideo).length;
}

export function addSource(library, collectionID, kind, driveID, name, entries) {
  const collection = findCollection(library, collectionID);
  if (!collection) return false;

  const sourceID = `${kind}:${driveID}`;
  const normalizedEntries = Array.isArray(entries)
    ? entries.map(normalizeEntry).filter(Boolean)
    : [];

  const existing = collection.sources.find((source) => source.id === sourceID);
  if (existing) {
    existing.name = name || existing.name;
    existing.entries = normalizedEntries;
    return false;
  }

  collection.sources.push({
    id: sourceID,
    kind,
    driveID,
    name: name || 'Google Drive',
    addedAt: new Date().toISOString(),
    entries: normalizedEntries,
  });

  return true;
}

export function removeSource(library, collectionID, sourceID) {
  const collection = findCollection(library, collectionID);
  if (!collection) return false;
  const before = collection.sources.length;
  collection.sources = collection.sources.filter((source) => source.id !== sourceID);
  return collection.sources.length !== before;
}

export function moveSource(library, sourceID, fromCollectionID, toCollectionID) {
  if (fromCollectionID === toCollectionID) return false;
  const from = findCollection(library, fromCollectionID);
  const to = findCollection(library, toCollectionID);
  if (!from || !to) return false;

  const index = from.sources.findIndex((source) => source.id === sourceID);
  if (index === -1) return false;

  const [source] = from.sources.splice(index, 1);
  if (!to.sources.some((item) => item.id === source.id)) {
    to.sources.push(source);
  }
  return true;
}

export function updateSource(library, collectionID, sourceID, patch) {
  const collection = findCollection(library, collectionID);
  if (!collection) return false;
  const source = collection.sources.find((item) => item.id === sourceID);
  if (!source) return false;

  if (patch && typeof patch.name === 'string') source.name = patch.name;
  if (patch && Array.isArray(patch.entries)) {
    source.entries = patch.entries.map(normalizeEntry).filter(Boolean);
  }
  return true;
}

export function createCollection(library, name) {
  const trimmed = String(name || '').trim();
  const collection = {
    id: uuid(),
    name: trimmed || 'Nova coleção',
    createdAt: new Date().toISOString(),
    isDefault: false,
    sources: [],
  };
  library.collections.push(collection);
  return collection.id;
}

export function renameCollection(library, collectionID, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const collection = findCollection(library, collectionID);
  if (!collection) return false;
  collection.name = trimmed;
  return true;
}

export function deleteCollection(library, collectionID) {
  const index = library.collections.findIndex((collection) => collection.id === collectionID);
  if (index === -1) return false;
  if (library.collections[index].isDefault) return false;

  library.collections.splice(index, 1);
  if (library.collections.length === 0) {
    library.collections.push(createDefaultCollection());
  }
  return true;
}
