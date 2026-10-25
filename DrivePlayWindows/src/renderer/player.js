import { previewURL } from './drive.js';

let webview = null;
let mode = 'preview';
let handlers = {
  onTick: () => {},
  onLoading: () => {},
  onError: () => {},
  onFullscreen: () => {},
  onNativeEvent: () => {},
};

export function setPlayerHandlers(next) {
  handlers = { ...handlers, ...next };
}

function setMode(next) {
  mode = next === 'native' ? 'native' : 'preview';
  try {
    window.api.setPlayerMode(mode);
  } catch (_) {}
}

export function playerMode() {
  return mode;
}

export function createPlayer(container) {
  if (webview) return webview;

  webview = document.createElement('webview');
  webview.className = 'player-webview';
  webview.setAttribute('preload', window.api.playerPreload);
  webview.setAttribute('partition', 'persist:driveplay');
  webview.setAttribute('webpreferences', 'contextIsolation=yes');
  webview.setAttribute('src', 'about:blank');
  container.appendChild(webview);

  webview.addEventListener('dom-ready', () => {
    try {
      window.api.registerPlayer(webview.getWebContentsId());
      if (window.api.testMode) window.api.setPlayerMuted(true);
    } catch (error) {
      console.error('DrivePlay: não foi possível registrar o player', error);
    }
  });

  webview.addEventListener('ipc-message', (event) => {
    if (event.channel === 'tick' && event.args && event.args[0]) {
      handlers.onTick(event.args[0]);
      return;
    }
    if (event.channel === 'native' && event.args && event.args[0]) {
      handlers.onNativeEvent(event.args[0]);
    }
  });

  webview.addEventListener('did-start-loading', () => {
    handlers.onLoading(true);
  });

  webview.addEventListener('did-stop-loading', () => {
    handlers.onLoading(false);
  });

  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return;
    const description = event.errorDescription || 'Falha ao carregar o player.';
    handlers.onLoading(false);
    handlers.onError(description);
  });

  webview.addEventListener('enter-html-full-screen', () => handlers.onFullscreen(true));
  webview.addEventListener('leave-html-full-screen', () => handlers.onFullscreen(false));

  webview.addEventListener('new-window', (event) => {
    event.preventDefault();
    const url = event.url;
    if (/^https?:\/\//i.test(url)) window.api.openExternal(url);
  });

  return webview;
}

export function playerElement() {
  return webview;
}

export function loadPlayer(id, options = {}) {
  if (!webview) return;

  const desired = options && options.mode === 'preview' ? 'preview' : 'native';
  setMode(desired);

  if (desired === 'preview') {
    webview.src = previewURL(id);
    return;
  }

  const base = window.api.nativePlayerPage;
  if (!base) {
    setMode('preview');
    webview.src = previewURL(id);
    return;
  }

  const params = new URLSearchParams();
  params.set('fileId', String(id || ''));
  params.set('title', String((options && options.title) || 'Vídeo do Drive'));
  params.set('settings', JSON.stringify((options && options.settings) || {}));
  params.set('playlist', JSON.stringify((options && options.playlist) || []));
  params.set('index', String((options && options.index) || 0));
  params.set('resume', String((options && options.resume) || 0));
  params.set('fill', options && options.fill ? '1' : '0');

  webview.src = `${base}?${params.toString()}`;
}

export function reloadPlayer() {
  if (!webview) return;
  webview.reload();
}

export function stopPlayer() {
  setMode('preview');
  if (!webview) return;
  try {
    webview.src = 'about:blank';
  } catch (_) {}
}

export function seekPlayer(seconds) {
  window.api.seekPlayer(seconds);
}

export function setPlayerMuted(muted) {
  if (!webview) return;
  try {
    webview.setAudioMuted(!!muted);
  } catch (_) {}
}

export function focusPlayer() {
  if (!webview) return;
  try {
    webview.focus();
  } catch (_) {}
}
