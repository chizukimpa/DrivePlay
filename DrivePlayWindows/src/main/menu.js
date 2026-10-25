'use strict';

const { app, dialog, Menu } = require('electron');

let mainWindow = null;
let currentSettings = {
  skipIntro: false,
  skipEnding: false,
  autoNext: true,
  resumePlayback: true,
  showSkipButtons: true,
  autoFullscreen: true,
};

function send(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', action);
  }
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Sobre o DrivePlay',
    message: `DrivePlay ${app.getVersion()}`,
    detail:
      'Player de vídeos MKV do Google Drive, com navegação de pastas, ' +
      'biblioteca de temporadas, retomada, pulo de abertura/encerramento e VLC.\n\n' +
      'O Google Drive transcodifica o vídeo no servidor; nenhum codec é instalado. ' +
      'Projeto não afiliado ao Google.',
    buttons: ['OK'],
    noLink: true,
  });
}

function toggleItem(label, key) {
  return {
    label,
    type: 'checkbox',
    checked: !!currentSettings[key],
    click: (item) => send({ type: 'toggle', key, value: !!item.checked }),
  };
}

function buildMenu(win, settings) {
  mainWindow = win;
  if (settings) currentSettings = { ...currentSettings, ...settings };

  const isMac = process.platform === 'darwin';
  const fullscreenAccelerator = isMac ? 'Ctrl+Cmd+F' : 'F11';

  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: 'Sobre o DrivePlay' },
        { type: 'separator' },
        { role: 'services', label: 'Serviços' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar DrivePlay' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { role: 'unhide', label: 'Mostrar todos' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair do DrivePlay' },
      ],
    });
  }

  template.push({
    label: 'Arquivo',
    submenu: [
      {
        label: 'Colar link e reproduzir',
        accelerator: 'CmdOrCtrl+Shift+V',
        click: () => send({ type: 'paste' }),
      },
      {
        label: 'Reproduzir novamente',
        accelerator: 'CmdOrCtrl+R',
        click: () => send({ type: 'reload' }),
      },
      {
        label: 'Abrir no VLC',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => send({ type: 'vlc' }),
      },
      { type: 'separator' },
      {
        label: 'Episódio anterior',
        accelerator: 'CmdOrCtrl+Left',
        click: () => send({ type: 'previous' }),
      },
      {
        label: 'Próximo episódio',
        accelerator: 'CmdOrCtrl+Right',
        click: () => send({ type: 'next' }),
      },
      { type: 'separator' },
      { role: 'quit', label: 'Sair' },
    ],
  });

  template.push({ role: 'editMenu', label: 'Editar' });

  template.push({
    label: 'Exibir',
    submenu: [
      {
        label: 'Biblioteca',
        accelerator: 'CmdOrCtrl+B',
        click: () => send({ type: 'library' }),
      },
      {
        label: 'Tela cheia',
        accelerator: fullscreenAccelerator,
        click: () => send({ type: 'fullscreen' }),
      },
    ],
  });

  template.push({
    label: 'Reprodução',
    submenu: [
      toggleItem('Pular abertura automaticamente', 'skipIntro'),
      toggleItem('Pular encerramento automaticamente', 'skipEnding'),
      toggleItem('Avançar para o próximo episódio', 'autoNext'),
      toggleItem('Retomar de onde parou', 'resumePlayback'),
      toggleItem('Mostrar botões de pular', 'showSkipButtons'),
      toggleItem('Tela cheia do vídeo após 5 s sem atividade', 'autoFullscreen'),
      { type: 'separator' },
      {
        label: 'Configurações de reprodução…',
        accelerator: 'CmdOrCtrl+,',
        click: () => send({ type: 'settings' }),
      },
    ],
  });

  template.push({
    label: 'Ajuda',
    submenu: [
      {
        label: 'Como usar o DrivePlay',
        accelerator: 'F1',
        click: () => send({ type: 'help' }),
      },
      { type: 'separator' },
      {
        label: 'Sobre o DrivePlay',
        click: showAbout,
      },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
