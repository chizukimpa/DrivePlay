/*
 * DrivePlay player core.
 *
 * Shared chrome for both backends:
 *  - the injected controller for the Google Drive preview (YouTube iframe)
 *  - the local <video> player
 *
 * The backend only exposes play/pause/seek/rate/quality/state; every control,
 * the seek bar, the menus, the skip logic and the progress bookkeeping live
 * here so the two players behave exactly the same.
 */
(function () {
  "use strict";

  if (window.DPPlayerCore) return;

  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  var QUALITY_LABELS = {
    auto: "Auto",
    highres: "Alta",
    hd2160: "4K",
    hd1440: "1440p",
    hd1080: "1080p",
    hd720: "720p",
    large: "480p",
    medium: "360p",
    small: "240p",
    tiny: "144p"
  };

  var DEFAULTS = {
    skipIntro: false,
    introSeconds: 120,
    skipEnding: false,
    endingSeconds: 190,
    autoFullscreen: true,
    autoNext: true,
    resumePlayback: true,
    fillScreen: false,
    autoSkipVersion: 2,
    subtitleSize: 1.3,
    subtitleColor: "#ffffff",
    subtitleOutline: true,
    subtitleFont: "sans",
    subtitleBackground: true
  };

  var CUE_SIZES = [1.0, 1.15, 1.3, 1.5, 1.75, 2.0];

  var CUE_FONTS = {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
    mono: '"Roboto Mono", "SF Mono", Menlo, Consolas, monospace'
  };

  var ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 5l8 7-8 7V5z" fill="currentColor" stroke="none"/><path d="M18 5v14"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M18 5l-8 7 8 7V5z" fill="currentColor" stroke="none"/><path d="M6 5v14"/></svg>',
    fill: '<svg viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
    chrome: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M9 21h6"/></svg>',
    skip: '<svg viewBox="0 0 24 24"><path d="M5 5l9 7-9 7V5z" fill="currentColor" stroke="none"/><path d="M18 5v14"/></svg>'
  };

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function formatTime(value) {
    var total = Math.max(0, Math.round(Number(value) || 0));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    if (hours > 0) return hours + ":" + pad(minutes) + ":" + pad(seconds);
    return minutes + ":" + pad(seconds);
  }

  function toNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

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
    settings.introSeconds = clamp(Math.round(toNumber(source.introSeconds, 120)), 0, 3600);
    settings.endingSeconds = clamp(Math.round(toNumber(source.endingSeconds, 190)), 0, 3600);
    settings.autoSkipVersion = clamp(Math.round(toNumber(source.autoSkipVersion, 2)), 0, 99);
    settings.subtitleSize = clamp(toNumber(source.subtitleSize, 1.3), 0.7, 2.4);
    settings.subtitleColor = /^#[0-9a-f]{6}$/i.test(String(source.subtitleColor || ""))
      ? String(source.subtitleColor)
      : "#ffffff";
    settings.subtitleOutline = source.subtitleOutline !== false;
    settings.subtitleFont = CUE_FONTS[source.subtitleFont] ? source.subtitleFont : "sans";
    settings.subtitleBackground = source.subtitleBackground !== false;
    return settings;
  }

  function qualityLabel(level) {
    return QUALITY_LABELS[level] || String(level || "Auto");
  }

  /*
   * Google Drive enforces Trusted Types (require-trusted-types-for 'script'),
   * which makes innerHTML/DOMParser throw for plain strings. The page allows
   * creating a policy, so the markup goes through one when available; the local
   * player has no such restriction and simply parses the string.
   */
  var htmlPolicy = null;
  var htmlPolicyTried = false;

  function trustedHtml(html) {
    if (!htmlPolicyTried) {
      htmlPolicyTried = true;
      try {
        if (window.trustedTypes && typeof trustedTypes.createPolicy === "function") {
          if (typeof trustedTypes.getPolicy === "function") {
            htmlPolicy = trustedTypes.getPolicy("driveplay");
          }
          if (!htmlPolicy) {
            htmlPolicy = trustedTypes.createPolicy("driveplay", {
              createHTML: function (value) { return String(value); }
            });
          }
        }
      } catch (error) {
        htmlPolicy = null;
      }
    }
    if (!htmlPolicy) return null;
    try {
      return htmlPolicy.createHTML(html);
    } catch (error) {
      return null;
    }
  }

  function parseHtml(html) {
    try {
      var safe = trustedHtml("<div>" + html + "</div>");
      if (!safe) return null;
      var doc = new DOMParser().parseFromString(safe, "text/html");
      var wrapper = doc && doc.body ? doc.body.firstChild : null;
      return wrapper ? document.importNode(wrapper, true) : null;
    } catch (error) {
      return null;
    }
  }

  function fillNode(node, html) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    var parsed = parseHtml(html);
    if (!parsed) return;
    while (parsed.firstChild) node.appendChild(parsed.firstChild);
  }

  function buildHtml() {
    return '' +
      '<div class="dp-stage"></div>' +
      '<div class="dp-shade"></div>' +
      '<div class="dp-spinner"><div class="dp-ring"></div></div>' +
      '<div class="dp-center">' +
        '<button class="dp-big" type="button" data-act="toggle" aria-label="Reproduzir">' + ICONS.play + '</button>' +
      '</div>' +
      '<div class="dp-gesture" aria-hidden="true"></div>' +
      '<div class="dp-top">' +
        '<button class="dp-btn" type="button" data-act="close" aria-label="Voltar">' + ICONS.back + '</button>' +
        '<div class="dp-title">' +
          '<span class="dp-title-text"></span>' +
          '<span class="dp-sub"></span>' +
        '</div>' +
      '</div>' +
      '<div class="dp-bottom">' +
        '<div class="dp-seek-row">' +
          '<span class="dp-time" data-cur>0:00</span>' +
          '<input class="dp-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Progresso do vídeo">' +
          '<span class="dp-time" data-dur>0:00</span>' +
        '</div>' +
        '<div class="dp-controls">' +
          '<button class="dp-btn" type="button" data-act="prev" aria-label="Episódio anterior">' + ICONS.prev + '</button>' +
          '<button class="dp-btn dp-text-btn" type="button" data-act="back10" aria-label="Voltar 10 segundos">-10</button>' +
          '<button class="dp-btn dp-btn-primary" type="button" data-act="toggle" aria-label="Reproduzir">' + ICONS.play + '</button>' +
          '<button class="dp-btn dp-text-btn" type="button" data-act="fwd10" aria-label="Avançar 10 segundos">+10</button>' +
          '<button class="dp-btn" type="button" data-act="next" aria-label="Próximo episódio">' + ICONS.next + '</button>' +
          '<div class="dp-extra">' +
            '<button class="dp-chip" type="button" data-act="fill">Preencher</button>' +
            '<button class="dp-btn" type="button" data-act="menu" aria-label="Mais opções">' + ICONS.menu + '</button>' +
          '</div>' +
          '<button class="dp-btn dp-text-btn" type="button" data-act="speed" aria-label="Velocidade">1x</button>' +
          '<button class="dp-btn dp-text-btn" type="button" data-act="quality" aria-label="Qualidade">Auto</button>' +
          '<button class="dp-btn" type="button" data-act="chrome" aria-label="Abrir no navegador">' + ICONS.chrome + '</button>' +
        '</div>' +
      '</div>' +
      '<button class="dp-pill" type="button" data-act="skip" hidden>' + ICONS.skip + '<span></span></button>' +
      '<div class="dp-menu" role="menu"></div>' +
      '<div class="dp-toast" role="status"></div>' +
      '<div class="dp-error" hidden>' +
        '<div class="dp-error-card">' +
          '<div class="dp-error-icon">' + ICONS.screen + '</div>' +
          '<h3>Não foi possível reproduzir</h3>' +
          '<p data-error-text></p>' +
          '<div class="dp-error-actions">' +
            '<button class="dp-chip" type="button" data-act="retry">Tentar novamente</button>' +
            '<button class="dp-chip" type="button" data-act="chrome">Abrir no Chrome</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function create(options) {
    options = options || {};
    var backend = options.backend;
    if (!backend) throw new Error("DPPlayerCore: backend obrigatório");

    var settings = normalizeSettings(options.settings);
    var playlist = Array.isArray(options.playlist) ? options.playlist.slice() : [];
    var title = String(options.title || "Vídeo do Drive");
    var index = toNumber(options.index, 0);
    var fill = options.fill === true || settings.fillScreen === true;
    var cover = options.cover === true;

    var root = document.createElement("div");
    root.id = "dp-root";
    root.className = "dp-root";
    fillNode(root, buildHtml());
    document.body.appendChild(root);

    var stage = root.querySelector(".dp-stage");
    var gesture = root.querySelector(".dp-gesture");
    var titleNode = root.querySelector(".dp-title-text");
    var subNode = root.querySelector(".dp-sub");
    var fillChip = root.querySelector('[data-act="fill"]');
    var playButtons = root.querySelectorAll('[data-act="toggle"]');
    var curNode = root.querySelector("[data-cur]");
    var durNode = root.querySelector("[data-dur]");
    var seekNode = root.querySelector(".dp-seek");
    var speedButton = root.querySelector('[data-act="speed"]');
    var qualityButton = root.querySelector('[data-act="quality"]');
    var prevButton = root.querySelector('[data-act="prev"]');
    var nextButton = root.querySelector('[data-act="next"]');
    var pill = root.querySelector(".dp-pill");
    var pillText = pill.querySelector("span");
    var menu = root.querySelector(".dp-menu");
    var toastNode = root.querySelector(".dp-toast");
    var errorNode = root.querySelector(".dp-error");
    var errorText = root.querySelector("[data-error-text]");

    var destroyed = false;
    var ready = false;
    var visible = true;
    var dragging = false;
    var lastActivity = Date.now();
    var lastSignature = "";
    var lastSavedTick = 0;
    var resumeTarget = null;
    var didSkipIntro = false;
    var didAdvance = false;
    var lastObservedTime = 0;
    var lastPaused = null;
    var lastPausedIcon = null;
    var toastTimer = null;
    var menuKind = "";
    var menuScrollToRestore = -1;
    var tickTimer = null;

    titleNode.textContent = title;
    root.classList.toggle("dp-cover", cover);
    root.classList.toggle("dp-fill", fill);
    updateSubtitle();
    updateFillChip();
    updatePlayIcons();
    applyCueStyle();

    if (playlist.length < 2) {
      prevButton.style.display = "none";
      nextButton.style.display = "none";
    }

    if (options.canOpenExternal === false) {
      var chromeButton = root.querySelector('[data-act="chrome"]');
      if (chromeButton) chromeButton.style.display = "none";
    }

    if (options.canSetQuality === false) {
      qualityButton.style.display = "none";
    }

    if (typeof backend.mount === "function") {
      try {
        backend.mount(stage, root);
      } catch (error) {
        showError("O player não pôde ser iniciado.");
      }
    }

    function updateSubtitle() {
      // The "Episódio X de Y" line was removed at the user's request.
      subNode.textContent = "";
      subNode.hidden = true;
    }

    function updateFillChip() {
      fillChip.textContent = fill ? "Original" : "Preencher";
      fillChip.classList.toggle("dp-active", fill);
    }

    function applyCueStyle() {
      var size = clamp(toNumber(settings.subtitleSize, 1.3), 0.7, 2.4);
      var color = settings.subtitleColor || "#ffffff";
      var font = CUE_FONTS[settings.subtitleFont] || CUE_FONTS.sans;
      root.style.setProperty("--dp-cue-size", String(size));
      root.style.setProperty("--dp-cue-color", color);
      root.style.setProperty("--dp-cue-font", font);
      root.classList.toggle("dp-cue-outline", settings.subtitleOutline !== false);
      root.classList.toggle("dp-cue-bg", settings.subtitleBackground !== false);
    }

    function cueSizeLabel(size) {
      return Math.round(size * 100) + "%";
    }

    function updateCueSetting(key, value) {
      var patch = {};
      if (key === "size") {
        settings.subtitleSize = clamp(toNumber(value, settings.subtitleSize), 0.7, 2.4);
        patch.subtitleSize = settings.subtitleSize;
      } else if (key === "color") {
        settings.subtitleColor = String(value || "#ffffff");
        patch.subtitleColor = settings.subtitleColor;
      } else if (key === "outline") {
        settings.subtitleOutline = value === "1" || value === true;
        patch.subtitleOutline = settings.subtitleOutline;
      } else if (key === "font") {
        settings.subtitleFont = CUE_FONTS[value] ? value : "sans";
        patch.subtitleFont = settings.subtitleFont;
      } else if (key === "bg") {
        settings.subtitleBackground = value === "1" || value === true;
        patch.subtitleBackground = settings.subtitleBackground;
      }
      applyCueStyle();
      if (typeof options.saveSettings === "function") {
        try { options.saveSettings(patch); } catch (error) { /* noop */ }
      }
    }

    function stepCueSize(direction) {
      var current = toNumber(settings.subtitleSize, 1.3);
      var nearest = 0;
      var best = Infinity;
      for (var i = 0; i < CUE_SIZES.length; i++) {
        var delta = Math.abs(CUE_SIZES[i] - current);
        if (delta < best) { best = delta; nearest = i; }
      }
      var next = clamp(nearest + (direction > 0 ? 1 : -1), 0, CUE_SIZES.length - 1);
      updateCueSetting("size", CUE_SIZES[next]);
    }

    function updatePlayIcons() {
      var state = safeState();
      var paused = state.paused !== false;
      if (paused === lastPausedIcon) return;
      lastPausedIcon = paused;
      var html = paused ? ICONS.play : ICONS.pause;
      for (var i = 0; i < playButtons.length; i++) {
        fillNode(playButtons[i], html);
        playButtons[i].setAttribute("aria-label", paused ? "Reproduzir" : "Pausar");
      }
      root.classList.toggle("dp-playing", !paused);
      root.classList.toggle("dp-paused", paused);
    }

    function safeState() {
      try {
        return backend.getState() || {};
      } catch (error) {
        return {};
      }
    }

    function currentTime() {
      return toNumber(safeState().currentTime, 0);
    }

    function duration() {
      return toNumber(safeState().duration, 0);
    }

    function isPaused() {
      return safeState().paused !== false;
    }

    function touch() {
      lastActivity = Date.now();
    }

    function setChrome(next) {
      next = !!next;
      if (next === visible) {
        if (next) touch();
        return;
      }
      visible = next;
      root.classList.toggle("dp-visible", next);
      if (!next) closeMenu();
      if (typeof options.onControls === "function") {
        try { options.onControls(next); } catch (error) { /* noop */ }
      }
      touch();
    }

    function toast(message, timeout) {
      if (!message) return;
      toastNode.textContent = message;
      toastNode.classList.add("dp-show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastNode.classList.remove("dp-show");
      }, timeout || 2400);
    }

    function showError(message) {
      errorText.textContent = message || "Tente novamente ou abra o vídeo no Chrome.";
      errorNode.hidden = false;
      root.classList.remove("dp-ready");
      setChrome(true);
      if (typeof options.onError === "function") {
        try { options.onError(message); } catch (error) { /* noop */ }
      }
    }

    function hideError() {
      errorNode.hidden = true;
    }

    function toggle() {
      touch();
      if (safeState().ended) {
        backend.seek(0);
      }
      if (isPaused()) backend.play();
      else backend.pause();
    }

    function seekBy(seconds) {
      touch();
      var total = duration();
      var next = clamp(currentTime() + seconds, 0, total > 0 ? total - 0.4 : 0);
      backend.seek(next);
      showToastShort(seconds > 0 ? "+" + seconds + " s" : seconds + " s");
    }

    function showToastShort(message) {
      toast(message, 1100);
    }

    function saveProgress(time, total) {
      if (!options.id || !(total > 1)) return;
      try {
        options.saveProgress(options.id, title, time, total);
      } catch (error) { /* noop */ }
      lastSavedTick = time;
    }

    function logNative(message) {
      try {
        if (window.PlayerBridge && typeof PlayerBridge.nativeLog === "function") {
          PlayerBridge.nativeLog(String(message || ""));
        }
      } catch (error) { /* noop */ }
    }

    function finishEpisode() {
      if (didAdvance) return;
      didAdvance = true;
      var total = duration();
      logNative("finish episode at " + Math.round(currentTime()) + "/" + Math.round(total)
        + " autoNext=" + settings.autoNext);
      saveProgress(total, total);
      if (settings.autoNext && typeof options.next === "function") {
        try {
          options.next();
          return;
        } catch (error) { /* noop */ }
      }
      if (total > 0 && currentTime() < total - 1.5) backend.seek(Math.max(total - 0.6, 0));
      setChrome(true);
    }

    function skipIntro() {
      var total = duration();
      if (!(total > settings.introSeconds + 20)) return;
      didSkipIntro = true;
      logNative("skip intro manual at " + Math.round(currentTime()) + " -> "
        + settings.introSeconds);
      backend.seek(settings.introSeconds);
      toast("Abertura pulada");
      updateSkipPill();
    }

    function updateSkipPill() {
      var state = safeState();
      var total = toNumber(state.duration, 0);
      var time = toNumber(state.currentTime, 0);
      var action = "";
      var label = "";

      if (time > settings.introSeconds + 6) didSkipIntro = false;

      if (
        settings.introSeconds >= 5 &&
        total > settings.introSeconds + 20 &&
        time > 0.5 &&
        time < settings.introSeconds + 2 &&
        !didSkipIntro
      ) {
        action = "skipIntro";
        label = "Pular abertura";
      } else if (
        settings.endingSeconds >= 5 &&
        total > settings.endingSeconds + 20 &&
        time >= total - settings.endingSeconds &&
        time < total - 1.5
      ) {
        action = "skipEnding";
        label = "Pular encerramento";
      }

      if (action) {
        pill.hidden = false;
        pill.classList.add("dp-show");
        pill.setAttribute("data-skip", action);
        pillText.textContent = label;
      } else {
        pill.classList.remove("dp-show");
        pill.hidden = true;
        pill.setAttribute("data-skip", "");
      }
    }

    function setFill(next, notify) {
      fill = !!next;
      root.classList.toggle("dp-fill", fill);
      updateFillChip();
      if (typeof backend.setFill === "function") {
        try { backend.setFill(fill); } catch (error) { /* noop */ }
      }
      settings.fillScreen = fill;
      if (notify !== false && typeof options.onFill === "function") {
        try { options.onFill(fill); } catch (error) { /* noop */ }
      }
      touch();
    }

    function setRate(rate) {
      rate = toNumber(rate, 1);
      if (typeof backend.setRate === "function") {
        try { backend.setRate(rate); } catch (error) { /* noop */ }
      }
      speedButton.textContent = (rate === 1 ? "1" : String(rate)) + "x";
      toast("Velocidade " + rate + "x");
      touch();
    }

    function setQuality(level) {
      if (typeof backend.setQuality === "function") {
        try { backend.setQuality(level); } catch (error) { /* noop */ }
      }
      qualityButton.textContent = qualityLabel(level);
      toast("Qualidade: " + qualityLabel(level));
      touch();
    }

    function closeMenu() {
      menu.classList.remove("dp-open");
      menuKind = "";
      while (menu.firstChild) menu.removeChild(menu.firstChild);
    }

    function menuButton(label, action, selected) {
      return '<button type="button" data-menu="' + action + '"' +
        (selected ? ' class="dp-selected"' : "") + ">" +
        "<span>" + label + "</span>" +
        (selected ? '<span class="dp-menu-check">✓</span>' : "") +
        "</button>";
    }

    function openMenu(kind) {
      touch();
      if (menuKind === kind) {
        closeMenu();
        return;
      }
      menuKind = kind;
      var html = "";

      if (kind === "speed") {
        html += '<div class="dp-menu-title">Velocidade</div>';
        var rate = toNumber(safeState().rate, 1);
        for (var i = 0; i < SPEEDS.length; i++) {
          html += menuButton(SPEEDS[i] + "x", "speed:" + SPEEDS[i], Math.abs(rate - SPEEDS[i]) < 0.01);
        }
      } else if (kind === "quality") {
        html += '<div class="dp-menu-title">Qualidade</div>';
        var levels = safeState().qualities || [];
        var currentQuality = safeState().quality || "auto";
        var options2 = ["auto"].concat(levels.filter(function (level) { return level !== "auto"; }));
        for (var j = 0; j < options2.length; j++) {
          html += menuButton(
            qualityLabel(options2[j]),
            "quality:" + options2[j],
            options2[j] === currentQuality
          );
        }
      } else if (kind === "audio") {
        html += '<div class="dp-menu-title">Faixa de áudio</div>';
        var audioTracks = safeState().audio || [];
        for (var a = 0; a < audioTracks.length; a++) {
          html += menuButton(
            audioTracks[a].label || ("Faixa " + (a + 1)),
            "audio:" + audioTracks[a].index,
            audioTracks[a].selected === true
          );
        }
      } else if (kind === "text") {
        html += '<div class="dp-menu-title">Legendas</div>';
        var textTracks = safeState().text || [];
        var anySelected = false;
        for (var t = 0; t < textTracks.length; t++) {
          if (textTracks[t].selected) anySelected = true;
        }
        html += menuButton("Desligadas", "text:-1", !anySelected);
        for (var u = 0; u < textTracks.length; u++) {
          html += menuButton(
            textTracks[u].label || ("Legenda " + (u + 1)),
            "text:" + textTracks[u].index,
            textTracks[u].selected === true
          );
        }
        html += menuButton("Estilo da legenda", "open:cue", false);
      } else if (kind === "cue") {
        var size = toNumber(settings.subtitleSize, 1.3);
        html += '<div class="dp-menu-title">Tamanho — ' + cueSizeLabel(size) + '</div>';
        html += menuButton("Diminuir", "cue:size:-1", false);
        html += menuButton("Aumentar", "cue:size:1", false);
        html += '<div class="dp-menu-title">Cor</div>';
        html += menuButton("Branco", "cue:color:#ffffff", settings.subtitleColor === "#ffffff");
        html += menuButton("Amarelo", "cue:color:#ffe066", settings.subtitleColor === "#ffe066");
        html += menuButton("Ciano", "cue:color:#9be7ff", settings.subtitleColor === "#9be7ff");
        html += '<div class="dp-menu-title">Contorno</div>';
        html += menuButton("Ligado", "cue:outline:1", settings.subtitleOutline !== false);
        html += menuButton("Desligado", "cue:outline:0", settings.subtitleOutline === false);
        html += '<div class="dp-menu-title">Fonte</div>';
        html += menuButton("Padrão", "cue:font:sans", settings.subtitleFont === "sans");
        html += menuButton("Serifada", "cue:font:serif", settings.subtitleFont === "serif");
        html += menuButton("Monoespaçada", "cue:font:mono", settings.subtitleFont === "mono");
        html += '<div class="dp-menu-title">Fundo</div>';
        html += menuButton("Ligado", "cue:bg:1", settings.subtitleBackground !== false);
        html += menuButton("Desligado", "cue:bg:0", settings.subtitleBackground === false);
      } else {
        html += '<div class="dp-menu-title">Player</div>';
        html += menuButton(fill ? "Tamanho original" : "Preencher a tela", "fill", false);
        html += menuButton("Velocidade", "open:speed", false);
        if ((safeState().qualities || []).length > 0 && options.canSetQuality !== false) {
          html += menuButton("Qualidade", "open:quality", false);
        }
        if ((safeState().audio || []).length > 1) {
          html += menuButton("Faixa de áudio", "open:audio", false);
        }
        if ((safeState().text || []).length > 0) {
          html += menuButton("Legendas", "open:text", false);
          html += menuButton("Estilo da legenda", "open:cue", false);
        }
        html += menuButton(
          "Abertura automática · " + settings.introSeconds + " s",
          "toggle:skipIntro",
          settings.skipIntro
        );
        html += menuButton(
          "Encerramento automático · " + settings.endingSeconds + " s",
          "toggle:skipEnding",
          settings.skipEnding
        );
        if (options.canOpenExternal !== false) {
          html += menuButton("Abrir no Chrome", "chrome", false);
        }
        html += menuButton("Fechar player", "close", false);
      }

      fillNode(menu, html);
      menu.classList.add("dp-open");
      if (menuScrollToRestore >= 0) {
        menu.scrollTop = menuScrollToRestore;
        menuScrollToRestore = -1;
      }
      touch();
    }

    function tick() {
      if (destroyed) return;
      var state = safeState();

      if (state.ready && !ready) {
        ready = true;
        root.classList.add("dp-ready");
        hideError();
        if (typeof options.onReady === "function") {
          try { options.onReady(); } catch (error) { /* noop */ }
        }
        resumeTarget = settings.resumePlayback && typeof options.getResume === "function"
          ? toNumber(options.getResume(options.id), 0)
          : 0;
        if (resumeTarget > 5 && resumeTarget < toNumber(state.duration, 0) - 10) {
          backend.seek(resumeTarget);
          toast("Retomando de " + formatTime(resumeTarget));
        } else {
          resumeTarget = 0;
        }
      }

      var total = toNumber(state.duration, 0);
      var time = toNumber(state.currentTime, 0);
      var paused = state.paused !== false;

      if (!dragging && total > 0) {
        var value = clamp(Math.round((time / total) * 1000), 0, 1000);
        seekNode.value = String(value);
        seekNode.style.setProperty("--dp-progress", (value / 10) + "%");
        curNode.textContent = formatTime(time);
        durNode.textContent = formatTime(total);
      } else if (total <= 0) {
        curNode.textContent = formatTime(time);
        durNode.textContent = "0:00";
      }

      updatePlayIcons();
      updateSkipPill();

      if (paused !== lastPaused) {
        lastPaused = paused;
        if (paused && ready) setChrome(true);
      }

      if (ready && !didAdvance) {
        if (Math.abs(time - lastSavedTick) >= 5) saveProgress(time, total);

        var jumped = Math.abs(time - lastObservedTime);
        var crossedIntro = lastObservedTime > 0.5 &&
          lastObservedTime < settings.introSeconds &&
          time >= settings.introSeconds &&
          jumped <= 8;

        if (
          settings.introSeconds >= 5 &&
          total > settings.introSeconds + 20 &&
          ((time > 0.5 && time < settings.introSeconds + 2) || crossedIntro) &&
          settings.skipIntro &&
          !paused &&
          !didSkipIntro
        ) {
          didSkipIntro = true;
          logNative("skip intro auto at " + Math.round(time) + " -> "
            + settings.introSeconds);
          backend.seek(settings.introSeconds);
          toast("Abertura pulada");
        }

        lastObservedTime = time;

        var inEnding =
          settings.endingSeconds >= 5 &&
          total > settings.endingSeconds + 20 &&
          time >= total - settings.endingSeconds;

        if (
          state.ended ||
          (total > 0 && time >= total - 1.2) ||
          (settings.skipEnding && !paused && inEnding)
        ) {
          finishEpisode();
        }
      }

      if (
        settings.autoFullscreen &&
        visible &&
        !menuKind &&
        !paused &&
        !state.ended &&
        Date.now() - lastActivity > 4000
      ) {
        setChrome(false);
      }

      var signature = [
        state.hasVideo !== false,
        Math.round(total),
        Math.round(time),
        paused,
        !!state.ended
      ].join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        if (typeof options.onState === "function") {
          try {
            options.onState(state.hasVideo !== false, total, time, paused, !!state.ended);
          } catch (error) { /* noop */ }
        }
      }
    }

    root.addEventListener("pointerdown", touch, true);
    root.addEventListener("pointermove", touch, { passive: true, capture: true });

    root.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target.closest("[data-act]") : null;
      if (!target) return;
      var act = target.getAttribute("data-act");
      event.preventDefault();
      event.stopPropagation();
      touch();

      if (act === "close") {
        if (typeof options.close === "function") options.close();
        else if (window.PlayerBridge && PlayerBridge.close) PlayerBridge.close();
        return;
      }
      if (act === "toggle") { toggle(); return; }
      if (act === "back10") { seekBy(-10); return; }
      if (act === "fwd10") { seekBy(10); return; }
      if (act === "prev") {
        if (typeof options.previous === "function") options.previous();
        return;
      }
      if (act === "next") {
        if (typeof options.next === "function") options.next();
        return;
      }
      if (act === "fill") { setFill(!fill); return; }
      if (act === "speed") { openMenu("speed"); return; }
      if (act === "quality") { openMenu("quality"); return; }
      if (act === "menu") { openMenu("main"); return; }
      if (act === "chrome") {
        if (typeof options.openExternal === "function") options.openExternal();
        return;
      }
      if (act === "skip") {
        var skip = pill.getAttribute("data-skip");
        if (skip === "skipIntro") skipIntro();
        else if (skip === "skipEnding") finishEpisode();
        return;
      }
      if (act === "retry") {
        hideError();
        if (typeof options.retry === "function") options.retry();
        else if (window.location && window.location.reload) window.location.reload();
        return;
      }
    });

    menu.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target.closest("[data-menu]") : null;
      if (!target) return;
      var action = target.getAttribute("data-menu");
      event.preventDefault();
      event.stopPropagation();
      touch();

      if (action.indexOf("speed:") === 0) {
        setRate(action.slice(6));
        closeMenu();
      } else if (action.indexOf("quality:") === 0) {
        setQuality(action.slice(8));
        closeMenu();
      } else if (action.indexOf("audio:") === 0) {
        if (typeof backend.selectAudio === "function") {
          backend.selectAudio(Number(action.slice(6)));
        }
        closeMenu();
      } else if (action.indexOf("text:") === 0) {
        if (typeof backend.selectText === "function") {
          backend.selectText(Number(action.slice(5)));
        }
        closeMenu();
      } else if (action.indexOf("open:") === 0) {
        openMenu(action.slice(5));
      } else if (action.indexOf("cue:") === 0) {
        var cueParts = action.split(":");
        var cueKey = cueParts[1];
        var cueValue = cueParts[2];
        if (cueKey === "size") {
          stepCueSize(Number(cueValue) || 1);
        } else {
          updateCueSetting(cueKey, cueValue);
        }
        menuScrollToRestore = menu.scrollTop;
        menuKind = "";
        openMenu("cue");
      } else if (action.indexOf("toggle:") === 0) {
        var toggleKey = action.slice(7);
        if (toggleKey === "skipIntro" || toggleKey === "skipEnding") {
          settings[toggleKey] = !settings[toggleKey];
          var togglePatch = {};
          togglePatch[toggleKey] = settings[toggleKey];
          if (typeof options.saveSettings === "function") {
            try { options.saveSettings(togglePatch); } catch (error) { /* noop */ }
          }
          toast(toggleKey === "skipIntro"
            ? (settings.skipIntro ? "Abertura automática ligada" : "Abertura automática desligada")
            : (settings.skipEnding ? "Encerramento automático ligado" : "Encerramento automático desligado"));
          updateSkipPill();
          menuScrollToRestore = menu.scrollTop;
          menuKind = "";
          openMenu("main");
        }
      } else if (action === "fill") {
        setFill(!fill);
        closeMenu();
      } else if (action === "chrome") {
        closeMenu();
        if (typeof options.openExternal === "function") options.openExternal();
      } else if (action === "close") {
        closeMenu();
        if (typeof options.close === "function") options.close();
      }
    });

    var lastPinchAt = 0;
    var pinchStartDistance = 0;
    var pinchTriggered = false;

    function pinchDistance(touches) {
      if (!touches || touches.length < 2) return 0;
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function resetPinch() {
      pinchStartDistance = 0;
      pinchTriggered = false;
    }

    gesture.addEventListener("touchstart", function (event) {
      if (event.touches && event.touches.length === 2) {
        pinchStartDistance = pinchDistance(event.touches);
        pinchTriggered = false;
      }
    }, { passive: true });

    gesture.addEventListener("touchmove", function (event) {
      if (pinchTriggered || pinchStartDistance <= 0) return;
      if (!event.touches || event.touches.length !== 2) return;
      var ratio = pinchDistance(event.touches) / pinchStartDistance;
      if (ratio >= 1.35) {
        pinchTriggered = true;
        lastPinchAt = Date.now();
        if (!fill) {
          setFill(true);
          toast("Tela preenchida");
        }
      } else if (ratio <= 0.72) {
        pinchTriggered = true;
        lastPinchAt = Date.now();
        if (fill) {
          setFill(false);
          toast("Tamanho original");
        }
      }
    }, { passive: true });

    gesture.addEventListener("touchend", resetPinch, { passive: true });
    gesture.addEventListener("touchcancel", resetPinch, { passive: true });

    // Trackpad pinch (Ctrl+wheel) on desktop.
    root.addEventListener("wheel", function (event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (event.deltaY < 0 && !fill) {
        setFill(true);
        toast("Tela preenchida");
      } else if (event.deltaY > 0 && fill) {
        setFill(false);
        toast("Tamanho original");
      }
    }, { passive: false });

    gesture.addEventListener("click", function () {
      if (Date.now() - lastPinchAt < 600) return;
      if (menuKind) {
        closeMenu();
        return;
      }
      setChrome(!visible);
    });

    seekNode.addEventListener("input", function () {
      dragging = true;
      touch();
      var total = duration();
      if (total > 0) {
        var time = (Number(seekNode.value) / 1000) * total;
        curNode.textContent = formatTime(time);
        seekNode.style.setProperty("--dp-progress", (Number(seekNode.value) / 10) + "%");
      }
    });

    function commitSeek() {
      var total = duration();
      if (total > 0) {
        var time = (Number(seekNode.value) / 1000) * total;
        backend.seek(time);
        curNode.textContent = formatTime(time);
      }
      dragging = false;
      touch();
    }

    seekNode.addEventListener("change", commitSeek);
    seekNode.addEventListener("pointerup", commitSeek);

    setChrome(true);
    tickTimer = setInterval(tick, 250);
    tick();

    var api = {
      root: root,
      toast: toast,
      showError: showError,
      hideError: hideError,
      setChrome: setChrome,
      setFill: function (value) { setFill(value, false); },
      setCover: function (value) {
        cover = !!value;
        root.classList.toggle("dp-cover", cover);
      },
      updateSettings: function (json) {
        settings = normalizeSettings(json);
        if (settings.fillScreen !== fill) setFill(settings.fillScreen, false);
        applyCueStyle();
        updateSkipPill();
      },
      pause: function () {
        try { backend.pause(); } catch (error) { /* noop */ }
        setChrome(true);
      },
      resize: function () {
        if (typeof backend.layout === "function") {
          try { backend.layout(); } catch (error) { /* noop */ }
        }
      },
      showEnded: function () {
        setChrome(true);
        toast("Fim da lista de episódios.");
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (tickTimer) clearInterval(tickTimer);
        if (toastTimer) clearTimeout(toastTimer);
        try {
          var total = duration();
          if (ready && total > 1) saveProgress(currentTime(), total);
        } catch (error) { /* noop */ }
        try { backend.destroy(); } catch (error) { /* noop */ }
        if (root && root.parentNode) root.parentNode.removeChild(root);
      },
      state: function () { return safeState(); }
    };

    window.__dpResize = api.resize;
    window.__dpSetChrome = api.setChrome;
    window.__dpSetFill = api.setFill;
    window.__dpSetCover = api.setCover;
    window.__dpPause = api.pause;
    window.__dpShowEnded = api.showEnded;
    window.__dpUpdateSettings = api.updateSettings;
    window.__dpDestroy = api.destroy;

    return api;
  }

  window.DPPlayerCore = { create: create, formatTime: formatTime };
})();
