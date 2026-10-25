(function () {
  "use strict";

  var LIBRARY_KEY = "driveplay.android.library.v3";
  var SETTINGS_KEY = "driveplay.android.settings.v3";

  var DEFAULTS = {
    skipIntro: true,
    introSeconds: 120,
    skipEnding: true,
    endingSeconds: 190,
    autoFullscreen: true,
    autoNext: true,
    resumePlayback: true,
    fillScreen: false
  };

  var state = {
    settings: null,
    library: null,
    view: "home",
    tab: "home",
    collectionID: null,
    folder: null,
    history: [],
    cover: false,
    version: "1.2.0",
    nativeReady: false,
    pendingFetch: {},
    fetches: {},
    toastTimer: null,
    renderTimer: null
  };

  /* ------------------------------------------------------------- helpers */

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function safeParse(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      var parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
      var random = (Math.random() * 16) | 0;
      var value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function clampNumber(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function formatTime(value) {
    var total = Math.max(0, Math.round(Number(value) || 0));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    if (hours > 0) {
      return hours + ":" + (minutes < 10 ? "0" + minutes : minutes) + ":" +
        (seconds < 10 ? "0" + seconds : seconds);
    }
    return minutes + ":" + (seconds < 10 ? "0" + seconds : seconds);
  }

  function cleanTitle(title, fallback) {
    var value = String(title || "")
      .replace(/\s*[-–—]\s*Google Drive\s*$/i, "")
      .replace(/^Google Drive\s*[-–—]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!value || value.toLowerCase() === "google drive") {
      return fallback || "Vídeo do Drive";
    }
    return value;
  }

  function storageGet(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw == null ? fallback : safeParse(raw, fallback);
    } catch (error) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* WebView storage can be unavailable. */
    }
  }

  function toast(message) {
    var node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      node.classList.remove("show");
    }, 2600);
  }

  /* ------------------------------------------------------------ settings */

  function normalizeSettings(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var settings = {};
    for (var key in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) settings[key] = DEFAULTS[key];
    }
    if (source.skipIntro != null) settings.skipIntro = source.skipIntro !== false;
    if (source.skipEnding != null) settings.skipEnding = source.skipEnding !== false;
    if (source.autoFullscreen != null) settings.autoFullscreen = source.autoFullscreen !== false;
    if (source.autoNext != null) settings.autoNext = source.autoNext !== false;
    if (source.resumePlayback != null) settings.resumePlayback = source.resumePlayback !== false;
    settings.fillScreen = source.fillScreen === true;
    settings.introSeconds = clampNumber(source.introSeconds, 120, 0, 3600);
    settings.endingSeconds = clampNumber(source.endingSeconds, 190, 0, 3600);
    return settings;
  }

  function loadSettings() {
    return normalizeSettings(storageGet(SETTINGS_KEY, {}));
  }

  function saveSettings() {
    state.settings = normalizeSettings(state.settings);
    storageSet(SETTINGS_KEY, state.settings);
    if (window.Android && typeof window.Android.setSettings === "function") {
      try {
        window.Android.setSettings(JSON.stringify(state.settings));
      } catch (error) {
        /* The bridge may not be ready. */
      }
    }
  }

  /* ------------------------------------------------------------- library */

  function createDefaultCollection() {
    return {
      id: uuid(),
      name: "Minha biblioteca",
      createdAt: new Date().toISOString(),
      isDefault: true,
      sources: []
    };
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || "").trim();
    var name = String(raw.name || raw.title || "").trim();
    if (!id || !name) return null;
    return {
      id: id,
      name: name,
      isFolder: raw.isFolder === true,
      isVideo: raw.isVideo === true && raw.isFolder !== true,
      modified: raw.modified ? String(raw.modified) : "",
      thumbnail: raw.thumbnail ? String(raw.thumbnail) : "",
      mimeType: raw.mimeType ? String(raw.mimeType) : ""
    };
  }

  function normalizeSource(raw) {
    if (!raw || typeof raw !== "object") return null;
    var kind = raw.kind === "file" ? "file" : "folder";
    var driveID = String(raw.driveID || "").trim();
    if (!driveID) return null;
    var entries = Array.isArray(raw.entries)
      ? raw.entries.map(normalizeEntry).filter(Boolean)
      : [];
    return {
      id: String(raw.id || kind + ":" + driveID),
      kind: kind,
      driveID: driveID,
      name: String(raw.name || "Google Drive"),
      addedAt: raw.addedAt || new Date().toISOString(),
      entries: entries
    };
  }

  function normalizeCollection(raw) {
    if (!raw || typeof raw !== "object") return null;
    var name = String(raw.name || "").trim();
    if (!name) return null;
    return {
      id: String(raw.id || uuid()),
      name: name,
      createdAt: raw.createdAt || new Date().toISOString(),
      isDefault: raw.isDefault === true,
      sources: Array.isArray(raw.sources)
        ? raw.sources.map(normalizeSource).filter(Boolean)
        : []
    };
  }

  function normalizeRecents(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    function list(items) {
      if (!Array.isArray(items)) return [];
      var seen = {};
      var result = [];
      items.forEach(function (item) {
        if (!item || typeof item !== "object") return;
        var id = String(item.id || "").trim();
        if (!id || seen[id]) return;
        seen[id] = true;
        result.push({
          id: id,
          title: String(item.title || ""),
          added: item.added || new Date().toISOString()
        });
      });
      return result.slice(0, 30);
    }
    return { folders: list(source.folders), items: list(source.items) };
  }

  function normalizeProgress(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var result = {};
    Object.keys(source).forEach(function (id) {
      var value = source[id];
      if (!value || typeof value !== "object") return;
      var time = Number(value.time);
      var duration = Number(value.duration);
      if (!isFinite(time) || !isFinite(duration)) return;
      result[id] = {
        time: Math.max(0, time),
        duration: Math.max(0, duration),
        watched: value.watched === true
      };
    });
    return result;
  }

  function normalizeLibrary(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var collections = Array.isArray(source.collections)
      ? source.collections.map(normalizeCollection).filter(Boolean)
      : [];

    if (!collections.length) collections = [createDefaultCollection()];

    var defaultIndex = -1;
    for (var i = 0; i < collections.length; i++) {
      if (collections[i].isDefault) {
        defaultIndex = i;
        break;
      }
    }
    if (defaultIndex < 0) defaultIndex = 0;
    collections.forEach(function (collection, index) {
      collection.isDefault = index === defaultIndex;
    });

    return {
      collections: collections,
      recents: normalizeRecents(source.recents),
      progress: normalizeProgress(source.progress)
    };
  }

  function saveLibrary(now) {
    storageSet(LIBRARY_KEY, state.library);
    var push = function () {
      if (window.Android && typeof window.Android.saveLibrary === "function") {
        try {
          window.Android.saveLibrary(JSON.stringify(state.library));
        } catch (error) {
          /* The bridge may not be ready. */
        }
      }
    };
    if (now) {
      push();
    } else {
      if (state.saveTimer) window.clearTimeout(state.saveTimer);
      state.saveTimer = window.setTimeout(push, 350);
    }
  }

  function defaultCollection() {
    for (var i = 0; i < state.library.collections.length; i++) {
      if (state.library.collections[i].isDefault) return state.library.collections[i];
    }
    return state.library.collections[0] || null;
  }

  function findCollection(id) {
    if (!id) return null;
    for (var i = 0; i < state.library.collections.length; i++) {
      if (state.library.collections[i].id === id) return state.library.collections[i];
    }
    return null;
  }

  function findSource(collectionID, sourceID) {
    var collection = findCollection(collectionID);
    if (!collection) return null;
    for (var i = 0; i < collection.sources.length; i++) {
      if (collection.sources[i].id === sourceID) return collection.sources[i];
    }
    return null;
  }

  function findSourceByDriveID(driveID) {
    for (var c = 0; c < state.library.collections.length; c++) {
      var sources = state.library.collections[c].sources;
      for (var s = 0; s < sources.length; s++) {
        if (sources[s].kind === "folder" && sources[s].driveID === driveID) return sources[s];
      }
    }
    return null;
  }

  function findEntry(id) {
    if (!id) return null;
    for (var c = 0; c < state.library.collections.length; c++) {
      var collection = state.library.collections[c];
      for (var s = 0; s < collection.sources.length; s++) {
        var source = collection.sources[s];
        for (var e = 0; e < source.entries.length; e++) {
          if (source.entries[e].id === id) {
            return { entry: source.entries[e], source: source, collection: collection };
          }
        }
      }
    }
    return null;
  }

  function addSource(collectionID, kind, driveID, name, entries) {
    var collection = findCollection(collectionID);
    if (!collection) {
      collection = defaultCollection();
    }
    if (!collection) {
      collection = createDefaultCollection();
      state.library.collections.push(collection);
    }

    var sourceID = kind + ":" + driveID;
    var normalized = (entries || []).map(normalizeEntry).filter(Boolean);
    var existing = null;
    for (var i = 0; i < collection.sources.length; i++) {
      if (collection.sources[i].id === sourceID) {
        existing = collection.sources[i];
        break;
      }
    }

    if (existing) {
      existing.name = name || existing.name;
      if (normalized.length) existing.entries = normalized;
      existing.addedAt = new Date().toISOString();
      return collection.id;
    }

    collection.sources.push({
      id: sourceID,
      kind: kind,
      driveID: driveID,
      name: name || "Google Drive",
      addedAt: new Date().toISOString(),
      entries: normalized
    });
    return collection.id;
  }

  function removeSource(collectionID, sourceID) {
    var collection = findCollection(collectionID);
    if (!collection) return;
    collection.sources = collection.sources.filter(function (source) {
      return source.id !== sourceID;
    });
  }

  function createCollection(name) {
    var collection = {
      id: uuid(),
      name: String(name || "").trim() || "Nova pasta",
      createdAt: new Date().toISOString(),
      isDefault: false,
      sources: []
    };
    state.library.collections.push(collection);
    return collection;
  }

  function deleteCollection(id) {
    var collection = findCollection(id);
    if (!collection || collection.isDefault) return false;
    state.library.collections = state.library.collections.filter(function (item) {
      return item.id !== id;
    });
    if (!state.library.collections.length) {
      state.library.collections.push(createDefaultCollection());
    }
    return true;
  }

  function aggregateEntries(collection) {
    if (!collection) return [];
    var seen = {};
    var result = [];
    collection.sources.forEach(function (source) {
      source.entries.forEach(function (entry) {
        if (!entry.isVideo || entry.isFolder) return;
        if (seen[entry.id]) return;
        seen[entry.id] = true;
        result.push(entry);
      });
    });
    return result.sort(compareEpisodes);
  }

  function aggregateSource(source) {
    if (!source) return [];
    var seen = {};
    var result = [];
    source.entries.forEach(function (entry) {
      if (!entry.isVideo || entry.isFolder) return;
      if (seen[entry.id]) return;
      seen[entry.id] = true;
      result.push(entry);
    });
    return result.sort(compareEpisodes);
  }

  function videosFromEntries(entries) {
    var seen = {};
    var result = [];
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.isVideo || entry.isFolder) return;
      if (seen[entry.id]) return;
      seen[entry.id] = true;
      result.push(entry);
    });
    return result.sort(compareEpisodes);
  }

  /* ---------------------------------------------------------- drive model */

  var ID = "[A-Za-z0-9_-]{10,}";

  function parseTarget(input) {
    var text = String(input || "").trim();
    if (!text) return null;

    var folderPatterns = [
      new RegExp("/folders/(" + ID + ")"),
      new RegExp("/drive/folders/(" + ID + ")"),
      new RegExp("[?&]id=(" + ID + ")")
    ];

    var looksLikeFolder = /\/folders\/|embeddedfolderview/i.test(text);
    if (looksLikeFolder) {
      for (var f = 0; f < folderPatterns.length; f++) {
        var folderMatch = text.match(folderPatterns[f]);
        if (folderMatch) return { kind: "folder", id: folderMatch[1] };
      }
    }

    var filePatterns = [
      new RegExp("/file/d/(" + ID + ")"),
      new RegExp("[?&]id=(" + ID + ")"),
      new RegExp("/d/(" + ID + ")")
    ];
    for (var i = 0; i < filePatterns.length; i++) {
      var fileMatch = text.match(filePatterns[i]);
      if (fileMatch) return { kind: "file", id: fileMatch[1] };
    }

    if (new RegExp("^" + ID + "$").test(text)) {
      return { kind: "file", id: text };
    }
    return null;
  }

  function fileExtension(name) {
    var text = String(name || "");
    if (text.indexOf(".") < 0) return "";
    return text.split(".").pop().toUpperCase();
  }

  function thumbnailURL(entry) {
    var raw = entry && entry.thumbnail ? String(entry.thumbnail) : "";
    if (!raw) return "";
    if (raw.indexOf("//") === 0) return "https:" + raw;
    return raw;
  }

  var collator = null;
  try {
    collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  } catch (error) {
    collator = null;
  }

  function naturalCompare(first, second) {
    if (collator) return collator.compare(String(first || ""), String(second || ""));
    return String(first || "").localeCompare(String(second || ""));
  }

  var episodePatterns = [
    /\bS(\d{1,2})\s*[._ -]?\s*E(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\bT(?:EMPORADA)?\s*(\d{1,2})\s*(?:EP|E|EPIS[OÓ]DIO)\s*(\d{1,3})\b/i,
    /\bSEASON\s*(\d{1,2})\s*EPISODE\s*(\d{1,3})\b/i
  ];

  function episodeKey(name) {
    var text = String(name || "");
    for (var i = 0; i < episodePatterns.length; i++) {
      var match = text.match(episodePatterns[i]);
      if (match) {
        return {
          season: parseInt(match[1], 10),
          episode: parseInt(match[2], 10)
        };
      }
    }
    return { season: null, episode: null };
  }

  function compareEpisodes(first, second) {
    var a = episodeKey(first.name);
    var b = episodeKey(second.name);

    if (a.season != null && b.season != null) {
      if (a.season !== b.season) return a.season - b.season;
      var episodeA = a.episode == null ? Number.MAX_SAFE_INTEGER : a.episode;
      var episodeB = b.episode == null ? Number.MAX_SAFE_INTEGER : b.episode;
      if (episodeA !== episodeB) return episodeA - episodeB;
    } else if (a.season != null) {
      return -1;
    } else if (b.season != null) {
      return 1;
    }

    var byName = naturalCompare(first.name, second.name);
    if (byName !== 0) return byName;
    return String(first.id || "").localeCompare(String(second.id || ""));
  }

  /* --------------------------------------------------------------- fetch */

  function fetchFolder(id) {
    if (state.fetches[id]) return state.fetches[id];

    var promise = new Promise(function (resolve, reject) {
      if (!(window.Android && typeof window.Android.fetchFolder === "function")) {
        reject(new Error("Abrir pastas do Drive exige o app Android."));
        return;
      }

      var timer = window.setTimeout(function () {
        if (state.pendingFetch[id]) {
          delete state.pendingFetch[id];
          reject(new Error("O Google Drive demorou para responder. Verifique a internet."));
        }
      }, 45000);

      state.pendingFetch[id] = {
        resolve: function (folder) {
          window.clearTimeout(timer);
          resolve(folder);
        },
        reject: function (error) {
          window.clearTimeout(timer);
          reject(error);
        }
      };

      try {
        window.Android.fetchFolder(id);
      } catch (error) {
        delete state.pendingFetch[id];
        window.clearTimeout(timer);
        reject(new Error("Não foi possível pedir a pasta ao Android."));
      }
    });

    state.fetches[id] = promise;
    promise.then(function () { delete state.fetches[id]; }, function () { delete state.fetches[id]; });
    return promise;
  }

  window.__dpFolderResult = function (id, json) {
    var pending = state.pendingFetch[id];
    if (!pending) return;
    delete state.pendingFetch[id];

    var result = safeParse(json, null);
    if (result && result.ok && result.folder) {
      pending.resolve(result.folder);
    } else {
      pending.reject(new Error(
        result && result.error ? result.error : "Não foi possível abrir esta pasta."
      ));
    }
  };

  /* ---------------------------------------------------------- navigation */

  function snapshot() {
    return {
      view: state.view,
      tab: state.tab,
      collectionID: state.collectionID,
      folder: state.folder
    };
  }

  function navigate(view, patch) {
    state.history.push(snapshot());
    state.view = view;
    state.tab = (view === "collection" || view === "folder") ? "collections" : view;
    if (patch) {
      Object.keys(patch).forEach(function (key) {
        state[key] = patch[key];
      });
    }
    render();
    var main = $("#main");
    if (main) main.scrollTop = 0;
  }

  function navigateRoot(view) {
    state.history = [];
    state.view = view;
    state.tab = view;
    state.collectionID = null;
    state.folder = null;
    render();
    var main = $("#main");
    if (main) main.scrollTop = 0;
  }

  function goBack() {
    if (dialog && !dialog.hidden) {
      closeDialog();
      return true;
    }
    if (state.history.length) {
      var previous = state.history.pop();
      state.view = previous.view;
      state.tab = previous.tab;
      state.collectionID = previous.collectionID;
      state.folder = previous.folder;
      render();
      return true;
    }
    if (state.view !== "home") {
      navigateRoot("home");
      return true;
    }
    return false;
  }

  window.__dpBack = goBack;

  /* -------------------------------------------------------------- render */

  function scheduleRender() {
    if (state.renderTimer) window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(function () {
      state.renderTimer = null;
      render();
    }, 260);
  }

  function render() {
    $$(".view").forEach(function (view) {
      view.hidden = view.getAttribute("data-view") !== state.view;
    });
    $$("#tabbar .tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-tab") === state.tab);
    });

    document.body.classList.toggle("cover", state.cover);
    var brandSub = $("#brandSub");
    if (brandSub) brandSub.textContent = state.cover ? "Tela de capa" : "Google Drive no celular";

    if (state.view === "home") renderHome();
    else if (state.view === "collections") renderCollections();
    else if (state.view === "collection") renderCollection();
    else if (state.view === "folder") renderFolder();
    else if (state.view === "settings") renderSettings();
  }

  function progressFor(id) {
    return state.library.progress[id] || null;
  }

  function progressPercent(id) {
    var item = progressFor(id);
    if (!item || !(item.duration > 0)) return 0;
    return Math.min(100, Math.round((item.time / item.duration) * 100));
  }

  function continueItems() {
    var result = [];
    state.library.recents.items.forEach(function (item) {
      var progress = progressFor(item.id);
      if (!progress || progress.watched) return;
      if (!(progress.time > 5)) return;
      if (progress.duration > 0 && progress.time > progress.duration - 15) return;
      result.push({ id: item.id, title: item.title, progress: progress });
    });
    return result.slice(0, 8);
  }

  var FOLDER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-10Z"/></svg>';
  var PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var CHEVRON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

  function thumbHtml(entry) {
    var url = thumbnailURL(entry);
    var cls = "thumb" + (entry.isFolder ? " folder" : "");
    if (url) {
      return '<div class="' + cls + '"><img loading="lazy" src="' + escapeHtml(url) +
        '" alt="" referrerpolicy="no-referrer"></div>';
    }
    return '<div class="' + cls + '">' + (entry.isFolder ? FOLDER_SVG : PLAY_SVG) + '</div>';
  }

  function entryMeta(entry) {
    var parts = [];
    if (entry.isFolder) {
      parts.push("Pasta");
    } else {
      var extension = fileExtension(entry.name);
      if (extension) parts.push(extension);
    }
    if (entry.modified) parts.push(entry.modified);
    return parts.join(" · ");
  }

  function collectionCardHtml(collection) {
    var episodes = aggregateEntries(collection).length;
    var sources = collection.sources.length;
    return '<button class="collection-card" type="button" data-collection="' +
      escapeHtml(collection.id) + '">' +
      '<span class="cc-icon">' + FOLDER_SVG + '</span>' +
      '<strong>' + escapeHtml(collection.name) + '</strong>' +
      '<span>' + episodes + (episodes === 1 ? ' vídeo' : ' vídeos') + ' · ' +
        sources + (sources === 1 ? ' fonte' : ' fontes') + '</span>' +
      '</button>';
  }

  function renderHome() {
    var homeCollections = $("#homeCollections");
    if (homeCollections) {
      var collections = state.library.collections.slice(0, 4);
      homeCollections.innerHTML = collections.map(collectionCardHtml).join("") +
        '<button class="collection-card cc-new" type="button" data-new-collection>' +
          '<span class="cc-icon">+</span>' +
          '<strong>Nova pasta</strong>' +
          '<span>Criar coleção</span>' +
        '</button>';
    }

    var items = continueItems();
    var continueBlock = $("#continueBlock");
    if (continueBlock) {
      continueBlock.hidden = items.length === 0;
      $("#continueList").innerHTML = items.map(function (item) {
        var found = findEntry(item.id);
        var entry = found ? found.entry : null;
        var thumb = entry ? thumbnailURL(entry) : "";
        var percent = item.progress.duration > 0
          ? Math.min(100, Math.round((item.progress.time / item.progress.duration) * 100))
          : 0;
        return '<button class="continue-card" type="button" data-play-id="' +
          escapeHtml(item.id) + '">' +
          '<div class="cc-cover"' + (thumb ? ' style="background-image:url(' + escapeHtml(thumb) + ')"' : '') + '>' +
            (thumb ? '' : PLAY_SVG) +
          '</div>' +
          '<div class="cc-body">' +
            '<strong>' + escapeHtml(cleanTitle(item.title, "Vídeo do Drive")) + '</strong>' +
            '<span>' + formatTime(item.progress.time) + ' de ' + formatTime(item.progress.duration) + '</span>' +
            '<div class="ep-progress"><i style="width:' + percent + '%"></i></div>' +
          '</div>' +
        '</button>';
      }).join("");
    }

    var rows = [];
    state.library.recents.folders.slice(0, 4).forEach(function (item) {
      rows.push(
        '<button class="row" type="button" data-recent-folder="' + escapeHtml(item.id) + '">' +
          '<div class="thumb folder">' + FOLDER_SVG + '</div>' +
          '<div class="row-main"><strong>' + escapeHtml(cleanTitle(item.title, "Pasta do Drive")) + '</strong>' +
            '<span>Pasta do Drive</span></div>' +
          '<div class="row-end">' + CHEVRON_SVG + '</div>' +
        '</button>'
      );
    });
    state.library.recents.items.slice(0, 8).forEach(function (item) {
      var found = findEntry(item.id);
      var entry = found ? found.entry : null;
      var percent = progressPercent(item.id);
      rows.push(
        '<button class="row" type="button" data-play-id="' + escapeHtml(item.id) + '">' +
          (entry ? thumbHtml(entry) : '<div class="thumb">' + PLAY_SVG + '</div>') +
          '<div class="row-main"><strong>' + escapeHtml(cleanTitle(item.title, "Vídeo do Drive")) + '</strong>' +
            '<span>' + (percent > 0 ? formatTime(progressFor(item.id).time) + ' assistidos' : 'Vídeo do Drive') + '</span>' +
            (percent > 0 ? '<div class="ep-progress"><i style="width:' + percent + '%"></i></div>' : '') +
          '</div>' +
          '<div class="row-end">' + PLAY_SVG + '</div>' +
        '</button>'
      );
    });

    var recentBlock = $("#recentBlock");
    if (recentBlock) {
      recentBlock.hidden = rows.length === 0;
      $("#recentList").innerHTML = rows.join("");
    }
  }

  function renderCollections() {
    var list = $("#collectionList");
    if (!list) return;
    list.innerHTML = state.library.collections.map(collectionCardHtml).join("");
    var empty = $("#collectionsEmpty");
    if (empty) empty.hidden = state.library.collections.length > 0;
  }

  function sourceChipHtml(collection, source) {
    var count = source.kind === "folder"
      ? videosFromEntries(source.entries).length
      : 1;
    return '<span class="source-chip">' +
      '<span class="sc-name">' + escapeHtml(source.name) + '</span>' +
      '<span class="sc-count">' + count + '</span>' +
      (source.kind === "folder"
        ? '<button class="sc-open" type="button" data-source-open="' + escapeHtml(source.id) +
          '" data-collection-id="' + escapeHtml(collection.id) + '" aria-label="Abrir fonte">' + FOLDER_SVG + '</button>'
        : '') +
      '<button class="sc-remove" type="button" data-source-remove="' + escapeHtml(source.id) +
        '" data-collection-id="' + escapeHtml(collection.id) + '" aria-label="Remover fonte">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>' +
      '</button>' +
    '</span>';
  }

  function episodeRowHtml(entry) {
    var progress = progressFor(entry.id);
    var percent = progressPercent(entry.id);
    var watched = !!(progress && progress.watched);
    return '<button class="episode" type="button" data-play-id="' + escapeHtml(entry.id) + '">' +
      '<div class="ep-main">' +
        '<strong>' + escapeHtml(entry.name) + '</strong>' +
        '<span>' + escapeHtml(entryMeta(entry)) + '</span>' +
        (percent > 0 && !watched ? '<div class="ep-progress"><i style="width:' + percent + '%"></i></div>' : '') +
        (watched ? '<span class="ep-badge">Assistido</span>' : '') +
      '</div>' +
      '<span class="ep-play">' + PLAY_SVG + '</span>' +
    '</button>';
  }

  function renderCollection() {
    var collection = findCollection(state.collectionID) || defaultCollection();
    if (!collection) return;
    state.collectionID = collection.id;

    $("#collectionTitle").textContent = collection.name;
    var episodes = aggregateEntries(collection);
    $("#collectionMeta").textContent = episodes.length +
      (episodes.length === 1 ? " vídeo" : " vídeos") + " · " +
      collection.sources.length + (collection.sources.length === 1 ? " fonte" : " fontes");

    $("#sourceStrip").innerHTML = collection.sources.map(function (source) {
      return sourceChipHtml(collection, source);
    }).join("");

    $("#episodeList").innerHTML = episodes.map(episodeRowHtml).join("");
    $("#playAllBtn").disabled = episodes.length === 0;

    var empty = $("#collectionEmpty");
    empty.hidden = episodes.length > 0;
    empty.innerHTML = collection.sources.length
      ? "Nenhum vídeo solto nestas fontes. As pastas podem ter subpastas: toque no ícone da fonte para navegar."
      : "Esta pasta está vazia. Toque em <strong>+ Fonte</strong> e cole um link de pasta ou de vídeo do Drive.";
  }

  function folderDisplayEntries(entries) {
    var folders = [];
    var videos = [];
    (entries || []).forEach(function (entry) {
      if (entry.isFolder) folders.push(entry);
      else if (entry.isVideo) videos.push(entry);
    });
    folders.sort(function (a, b) { return naturalCompare(a.name, b.name); });
    videos.sort(compareEpisodes);
    return folders.concat(videos);
  }

  function renderFolder() {
    var folder = state.folder;
    if (!folder) return;

    $("#folderTitle").textContent = folder.title || "Pasta do Drive";
    $("#folderCrumb").textContent = folder.crumb || "Google Drive";

    var videos = videosFromEntries(folder.entries);
    $("#folderMeta").textContent = folder.loading
      ? "Carregando…"
      : videos.length + (videos.length === 1 ? " vídeo" : " vídeos") +
        " · " + folder.entries.length + " itens";

    var loading = $("#folderLoading");
    loading.hidden = !folder.loading;

    var list = $("#folderList");
    var empty = $("#folderEmpty");
    var actions = $("#folderActions");
    actions.hidden = folder.loading;

    $("#playFolderBtn").disabled = videos.length === 0;
    $("#addFolderSourceBtn").disabled = folder.loading || !!folder.error;

    if (folder.error) {
      loading.hidden = true;
      empty.hidden = true;
      list.hidden = false;
      list.innerHTML =
        '<div class="empty">' + escapeHtml(folder.error) +
          '<div class="action-row" style="margin-top:12px">' +
            '<button class="btn btn-ghost" type="button" data-folder-retry>Repetir</button>' +
            '<button class="btn btn-primary" type="button" data-folder-chrome>Abrir no Chrome</button>' +
          '</div>' +
        '</div>';
      return;
    }

    if (folder.loading) {
      list.hidden = true;
      empty.hidden = true;
      return;
    }

    var display = folderDisplayEntries(folder.entries);
    list.hidden = false;
    list.innerHTML = display.map(function (entry) {
      if (entry.isFolder) {
        return '<button class="row" type="button" data-entry="' + escapeHtml(entry.id) + '">' +
          thumbHtml(entry) +
          '<div class="row-main"><strong>' + escapeHtml(entry.name) + '</strong>' +
            '<span>' + escapeHtml(entryMeta(entry)) + '</span></div>' +
          '<div class="row-end">' + CHEVRON_SVG + '</div>' +
        '</button>';
      }
      return '<button class="row" type="button" data-entry="' + escapeHtml(entry.id) + '">' +
        thumbHtml(entry) +
        '<div class="row-main"><strong>' + escapeHtml(entry.name) + '</strong>' +
          '<span>' + escapeHtml(entryMeta(entry)) + '</span></div>' +
        '<div class="row-end">' + PLAY_SVG + '</div>' +
      '</button>';
    }).join("");

    empty.hidden = display.length > 0;
    if (!display.length) {
      empty.innerHTML = "Esta pasta não tem subpastas nem vídeos visíveis. Abra no Chrome para ver todos os arquivos.";
    }
  }

  function renderSettings() {
    syncSettings();
    var version = $("#versionLabel");
    if (version) version.textContent = "DrivePlay " + state.version + " · Android";
  }

  /* -------------------------------------------------------------- actions */

  function openCollection(id) {
    var collection = findCollection(id);
    if (!collection) return;
    navigate("collection", { collectionID: id, folder: null });
  }

  function openFolderTarget(id, title, options) {
    options = options || {};
    var source = findSourceByDriveID(id);
    var folder = {
      id: id,
      title: title || (source && source.name) || "Pasta do Drive",
      entries: source ? source.entries : [],
      loading: !source,
      error: "",
      crumb: options.crumb || "Google Drive",
      collectionID: options.collectionID || "",
      sourceID: options.sourceID || (source ? source.id : "")
    };

    navigate("folder", { folder: folder });
    loadFolder(folder, !source);
  }

  function loadFolder(folder, showLoading) {
    if (showLoading) {
      folder.loading = true;
      folder.error = "";
      if (state.folder === folder) renderFolder();
    }

    fetchFolder(folder.id).then(function (data) {
      folder.entries = Array.isArray(data.entries) ? data.entries : [];
      folder.title = cleanTitle(data.name, folder.title || "Pasta do Drive");
      folder.loading = false;
      folder.error = "";

      var source = findSourceByDriveID(folder.id);
      if (source) {
        source.name = folder.title;
        source.entries = folder.entries;
      }

      addRecentFolder(folder.id, folder.title);
      saveLibrary();
      if (state.folder === folder) renderFolder();
    }).catch(function (error) {
      folder.loading = false;
      if (folder.entries.length) {
        toast("Não foi possível atualizar esta pasta.");
        if (state.folder === folder) renderFolder();
        return;
      }
      folder.error = error && error.message
        ? error.message
        : "Não foi possível abrir esta pasta.";
      if (state.folder === folder) renderFolder();
    });
  }

  function openFile(id, title, options) {
    if (!id) return;
    options = options || {};

    var found = findEntry(id);
    var name = cleanTitle(
      title || (found && found.entry.name) || recentTitle(id) || "Vídeo do Drive",
      "Vídeo do Drive"
    );

    if (String(id).indexOf("local:") === 0) {
      addRecentFile(id, name);
      saveLibrary(true);
      render();
      if (window.Android && typeof window.Android.openLocal === "function") {
        try {
          window.Android.openLocal(id);
          return;
        } catch (error) {
          /* Fall through to the message below. */
        }
      }
      toast("Abra o vídeo local novamente pelo seletor de arquivos.");
      return;
    }

    var playlist = [];
    if (Array.isArray(options.playlist) && options.playlist.length) {
      playlist = options.playlist.slice();
    } else if (found) {
      playlist = aggregateSource(found.source);
    } else if (Array.isArray(options.entries)) {
      playlist = videosFromEntries(options.entries);
    }

    if (!playlist.length) playlist = [{ id: id, title: name }];

    var hasCurrent = false;
    playlist = playlist.map(function (entry) {
      var entryName = cleanTitle(entry.title || entry.name || "Vídeo do Drive", "Vídeo do Drive");
      if (entry.id === id) {
        hasCurrent = true;
        return { id: id, title: name };
      }
      return { id: entry.id, title: entryName };
    });
    if (!hasCurrent) playlist.unshift({ id: id, title: name });

    addRecentFile(id, name);
    saveLibrary(true);
    render();

    if (window.Android && typeof window.Android.openFile === "function") {
      try {
        window.Android.openFile(
          id,
          name,
          JSON.stringify(state.settings),
          JSON.stringify(playlist)
        );
        return;
      } catch (error) {
        /* Fall through to the message below. */
      }
    }
    toast("O player do DrivePlay só está disponível no app Android.");
  }

  function playCollection() {
    var collection = findCollection(state.collectionID) || defaultCollection();
    var episodes = aggregateEntries(collection);
    if (!episodes.length) {
      toast("Adicione uma fonte com vídeos primeiro.");
      return;
    }

    var target = episodes[0];
    for (var i = 0; i < episodes.length; i++) {
      var progress = progressFor(episodes[i].id);
      if (!progress || !progress.watched) {
        target = episodes[i];
        break;
      }
    }

    openFile(target.id, target.name, {
      playlist: episodes.map(function (entry) {
        return { id: entry.id, title: entry.name };
      })
    });
  }

  function playFolder() {
    var folder = state.folder;
    if (!folder) return;
    var videos = videosFromEntries(folder.entries);
    if (!videos.length) {
      toast("Esta pasta não tem vídeos.");
      return;
    }
    openFile(videos[0].id, videos[0].name, {
      playlist: videos.map(function (entry) {
        return { id: entry.id, title: entry.name };
      })
    });
  }

  function handleLink(raw, options) {
    options = options || {};
    var target = parseTarget(raw);
    if (!target) {
      toast("Cole um link de vídeo ou de pasta do Google Drive.");
      return;
    }

    if (target.kind === "file") {
      var found = findEntry(target.id);
      openFile(target.id, found ? found.entry.name : "Vídeo do Drive", options);
      return;
    }

    addRecentFolder(target.id, "Pasta do Drive");
    saveLibrary();
    openFolderTarget(target.id, "Pasta do Drive", { crumb: "Google Drive" });
  }

  function openInput() {
    var input = $("#linkInput");
    var value = input ? input.value : "";
    if (!String(value || "").trim()) {
      toast("Cole um link de vídeo ou pasta do Google Drive.");
      if (input) input.focus();
      return;
    }
    handleLink(value);
    if (input) input.value = "";
  }

  function pasteLink() {
    var input = $("#linkInput");
    if (window.Android && typeof window.Android.readClipboard === "function") {
      try {
        var text = String(window.Android.readClipboard() || "").trim();
        if (!text) {
          toast("A área de transferência está vazia.");
          return;
        }
        if (input) {
          input.value = text;
          input.focus();
        }
        toast("Link colado.");
        return;
      } catch (error) {
        toast("Não foi possível ler a área de transferência.");
        return;
      }
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (text) {
        if (input) {
          input.value = text;
          input.focus();
        }
        toast(text ? "Link colado." : "A área de transferência está vazia.");
      }).catch(function () {
        toast("Cole o link manualmente no campo.");
      });
      return;
    }
    toast("Cole o link manualmente no campo.");
  }

  function pickLocalVideo() {
    if (window.Android && typeof window.Android.pickVideo === "function") {
      try {
        window.Android.pickVideo();
        return;
      } catch (error) {
        toast("Não foi possível abrir os arquivos.");
        return;
      }
    }
    toast("Escolher vídeo local está disponível no app Android.");
  }

  function recentTitle(id) {
    var items = state.library.recents.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i].title;
    }
    return "";
  }

  function addRecentFile(id, title) {
    if (!id) return;
    var items = state.library.recents.items;
    var existing = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        existing = items[i];
        break;
      }
    }
    var nice = cleanTitle(title, "Vídeo do Drive");
    if (existing) {
      if (nice !== "Vídeo do Drive") existing.title = nice;
      existing.added = new Date().toISOString();
      items = [existing].concat(items.filter(function (item) { return item !== existing; }));
    } else {
      items.unshift({ id: id, title: nice, added: new Date().toISOString() });
    }
    state.library.recents.items = items.slice(0, 30);
  }

  function addRecentFolder(id, title) {
    if (!id) return;
    var folders = state.library.recents.folders;
    var existing = null;
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].id === id) {
        existing = folders[i];
        break;
      }
    }
    var nice = cleanTitle(title, "Pasta do Drive");
    if (existing) {
      if (nice !== "Pasta do Drive") existing.title = nice;
      existing.added = new Date().toISOString();
      folders = [existing].concat(folders.filter(function (item) { return item !== existing; }));
    } else {
      folders.unshift({ id: id, title: nice, added: new Date().toISOString() });
    }
    state.library.recents.folders = folders.slice(0, 20);
  }

  function updateEntryTitle(id, title) {
    var nice = cleanTitle(title, "");
    if (!nice) return;
    for (var c = 0; c < state.library.collections.length; c++) {
      var sources = state.library.collections[c].sources;
      for (var s = 0; s < sources.length; s++) {
        for (var e = 0; e < sources[s].entries.length; e++) {
          if (sources[s].entries[e].id === id) {
            sources[s].entries[e].name = nice;
          }
        }
      }
    }
  }

  function updateProgress(id, position, duration) {
    if (!id) return;
    var time = Math.max(0, Number(position) || 0);
    var total = Math.max(0, Number(duration) || 0);
    var item = state.library.progress[id] || { time: 0, duration: 0, watched: false };
    item.time = time;
    item.duration = total;
    if (total > 1 && (time >= total - 15 || time / total >= 0.95)) {
      item.watched = true;
      item.time = total;
    }
    state.library.progress[id] = item;

    var recents = state.library.recents.items;
    for (var i = 0; i < recents.length; i++) {
      if (recents[i].id === id) {
        recents[i].added = new Date().toISOString();
        break;
      }
    }
    saveLibrary();
    scheduleRender();
  }

  /* -------------------------------------------------------------- dialogs */

  var dialog = document.getElementById("dialog");

  function openDialog(html) {
    dialog = dialog || $("#dialog");
    if (!dialog) return;
    dialog.innerHTML = html;
    dialog.hidden = false;
    dialog.setAttribute("aria-hidden", "false");
  }

  function closeDialog() {
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute("aria-hidden", "true");
    dialog.innerHTML = "";
    dialog.onclick = null;
  }

  function promptDialog(options) {
    return new Promise(function (resolve) {
      var inputId = "dialog-input-" + Date.now();
      openDialog(
        '<div class="dialog-panel">' +
          '<h3>' + escapeHtml(options.title || "Digite") + '</h3>' +
          (options.message ? '<p>' + escapeHtml(options.message) + '</p>' : '') +
          '<input class="dialog-input" id="' + inputId + '" type="text" autocomplete="off" ' +
            'autocapitalize="off" spellcheck="false" placeholder="' +
            escapeHtml(options.placeholder || "") + '" value="' +
            escapeHtml(options.value || "") + '">' +
          '<div class="dialog-actions">' +
            '<button class="btn btn-primary" type="button" data-dialog="confirm">' +
              escapeHtml(options.confirmLabel || "Confirmar") + '</button>' +
            '<button class="btn dialog-cancel" type="button" data-dialog="cancel">Cancelar</button>' +
          '</div>' +
        '</div>'
      );

      var input = document.getElementById(inputId);
      window.setTimeout(function () {
        if (input) {
          input.focus();
          try { input.select(); } catch (error) { /* noop */ }
        }
      }, 80);

      function finish(value) {
        closeDialog();
        resolve(value);
      }

      dialog.onclick = function (event) {
        var target = event.target.closest ? event.target.closest("[data-dialog]") : null;
        if (!target) {
          if (event.target === dialog) finish(null);
          return;
        }
        if (target.getAttribute("data-dialog") === "confirm") {
          finish(input ? input.value.trim() : "");
        } else {
          finish(null);
        }
      };

      if (input) {
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(input.value.trim());
          }
        });
      }
    });
  }

  function confirmDialog(title, message, confirmLabel, danger) {
    return new Promise(function (resolve) {
      openDialog(
        '<div class="dialog-panel">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<p>' + escapeHtml(message) + '</p>' +
          '<div class="dialog-actions">' +
            '<button class="btn ' + (danger ? "dialog-danger" : "btn-primary") +
              '" type="button" data-dialog="yes">' + escapeHtml(confirmLabel || "Confirmar") + '</button>' +
            '<button class="btn dialog-cancel" type="button" data-dialog="no">Cancelar</button>' +
          '</div>' +
        '</div>'
      );
      dialog.onclick = function (event) {
        var target = event.target.closest ? event.target.closest("[data-dialog]") : null;
        if (!target) {
          if (event.target === dialog) {
            closeDialog();
            resolve(false);
          }
          return;
        }
        var value = target.getAttribute("data-dialog") === "yes";
        closeDialog();
        resolve(value);
      };
    });
  }

  function actionDialog(title, message, actions) {
    return new Promise(function (resolve) {
      var html = '<div class="dialog-panel"><h3>' + escapeHtml(title) + '</h3>' +
        (message ? '<p>' + escapeHtml(message) + '</p>' : '') +
        '<div class="dialog-actions">';
      actions.forEach(function (action) {
        html += '<button class="btn ' + (action.danger ? "dialog-danger" : "btn-ghost") +
          '" type="button" data-dialog-value="' + escapeHtml(action.value) + '">' +
          escapeHtml(action.label) + '</button>';
      });
      html += '<button class="btn dialog-cancel" type="button" data-dialog-value="">Cancelar</button>';
      html += '</div></div>';
      openDialog(html);

      dialog.onclick = function (event) {
        var target = event.target.closest ? event.target.closest("[data-dialog-value]") : null;
        if (!target) {
          if (event.target === dialog) {
            closeDialog();
            resolve(null);
          }
          return;
        }
        var value = target.getAttribute("data-dialog-value");
        closeDialog();
        resolve(value || null);
      };
    });
  }

  function showErrorDialog(title, message, url) {
    var actions = [{ label: "Fechar", value: "close" }];
    if (url) actions.unshift({ label: "Abrir no Chrome", value: "chrome" });
    actionDialog(title, message, actions).then(function (value) {
      if (value === "chrome" && url) openExternal(url);
    });
  }

  function openExternal(url) {
    if (!url) return;
    if (window.Android && typeof window.Android.openExternal === "function") {
      try {
        window.Android.openExternal(url);
        return;
      } catch (error) {
        /* Fall through. */
      }
    }
    try { window.open(url, "_blank", "noopener"); } catch (error) { /* noop */ }
  }

  /* ------------------------------------------------------ collection flows */

  function createCollectionFlow() {
    promptDialog({
      title: "Nova pasta",
      message: "Dê um nome para a coleção. Ela organiza temporadas, animes ou cursos.",
      placeholder: "Ex.: Bleach — 4ª temporada",
      confirmLabel: "Criar pasta"
    }).then(function (name) {
      if (!name) return;
      var collection = createCollection(name);
      saveLibrary(true);
      render();
      openCollection(collection.id);
      toast("Pasta criada.");
    });
  }

  function chooseCollection(title) {
    var actions = state.library.collections.map(function (collection) {
      return { label: collection.name, value: collection.id };
    });
    if (!actions.length) return Promise.resolve(null);
    return actionDialog(title, "Escolha a pasta de destino.", actions);
  }

  function addSourceFlow(collectionID) {
    promptDialog({
      title: "Adicionar fonte",
      message: "Cole o link de uma pasta ou de um vídeo do Google Drive compartilhado como “qualquer pessoa com o link”.",
      placeholder: "https://drive.google.com/...",
      confirmLabel: "Adicionar"
    }).then(function (value) {
      if (!value) return;
      var target = parseTarget(value);
      if (!target) {
        toast("Esse link não parece ser do Google Drive.");
        return;
      }

      if (target.kind === "file") {
        addSource(collectionID, "file", target.id, "Vídeo do Drive", [{
          id: target.id,
          name: "Vídeo do Drive",
          isVideo: true,
          isFolder: false
        }]);
        saveLibrary(true);
        render();
        toast("Vídeo adicionado à pasta.");
        return;
      }

      toast("Lendo a pasta do Drive…");
      fetchFolder(target.id).then(function (folder) {
        addSource(collectionID, "folder", target.id, folder.name, folder.entries);
        saveLibrary(true);
        render();
        toast(folder.entries.length + " itens adicionados.");
      }).catch(function (error) {
        showErrorDialog(
          "Não foi possível adicionar",
          error && error.message ? error.message : "Verifique se a pasta está pública.",
          "https://drive.google.com/drive/folders/" + target.id
        );
      });
    });
  }

  function addFolderToCollection() {
    var folder = state.folder;
    if (!folder) return;
    var targetCollection = folder.collectionID || null;

    var pick = targetCollection
      ? Promise.resolve(targetCollection)
      : chooseCollection("Adicionar pasta");

    pick.then(function (collectionID) {
      if (!collectionID) return;
      addSource(collectionID, "folder", folder.id, folder.title, folder.entries);
      saveLibrary(true);
      toast("Pasta adicionada à biblioteca.");
      if (state.view === "folder") {
        folder.collectionID = collectionID;
        render();
      } else {
        openCollection(collectionID);
      }
    });
  }

  function openCollectionMenu() {
    var collection = findCollection(state.collectionID);
    if (!collection) return;

    var actions = [
      { label: "Renomear pasta", value: "rename" },
      { label: "Adicionar fonte", value: "source" }
    ];
    if (!collection.isDefault) {
      actions.push({ label: "Excluir pasta", value: "delete", danger: true });
    }

    actionDialog(collection.name, "O que você quer fazer?", actions).then(function (value) {
      if (value === "rename") {
        promptDialog({
          title: "Renomear pasta",
          value: collection.name,
          confirmLabel: "Salvar"
        }).then(function (name) {
          if (!name) return;
          collection.name = name;
          saveLibrary(true);
          render();
        });
      } else if (value === "source") {
        addSourceFlow(collection.id);
      } else if (value === "delete") {
        confirmDialog(
          "Excluir pasta",
          "A pasta “" + collection.name + "” será removida da biblioteca. Os vídeos continuam no Google Drive.",
          "Excluir",
          true
        ).then(function (confirmed) {
          if (!confirmed) return;
          if (deleteCollection(collection.id)) {
            saveLibrary(true);
            toast("Pasta excluída.");
            navigateRoot("collections");
          }
        });
      }
    });
  }

  /* ------------------------------------------------------------ settings */

  function syncSettings() {
    var map = {
      "#skipIntro": "skipIntro",
      "#skipEnding": "skipEnding",
      "#autoFullscreen": "autoFullscreen",
      "#autoNext": "autoNext",
      "#resumePlayback": "resumePlayback",
      "#fillScreen": "fillScreen"
    };
    Object.keys(map).forEach(function (selector) {
      var node = $(selector);
      if (node) node.checked = state.settings[map[selector]] === true;
    });

    var intro = $("#introSeconds");
    if (intro) {
      intro.value = String(state.settings.introSeconds);
      intro.disabled = !state.settings.skipIntro;
    }
    var ending = $("#endingSeconds");
    if (ending) {
      ending.value = String(state.settings.endingSeconds);
      ending.disabled = !state.settings.skipEnding;
    }
  }

  function bindSettings() {
    var toggles = {
      "#skipIntro": "skipIntro",
      "#skipEnding": "skipEnding",
      "#autoFullscreen": "autoFullscreen",
      "#autoNext": "autoNext",
      "#resumePlayback": "resumePlayback",
      "#fillScreen": "fillScreen"
    };

    Object.keys(toggles).forEach(function (selector) {
      var node = $(selector);
      if (!node) return;
      node.addEventListener("change", function () {
        state.settings[toggles[selector]] = node.checked;
        saveSettings();
        syncSettings();
      });
    });

    var intro = $("#introSeconds");
    if (intro) {
      intro.addEventListener("change", function () {
        state.settings.introSeconds = clampNumber(intro.value, 120, 0, 3600);
        saveSettings();
        syncSettings();
      });
    }

    var ending = $("#endingSeconds");
    if (ending) {
      ending.addEventListener("change", function () {
        state.settings.endingSeconds = clampNumber(ending.value, 190, 0, 3600);
        saveSettings();
        syncSettings();
      });
    }
  }

  /* ------------------------------------------------------------------ ui */

  function bindUi() {
    $("#openBtn").addEventListener("click", openInput);
    $("#pasteBtn").addEventListener("click", pasteLink);
    $("#localBtn").addEventListener("click", pickLocalVideo);
    $("#settingsBtn").addEventListener("click", function () { navigateRoot("settings"); });
    $("#newCollectionBtn").addEventListener("click", createCollectionFlow);
    $("#addCollectionBtn").addEventListener("click", createCollectionFlow);
    $("#createCollectionBtn").addEventListener("click", createCollectionFlow);
    $("#playAllBtn").addEventListener("click", playCollection);
    $("#addSourceBtn").addEventListener("click", function () {
      addSourceFlow(state.collectionID);
    });
    $("#collectionMenuBtn").addEventListener("click", openCollectionMenu);
    $("#playFolderBtn").addEventListener("click", playFolder);
    $("#addFolderSourceBtn").addEventListener("click", addFolderToCollection);
    $("#folderRefreshBtn").addEventListener("click", function () {
      if (state.folder) loadFolder(state.folder, true);
    });

    var input = $("#linkInput");
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          openInput();
        }
      });
    }

    $$("#tabbar .tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        navigateRoot(tab.getAttribute("data-tab"));
      });
    });

    $$("[data-back]").forEach(function (button) {
      button.addEventListener("click", goBack);
    });

    $("#clearRecentsBtn").addEventListener("click", function () {
      confirmDialog(
        "Limpar recentes",
        "O histórico de vídeos e pastas será apagado. As posições de reprodução continuam salvas.",
        "Limpar"
      ).then(function (confirmed) {
        if (!confirmed) return;
        state.library.recents = { folders: [], items: [] };
        saveLibrary(true);
        render();
        toast("Recentes limpos.");
      });
    });

    $("#clearLibraryBtn").addEventListener("click", function () {
      confirmDialog(
        "Limpar biblioteca",
        "Pastas, fontes e posições salvas serão removidas. Os vídeos continuam no Google Drive.",
        "Limpar tudo",
        true
      ).then(function (confirmed) {
        if (!confirmed) return;
        state.library = normalizeLibrary({});
        storageSet(LIBRARY_KEY, state.library);
        if (window.Android && typeof window.Android.clearLibrary === "function") {
          try { window.Android.clearLibrary(); } catch (error) { /* noop */ }
        }
        saveLibrary(true);
        toast("Biblioteca limpa.");
        navigateRoot("home");
      });
    });

    $("#main").addEventListener("click", handleMainClick);
  }

  function handleMainClick(event) {
    var node = event.target.closest ? event.target.closest("[data-collection]") : null;
    if (node) {
      openCollection(node.getAttribute("data-collection"));
      return;
    }

    node = event.target.closest("[data-new-collection]");
    if (node) {
      createCollectionFlow();
      return;
    }

    node = event.target.closest("[data-source-remove]");
    if (node) {
      var collectionID = node.getAttribute("data-collection-id");
      var sourceID = node.getAttribute("data-source-remove");
      var source = findSource(collectionID, sourceID);
      confirmDialog(
        "Remover fonte",
        "A fonte “" + (source ? source.name : "Google Drive") + "” será removida desta pasta.",
        "Remover",
        true
      ).then(function (confirmed) {
        if (!confirmed) return;
        removeSource(collectionID, sourceID);
        saveLibrary(true);
        render();
        toast("Fonte removida.");
      });
      return;
    }

    node = event.target.closest("[data-source-open]");
    if (node) {
      var openCollectionID = node.getAttribute("data-collection-id");
      var openSource = findSource(openCollectionID, node.getAttribute("data-source-open"));
      if (openSource) {
        openFolderTarget(openSource.driveID, openSource.name, {
          crumb: "Fonte da pasta",
          collectionID: openCollectionID,
          sourceID: openSource.id
        });
      }
      return;
    }

    node = event.target.closest("[data-recent-folder]");
    if (node) {
      var folderID = node.getAttribute("data-recent-folder");
      openFolderTarget(folderID, "Pasta do Drive", { crumb: "Recentes" });
      return;
    }

    node = event.target.closest("[data-play-id]");
    if (node) {
      var playID = node.getAttribute("data-play-id");
      if (state.view === "folder" && state.folder) {
        openFile(playID, "", { entries: state.folder.entries });
      } else {
        openFile(playID, "");
      }
      return;
    }

    node = event.target.closest("[data-entry]");
    if (node) {
      var entryID = node.getAttribute("data-entry");
      var folder = state.folder;
      if (!folder) return;
      var entry = null;
      for (var i = 0; i < folder.entries.length; i++) {
        if (folder.entries[i].id === entryID) {
          entry = folder.entries[i];
          break;
        }
      }
      if (!entry) return;
      if (entry.isFolder) {
        openFolderTarget(entry.id, entry.name, {
          crumb: folder.title,
          collectionID: folder.collectionID,
          sourceID: folder.sourceID
        });
      } else if (entry.isVideo) {
        openFile(entry.id, entry.name, { entries: folder.entries });
      }
      return;
    }

    node = event.target.closest("[data-folder-retry]");
    if (node && state.folder) {
      loadFolder(state.folder, true);
      return;
    }

    node = event.target.closest("[data-folder-chrome]");
    if (node && state.folder) {
      openExternal("https://drive.google.com/drive/folders/" + state.folder.id);
    }
  }

  /* --------------------------------------------------------- native hooks */

  window.__dpNativeReady = function () {
    if (state.nativeReady) return;
    state.nativeReady = true;

    var rawSettings = null;
    try {
      if (window.Android && typeof window.Android.getSettings === "function") {
        rawSettings = window.Android.getSettings();
      }
    } catch (error) { /* noop */ }

    if (rawSettings) {
      var nativeSettings = safeParse(rawSettings, null);
      if (nativeSettings && typeof nativeSettings === "object") {
        var hasValues = Object.keys(nativeSettings).length > 0;
        if (hasValues) {
          state.settings = normalizeSettings(
            Object.assign({}, state.settings, nativeSettings)
          );
        }
      }
    }

    var rawLibrary = null;
    try {
      if (window.Android && typeof window.Android.loadLibrary === "function") {
        rawLibrary = window.Android.loadLibrary();
      }
    } catch (error) { /* noop */ }

    var nativeLibrary = safeParse(rawLibrary, null);
    if (nativeLibrary && typeof nativeLibrary === "object") {
      var nativeHasData = (Array.isArray(nativeLibrary.collections) &&
        nativeLibrary.collections.some(function (collection) {
          return collection && Array.isArray(collection.sources) && collection.sources.length > 0;
        })) || (nativeLibrary.recents && Array.isArray(nativeLibrary.recents.items) &&
          nativeLibrary.recents.items.length > 0);

      var localHasData = state.library.collections.some(function (collection) {
        return collection.sources.length > 0;
      }) || state.library.recents.items.length > 0;

      if (nativeHasData || !localHasData) {
        state.library = normalizeLibrary(nativeLibrary);
      }
    }

    try {
      if (window.Android && typeof window.Android.getVersion === "function") {
        var version = window.Android.getVersion();
        if (version) state.version = String(version);
      }
    } catch (error) { /* noop */ }

    try {
      if (window.Android && typeof window.Android.isCoverScreen === "function") {
        state.cover = window.Android.isCoverScreen() === true;
      }
    } catch (error) { /* noop */ }

    saveSettings();
    saveLibrary(true);
    render();

    var launchLink = "";
    try {
      if (window.Android && typeof window.Android.getLaunchLink === "function") {
        launchLink = String(window.Android.getLaunchLink() || "");
      }
    } catch (error) { /* noop */ }
    if (launchLink) handleLink(launchLink);
  };

  window.__dpOpenLink = function (url) {
    var link = String(url || "").trim();
    if (!link) return;
    var input = $("#linkInput");
    if (input) input.value = link;
    var target = parseTarget(link);
    if (target) handleLink(link);
    else toast("Link recebido, mas não parece ser do Google Drive.");
  };

  window.__dpAddFile = function (id, title, url) {
    if (!id) return;
    var nice = cleanTitle(title, "Vídeo do Drive");
    addRecentFile(id, nice);
    updateEntryTitle(id, nice);
    saveLibrary();
    scheduleRender();
  };

  window.__dpUpdateTitle = function (id, title) {
    if (!id) return;
    var nice = cleanTitle(title, "Vídeo do Drive");
    updateEntryTitle(id, nice);
    addRecentFile(id, nice);
    saveLibrary();
    scheduleRender();
  };

  window.__dpProgress = function (id, position, duration) {
    updateProgress(id, position, duration);
  };

  window.__dpLibraryUpdated = function (json) {
    var incoming = safeParse(json, null);
    if (!incoming || !Array.isArray(incoming.collections)) return;
    state.library = normalizeLibrary(incoming);
    storageSet(LIBRARY_KEY, state.library);
    render();
  };

  window.__dpLibraryCleared = function () {
    state.library = normalizeLibrary({});
    storageSet(LIBRARY_KEY, state.library);
    render();
  };

  window.__dpPlayerClosed = function () {
    saveLibrary();
    render();
  };

  window.__dpSetCover = function (cover) {
    state.cover = cover === true;
    document.body.classList.toggle("cover", state.cover);
    var brandSub = $("#brandSub");
    if (brandSub) brandSub.textContent = state.cover ? "Tela de capa" : "Google Drive no celular";
  };

  window.__dpFillSettingChanged = function (enabled) {
    state.settings.fillScreen = enabled === true;
    storageSet(SETTINGS_KEY, state.settings);
    syncSettings();
  };

  /* ----------------------------------------------------------------- init */

  function init() {
    state.settings = loadSettings();
    state.library = normalizeLibrary(storageGet(LIBRARY_KEY, null));
    bindUi();
    bindSettings();
    syncSettings();
    render();
    window.setTimeout(function () {
      document.body.classList.remove("booting");
    }, 80);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
