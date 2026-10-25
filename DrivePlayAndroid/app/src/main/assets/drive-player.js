/*
 * Injected controller for the public Google Drive preview page.
 *
 * The Drive preview embeds a YouTube player in an iframe. Instead of fighting
 * Drive's own UI, this script isolates that iframe, covers the page with the
 * DrivePlay chrome and drives the embedded player through the YouTube iframe
 * API (postMessage). It is the only reliable way to play MKV/HEVC files that
 * the WebView cannot decode directly.
 */
(function () {
  "use strict";

  if (window.__dpDriveBooted) return;
  window.__dpDriveBooted = true;

  var CSS = __DP_CSS__;
  var SETTINGS = __DP_SETTINGS__;
  var FILE_ID = __DP_FILE_ID__;
  var TITLE = __DP_TITLE__;
  var PLAYLIST = JSON.parse(__DP_PLAYLIST__ || "[]");
  var FILL = __DP_FILL__;
  var COVER = __DP_COVER__;

  var ISOLATION_CSS = '' +
    'html.dp-isolated,body.dp-isolated{background:#000!important;overflow:hidden!important;}' +
    'body.dp-isolated>*{visibility:hidden!important;}' +
    'body.dp-isolated>#dp-root,body.dp-isolated>.dp-chain{visibility:visible!important;}' +
    '.dp-chain{transform:none!important;filter:none!important;perspective:none!important;' +
      'will-change:auto!important;overflow:visible!important;position:static!important;' +
      'contain:none!important;clip-path:none!important;opacity:1!important;' +
      'max-width:none!important;max-height:none!important;}' +
    'iframe.dp-frame{position:fixed!important;left:0;top:0;border:0!important;margin:0!important;' +
      'padding:0!important;max-width:none!important;max-height:none!important;' +
      'z-index:2147483646!important;background:#000!important;}';

  function injectStyle() {
    if (document.getElementById("dp-player-style")) return;
    var style = document.createElement("style");
    style.id = "dp-player-style";
    style.textContent = CSS + "\n" + ISOLATION_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  injectStyle();

  var iframe = null;
  var frameWindow = null;
  var chain = [];
  var attached = false;
  var bootTime = Date.now();

  var state = {
    ready: false,
    hasVideo: false,
    currentTime: 0,
    duration: 0,
    paused: true,
    ended: false,
    rate: 1,
    quality: "auto",
    qualities: [],
    aspect: 0,
    error: null
  };

  var player = null;
  var pollTimer = null;
  var layoutTimer = null;
  var started = false;
  var aspectTried = false;

  function bridge(name) {
    try {
      if (window.PlayerBridge && typeof window.PlayerBridge[name] === "function") {
        return window.PlayerBridge[name].apply(window.PlayerBridge, Array.prototype.slice.call(arguments, 1));
      }
    } catch (error) {
      /* The native bridge is best effort. */
    }
    return null;
  }

  function findIframe() {
    var nodes = document.querySelectorAll("iframe");
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var src = String(node.src || "");
      if (src.indexOf("/embed") >= 0 && (src.indexOf("youtube") >= 0 || src.indexOf("googleapis") >= 0)) {
        return node;
      }
      var rect = node.getBoundingClientRect();
      var area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = node;
      }
    }
    return bestArea > 10000 ? best : null;
  }

  function isolate() {
    if (!iframe) return;
    for (var i = 0; i < chain.length; i++) {
      chain[i].classList.remove("dp-chain");
    }
    chain = [];

    var node = iframe;
    while (node && node !== document.body && node !== document.documentElement) {
      node.classList.add("dp-chain");
      chain.push(node);
      node = node.parentElement;
    }

    document.documentElement.classList.add("dp-isolated");
    document.body.classList.add("dp-isolated");
    iframe.classList.add("dp-frame");
    iframe.style.position = "fixed";
    iframe.style.left = "0";
    iframe.style.top = "0";
    iframe.style.zIndex = "2147483646";
    iframe.style.border = "0";
    iframe.style.background = "#000";
  }

  function layout() {
    if (!iframe) return;
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var width = viewportWidth;
    var height = viewportHeight;
    var left = 0;
    var top = 0;
    var aspect = state.aspect;

    if (FILL && aspect > 0.2 && aspect < 5) {
      if (viewportWidth / viewportHeight > aspect) {
        width = viewportWidth;
        height = Math.round(viewportWidth / aspect);
      } else {
        height = viewportHeight;
        width = Math.round(viewportHeight * aspect);
      }
      left = Math.round((viewportWidth - width) / 2);
      top = Math.round((viewportHeight - height) / 2);
    }

    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    iframe.style.left = left + "px";
    iframe.style.top = top + "px";
  }

  function detectAspect() {
    if (aspectTried) return;
    aspectTried = true;

    var links = document.querySelectorAll('link[rel="preload"][as="image"]');
    for (var i = 0; i < links.length; i++) {
      var href = String(links[i].href || "");
      if (!href) continue;
      (function (url) {
        var image = new Image();
        image.onload = function () {
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            state.aspect = image.naturalWidth / image.naturalHeight;
            layout();
          }
        };
        image.src = url;
      })(href);
      return;
    }
  }

  function send(func, args) {
    if (!frameWindow) return;
    try {
      frameWindow.postMessage(JSON.stringify({
        event: "command",
        func: func,
        args: args || []
      }), "*");
    } catch (error) {
      /* The iframe may be gone. */
    }
  }

  function applyPlayerState(value) {
    var code = Number(value);
    if (!isFinite(code)) return;
    if (code === 0) {
      state.ended = true;
      state.paused = true;
    } else if (code === 1) {
      state.ended = false;
      state.paused = false;
    } else if (code === 2) {
      state.paused = true;
    } else if (code === 5) {
      state.paused = true;
    }
  }

  function applyInfo(info) {
    if (!info || typeof info !== "object") return;

    if (typeof info.currentTime === "number" && isFinite(info.currentTime)) {
      state.currentTime = Math.max(0, info.currentTime);
    }
    if (typeof info.duration === "number" && isFinite(info.duration) && info.duration > 0) {
      state.duration = info.duration;
    }
    if (typeof info.playbackRate === "number" && isFinite(info.playbackRate)) {
      state.rate = info.playbackRate;
    }
    if (typeof info.playbackQuality === "string") {
      state.quality = info.playbackQuality;
    }
    if (Array.isArray(info.availableQualityLevels)) {
      state.qualities = info.availableQualityLevels.slice();
    }
    if (info.videoContentRect && info.videoContentRect.width > 0 && info.videoContentRect.height > 0) {
      state.aspect = info.videoContentRect.width / info.videoContentRect.height;
      layout();
    }
    if (info.progressState) {
      if (typeof info.progressState.duration === "number" && info.progressState.duration > 0) {
        state.duration = info.progressState.duration;
      }
      if (typeof info.progressState.current === "number" && isFinite(info.progressState.current)) {
        state.currentTime = Math.max(0, info.progressState.current);
      }
    }
    if (typeof info.playerState === "number") {
      applyPlayerState(info.playerState);
    }
    if (info.videoData && info.videoData.errorCode) {
      state.error = String(info.videoData.errorCode);
    }

    if (state.duration > 0) {
      state.hasVideo = true;
      state.ready = true;
    }
  }

  window.addEventListener("message", function (event) {
    if (frameWindow && event.source !== frameWindow) return;
    var data = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (error) {
        return;
      }
    }
    if (!data || typeof data !== "object") return;

    if (data.event === "onStateChange") {
      applyPlayerState(data.info);
    } else if (data.event === "infoDelivery" || data.event === "initialDelivery") {
      applyInfo(data.info);
    } else if (data.event === "onError") {
      state.error = String(data.info || "erro");
    }
  });

  function attach() {
    if (iframe && !iframe.isConnected) {
      iframe = null;
      frameWindow = null;
      attached = false;
    }
    if (!iframe) {
      iframe = findIframe();
      if (!iframe) return;
    }
    if (!iframe.contentWindow) return;
    frameWindow = iframe.contentWindow;

    if (!attached) {
      attached = true;
      isolate();
      detectAspect();
      layout();

      try {
        frameWindow.postMessage(JSON.stringify({ event: "listening", id: "dp" }), "*");
      } catch (error) { /* noop */ }
      send("addEventListener", ["onStateChange"]);
      send("addEventListener", ["onReady"]);

      setTimeout(function () { send("playVideo", []); }, 250);
      setTimeout(function () { send("playVideo", []); }, 1200);
      setTimeout(function () { send("playVideo", []); }, 2600);
    } else {
      isolate();
      layout();
    }
  }

  function start() {
    if (started) return;
    started = true;

    player = window.DPPlayerCore.create({
      id: FILE_ID,
      title: TITLE,
      playlist: Array.isArray(PLAYLIST) ? PLAYLIST : [],
      settings: SETTINGS,
      fill: FILL,
      cover: COVER,
      backend: {
        mount: function () { /* the iframe stays in the Drive page */ },
        play: function () {
          send("playVideo", []);
          state.paused = false;
        },
        pause: function () {
          send("pauseVideo", []);
          state.paused = true;
        },
        seek: function (seconds) {
          send("seekTo", [Math.max(0, Number(seconds) || 0), true]);
          state.currentTime = Math.max(0, Number(seconds) || 0);
        },
        setRate: function (rate) {
          send("setPlaybackRate", [rate]);
          state.rate = rate;
        },
        setQuality: function (level) {
          send("setPlaybackQuality", [level]);
          state.quality = level;
        },
        getState: function () { return state; },
        setFill: function (value) {
          FILL = value;
          layout();
        },
        layout: layout,
        destroy: function () {
          send("pauseVideo", []);
          if (pollTimer) clearInterval(pollTimer);
          if (layoutTimer) clearInterval(layoutTimer);
        }
      },
      getResume: function (id) { return bridge("getResume", id); },
      saveProgress: function (id, title, time, duration) {
        bridge("saveProgress", id, title, time, duration);
      },
      close: function () { bridge("close"); },
      next: function () { bridge("next"); },
      previous: function () { bridge("previous"); },
      openExternal: function () { bridge("openInChrome"); },
      onFill: function (enabled) { bridge("setFill", enabled); },
      onControls: function (visible) { bridge("onControls", visible); },
      onState: function (hasVideo, duration, position, paused, ended) {
        bridge("onState", hasVideo, duration, position, paused, ended);
      },
      onReady: function () { bridge("onReady"); },
      onError: function (message) { bridge("onError", message); },
      retry: function () { window.location.reload(); }
    });

    attach();
    pollTimer = setInterval(function () {
      attach();
      if (!state.ready && Date.now() - bootTime > 30000) {
        clearInterval(pollTimer);
        pollTimer = null;
        player.showError(
          "O player do Google Drive não respondeu. Confirme que o vídeo está público " +
          "(\"qualquer pessoa com o link\") ou abra no Chrome."
        );
      }
      if (state.error) {
        player.showError("O Google Drive recusou este vídeo. Abra no Chrome para entrar na sua conta.");
      }
    }, 400);

    layoutTimer = setInterval(layout, 2000);
    window.addEventListener("resize", layout);
    window.addEventListener("orientationchange", function () {
      setTimeout(layout, 350);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
