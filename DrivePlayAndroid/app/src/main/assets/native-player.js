/*
 * Native backend for the DrivePlay player page.
 *
 * The MKV from Google Drive is decoded by ExoPlayer in the Android layer and
 * rendered in a TextureView *behind* this transparent WebView. Everything the
 * user sees here (seek bar, ±10 s, speed, tracks, skip intro/ending) is the
 * same chrome used by the desktop builds.
 */
(function () {
  "use strict";

  if (!/[?&]native=1(?:&|$)/.test(window.location.search)) return;
  if (window.__dpNativeBooted) return;
  window.__dpNativeBooted = true;

  document.documentElement.classList.add("dp-native");

  function param(name, fallback) {
    try {
      var value = new URLSearchParams(window.location.search).get(name);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function bridge(name) {
    try {
      if (window.PlayerBridge && typeof window.PlayerBridge[name] === "function") {
        return window.PlayerBridge[name].apply(
          window.PlayerBridge,
          Array.prototype.slice.call(arguments, 1)
        );
      }
    } catch (error) {
      /* The bridge is best effort. */
    }
    return null;
  }

  var id = param("id", "native:0");
  var title = param("title", "Vídeo do Drive");
  var index = parseInt(param("index", "0"), 10);
  if (!isFinite(index) || index < 0) index = 0;
  var skipResume = param("skipResume", "0") === "1";
  var isLocal = param("local", "0") === "1";
  var playlist = [];
  try {
    playlist = JSON.parse(param("playlist", "[]")) || [];
  } catch (error) {
    playlist = [];
  }
  if (!Array.isArray(playlist) || playlist.length === 0) {
    playlist = [{ id: id, title: title }];
  }

  var settings = {};
  try {
    var rawSettings = bridge("getSettings");
    if (rawSettings) settings = JSON.parse(rawSettings) || {};
  } catch (error) {
    settings = {};
  }
  // A local/picked file has a one-item playlist: auto-next would reopen the
  // same video from the start forever.
  if (isLocal) settings.autoNext = false;

  var cover = false;
  try {
    cover = bridge("isCover") === true;
  } catch (error) {
    cover = false;
  }

  var state = {
    ready: false,
    hasVideo: false,
    currentTime: 0,
    duration: 0,
    paused: true,
    ended: false,
    rate: 1,
    quality: "original",
    qualities: [],
    aspect: 0,
    error: null,
    buffering: true,
    audio: [],
    text: []
  };

  var player = null;
  var cueNode = null;
  var lastError = "";
  var errorShown = false;

  function safeParse(json) {
    try {
      return JSON.parse(json);
    } catch (error) {
      return null;
    }
  }

  function showCues(text) {
    if (!player) return;
    if (!cueNode) {
      cueNode = document.createElement("div");
      cueNode.className = "dp-cues";
      player.root.appendChild(cueNode);
    }
    cueNode.textContent = text || "";
    cueNode.classList.toggle("dp-cues-on", !!(text && text.length));
  }

  window.__dpNativeState = function (raw) {    var data = typeof raw === "string" ? safeParse(raw) : raw;
    if (!data) return;

    if (typeof data.cues === "string") {
      showCues(data.cues);
      return;
    }

    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) state[key] = data[key];
    }
    state.error = data.error || lastError || null;

    if (!player) return;

    if (state.ready) {
      errorShown = false;
      player.hideError();
    } else if (state.error && !errorShown) {
      errorShown = true;
      player.showError(state.error);
    }
  };

  window.__dpNativeSnapshot = function () {
    return JSON.parse(JSON.stringify(state));
  };

  player = window.DPPlayerCore.create({
    id: id,
    title: title,
    index: index,
    playlist: playlist,
    settings: settings,
    fill: settings.fillScreen === true,
    cover: cover,
    canOpenExternal: !isLocal,
    canSetQuality: false,
    backend: {
      mount: function () { /* the video is a native TextureView behind the page */ },
      play: function () { bridge("nativePlay"); },
      pause: function () { bridge("nativePause"); },
      seek: function (seconds) { bridge("nativeSeek", Number(seconds) || 0); },
      setRate: function (rate) { bridge("nativeRate", Number(rate) || 1); },
      setQuality: function () { /* the original Drive file has one quality */ },
      getState: function () { return state; },
      setFill: function (enabled) { bridge("nativeFill", enabled === true); },
      layout: function () { /* handled by the native surface */ },
      selectAudio: function (index) { bridge("nativeAudio", Number(index)); },
      selectText: function (index) { bridge("nativeText", Number(index)); },
      // The native player belongs to the activity, not to this page: a page
      // reload (display switch, chrome rebuild) must not stop the video.
      destroy: function () { /* stopped by MainActivity.closePlayer */ }
    },
    getResume: function (fileId) {
      return skipResume ? 0 : bridge("getResume", fileId);
    },
    saveProgress: function (fileId, fileTitle, time, duration) {
      bridge("saveProgress", fileId, fileTitle, time, duration);
    },
    close: function () { bridge("close"); },
    openExternal: function () { bridge("openInChrome"); },
    onFill: function (enabled) { bridge("setFill", enabled); },
    saveSettings: function (patch) {
      try { bridge("saveSettings", JSON.stringify(patch)); } catch (error) { /* noop */ }
    },
    onControls: function (visible) { bridge("onControls", visible); },
    onState: function (hasVideo, duration, position, paused, ended) {
      bridge("onState", hasVideo, duration, position, paused, ended);
    },
    onReady: function () { bridge("onReady"); },
    onError: function () { /* the in-page card already explains it */ },
    retry: function () {
      errorShown = false;
      if (player) player.hideError();
      bridge("nativeRetry");
    }
  });

  // Ask the native layer for a fresh state right away.
  bridge("nativePing");

  window.addEventListener("beforeunload", function () {
    try { player.destroy(); } catch (error) { /* noop */ }
  });
})();
