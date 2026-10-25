/*
 * Local video backend for the DrivePlay player page.
 * Uses a plain <video> element, so the phone's own hardware decoders handle
 * the file picked with the Android document picker.
 */
(function () {
  "use strict";

  if (/[?&]native=1(?:&|$)/.test(window.location.search)) return;
  if (window.__dpLocalBooted) return;
  window.__dpLocalBooted = true;

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

  var id = param("id", "local:0");
  var title = param("title", "Vídeo local");
  var source = param("src", "");

  var settings = {};
  try {
    var rawSettings = bridge("getSettings");
    if (rawSettings) settings = JSON.parse(rawSettings) || {};
  } catch (error) {
    settings = {};
  }

  var cover = false;
  try {
    cover = bridge("isCover") === true;
  } catch (error) {
    cover = false;
  }

  var video = document.createElement("video");
  video.className = "dp-video";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "metadata";
  video.controls = false;
  video.disablePictureInPicture = true;
  video.src = source;

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

  function refresh() {
    state.currentTime = video.currentTime || 0;
    state.duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    state.paused = video.paused;
    state.ended = video.ended;
    state.rate = video.playbackRate || 1;
    state.aspect = video.videoWidth && video.videoHeight
      ? video.videoWidth / video.videoHeight
      : state.aspect;
    state.ready = state.duration > 0 && video.readyState >= 1;
    state.hasVideo = state.ready;
    if (video.error) state.error = video.error.code;
    return state;
  }

  function errorMessage(code) {
    if (code === 1) return "A reprodução foi interrompida. Tente abrir o arquivo de novo.";
    if (code === 2) return "Não foi possível ler o arquivo. Verifique se ele ainda está no celular.";
    if (code === 3) return "O arquivo está corrompido ou usa um formato não suportado.";
    if (code === 4) return "Este formato não é compatível com o player. Tente um MP4/H.264 ou abra no VLC.";
    return "Não foi possível reproduzir este vídeo.";
  }

  var player = window.DPPlayerCore.create({
    id: id,
    title: title,
    playlist: [{ id: id, title: title }],
    settings: settings,
    fill: settings.fillScreen === true,
    cover: cover,
    canOpenExternal: false,
    canSetQuality: false,
    backend: {
      mount: function (stage) {
        stage.appendChild(video);
      },
      play: function () {
        var promise = video.play();
        if (promise && promise.catch) promise.catch(function () { /* handled by the UI */ });
      },
      pause: function () {
        video.pause();
      },
      seek: function (seconds) {
        if (!isFinite(video.duration)) return;
        video.currentTime = Math.min(Math.max(Number(seconds) || 0, 0), Math.max(video.duration - 0.2, 0));
      },
      setRate: function (rate) {
        video.playbackRate = rate;
      },
      setQuality: function () { /* local files have a single quality */ },
      getState: function () { return refresh(); },
      setFill: function () { /* CSS object-fit handles the local video */ },
      layout: function () { /* the CSS fills the viewport */ },
      destroy: function () {
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch (error) { /* noop */ }
      }
    },
    getResume: function (fileId) { return bridge("getResume", fileId); },
    saveProgress: function (fileId, fileTitle, time, duration) {
      bridge("saveProgress", fileId, fileTitle, time, duration);
    },
    close: function () { bridge("close"); },
    openExternal: function () {
      player.toast("Vídeo local: use o player do DrivePlay.");
    },
    onFill: function (enabled) { bridge("setFill", enabled); },
    saveSettings: function (patch) {
      try { bridge("saveSettings", JSON.stringify(patch)); } catch (error) { /* noop */ }
    },
    onControls: function (visible) { bridge("onControls", visible); },
    onState: function (hasVideo, duration, position, paused, ended) {
      bridge("onState", hasVideo, duration, position, paused, ended);
    },
    onReady: function () { bridge("onReady"); },
    onError: function (message) { bridge("onError", message); },
    retry: function () {
      try {
        video.load();
        video.play();
      } catch (error) { /* noop */ }
    }
  });

  video.addEventListener("loadedmetadata", function () {
    refresh();
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () { /* user can press play */ });
  });

  video.addEventListener("error", function () {
    refresh();
    player.showError(errorMessage(video.error ? video.error.code : 0));
  });

  video.addEventListener("ended", function () {
    refresh();
    player.toast("Fim do vídeo.");
  });

  if (!source) {
    player.showError("O arquivo de vídeo não foi informado.");
  }

  window.addEventListener("beforeunload", function () {
    player.destroy();
  });
})();
