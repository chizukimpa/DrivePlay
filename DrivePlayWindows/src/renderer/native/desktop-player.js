(function () {
  "use strict";
  if (window.__dpDesktopBooted) return;
  window.__dpDesktopBooted = true;

  function param(name, fallback) {
    try {
      var value = new URLSearchParams(window.location.search).get(name);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function safeParse(value, fallback) {
    try {
      var parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  var api = window.DesktopPlayer;
  var id = param("fileId", "");
  var title = param("title", "Vídeo do Drive");
  var settings = safeParse(param("settings", "{}"), {});
  var playlist = safeParse(param("playlist", "[]"), []);
  var index = parseInt(param("index", "0"), 10);
  if (!isFinite(index) || index < 0) index = 0;
  if (!Array.isArray(playlist) || !playlist.length) playlist = [{ id: id, title: title }];
  var resume = parseFloat(param("resume", "0")) || 0;
  var fill = param("fill", "0") === "1";

  var stage = null;
  var video = null;
  var audio = null;
  var prepared = null;
  var currentAudio = -1;
  var currentText = -1;
  var cueNode = null;
  var cues = [];
  var cuePointer = 0;
  var preparing = false;
  var player = null;
  var readySent = false;
  var fallbackTried = false;
  var failureSent = false;
  var supportProbeTimer = null;
  var supportProbeAttempts = 0;

  function reportFailure(message) {
    if (failureSent) return;
    failureSent = true;
    if (api.failed) {
      try { api.failed(message); } catch (error) {}
    }
  }

  function scheduleSupportProbe() {
    if (supportProbeTimer) clearTimeout(supportProbeTimer);
    supportProbeTimer = setTimeout(function () {
      if (!video || fallbackTried) return;
      if (video.videoWidth > 0) return;
      if (video.error) return;

      supportProbeAttempts += 1;
      if (video.readyState >= 1 && video.duration > 0) {
        fallbackTried = true;
        if (player) {
          player.showError(
            "Este vídeo usa um codec que o player integrado não consegue exibir. "
            + "Abrindo o player do Drive…"
          );
        }
        return;
      }
      if (supportProbeAttempts < 5) scheduleSupportProbe();
    }, 6000);
  }

  function signalReady() {
    if (readySent) return;
    readySent = true;
    if (api.ready) {
      try {
        api.ready({
          duration: state.duration || 0,
          hasVideo: state.hasVideo !== false,
          width: state.width || 0,
          height: state.height || 0
        });
      } catch (error) {}
    }
  }

  var state = {
    ready: false,
    hasVideo: false,
    currentTime: 0,
    duration: 0,
    paused: true,
    ended: false,
    rate: 1,
    aspect: 0,
    error: null,
    buffering: true,
    quality: "original",
    qualities: [],
    audio: [],
    text: []
  };

  function defaultAudioIndex() {
    if (!prepared || !prepared.audio.length) return -1;
    for (var i = 0; i < prepared.audio.length; i += 1) {
      if (prepared.audio[i].default) return prepared.audio[i].index;
    }
    return prepared.audio[0].index;
  }

  function refreshState() {
    if (video) {
      state.currentTime = video.currentTime || 0;
      state.duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      state.paused = video.paused;
      state.ended = video.ended;
      state.rate = video.playbackRate || 1;
      state.aspect = video.videoWidth && video.videoHeight
        ? video.videoWidth / video.videoHeight
        : state.aspect;
      state.ready = state.duration > 0 && video.readyState >= 1;
      state.hasVideo = state.ready && video.videoWidth > 0;
      state.buffering = !video.paused && video.readyState < 3;
    }
    if (prepared) {
      state.audio = prepared.audio.map(function (track) {
        return {
          index: track.index,
          label: track.label,
          language: track.language,
          selected: track.index === currentAudio
        };
      });
      state.text = prepared.text.map(function (track) {
        return {
          index: track.index,
          label: track.label,
          language: track.language,
          selected: track.index === currentText
        };
      });
    }
    return state;
  }

  function syncAudioTime() {
    if (!audio || !video) return;
    if (Math.abs((audio.currentTime || 0) - (video.currentTime || 0)) > 0.35) {
      try { audio.currentTime = Math.max(0, video.currentTime - 0.05); } catch (error) {}
    }
  }

  function syncAudioPlayback(force) {
    if (!audio || !video) return;
    audio.playbackRate = video.playbackRate || 1;
    if (force || Math.abs(audio.currentTime - video.currentTime) > 0.4) syncAudioTime();
    if (video.paused || video.ended) {
      audio.pause();
    } else {
      var promise = audio.play();
      if (promise && promise.catch) promise.catch(function () {});
    }
  }

  function clearAudio() {
    if (!audio) return;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch (error) {}
    if (audio.parentNode) audio.parentNode.removeChild(audio);
    audio = null;
  }

  function makeAudio(url) {
    clearAudio();
    audio = document.createElement("audio");
    audio.preload = "auto";
    audio.src = url;
    audio.style.display = "none";
    stage.appendChild(audio);
    audio.addEventListener("loadedmetadata", syncAudioTime);
  }

  function vttTime(value) {
    var match = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(String(value || "").trim());
    if (!match) return 0;
    return (parseInt(match[1] || "0", 10) * 3600)
      + parseInt(match[2], 10) * 60
      + parseInt(match[3], 10)
      + parseInt(match[4], 10) / 1000;
  }

  function parseVtt(text) {
    var result = [];
    var blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/);
    blocks.forEach(function (block) {
      var lines = block.split("\n");
      var at = /^\d+$/.test((lines[0] || "").trim()) ? 1 : 0;
      var timing = /^([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[at] || "");
      if (!timing) return;
      var body = lines.slice(at + 1).join("\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\{[^}]*\}/g, "")
        .trim();
      if (!body) return;
      var start = vttTime(timing[1]);
      var end = vttTime(timing[2]);
      if (end > start) result.push({ start: start, end: end, text: body });
    });
    result.sort(function (a, b) { return a.start - b.start; });
    return result;
  }

  function ensureCueNode() {
    if (cueNode || !player) return;
    cueNode = document.createElement("div");
    cueNode.className = "dp-cues";
    player.root.appendChild(cueNode);
  }

  function updateCues(time) {
    if (!cueNode) return;
    var text = "";
    if (cues.length) {
      while (cuePointer > 0 && cues[cuePointer - 1].start > time) cuePointer -= 1;
      while (cuePointer < cues.length && cues[cuePointer].end <= time) cuePointer += 1;
      var cue = cues[cuePointer];
      if (cue && cue.start <= time && cue.end > time) text = cue.text;
    }
    if (cueNode.textContent !== text) cueNode.textContent = text;
    cueNode.classList.toggle("dp-cues-on", !!text);
  }

  function attachVideoEvents() {
    video.addEventListener("loadedmetadata", function () {
      refreshState();
      signalReady();
      if (resume > 5 && resume < (video.duration || 0) - 5) {
        try { video.currentTime = resume; } catch (error) {}
      }
      var promise = video.play();
      if (promise && promise.catch) {
        promise.catch(function () {
          if (player) player.toast("Clique em play para iniciar.");
        });
      }
    });
    video.addEventListener("play", function () { syncAudioPlayback(true); });
    video.addEventListener("pause", function () { syncAudioPlayback(false); });
    video.addEventListener("seeking", function () { syncAudioTime(); });
    video.addEventListener("seeked", function () { syncAudioPlayback(false); });
    video.addEventListener("ratechange", function () { syncAudioPlayback(false); });
    video.addEventListener("timeupdate", function () {
      refreshState();
      updateCues(state.currentTime);
      if (audio) syncAudioPlayback(false);
    });
    video.addEventListener("waiting", function () { state.buffering = true; });
    video.addEventListener("playing", function () { state.buffering = false; });
    video.addEventListener("ended", function () {
      state.buffering = false;
      if (player) player.toast("Fim do vídeo.");
    });
    video.addEventListener("error", function () {
      var code = video.error ? video.error.code : 0;
      var message = code === 2 ? "Não foi possível ler o vídeo."
        : code === 3 ? "O vídeo está corrompido ou usa um codec não suportado."
        : code === 4 ? "Este formato não é compatível com o player."
        : "Não foi possível reproduzir este vídeo.";
      if (player) player.showError(message);
    });
  }

  function setup(info) {
    prepared = info;
    state.duration = info.duration || 0;
    video = document.createElement("video");
    video.className = "dp-video";
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.controls = false;
    video.disablePictureInPicture = true;
    video.src = info.videoUrl;
    stage.appendChild(video);
    attachVideoEvents();
    scheduleSupportProbe();

    currentAudio = defaultAudioIndex();
    currentText = -1;
    if (api.onProgress) {
      api.onProgress(function (data) {
        if (!player || !data) return;
        var percent = Math.round((data.progress || 0) * 100);
        player.toast("Preparando "
          + (data.kind === "audio" ? "áudio" : "legenda")
          + "… " + percent + "%");
      });
    }
    refreshState();
  }

  function startPrepare() {
    if (preparing) return;
    preparing = true;
    api.prepare({
      fileId: id,
      title: title,
      apiKey: (settings && settings.driveApiKey) || ""
    }).then(function (info) {
      if (!info || info.ok !== true) {
        var message = (info && info.error) || "Não foi possível preparar o vídeo.";
        if (player) player.showError(message);
        return;
      }
      setup(info);
    }).catch(function (error) {
      var message = "Falha ao preparar o vídeo: "
        + (error && error.message ? error.message : error);
      if (player) player.showError(message);
    });
  }

  function extract(kind, track) {
    return api.extract({
      key: prepared.key,
      kind: kind,
      streamIndex: track.streamIndex,
      duration: prepared.duration || state.duration || 0
    });
  }

  function selectAudio(trackIndex) {
    if (!prepared || trackIndex < 0) return;
    var track = null;
    for (var i = 0; i < prepared.audio.length; i += 1) {
      if (prepared.audio[i].index === trackIndex) track = prepared.audio[i];
    }
    if (!track) return;

    if (trackIndex === defaultAudioIndex()) {
      currentAudio = trackIndex;
      clearAudio();
      if (video) video.muted = false;
      refreshState();
      return;
    }

    player.toast("Preparando áudio…");
    extract("audio", track).then(function (result) {
      if (!result || result.ok !== true) {
        player.toast((result && result.error) || "Não foi possível preparar o áudio.");
        return;
      }
      currentAudio = trackIndex;
      makeAudio(result.url);
      if (video) {
        video.muted = true;
        try { audio.currentTime = Math.max(0, video.currentTime - 0.05); } catch (error) {}
      }
      syncAudioPlayback(true);
      refreshState();
      player.toast("Áudio: " + track.label);
    });
  }

  function selectText(trackIndex) {
    if (!prepared) return;
    if (trackIndex < 0) {
      currentText = -1;
      cues = [];
      cuePointer = 0;
      if (cueNode) {
        cueNode.textContent = "";
        cueNode.classList.remove("dp-cues-on");
      }
      refreshState();
      return;
    }
    var track = null;
    for (var i = 0; i < prepared.text.length; i += 1) {
      if (prepared.text[i].index === trackIndex) track = prepared.text[i];
    }
    if (!track) return;

    player.toast("Preparando legenda…");
    extract("text", track).then(function (result) {
      if (!result || result.ok !== true) {
        player.toast((result && result.error) || "Não foi possível preparar a legenda.");
        return;
      }
      fetch(result.url).then(function (response) {
        return response.text();
      }).then(function (text) {
        cues = parseVtt(text);
        cuePointer = 0;
        currentText = trackIndex;
        ensureCueNode();
        refreshState();
        player.toast(cues.length ? ("Legenda: " + track.label) : "Esta legenda não tem textos.");
      }).catch(function () {
        player.toast("Não foi possível carregar a legenda.");
      });
    });
  }

  player = window.DPPlayerCore.create({
    id: id,
    title: title,
    index: index,
    playlist: playlist,
    settings: settings,
    fill: fill,
    cover: false,
    canOpenExternal: true,
    canSetQuality: false,
    backend: {
      mount: function (stageElement) {
        stage = stageElement;
        startPrepare();
      },
      play: function () {
        if (!video) return;
        var promise = video.play();
        if (promise && promise.catch) promise.catch(function () {});
      },
      pause: function () { if (video) video.pause(); },
      seek: function (seconds) {
        if (!video) return;
        var duration = isFinite(video.duration) ? video.duration : 0;
        var target = Number(seconds) || 0;
        if (duration > 0) target = Math.min(Math.max(target, 0), Math.max(duration - 0.2, 0));
        try { video.currentTime = target; } catch (error) {}
        if (audio) {
          try { audio.currentTime = Math.max(0, target - 0.05); } catch (error) {}
        }
        updateCues(target);
      },
      setRate: function (rate) {
        if (video) video.playbackRate = rate;
        if (audio) audio.playbackRate = rate;
      },
      setQuality: function () {},
      getState: refreshState,
      setFill: function (enabled) {
        if (video) video.style.objectFit = enabled ? "cover" : "contain";
      },
      layout: function () {},
      selectAudio: selectAudio,
      selectText: selectText,
      destroy: function () {
        if (supportProbeTimer) clearTimeout(supportProbeTimer);
        clearAudio();
        if (video) {
          try {
            video.pause();
            video.removeAttribute("src");
            video.load();
          } catch (error) {}
        }
      }
    },
    getResume: function () { return resume; },
    saveProgress: function (fileId, fileTitle, time, duration) {
      if (api.saveProgress) api.saveProgress(fileId, fileTitle, time, duration);
    },
    saveSettings: function (patch) {
      if (api.saveSettings) api.saveSettings(patch);
    },
    close: function () { if (api.close) api.close(); },
    openExternal: function () { if (api.openExternal) api.openExternal(); },
    onFill: function (enabled) { if (api.setFill) api.setFill(enabled); },
    onControls: function () {},
    onState: function () {},
    onReady: signalReady,
    onError: function (message) {
      reportFailure(message);
    },
    previous: function () { if (api.previous) api.previous(); },
    next: function () { if (api.next) api.next(); },
    retry: function () { location.reload(); }
  });

  window.__dpNativeCmd = function (command) {
    if (!command || !video) return;
    if (typeof command.seek === "number" && isFinite(command.seek)) {
      var duration = isFinite(video.duration) ? video.duration : 0;
      var target = Number(command.seek) || 0;
      if (duration > 0) target = Math.min(Math.max(target, 0), Math.max(duration - 0.2, 0));
      try { video.currentTime = target; } catch (error) {}
      if (audio) {
        try { audio.currentTime = Math.max(0, target - 0.05); } catch (error) {}
      }
      updateCues(target);
      refreshState();
    }
    if (typeof command.fill === "boolean" && player) player.setFill(command.fill);
    if (command.play === true) {
      var promise = video.play();
      if (promise && promise.catch) promise.catch(function () {});
    }
    if (command.pause === true) video.pause();
  };

  window.__dpNativeSnapshot = function () {
    return refreshState();
  };

  window.addEventListener("beforeunload", function () {
    try { player.destroy(); } catch (error) {}
  });
})();
