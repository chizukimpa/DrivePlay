import { previewURL } from './drive.js';

let webview = null;
let handlers = {
  onTick: () => {},
  onLoading: () => {},
  onError: () => {},
  onFullscreen: () => {},
};

export function setPlayerHandlers(next) {
  handlers = { ...handlers, ...next };
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
    const description = event.errorDescription || 'Falha ao carregar o player do Google Drive.';
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

export function loadPlayer(id) {
  if (!webview) return;
  webview.src = previewURL(id);
}

export function reloadPlayer() {
  if (!webview) return;
  webview.reload();
}

export function stopPlayer() {
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
