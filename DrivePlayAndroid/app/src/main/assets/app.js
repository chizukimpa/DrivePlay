(function () {
  "use strict";

  var SETTINGS_KEY = "driveplay.settings.v3";
  var LIBRARY_KEY = "driveplay.library.v1";
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

  var settings = loadSettings();
  var library = loadLibrary();
  var toastTimer = null;
  var nativeReadyDone = false;

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function safeParse(value, fallback) {
    try {
      var parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
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
      /* WebView storage can be unavailable in restricted contexts. */
    }
  }

  function clampNumber(value, fallback, min, max) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    number = Math.round(number);
    return Math.min(max, Math.max(min, number));
  }

  function normalizeSettings(source) {
    var s = Object.assign({}, DEFAULTS, source || {});
    s.skipIntro = s.skipIntro !== false;
    s.skipEnding = s.skipEnding !== false;
    s.autoFullscreen = s.autoFullscreen !== false;
    s.autoNext = s.autoNext !== false;
    s.resumePlayback = s.resumePlayback !== false;
    s.fillScreen = s.fillScreen === true;
    s.introSeconds = clampNumber(s.introSeconds, DEFAULTS.introSeconds, 0, 3600);
    s.endingSeconds = clampNumber(s.endingSeconds, DEFAULTS.endingSeconds, 0, 3600);
    return s;
  }

  function loadSettings() {
    return normalizeSettings(storageGet(SETTINGS_KEY, DEFAULTS));
  }

  function loadLibrary() {
    var items = storageGet(LIBRARY_KEY, []);
    if (!Array.isArray(items)) return [];
    return items.filter(function (item) {
      return item && item.id && (item.kind === "file" || item.kind === "folder");
    }).slice(0, 100);
  }

  function saveSettings() {
    settings = normalizeSettings(settings);
    storageSet(SETTINGS_KEY, settings);
    if (window.Android && typeof window.Android.setSettings === "function") {
      try {
        window.Android.setSettings(JSON.stringify(settings));
      } catch (error) {
        /* Native bridge may not be ready yet. */
      }
    }
  }

  function saveLibrary() {
    library = library.slice(0, 100);
    storageSet(LIBRARY_KEY, library);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanTitle(title, fallback) {
    var value = String(title || "")
      .replace(/\s*[-–—]\s*Google Drive\s*$/i, "")
      .replace(/^Google Drive\s*[-–—]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return value && value.toLowerCase() !== "google drive" ? value : (fallback || "Vídeo do Drive");
  }

  function toast(message) {
    var node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      node.classList.remove("show");
    }, 2600);
  }

  function normalizeUrl(raw) {
    var value = String(raw || "").trim();
    if (!value) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = "https://" + value;
    return value;
  }

  function parseDriveLink(raw) {
    var url = normalizeUrl(raw);
    if (!url) return null;

    var folder = url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/i) ||
      url.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{10,})/i);
    if (folder) {
      return {
        kind: "folder",
        id: folder[1],
        url: url,
        title: "Pasta do Drive"
      };
    }

    var file = url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/i) ||
      url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/i) ||
      url.match(/\/d\/([a-zA-Z0-9_-]{10,})/i);
    if (file) {
      return {
        kind: "file",
        id: file[1],
        url: url,
        title: "Vídeo do Drive"
      };
    }

    if (/^https?:\/\//i.test(url)) {
      return { kind: "external", id: "", url: url, title: "Link" };
    }
    return null;
  }

  function openExternal(url) {
    if (window.Android && typeof window.Android.openExternal === "function") {
      try {
        window.Android.openExternal(url);
        return;
      } catch (error) {
        /* Fall through to the browser. */
      }
    }
    try {
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast("Não foi possível abrir este link.");
    }
  }

  function addLibrary(kind, id, title, url) {
    if (!id || (kind !== "file" && kind !== "folder")) return;
    var fallback = kind === "folder" ? "Pasta do Drive" : "Vídeo do Drive";
    var niceTitle = cleanTitle(title, fallback);
    var existing = null;
    for (var i = 0; i < library.length; i++) {
      if (library[i].kind === kind && library[i].id === id) {
        existing = library[i];
        break;
      }
    }

    if (existing) {
      if (niceTitle && niceTitle !== fallback) existing.title = niceTitle;
      if (url) existing.url = url;
      existing.added = Date.now();
      library = [existing].concat(library.filter(function (item) { return item !== existing; }));
    } else {
      library.unshift({
        kind: kind,
        id: id,
        title: niceTitle,
        url: url || "",
        added: Date.now()
      });
    }

    saveLibrary();
    renderLibrary();
  }

  function buildFilePlaylist(item) {
    var files = library.filter(function (entry) { return entry.kind === "file"; });
    return files.map(function (entry) {
      return { id: entry.id, title: entry.title };
    });
  }

  function openFileItem(item) {
    if (!item || item.kind !== "file") return;
    var playlist = buildFilePlaylist(item);
    if (!playlist.length) playlist = [{ id: item.id, title: item.title }];
    if (window.Android && typeof window.Android.openFile === "function") {
      try {
        window.Android.openFile(item.id, item.title, JSON.stringify(settings), JSON.stringify(playlist));
        return;
      } catch (error) {
        toast("Não foi possível abrir o player.");
      }
    }
    openExternal("https://drive.google.com/file/d/" + item.id + "/view");
  }

  function openFolderItem(item) {
    if (!item || item.kind !== "folder") return;
    var url = item.url || ("https://drive.google.com/drive/folders/" + item.id);
    if (window.Android && typeof window.Android.openFolder === "function") {
      try {
        window.Android.openFolder(url, item.title, JSON.stringify(settings));
        return;
      } catch (error) {
        toast("Não foi possível abrir a pasta.");
      }
    }
    openExternal(url);
  }

  function openParsed(parsed) {
    if (!parsed) {
      toast("Cole um link válido do Google Drive.");
      return;
    }

    if (parsed.kind === "external") {
      openExternal(parsed.url);
      return;
    }

    var title = parsed.kind === "folder" ? "Pasta do Drive" : "Vídeo do Drive";
    addLibrary(parsed.kind, parsed.id, title, parsed.url);

    if (parsed.kind === "file") {
      openFileItem({ kind: "file", id: parsed.id, title: title, url: parsed.url });
    } else {
      openFolderItem({ kind: "folder", id: parsed.id, title: title, url: parsed.url });
    }
  }

  function openInput() {
    var input = $("#linkInput");
    var parsed = parseDriveLink(input ? input.value : "");
    if (!parsed) {
      toast("Cole um link de vídeo ou pasta do Google Drive.");
      if (input) input.focus();
      return;
    }
    openParsed(parsed);
  }

  function pasteLink() {
    if (window.Android && typeof window.Android.readClipboard === "function") {
      try {
        var text = String(window.Android.readClipboard() || "").trim();
        if (!text) {
          toast("A área de transferência está vazia.");
          return;
        }
        var input = $("#linkInput");
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
        var input = $("#linkInput");
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

  function renderLibrary() {
    var section = $("#librarySection");
    var hero = $("#hero");
    var list = $("#libraryList");
    var count = $("#libraryCount");
    if (!section || !list || !hero) return;

    var hasItems = library.length > 0;
    section.hidden = !hasItems;
    hero.hidden = hasItems;
    if (count) count.textContent = String(library.length);
    if (!hasItems) {
      list.innerHTML = "";
      return;
    }

    list.innerHTML = library.map(function (item, index) {
      var isFolder = item.kind === "folder";
      var icon = isFolder
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-10Z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="none"/><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/></svg>';
      var subtitle = isFolder ? "Pasta do Drive" : "Vídeo do Drive";
      var shortId = String(item.id || "").slice(0, 9);
      var meta = subtitle + (shortId ? " · " + shortId + "…" : "");
      return '<div class="lib-item" data-index="' + index + '" role="button" tabindex="0" aria-label="Abrir ' + escapeHtml(item.title) + '">' +
        '<div class="lib-icon ' + (isFolder ? "folder" : "file") + '">' + icon + '</div>' +
        '<div class="lib-main"><strong>' + escapeHtml(item.title || subtitle) + '</strong><span>' + escapeHtml(meta) + '</span></div>' +
        '<div class="lib-actions">' +
          '<button class="icon-btn play-fab" type="button" data-play="' + index + '" aria-label="Reproduzir">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
          '</button>' +
          '<button class="icon-btn trash" type="button" data-delete="' + index + '" aria-label="Remover">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function handleLibraryClick(event) {
    var deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      removeLibraryItem(Number(deleteButton.getAttribute("data-delete")));
      return;
    }

    var itemNode = event.target.closest("[data-index]");
    if (!itemNode) return;
    event.preventDefault();
    var index = Number(itemNode.getAttribute("data-index"));
    var item = library[index];
    if (!item) return;
    if (item.kind === "folder") openFolderItem(item);
    else openFileItem(item);
  }

  function handleLibraryKey(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var itemNode = event.target.closest("[data-index]");
    if (!itemNode) return;
    event.preventDefault();
    var item = library[Number(itemNode.getAttribute("data-index"))];
    if (!item) return;
    if (item.kind === "folder") openFolderItem(item);
    else openFileItem(item);
  }

  function removeLibraryItem(index) {
    var item = library[index];
    if (!item) return;
    var label = item.title || (item.kind === "folder" ? "esta pasta" : "este vídeo");
    if (!window.confirm("Remover “" + label + "” da biblioteca?")) return;
    library.splice(index, 1);
    saveLibrary();
    renderLibrary();
    toast("Removido da biblioteca.");
  }

  function syncSettingsControls() {
    var introToggle = $("#skipIntro");
    var endingToggle = $("#skipEnding");
    var autoFullscreen = $("#autoFullscreen");
    var autoNext = $("#autoNext");
    var resume = $("#resumePlayback");
    var fillScreen = $("#fillScreen");
    var introSeconds = $("#introSeconds");
    var endingSeconds = $("#endingSeconds");

    if (introToggle) introToggle.checked = settings.skipIntro;
    if (endingToggle) endingToggle.checked = settings.skipEnding;
    if (autoFullscreen) autoFullscreen.checked = settings.autoFullscreen;
    if (autoNext) autoNext.checked = settings.autoNext;
    if (resume) resume.checked = settings.resumePlayback;
    if (fillScreen) fillScreen.checked = settings.fillScreen;
    if (introSeconds) {
      introSeconds.value = String(settings.introSeconds);
      introSeconds.disabled = !settings.skipIntro;
    }
    if (endingSeconds) {
      endingSeconds.value = String(settings.endingSeconds);
      endingSeconds.disabled = !settings.skipEnding;
    }
  }

  function openSheet() {
    var sheet = $("#sheet");
    if (!sheet) return;
    syncSettingsControls();
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("sheet-open");
  }

  function closeSheet() {
    var sheet = $("#sheet");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("sheet-open");
  }

  function bindSettings() {
    var introToggle = $("#skipIntro");
    var endingToggle = $("#skipEnding");
    var autoFullscreen = $("#autoFullscreen");
    var autoNext = $("#autoNext");
    var resume = $("#resumePlayback");
    var fillScreen = $("#fillScreen");
    var introSeconds = $("#introSeconds");
    var endingSeconds = $("#endingSeconds");

    if (introToggle) {
      introToggle.addEventListener("change", function () {
        settings.skipIntro = introToggle.checked;
        saveSettings();
        syncSettingsControls();
      });
    }
    if (endingToggle) {
      endingToggle.addEventListener("change", function () {
        settings.skipEnding = endingToggle.checked;
        saveSettings();
        syncSettingsControls();
      });
    }
    if (autoFullscreen) {
      autoFullscreen.addEventListener("change", function () {
        settings.autoFullscreen = autoFullscreen.checked;
        saveSettings();
      });
    }
    if (autoNext) {
      autoNext.addEventListener("change", function () {
        settings.autoNext = autoNext.checked;
        saveSettings();
      });
    }
    if (resume) {
      resume.addEventListener("change", function () {
        settings.resumePlayback = resume.checked;
        saveSettings();
      });
    }
    if (fillScreen) {
      fillScreen.addEventListener("change", function () {
        settings.fillScreen = fillScreen.checked;
        saveSettings();
      });
    }
    if (introSeconds) {
      introSeconds.addEventListener("input", function () {
        settings.introSeconds = clampNumber(introSeconds.value, settings.introSeconds, 0, 3600);
        saveSettings();
      });
      introSeconds.addEventListener("blur", function () {
        syncSettingsControls();
      });
    }
    if (endingSeconds) {
      endingSeconds.addEventListener("input", function () {
        settings.endingSeconds = clampNumber(endingSeconds.value, settings.endingSeconds, 0, 3600);
        saveSettings();
      });
      endingSeconds.addEventListener("blur", function () {
        syncSettingsControls();
      });
    }

    $$("[data-close-sheet]").forEach(function (node) {
      node.addEventListener("click", closeSheet);
    });

    var settingsBtn = $("#settingsBtn");
    if (settingsBtn) settingsBtn.addEventListener("click", openSheet);
  }

  function bindUi() {
    var openBtn = $("#openBtn");
    var pasteBtn = $("#pasteBtn");
    var localBtn = $("#localBtn");
    var heroOpen = $("#heroOpen");
    var heroLocal = $("#heroLocal");
    var addLinkBtn = $("#addLinkBtn");
    var input = $("#linkInput");

    if (openBtn) openBtn.addEventListener("click", openInput);
    if (pasteBtn) pasteBtn.addEventListener("click", pasteLink);
    if (localBtn) localBtn.addEventListener("click", pickLocalVideo);
    if (heroLocal) heroLocal.addEventListener("click", pickLocalVideo);
    if (heroOpen) {
      heroOpen.addEventListener("click", function () {
        if (input) {
          input.focus();
          if (typeof input.scrollIntoView === "function") input.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
    if (addLinkBtn) {
      addLinkBtn.addEventListener("click", function () {
        if (input) {
          input.focus();
          input.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          openInput();
        }
      });
    }

    var libraryList = $("#libraryList");
    if (libraryList) {
      libraryList.addEventListener("click", handleLibraryClick);
      libraryList.addEventListener("keydown", handleLibraryKey);
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeSheet();
    });
  }

  function mergeNativeSettings(raw) {
    if (!raw || raw === "{}") return;
    var parsed = safeParse(raw, null);
    if (!parsed || typeof parsed !== "object") return;
    settings = normalizeSettings(Object.assign({}, settings, parsed));
    storageSet(SETTINGS_KEY, settings);
    syncSettingsControls();
  }

  function handleNativeLaunchLink() {
    if (!window.Android || typeof window.Android.getLaunchLink !== "function") return;
    try {
      var link = String(window.Android.getLaunchLink() || "").trim();
      if (!link) return;
      var input = $("#linkInput");
      if (input) input.value = link;
      var parsed = parseDriveLink(link);
      if (parsed) window.setTimeout(function () { openParsed(parsed); }, 40);
    } catch (error) {
      /* The bridge is best-effort. */
    }
  }

  function init() {
    settings = loadSettings();
    library = loadLibrary();
    bindUi();
    bindSettings();
    syncSettingsControls();
    renderLibrary();
    saveSettings();
  }

  /* Called by the native Android shell after the web page is loaded. */
  window.__dpNativeReady = function () {
    if (nativeReadyDone) return;
    nativeReadyDone = true;
    if (window.Android) {
      try {
        if (typeof window.Android.getSettings === "function") {
          mergeNativeSettings(window.Android.getSettings());
        }
      } catch (error) {
        /* Ignore bridge failures and keep local settings. */
      }
      handleNativeLaunchLink();
    }
    saveSettings();
  };

  /* Called by the native shell for shared Drive links and titles. */
  window.__dpOpenLink = function (url) {
    var link = String(url || "").trim();
    if (!link) return;
    var input = $("#linkInput");
    if (input) input.value = link;
    var parsed = parseDriveLink(link);
    if (parsed) openParsed(parsed);
    else toast("Link recebido, mas não parece ser do Google Drive.");
  };

  window.__dpAddLibrary = function (kind, id, title, url) {
    addLibrary(kind, id, title, url);
  };

  window.__dpFillSettingChanged = function (enabled) {
    settings.fillScreen = enabled === true;
    storageSet(SETTINGS_KEY, settings);
    syncSettingsControls();
  };

  window.__dpUpdateTitle = function (id, title) {
    if (!id) return;
    var item = null;
    for (var i = 0; i < library.length; i++) {
      if (library[i].kind === "file" && library[i].id === id) {
        item = library[i];
        break;
      }
    }
    var niceTitle = cleanTitle(title, "Vídeo do Drive");
    if (item) {
      if (niceTitle !== "Vídeo do Drive") item.title = niceTitle;
      saveLibrary();
      renderLibrary();
    } else if (niceTitle !== "Vídeo do Drive") {
      addLibrary("file", id, niceTitle, "https://drive.google.com/file/d/" + id + "/view");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
