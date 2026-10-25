'use strict';

const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
  webContents,
} = require('electron');
const fs = require('fs');
const path = require('path');

const { fetchFolder, fetchTitle } = require('./main/drive');
const store = require('./main/store');
const downloads = require('./main/downloads');
const vlc = require('./main/vlc');
const { buildMenu } = require('./main/menu');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('DrivePlay');

function resolveUserData() {
  const override = process.env.DRIVEPLAY_USER_DATA;
  if (override) return path.resolve(override);

  if (!app.isPackaged) {
    return path.join(app.getPath('appData'), 'DrivePlayWindows');
  }

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const portable =
    !!process.env.PORTABLE_EXECUTABLE_DIR ||
    process.argv.includes('--portable') ||
    fs.existsSync(path.join(portableDir, 'portable.txt'));

  return portable ? path.join(portableDir, 'DrivePlayData') : null;
}

try {
  const userData = resolveUserData();
  if (userData) app.setPath('userData', userData);
} catch (_) {}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function driveLinkFromArguments(argv) {
  return (argv || []).find(
    (argument) => /^https?:\/\//i.test(argument) && /drive\.google\.com/i.test(argument)
  ) || null;
}

const launchLink = driveLinkFromArguments(process.argv);

let win = null;
let playerWC = null;
let injectionTimer = null;
let hookedPlayerID = null;
let playerFill = false;

const autoFullscreen = {
  enabled: true,
  active: false,
  suppressed: false,
  timer: null,
  idleSeconds: 5,
};

function checkAutoFullscreen() {
  if (!autoFullscreen.enabled || !autoFullscreen.active || autoFullscreen.suppressed) return;
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
  if (!win.isFocused() || win.isFullScreen()) return;

  let idle = 0;
  try {
    idle = powerMonitor.getSystemIdleTime();
  } catch (_) {
    return;
  }
  if (idle < autoFullscreen.idleSeconds) return;

  win.setFullScreen(true);
  if (!win.isDestroyed()) {
    win.webContents.send('window:fullscreen-changed', true);
  }
}

function startAutoFullscreenWatcher() {
  if (autoFullscreen.timer) return;
  autoFullscreen.timer = setInterval(checkAutoFullscreen, 1000);
}

const INJECT = String.raw`
(() => {
  if (window.__driveplayInstalled) return 'already';
  window.__driveplayInstalled = true;

  function collect(root, out) {
    try {
      root.querySelectorAll('video').forEach(function (video) { out.push(video); });
      root.querySelectorAll('*').forEach(function (element) {
        if (element.shadowRoot) collect(element.shadowRoot, out);
      });
    } catch (error) {}
  }

  function allVideos() {
    const out = [];
    collect(document, out);
    return out;
  }

  function primaryVideo() {
    const list = allVideos();
    let best = null;
    for (let i = 0; i < list.length; i += 1) {
      const video = list[i];
      const duration = isFinite(video.duration) ? video.duration : 0;
      const bestDuration = best && isFinite(best.duration) ? best.duration : 0;
      if (!best || duration > bestDuration) best = video;
    }
    return best;
  }

  function report() {
    const video = primaryVideo();
    const payload = { type: 'tick', href: location.href };
    if (video) {
      payload.video = {
        t: video.currentTime || 0,
        d: isFinite(video.duration) ? video.duration : 0,
        paused: !!video.paused,
        ended: !!video.ended,
        ready: video.readyState || 0
      };
    }
    try {
      window.top.postMessage({ __driveplayTick: payload }, '*');
    } catch (error) {}
  }

  function forward(command) {
    const frames = document.querySelectorAll('iframe');
    for (let i = 0; i < frames.length; i += 1) {
      try {
        frames[i].contentWindow.postMessage({ __driveplay: command }, '*');
      } catch (error) {}
    }
  }

  function apply(command) {
    if (typeof command.fill === 'boolean') {
      setFill(command.fill);
    }
    const video = primaryVideo();
    if (!video) return;
    if (typeof command.seek === 'number' && isFinite(command.seek)) {
      try { video.currentTime = command.seek; } catch (error) {}
    }
    if (command.play === true) {
      try { video.play(); } catch (error) {}
    }
    if (command.pause === true) {
      try { video.pause(); } catch (error) {}
    }
  }

  function setFill(enabled) {
    const old = document.getElementById('__driveplayFill');
    if (!enabled) {
      if (old) old.remove();
      return;
    }
    let style = old;
    if (!style) {
      style = document.createElement('style');
      style.id = '__driveplayFill';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent =
      'html,body{background:#000!important;overflow:hidden!important;}' +
      'video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;' +
      'max-width:none!important;max-height:none!important;object-fit:cover!important;' +
      'z-index:2147483000!important;background:#000!important;}';
  }

  window.__driveplayCmd = function (command) {
    apply(command);
    forward(command);
  };

  window.addEventListener('message', function (event) {
    const command = event && event.data && event.data.__driveplay;
    if (!command) return;
    apply(command);
    forward(command);
  });

  function tryPlay() {
    const video = primaryVideo();
    if (!video || !video.paused) return;
    try {
      video.muted = true;
      const promise = video.play();
      if (promise && promise.then) {
        promise
          .then(function () {
            setTimeout(function () {
              try { video.muted = false; } catch (error) {}
            }, 1200);
          })
          .catch(function () {});
      }
    } catch (error) {}
  }

  setInterval(report, 1000);
  setTimeout(report, 500);
  setTimeout(tryPlay, 800);
  setTimeout(tryPlay, 2500);
  setTimeout(tryPlay, 5000);
  setTimeout(tryPlay, 8000);

  if (window === window.top) {
    let started = false;
    let attempts = 0;

    window.addEventListener('message', function (event) {
      const payload = event && event.data && event.data.__driveplayTick;
      if (payload && payload.video && payload.video.t > 0.2) started = true;
    });

    const autoplayTimer = setInterval(function () {
      attempts += 1;
      if (started || attempts > 20) {
        clearInterval(autoplayTimer);
        return;
      }
      const button = document.querySelector(
        'button[aria-label*="iniciar"], button[aria-label*="Iniciar"], ' +
        'button[aria-label*="Reproduzir"], button[aria-label*="Play"]'
      );
      if (button) {
        try { button.click(); } catch (error) {}
      }
    }, 1000);
  }
})();
`;

function injectPlayerFrames() {
  if (!playerWC || playerWC.isDestroyed()) return;

  let frames = [];
  try {
    frames = playerWC.mainFrame.framesInSubtree;
  } catch (_) {
    return;
  }

  const fillCommand = `window.__driveplayCmd && window.__driveplayCmd({fill:${playerFill}});`;
  for (const frame of frames) {
    frame.executeJavaScript(INJECT).catch(() => {});
    frame.executeJavaScript(fillCommand).catch(() => {});
  }
}

function startInjection() {
  if (injectionTimer) clearInterval(injectionTimer);
  injectionTimer = setInterval(injectPlayerFrames, 1200);
  injectPlayerFrames();
}

function registerPlayer(id) {
  if (!Number.isInteger(id)) return;
  const contents = webContents.fromId(id);
  if (!contents || contents.isDestroyed()) return;
  if (contents.getType() !== 'webview') return;

  playerWC = contents;
  downloads.setPlayer(contents);
  startInjection();

  if (hookedPlayerID === id) return;
  hookedPlayerID = id;

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-frame-finish-load', () => {
    setTimeout(injectPlayerFrames, 300);
  });

  contents.on('destroyed', () => {
    if (playerWC === contents) {
      playerWC = null;
      if (injectionTimer) clearInterval(injectionTimer);
      injectionTimer = null;
    }
  });
}

function seekPlayer(time) {
  const seconds = Number(time);
  if (!isFinite(seconds) || !playerWC || playerWC.isDestroyed()) return;

  let frames = [];
  try {
    frames = playerWC.mainFrame.framesInSubtree;
  } catch (_) {
    return;
  }

  const command = `window.__driveplayCmd && window.__driveplayCmd({seek:${JSON.stringify(seconds)}});`;
  for (const frame of frames) {
    frame.executeJavaScript(command).catch(() => {});
  }
}

function setPlayerFill(enabled) {
  playerFill = !!enabled;
  if (!playerWC || playerWC.isDestroyed()) return;

  let frames = [];
  try {
    frames = playerWC.mainFrame.framesInSubtree;
  } catch (_) {
    return;
  }

  const command = `window.__driveplayCmd && window.__driveplayCmd({fill:${playerFill}});`;
  for (const frame of frames) {
    frame.executeJavaScript(command).catch(() => {});
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  const iconPath = path.join(
    __dirname,
    '..',
    'assets',
    isWin ? 'icon.ico' : 'icon.png'
  );
  const icon = nativeImage.createFromPath(iconPath);

  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0f13',
    title: 'DrivePlay',
    icon: icon.isEmpty() ? undefined : icon,
    show: false,
    autoHideMenuBar: isWin,
    titleBarStyle: isMac ? 'default' : 'hidden',
    titleBarOverlay: isWin
      ? { color: '#16171c', symbolColor: '#c7c9d1', height: 36 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('enter-full-screen', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window:fullscreen-changed', true);
    }
  });

  win.on('leave-full-screen', () => {
    autoFullscreen.suppressed = true;
    if (win && !win.isDestroyed()) {
      win.webContents.send('window:fullscreen-changed', false);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  downloads.setupDownloads(win);
  buildMenu(win, {});

  if (!app.isPackaged && process.env.DRIVEPLAY_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

ipcMain.handle('drive:fetchFolder', async (_event, id) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return { ok: false, error: 'ID de pasta inválido.' };
  }
  return fetchFolder(id);
});

ipcMain.handle('drive:fetchTitle', async (_event, id) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return { ok: false, error: 'ID de arquivo inválido.' };
  }
  return fetchTitle(id);
});

ipcMain.handle('store:load', async (_event, name) => store.load(name));
ipcMain.handle('store:save', async (_event, name, data) => {
  try {
    await store.save(name, data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('clipboard:write', (_event, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (typeof url !== 'string' || !/^(https?|mailto):/i.test(url)) {
    return { ok: false, error: 'Link inválido.' };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('vlc:open', (_event, id) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return { ok: false, error: 'ID inválido.' };
  }
  return vlc.open(id);
});

ipcMain.handle('download:start', (_event, id, filename) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return { ok: false, error: 'ID inválido.' };
  }
  return downloads.start(id, String(filename || ''));
});
ipcMain.handle('download:cancel', () => downloads.cancel());
ipcMain.handle('download:reveal', () => downloads.reveal());

ipcMain.handle('window:fullscreen', (_event, value) => {
  if (!win) return false;
  win.setFullScreen(!!value);
  if (!win.isDestroyed()) {
    win.webContents.send('window:fullscreen-changed', !!value);
  }
  return !!value;
});

ipcMain.on('player:active', (_event, active) => {
  autoFullscreen.active = !!active;
});

ipcMain.on('auto-fullscreen:enabled', (_event, enabled) => {
  const next = !!enabled;
  if (next && !autoFullscreen.enabled) autoFullscreen.suppressed = false;
  autoFullscreen.enabled = next;
});

ipcMain.on('auto-fullscreen:reset', () => {
  autoFullscreen.suppressed = false;
});

ipcMain.on('window:title', (_event, title) => {
  if (win) win.setTitle(String(title || 'DrivePlay'));
});

ipcMain.on('menu:update', (_event, settings) => {
  if (win) buildMenu(win, settings || {});
});

ipcMain.on('player:register', (_event, id) => registerPlayer(id));
ipcMain.on('player:seek', (_event, time) => seekPlayer(time));
ipcMain.on('player:fill', (_event, enabled) => setPlayerFill(enabled));
ipcMain.on('player:mute', (_event, muted) => {
  if (playerWC && !playerWC.isDestroyed()) playerWC.setAudioMuted(!!muted);
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:launchLink', () => launchLink);

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  createWindow();
  startAutoFullscreenWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', (_event, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  const link = driveLinkFromArguments(argv);
  if (link) win.webContents.send('app:openLink', link);
});

app.on('window-all-closed', () => app.quit());
