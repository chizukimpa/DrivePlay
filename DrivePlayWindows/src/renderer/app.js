import { icons, svg } from './icons.js';
import {
  parseTarget,
  folderURL,
  fileViewURL,
  previewURL,
  directURL,
  fileExtension,
  sortFolderEntries,
  sortEpisodes,
  entrySubtitle,
  thumbnailURL,
  escapeHTML,
  formatTime,
  cssEscape,
} from './drive.js';
import {
  normalizeLibrary,
  defaultCollection,
  findCollection,
  aggregateEntries,
  episodeCount,
  sourceVideoCount,
  addSource,
  removeSource,
  moveSource,
  updateSource,
  createCollection,
  renameCollection,
  deleteCollection,
  createDefaultCollection,
} from './library.js';
import {
  DEFAULT_SETTINGS,
  loadAll,
  saveNow,
  saveSoon,
} from './store.js';
import {
  createPlayer,
  setPlayerHandlers,
  loadPlayer,
  reloadPlayer,
  seekPlayer,
  stopPlayer,
  setPlayerMuted,
} from './player.js';

const api = window.api;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  linkText: '',
  currentID: null,
  currentTitle: '',
  isLoading: false,
  errorMessage: null,
  showSidebar: true,
  libraryMode: false,
  selectedEntryID: null,
  folderSearch: '',
  librarySearch: '',
  browser: {
    stack: [],
    cache: new Map(),
    isLoading: false,
    error: null,
  },
  library: { collections: [] },
  selectedCollectionID: null,
  libraryRefreshing: false,
  recents: { folders: [], items: [] },
  progress: {},
  settings: { ...DEFAULT_SETTINGS },
  player: {
    hasVideo: false,
    isReady: false,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    hasEnded: false,
  },
  didResume: false,
  didSkipIntro: false,
  didAdvance: false,
  resumeTarget: null,
  lastSavedTick: 0,
  downloads: { state: 'idle' },
  fullscreen: false,
  modalStack: [],
};

let toastTimer = null;
let menuOutsideHandler = null;
let menuKeyHandler = null;
let popoverOutsideHandler = null;
let browserRequestToken = 0;

// --------------------------------------------------------------- helpers

function currentFolder() {
  return state.browser.stack.length
    ? state.browser.stack[state.browser.stack.length - 1]
    : null;
}

function currentCollection() {
  return findCollection(state.library, state.selectedCollectionID);
}

function ensureSelectedCollection() {
  const exists = state.library.collections.some(
    (collection) => collection.id === state.selectedCollectionID
  );
  if (exists) return currentCollection();
  const fallback = defaultCollection(state.library) || state.library.collections[0];
  state.selectedCollectionID = fallback ? fallback.id : null;
  return fallback || null;
}

function libraryEntries() {
  return aggregateEntries(state.library, state.selectedCollectionID);
}

function folderVideos() {
  const folder = currentFolder();
  if (!folder) return [];
  return sortFolderEntries(folder.entries.filter((entry) => entry.isVideo && !entry.isFolder));
}

function playlistEntries() {
  return state.libraryMode ? libraryEntries() : folderVideos();
}

function activeEntries() {
  if (state.libraryMode) {
    const entries = libraryEntries();
    if (!state.librarySearch) return entries;
    const needle = state.librarySearch.toLocaleLowerCase('pt-BR');
    return entries.filter((entry) => entry.name.toLocaleLowerCase('pt-BR').includes(needle));
  }

  const folder = currentFolder();
  if (!folder) return [];
  let entries = folder.entries;
  if (state.folderSearch) {
    const needle = state.folderSearch.toLocaleLowerCase('pt-BR');
    entries = entries.filter((entry) => entry.name.toLocaleLowerCase('pt-BR').includes(needle));
  }
  return sortFolderEntries(entries);
}

function findEntry(id) {
  if (!id) return null;
  return activeEntries().find((entry) => entry.id === id) || null;
}

function isWatched(id) {
  return !!(state.progress[id] && state.progress[id].watched);
}

function progressFraction(id) {
  const progress = state.progress[id];
  if (!progress || progress.duration <= 1) return 0;
  return Math.min(Math.max(progress.time / progress.duration, 0), 1);
}

function resumeTimeFor(id) {
  const progress = state.progress[id];
  if (!progress || progress.watched || progress.time <= 5) return null;
  if (progress.duration > 0 && progress.time > progress.duration - 15) return null;
  return progress.time;
}

function recordProgress(id, time, duration) {
  if (!id || !(duration > 1)) return;

  const current = state.progress[id] || { time: 0, duration, watched: false };
  if (time < 1 && current.time > 5) return;

  current.duration = duration;
  if (current.watched) {
    current.time = duration;
  } else {
    current.time = Math.min(Math.max(time, 0), duration);
    if (current.time >= duration - 15 || current.time / duration >= 0.95) {
      current.watched = true;
      current.time = duration;
    }
  }

  state.progress[id] = current;
  persistProgress();
  updateRowVisual(id);
}

function markWatched(id, duration) {
  const current = state.progress[id] || { time: duration, duration, watched: true };
  current.watched = true;
  if (duration > 0) {
    current.duration = duration;
    current.time = duration;
  }
  state.progress[id] = current;
  persistProgress();
  updateRowVisual(id);
}

function markUnwatched(id) {
  const current = state.progress[id];
  if (!current) return;
  current.watched = false;
  state.progress[id] = current;
  persistProgress();
  updateRowVisual(id);
}

function resetProgress(id) {
  const current = state.progress[id];
  if (!current) return;
  current.time = 0;
  current.watched = false;
  state.progress[id] = current;
  persistProgress();
  updateRowVisual(id);
}

// ------------------------------------------------------------ persistence

function settingsPayload() {
  return {
    ...state.settings,
    libraryMode: state.libraryMode,
    selectedCollectionID: state.selectedCollectionID,
    showSidebar: state.showSidebar,
  };
}

function persistSettings(immediate = false) {
  state.settings.libraryMode = state.libraryMode;
  state.settings.selectedCollectionID = state.selectedCollectionID;
  state.settings.showSidebar = state.showSidebar;
  const payload = settingsPayload();
  if (immediate) saveNow(api, 'settings', payload);
  else saveSoon(api, 'settings', payload, 180);
  api.updateMenu(payload);
}

function persistLibrary(immediate = true) {
  const data = { collections: state.library.collections };
  if (immediate) saveNow(api, 'library', data);
  else saveSoon(api, 'library', data, 200);
}

function persistProgress() {
  saveSoon(api, 'progress', state.progress, 450);
}

function persistRecents() {
  saveNow(api, 'recents', state.recents);
}

function updateWindowTitle() {
  let title = 'DrivePlay';
  if (state.currentID && state.currentTitle) {
    title = state.currentTitle;
  } else if (state.libraryMode) {
    title = (currentCollection() && currentCollection().name) || 'Biblioteca';
  } else if (currentFolder()) {
    title = currentFolder().name;
  }
  api.setTitle(title);
}

// ---------------------------------------------------------------- toast

function showToast(text) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast">${escapeHTML(text)}</div>`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    const toast = root.querySelector('.toast');
    if (!toast) return;
    toast.classList.add('leaving');
    setTimeout(() => {
      if (root.contains(toast)) toast.remove();
    }, 190);
  }, 2500);
}

// ----------------------------------------------------------------- menus

function closeMenus() {
  const root = $('#menu-root');
  if (!root) return;
  root.innerHTML = '';
  if (menuOutsideHandler) {
    document.removeEventListener('mousedown', menuOutsideHandler, true);
    menuOutsideHandler = null;
  }
  if (menuKeyHandler) {
    document.removeEventListener('keydown', menuKeyHandler, true);
    menuKeyHandler = null;
  }
}

function menuItemHTML(item, index) {
  if (item.type === 'separator') return '<div class="menu-sep"></div>';
  if (item.type === 'section') {
    return `<div class="menu-section">${escapeHTML(item.label)}</div>`;
  }

  const classes = ['menu-item'];
  if (item.disabled) classes.push('disabled');

  let leading = '';
  if (item.checked) {
    leading = `<span class="menu-check">${svg('check', 13)}</span>`;
  } else if (item.icon) {
    leading = `<span class="menu-icon">${svg(item.icon, 15)}</span>`;
  } else {
    leading = '<span class="menu-check"></span>';
  }

  const shortcut = item.shortcut
    ? `<span class="menu-shortcut">${escapeHTML(item.shortcut)}</span>`
    : '';
  const arrow = item.submenu
    ? `<span class="menu-icon">${svg('chevronRight', 12)}</span>`
    : '';

  return `<div class="${classes.join(' ')}" data-index="${index}">
    ${leading}
    <span class="menu-label">${escapeHTML(item.label)}</span>
    ${shortcut}
    ${arrow}
  </div>`;
}

function bindMenuClicks(menu, items) {
  menu.addEventListener('click', (event) => {
    const element = event.target.closest('.menu-item');
    if (!element || element.classList.contains('disabled')) return;

    const item = items[Number(element.dataset.index)];
    if (!item) return;

    if (item.submenu) {
      event.stopPropagation();
      openSubmenu(element, item.submenu);
      return;
    }

    closeMenus();
    if (typeof item.action === 'function') item.action();
  });
}

function positionMenu(menu, left, top) {
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  const clampedTop = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  menu.style.left = `${clampedLeft}px`;
  menu.style.top = `${clampedTop}px`;
}

function showMenu(items, options = {}) {
  closeMenus();

  const menu = document.createElement('div');
  menu.className = 'menu';
  if (options.width) menu.style.minWidth = `${options.width}px`;
  menu.innerHTML = items.map(menuItemHTML).join('');
  $('#menu-root').appendChild(menu);

  let left = options.x || 8;
  let top = options.y || 8;

  if (options.anchor) {
    const rect = options.anchor.getBoundingClientRect();
    left = options.alignRight ? rect.right - menu.offsetWidth : rect.left;
    top = rect.bottom + 6;
    if (top + menu.offsetHeight > window.innerHeight - 8) {
      top = rect.top - menu.offsetHeight - 6;
    }
  }

  positionMenu(menu, left, top);
  bindMenuClicks(menu, items);

  menuOutsideHandler = (event) => {
    if (!event.target.closest('.menu')) closeMenus();
  };
  document.addEventListener('mousedown', menuOutsideHandler, true);

  menuKeyHandler = (event) => {
    if (event.key === 'Escape') closeMenus();
  };
  document.addEventListener('keydown', menuKeyHandler, true);

  return menu;
}

function openSubmenu(parentItem, items) {
  const existing = $('#menu-root .menu.submenu');
  if (existing) existing.remove();

  const child = document.createElement('div');
  child.className = 'menu submenu';
  child.style.zIndex = '2001';
  child.innerHTML = items.map(menuItemHTML).join('');
  $('#menu-root').appendChild(child);

  const rect = parentItem.getBoundingClientRect();
  let left = rect.right + 3;
  if (left + child.offsetWidth > window.innerWidth - 8) {
    left = rect.left - child.offsetWidth - 3;
  }
  const top = rect.top - 5;
  positionMenu(child, left, top);
  bindMenuClicks(child, items);

  const parentMenu = parentItem.closest('.menu');
  let closeTimer = null;

  const scheduleClose = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!child.matches(':hover')) child.remove();
    }, 220);
  };

  parentMenu.addEventListener('mouseleave', (event) => {
    if (child.contains(event.relatedTarget)) return;
    scheduleClose();
  });

  child.addEventListener('mouseleave', (event) => {
    if (parentItem.contains(event.relatedTarget)) return;
    scheduleClose();
  });

  parentMenu.addEventListener('mouseover', (event) => {
    const element = event.target.closest('.menu-item');
    if (!element || element === parentItem) return;
    if (closeTimer) clearTimeout(closeTimer);
    child.remove();
  });
}

function showSectionedMenu(sections, options = {}) {
  const items = [];
  for (const section of sections) {
    if (section.type === 'section') {
      items.push({ type: 'section', label: section.label });
    } else if (section.type === 'separator') {
      items.push({ type: 'separator' });
    } else if (Array.isArray(section.items)) {
      items.push(...section.items);
    } else {
      items.push(section);
    }
  }
  return showMenu(items, options);
}

// --------------------------------------------------------------- popover

function closePopover() {
  const root = $('#popover-root');
  if (root) root.innerHTML = '';
  if (popoverOutsideHandler) {
    document.removeEventListener('mousedown', popoverOutsideHandler, true);
    popoverOutsideHandler = null;
  }
}

function showSettingsPopover(anchor) {
  const root = $('#popover-root');
  if (root.childElementCount > 0) {
    closePopover();
    return;
  }
  closeMenus();

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.innerHTML = settingsPopoverHTML();
  root.appendChild(popover);

  const rect = anchor ? anchor.getBoundingClientRect() : null;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let left = rect ? rect.left + rect.width / 2 - width / 2 : window.innerWidth - width - 20;
  let top = rect ? rect.top - height - 8 : window.innerHeight - height - 70;
  if (top < 8) top = rect ? rect.bottom + 8 : 20;
  popover.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  popover.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;

  bindSettingsPopover(popover);

  popoverOutsideHandler = (event) => {
    if (!event.target.closest('.popover') && !event.target.closest('#skip-settings')) {
      closePopover();
    }
  };
  document.addEventListener('mousedown', popoverOutsideHandler, true);
}

function settingsPopoverHTML() {
  const settings = state.settings;
  return `
    <div class="popover-title">Reprodução</div>

    ${toggleRowHTML('skipIntro', 'Pular abertura automaticamente', settings.skipIntro)}
    ${stepperRowHTML('introSeconds', 'Duração da abertura', settings.introSeconds, 5, 300, 5, !settings.skipIntro)}

    <div class="popover-divider"></div>

    ${toggleRowHTML('skipEnding', 'Pular encerramento automaticamente', settings.skipEnding)}
    ${stepperRowHTML('endingSeconds', 'Encerramento (últimos)', settings.endingSeconds, 30, 600, 15, !settings.skipEnding)}

    <div class="popover-divider"></div>

    ${toggleRowHTML('autoNext', 'Avançar para o próximo episódio', settings.autoNext)}
    ${toggleRowHTML('resumePlayback', 'Retomar de onde parou', settings.resumePlayback)}
    ${toggleRowHTML('showSkipButtons', 'Mostrar botões de pular', settings.showSkipButtons)}

    <div class="popover-note">As escolhas ficam salvas. O botão “Pular” na barra inferior indica quando o pulo automático está ativo.</div>
  `;
}

function toggleRowHTML(key, label, value) {
  return `<div class="toggle-row" data-toggle-row="${key}">
    <span>${escapeHTML(label)}</span>
    <button type="button" class="switch ${value ? 'on' : ''}" data-toggle="${key}" aria-pressed="${value ? 'true' : 'false'}"></button>
  </div>`;
}

function stepperRowHTML(key, label, value, minimum, maximum, step, disabled) {
  return `<div class="stepper-row ${disabled ? 'disabled' : ''}" data-stepper-row="${key}">
    <span>${escapeHTML(label)}</span>
    <div class="stepper">
      <button type="button" data-step="${key}" data-delta="${-step}" ${disabled ? 'disabled' : ''}>−</button>
      <span class="stepper-value" data-stepper-value="${key}">${Math.round(value)} s</span>
      <button type="button" data-step="${key}" data-delta="${step}" ${disabled ? 'disabled' : ''}>+</button>
    </div>
  </div>`;
}

function bindSettingsPopover(popover) {
  $$('[data-toggle]', popover).forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      const value = !state.settings[key];
      state.settings[key] = value;
      button.classList.toggle('on', value);
      button.setAttribute('aria-pressed', value ? 'true' : 'false');
      persistSettings();
      updateStepperState(popover);
      updateSkipButtons();
      updateSkipSettingsButton();
    });
  });

  $$('[data-step]', popover).forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.step;
      const delta = Number(button.dataset.delta);
      const ranges = {
        introSeconds: { min: 5, max: 300, fallback: 90 },
        endingSeconds: { min: 30, max: 600, fallback: 180 },
      };
      const range = ranges[key];
      if (!range) return;
      const current = Number(state.settings[key]) || range.fallback;
      state.settings[key] = Math.min(Math.max(current + delta, range.min), range.max);
      const valueElement = popover.querySelector(`[data-stepper-value="${key}"]`);
      if (valueElement) valueElement.textContent = `${Math.round(state.settings[key])} s`;
      persistSettings();
      updateSkipButtons();
    });
  });
}

function updateStepperState(popover) {
  const introRow = popover.querySelector('[data-stepper-row="introSeconds"]');
  const endingRow = popover.querySelector('[data-stepper-row="endingSeconds"]');
  if (introRow) {
    introRow.classList.toggle('disabled', !state.settings.skipIntro);
    $$('button', introRow).forEach((button) => {
      button.disabled = !state.settings.skipIntro;
    });
  }
  if (endingRow) {
    endingRow.classList.toggle('disabled', !state.settings.skipEnding);
    $$('button', endingRow).forEach((button) => {
      button.disabled = !state.settings.skipEnding;
    });
  }
}

// ---------------------------------------------------------------- modals

function openModal(options = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const panel = document.createElement('div');
  panel.className = `modal ${options.widthClass || 'medium'}`;
  if (options.className) panel.classList.add(options.className);

  if (options.header !== false) {
    panel.innerHTML = `<div class="modal-head">
      <div class="modal-head-text">
        <div class="modal-title">${escapeHTML(options.title || '')}</div>
        ${options.subtitle ? `<div class="modal-sub">${escapeHTML(options.subtitle)}</div>` : ''}
      </div>
      <button type="button" class="modal-close" data-modal-close title="Fechar">${svg('xmark', 13)}</button>
    </div>`;
  }

  if (options.body) {
    const body = document.createElement('div');
    body.className = options.bodyClass || 'modal-body';
    body.innerHTML = options.body;
    panel.appendChild(body);
  }

  const actions = Array.isArray(options.actions) ? options.actions : [];
  if (actions.length > 0) {
    const actionsElement = document.createElement('div');
    actionsElement.className = 'modal-actions';
    actions.forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.className || 'secondary-btn';
      button.dataset.actionIndex = String(index);
      button.textContent = action.label;
      if (action.disabled) button.disabled = true;
      actionsElement.appendChild(button);
    });
    panel.appendChild(actionsElement);
  }

  backdrop.appendChild(panel);
  $('#modal-root').appendChild(backdrop);

  function close() {
    if (!backdrop.parentNode) return;
    backdrop.remove();
    state.modalStack = state.modalStack.filter((entry) => entry.backdrop !== backdrop);
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop && options.dismissOnBackdrop !== false) close();
  });

  panel.addEventListener('mousedown', (event) => event.stopPropagation());

  const closeButton = panel.querySelector('[data-modal-close]');
  if (closeButton) closeButton.addEventListener('click', close);

  const actionButtons = $$('[data-action-index]', panel);
  actionButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const action = actions[Number(button.dataset.actionIndex)];
      if (!action) return;

      if (typeof action.action === 'function') {
        let result;
        try {
          result = action.action(panel, close);
        } catch (error) {
          console.error(error);
          return;
        }

        if (result && typeof result.then === 'function') {
          const resolved = await result;
          if (resolved === false) return;
        } else if (result === false) {
          return;
        }
      }

      if (action.close !== false) close();
    });
  });

  const entry = { backdrop, panel, close };
  state.modalStack.push(entry);

  if (typeof options.onMount === 'function') {
    options.onMount(panel, close, actions, actionButtons);
  }

  setTimeout(() => {
    const input = panel.querySelector('input, textarea');
    if (input) input.focus();
    else {
      const primary = panel.querySelector('.modal-actions .primary-btn');
      if (primary) primary.focus();
    }
  }, 30);

  return entry;
}

function showAlert(title, message, buttons = null) {
  const list = buttons && buttons.length
    ? buttons
    : [{ label: 'OK', className: 'primary-btn' }];

  return openModal({
    title,
    body: `<div class="modal-message">${escapeHTML(message)}</div>`,
    widthClass: 'small',
    actions: list,
  });
}

function showPrompt(options) {
  const initial = options.initial || '';
  const entry = openModal({
    title: options.title,
    subtitle: options.message,
    body: `<input class="modal-input" id="prompt-input" type="text" placeholder="${escapeHTML(options.placeholder || '')}" value="${escapeHTML(initial)}" autocomplete="off">`,
    widthClass: 'small',
    actions: [
      { label: 'Cancelar', className: 'secondary-btn' },
      {
        label: options.actionTitle || 'Salvar',
        className: 'primary-btn',
        action: (panel) => {
          const input = panel.querySelector('#prompt-input');
          const value = input ? input.value.trim() : '';
          if (!value) {
            if (input) input.focus();
            return false;
          }
          options.onConfirm(value);
          return true;
        },
      },
    ],
    onMount: (panel, close, actions, buttons) => {
      const input = panel.querySelector('#prompt-input');
      if (!input) return;
      const primary = buttons[1];
      if (primary) primary.disabled = !input.value.trim();
      input.addEventListener('input', () => {
        if (primary) primary.disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const primary = buttons[1];
          if (primary && !primary.disabled) primary.click();
        }
      });
      if (initial) {
        setTimeout(() => {
          input.focus();
          input.select();
        }, 40);
      }
    },
  });
  return entry;
}

const isMacPlatform = api.platform === 'darwin';
const modLabel = isMacPlatform ? '⌘' : 'Ctrl';
const fullscreenLabel = isMacPlatform ? '⌃⌘F' : 'F11';

// --------------------------------------------------------------- rendering

function renderAll() {
  renderHeader();
  renderSidebar();
  renderContent();
  renderFooter();
  updateWindowTitle();
}

function renderHeader() {
  const input = $('#link-input');
  if (input && input.value !== state.linkText) input.value = state.linkText;

  const clear = $('#clear-link');
  if (clear) clear.classList.toggle('hidden', !state.linkText);

  const toggle = $('#toggle-sidebar');
  if (toggle) {
    toggle.classList.toggle('hidden', !(currentFolder() || state.libraryMode));
    toggle.classList.toggle('active', state.showSidebar);
  }

  const libraryToggle = $('#library-toggle');
  if (libraryToggle) libraryToggle.classList.toggle('active', state.libraryMode);

  updateSidebarVisibility();
}

function updateSidebarVisibility() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  const visible = state.showSidebar && (currentFolder() || state.libraryMode);
  sidebar.classList.toggle('hidden', !visible);
}

function renderSidebar() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;

  const visible = state.showSidebar && (currentFolder() || state.libraryMode);
  sidebar.classList.toggle('hidden', !visible);
  if (!visible) return;

  if (state.libraryMode) renderLibrarySidebar(sidebar);
  else renderFolderSidebar(sidebar);
}

function renderFolderSidebar(sidebar) {
  const folder = currentFolder();
  if (!folder) {
    sidebar.innerHTML = '';
    return;
  }

  const canGoBack = state.browser.stack.length > 1;

  sidebar.innerHTML = `
    <div class="sidebar-head">
      ${canGoBack ? `<button type="button" class="icon-btn tiny" id="folder-back" title="Voltar para a pasta anterior">${svg('chevronLeft', 14)}</button>` : ''}
      <div class="sidebar-titles">
        <div class="sidebar-title" title="${escapeHTML(folder.name)}">${escapeHTML(folder.name)}</div>
        <div class="sidebar-sub">${folder.entries.length} ${folder.entries.length === 1 ? 'item' : 'itens'}</div>
      </div>
      <div class="head-actions">
        <button type="button" class="icon-btn tiny" id="folder-bookmark" title="Adicionar esta pasta à biblioteca">${svg('bookmark', 14)}</button>
        <button type="button" class="icon-btn tiny" id="folder-refresh" title="Atualizar pasta">${svg('refresh', 14)}</button>
        <button type="button" class="icon-btn tiny" id="folder-close" title="Fechar pasta">${svg('xmark', 12)}</button>
      </div>
    </div>

    <div class="search-bar">
      <span class="search-icon">${svg('search', 13)}</span>
      <input id="folder-search" type="text" placeholder="Buscar episódio…" autocomplete="off" spellcheck="false" value="${escapeHTML(state.folderSearch)}">
      <button type="button" id="folder-search-clear" class="clear-btn ${state.folderSearch ? '' : 'hidden'}" title="Limpar busca">×</button>
    </div>

    ${state.browser.isLoading ? '<div class="loading-bar"></div>' : ''}
    ${state.browser.error ? `<div class="error-banner"><span class="banner-icon">${svg('warning', 12)}</span><span>${escapeHTML(state.browser.error)}</span></div>` : ''}

    <div class="entry-list" id="entry-list"></div>
  `;

  const back = $('#folder-back', sidebar);
  if (back) back.addEventListener('click', goBackFolder);

  const bookmark = $('#folder-bookmark', sidebar);
  if (bookmark) {
    bookmark.addEventListener('click', () => showBookmarkMenu(bookmark));
  }

  const refresh = $('#folder-refresh', sidebar);
  if (refresh) refresh.addEventListener('click', reloadFolder);

  const close = $('#folder-close', sidebar);
  if (close) close.addEventListener('click', closeFolder);

  const search = $('#folder-search', sidebar);
  const searchClear = $('#folder-search-clear', sidebar);
  if (search) {
    search.addEventListener('input', () => {
      state.folderSearch = search.value;
      if (searchClear) searchClear.classList.toggle('hidden', !state.folderSearch);
      renderEntryList();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      state.folderSearch = '';
      if (search) {
        search.value = '';
        search.focus();
      }
      searchClear.classList.add('hidden');
      renderEntryList();
    });
  }

  renderEntryList();
}

function renderLibrarySidebar(sidebar) {
  ensureSelectedCollection();
  const collection = currentCollection();
  const collectionCount = state.library.collections.length;
  const entriesCount = episodeCount(state.library, state.selectedCollectionID);

  sidebar.innerHTML = `
    <div class="sidebar-head">
      <div class="sidebar-titles">
        <div class="sidebar-title">Biblioteca</div>
        <div class="sidebar-sub">${collectionCount} ${collectionCount === 1 ? 'coleção' : 'coleções'}</div>
      </div>
      <div class="head-actions">
        <button type="button" class="icon-btn tiny" id="library-new" title="Nova coleção">${svg('plus', 13)}</button>
        <button type="button" class="icon-btn tiny" id="library-options" title="Opções da coleção">${svg('ellipsis', 14)}</button>
        <button type="button" class="icon-btn tiny" id="library-close" title="Voltar para a pasta do Drive">${svg('xmark', 12)}</button>
      </div>
    </div>

    <div class="collection-bar">
      <button type="button" class="collection-picker" id="collection-picker" title="Escolher coleção">
        <span class="picker-icon">${svg('folderFill', 12)}</span>
        <span class="picker-name">${escapeHTML(collection ? collection.name : 'Coleção')}</span>
        <span class="picker-count">${entriesCount} eps</span>
        <span class="picker-chevron">${svg('chevronUpDown', 10)}</span>
      </button>
      <button type="button" class="square-btn" id="library-add" title="Adicionar link à coleção">${svg('plus', 14)}</button>
    </div>

    <div class="search-bar">
      <span class="search-icon">${svg('search', 13)}</span>
      <input id="library-search" type="text" placeholder="Buscar na biblioteca…" autocomplete="off" spellcheck="false" value="${escapeHTML(state.librarySearch)}">
      <button type="button" id="library-search-clear" class="clear-btn ${state.librarySearch ? '' : 'hidden'}" title="Limpar busca">×</button>
    </div>

    ${state.libraryRefreshing ? '<div class="loading-bar"></div>' : ''}

    <div class="entry-list" id="entry-list"></div>
  `;

  const newButton = $('#library-new', sidebar);
  if (newButton) newButton.addEventListener('click', () => createCollectionFlow(false));

  const options = $('#library-options', sidebar);
  if (options) options.addEventListener('click', () => showCollectionOptions(options));

  const close = $('#library-close', sidebar);
  if (close) close.addEventListener('click', () => setLibraryMode(false));

  const picker = $('#collection-picker', sidebar);
  if (picker) picker.addEventListener('click', () => showCollectionPicker(picker));

  const add = $('#library-add', sidebar);
  if (add) add.addEventListener('click', openAddLibraryLink);

  const search = $('#library-search', sidebar);
  const searchClear = $('#library-search-clear', sidebar);
  if (search) {
    search.addEventListener('input', () => {
      state.librarySearch = search.value;
      if (searchClear) searchClear.classList.toggle('hidden', !state.librarySearch);
      renderEntryList();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      state.librarySearch = '';
      if (search) {
        search.value = '';
        search.focus();
      }
      searchClear.classList.add('hidden');
      renderEntryList();
    });
  }

  renderEntryList();
}

function renderEntryList() {
  const list = $('#entry-list');
  if (!list) return;

  const entries = activeEntries();
  const loading = state.libraryMode ? state.libraryRefreshing : state.browser.isLoading;

  if (entries.length === 0) {
    if (loading) {
      list.innerHTML = '<div class="entry-empty"><div class="spinner" style="margin:0 auto 10px"></div>Carregando…</div>';
    } else {
      let message;
      if (state.libraryMode) {
        const collection = currentCollection();
        if (!collection || collection.sources.length === 0) {
          message = 'Adicione uma pasta de temporada';
        } else if (state.librarySearch) {
          message = 'Nada encontrado';
        } else {
          message = 'Nenhum vídeo na coleção';
        }
      } else if (state.folderSearch) {
        message = 'Nada encontrado';
      } else {
        message = 'Pasta vazia';
      }
      list.innerHTML = `<div class="entry-empty">${escapeHTML(message)}</div>`;
    }
    return;
  }

  list.innerHTML = entries.map(entryRowHTML).join('');
  bindEntryList(list);

  requestAnimationFrame(() => {
    const selected = list.querySelector('.entry-row.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  });
}

function entryRowHTML(entry) {
  const kind = entry.isFolder ? 'folder' : entry.isVideo ? 'video' : 'file';
  const selected = state.selectedEntryID === entry.id;
  const watched = isWatched(entry.id);
  const fraction = progressFraction(entry.id);
  const thumbnail = thumbnailURL(entry);

  let visual;
  if (entry.isFolder) {
    visual = `<span class="thumb-placeholder folder">${svg('folderFill', 18)}</span>`;
  } else if (thumbnail) {
    visual = `<img src="${escapeHTML(thumbnail)}" alt="" loading="lazy">`;
  } else {
    visual = `<span class="thumb-placeholder">${svg(entry.isVideo ? 'film' : 'doc', 17)}</span>`;
  }

  const check = watched
    ? `<div class="watched-check">${svg('check', 9)}</div>`
    : '';

  const progress = !watched && fraction > 0.02
    ? `<div class="thumb-progress"><div class="thumb-progress-inner" style="width:${(fraction * 100).toFixed(1)}%"></div></div>`
    : '';

  return `<div class="entry-row ${selected ? 'selected' : ''}" data-entry-id="${escapeHTML(entry.id)}" data-kind="${kind}" tabindex="0" role="button" title="${escapeHTML(entry.name)}">
    <div class="entry-thumb">
      ${visual}
      ${check}
      ${progress}
    </div>
    <div class="entry-text">
      <div class="entry-name">${escapeHTML(entry.name)}</div>
      <div class="entry-sub">${escapeHTML(entrySubtitle(entry))}</div>
    </div>
  </div>`;
}

function bindEntryList(list) {
  list.addEventListener('click', (event) => {
    const row = event.target.closest('.entry-row');
    if (!row) return;
    const entry = findEntry(row.dataset.entryId);
    if (entry) selectEntry(entry);
  });

  list.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.entry-row');
    if (!row) return;
    event.preventDefault();
    const entry = findEntry(row.dataset.entryId);
    if (entry) showEntryContextMenu(entry, event.clientX, event.clientY);
  });

  list.addEventListener('keydown', (event) => {
    const row = event.target.closest('.entry-row');
    if (!row) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const entry = findEntry(row.dataset.entryId);
      if (entry) selectEntry(entry);
      return;
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const entry = findEntry(row.dataset.entryId);
      if (entry) {
        const rect = row.getBoundingClientRect();
        showEntryContextMenu(entry, rect.left + 20, rect.top + 20);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = $$('.entry-row', list);
      const index = rows.indexOf(row);
      const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1;
      const next = rows[Math.max(0, Math.min(nextIndex, rows.length - 1))];
      if (next) next.focus();
    }
  });

  list.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!image || image.tagName !== 'IMG') return;
      const row = image.closest('.entry-row');
      const thumb = image.closest('.entry-thumb');
      if (!row || !thumb) return;
      const kind = row.dataset.kind;
      const icon = kind === 'folder' ? svg('folderFill', 18) : kind === 'video' ? svg('film', 17) : svg('doc', 17);
      image.remove();
      thumb.insertAdjacentHTML(
        'afterbegin',
        `<span class="thumb-placeholder ${kind === 'folder' ? 'folder' : ''}">${icon}</span>`
      );
    },
    true
  );
}

function renderContent() {
  const hasCurrent = !!state.currentID;
  const playerShell = $('#player-shell');
  const idle = $('#idle');

  if (playerShell) playerShell.classList.toggle('hidden', !hasCurrent);
  if (idle) idle.classList.toggle('hidden', hasCurrent);

  if (hasCurrent) {
    updatePlayerOverlays();
    updateSkipButtons();
    return;
  }

  if (state.libraryMode) renderLibraryIdle();
  else if (currentFolder()) renderFolderIdle();
  else renderEmptyState();
}

function renderEmptyState() {
  const idle = $('#idle');
  if (!idle) return;

  const hasRecents = state.recents.folders.length > 0 || state.recents.items.length > 0;
  const error = state.browser.error;

  idle.innerHTML = `
    <div class="idle-inner">
      <div class="empty-hero">
        <div class="empty-hero-icon">${svg('rectangleStack', 40)}</div>
        <h1 class="empty-hero-title">Seus MKV do Drive, sem converter nada</h1>
        <p class="empty-hero-text">Cole o link de uma pasta para ver todos os episódios numa lista, ou o link de um arquivo para tocar direto. O Google Drive transcodifica o vídeo no servidor, então MKV, AVI e outros formatos funcionam — e você ainda pode abrir no VLC com legendas e qualidade original.</p>
        <div class="empty-hero-actions">
          <button type="button" class="primary-btn" id="empty-paste">${svg('copy', 14)}<span>Colar da área de transferência</span></button>
          <button type="button" class="secondary-btn" id="empty-help">${svg('help', 14)}<span>Como usar</span></button>
        </div>
        ${error ? `<div class="error-banner" style="max-width:480px;margin:4px auto 0"><span class="banner-icon">${svg('warning', 12)}</span><span>${escapeHTML(error)}</span></div>` : ''}
        ${hasRecents ? renderRecentList() : ''}
      </div>
    </div>
  `;

  const paste = $('#empty-paste', idle);
  if (paste) paste.addEventListener('click', pasteAndPlay);

  const help = $('#empty-help', idle);
  if (help) help.addEventListener('click', showHelp);

  const clear = $('#recents-clear', idle);
  if (clear) {
    clear.addEventListener('click', () => {
      state.recents = { folders: [], items: [] };
      persistRecents();
      renderContent();
    });
  }

  $$('.recent-row', idle).forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.recentId;
      const isFolder = row.dataset.recentFolder === 'true';
      if (isFolder) {
        openFolder(id);
      } else {
        state.linkText = fileViewURL(id);
        openFile(id, row.dataset.recentTitle || '');
      }
    });

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const id = row.dataset.recentId;
      const isFolder = row.dataset.recentFolder === 'true';
      showMenu(
        [
          {
            label: 'Remover dos recentes',
            icon: 'trash',
            action: () => {
              if (isFolder) removeRecentFolder(id);
              else removeRecentItem(id);
            },
          },
        ],
        { x: event.clientX, y: event.clientY }
      );
    });
  });
}

function renderRecentList() {
  const folders = state.recents.folders;
  const items = state.recents.items;

  const rows = [
    ...folders.map(
      (folder) => `<div class="recent-row" data-recent-id="${escapeHTML(folder.id)}" data-recent-folder="true" data-recent-title="${escapeHTML(folder.title || '')}" role="button" tabindex="0">
        <div class="recent-icon">${svg('folderFill', 15)}</div>
        <div class="recent-text">
          <div class="recent-title">${escapeHTML(folder.title || 'Pasta do Drive')}</div>
          <div class="recent-sub">Pasta</div>
        </div>
        <span class="recent-chevron">${svg('chevronRight', 12)}</span>
      </div>`
    ),
    ...items.map(
      (item) => `<div class="recent-row" data-recent-id="${escapeHTML(item.id)}" data-recent-folder="false" data-recent-title="${escapeHTML(item.title || '')}" role="button" tabindex="0">
        <div class="recent-icon">${svg('film', 15)}</div>
        <div class="recent-text">
          <div class="recent-title">${escapeHTML(item.title || 'Vídeo do Drive')}</div>
          <div class="recent-sub">${escapeHTML(item.id)}</div>
        </div>
        <span class="recent-chevron">${svg('chevronRight', 12)}</span>
      </div>`
    ),
  ].join('');

  return `<div class="recents-wrap">
    <div class="recents-head">
      <span>Recentes</span>
      <button type="button" class="recents-clear" id="recents-clear">Limpar</button>
    </div>
    <div class="recents-card">${rows}</div>
  </div>`;
}

function renderFolderIdle() {
  const idle = $('#idle');
  const folder = currentFolder();
  if (!idle || !folder) return;

  const videos = folderVideos();

  idle.innerHTML = `<div class="idle-inner">
    <div class="idle-icon">${svg('rectangleStack', 44)}</div>
    <h1 class="idle-title">${escapeHTML(folder.name)}</h1>
    ${videos.length === 0
      ? '<p class="idle-text">Nenhum vídeo nesta pasta. Abra uma subpasta na lista ao lado.</p>'
      : `<p class="idle-text">${videos.length} vídeo(s) nesta pasta. Escolha um episódio na lista ao lado.</p>
         <div class="idle-actions"><button type="button" class="primary-btn" id="folder-play-first">${svg('play', 12)}<span>Reproduzir primeiro</span></button></div>`}
    <div class="idle-actions">
      <button type="button" class="secondary-btn" id="folder-add-library">${svg('bookmark', 14)}<span>Adicionar à biblioteca</span></button>
    </div>
  </div>`;

  const playFirst = $('#folder-play-first', idle);
  if (playFirst && videos.length > 0) {
    playFirst.addEventListener('click', () => selectEntry(videos[0]));
  }

  const addLibrary = $('#folder-add-library', idle);
  if (addLibrary) {
    addLibrary.addEventListener('click', () => showBookmarkMenu(addLibrary));
  }
}

function renderLibraryIdle() {
  const idle = $('#idle');
  if (!idle) return;

  ensureSelectedCollection();
  const collection = currentCollection();
  const entries = libraryEntries();
  const sources = collection ? collection.sources.length : 0;

  idle.innerHTML = `<div class="idle-inner">
    <div class="idle-icon">${svg('booksFill', 44)}</div>
    <h1 class="idle-title">${escapeHTML(collection ? collection.name : 'Biblioteca')}</h1>
    ${entries.length === 0
      ? `<p class="idle-text">Adicione o link de uma pasta de temporada ou de um vídeo para começar. Você pode juntar várias temporadas na mesma coleção.</p>
         <div class="idle-actions">
           <button type="button" class="primary-btn" id="library-idle-add">${svg('plus', 13)}<span>Adicionar link</span></button>
           <button type="button" class="secondary-btn" id="library-idle-sources">${svg('sliders', 14)}<span>Gerenciar fontes</span></button>
         </div>`
      : `<p class="idle-text">${entries.length} ${entries.length === 1 ? 'episódio' : 'episódios'} · ${sources} ${sources === 1 ? 'fonte' : 'fontes'}. Escolha um episódio na lista ao lado.</p>
         <div class="idle-actions">
           <button type="button" class="primary-btn" id="library-play-first">${svg('play', 12)}<span>Reproduzir primeiro</span></button>
           <button type="button" class="secondary-btn" id="library-idle-add">${svg('plus', 13)}<span>Adicionar link</span></button>
           <button type="button" class="secondary-btn" id="library-idle-sources">${svg('sliders', 14)}<span>Fontes</span></button>
         </div>`}
  </div>`;

  const playFirst = $('#library-play-first', idle);
  if (playFirst && entries.length > 0) {
    playFirst.addEventListener('click', () => selectEntry(entries[0]));
  }

  const add = $('#library-idle-add', idle);
  if (add) add.addEventListener('click', openAddLibraryLink);

  const sourcesButton = $('#library-idle-sources', idle);
  if (sourcesButton) sourcesButton.addEventListener('click', openManageSources);
}

function renderFooter() {
  const footer = $('#footer');
  if (!footer) return;

  if (!state.currentID) {
    footer.classList.add('hidden');
    footer.innerHTML = '';
    return;
  }

  footer.classList.remove('hidden');

  const title = state.currentTitle || 'Vídeo do Drive';
  const entries = playlistEntries();
  const skipActive = state.settings.skipIntro || state.settings.skipEnding;
  const revealLabel = isMacPlatform ? 'Mostrar no Finder' : 'Mostrar na pasta';

  let download = '';
  if (state.downloads.state === 'downloading') {
    const progress = Math.max(0, Math.min(Number(state.downloads.progress) || 0, 1));
    download = `<div class="download-control">
      <div class="download-progress"><div class="download-progress-inner" style="width:${(progress * 100).toFixed(1)}%"></div></div>
      <span class="download-percent">${Math.round(progress * 100)}%</span>
      <button type="button" class="footer-icon" id="download-cancel" title="Cancelar download">${svg('closeCircle', 13)}</button>
    </div>`;
  } else if (state.downloads.state === 'finished') {
    download = `<button type="button" class="download-label accent" id="download-reveal" title="${escapeHTML(revealLabel)}">${svg('folder', 12)} ${escapeHTML(revealLabel)}</button>`;
  } else if (state.downloads.state === 'failed') {
    download = `<button type="button" class="download-label danger" id="download-failed" title="Ver detalhes do erro">${svg('warning', 12)} Download falhou</button>`;
  } else {
    download = `<button type="button" class="footer-icon" id="download-start" title="Baixar arquivo">${svg('downloadCircle', 15)}</button>`;
  }

  footer.innerHTML = `
    <span class="footer-film">${svg('film', 17)}</span>
    <div class="footer-text">
      <div class="footer-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
      <div class="footer-id" title="${escapeHTML(state.currentID)}">${escapeHTML(state.currentID)}</div>
    </div>

    <div class="footer-spacer"></div>

    ${(currentFolder() || state.libraryMode) ? `<button type="button" class="footer-icon ${state.showSidebar ? 'active' : ''}" id="footer-list" title="${state.showSidebar ? 'Ocultar' : 'Mostrar'} lista de reprodução">${svg('list', 15)}</button>` : ''}

    ${entries.length > 0 ? `
      <button type="button" class="footer-icon" id="footer-prev" title="Episódio anterior (${modLabel}←)">${svg('chevronLeft', 15)}</button>
      <button type="button" class="footer-icon" id="footer-next" title="Próximo episódio (${modLabel}→)">${svg('chevronRight', 15)}</button>
    ` : ''}

    <div class="footer-divider"></div>

    <button type="button" class="skip-settings ${skipActive ? 'active' : ''}" id="skip-settings" title="Pular abertura/encerramento automaticamente">
      ${svg('forwardEnd', 12)}
      <span class="skip-label">${skipActive ? 'Pular ativo' : 'Pular'}</span>
      ${svg('chevronDown', 10)}
    </button>

    ${download}

    <button type="button" class="vlc-btn" id="footer-vlc" title="Abrir no VLC — legendas e qualidade original">${svg('vlc', 12)}<span>VLC</span></button>

    <button type="button" class="footer-icon" id="footer-browser" title="Abrir no navegador">${svg('globe', 15)}</button>
    <button type="button" class="footer-icon" id="footer-copy" title="Copiar link direto">${svg('copy', 15)}</button>
    <button type="button" class="footer-icon" id="footer-reload" title="Recarregar (${modLabel}R)">${svg('refresh', 15)}</button>
    <button type="button" class="footer-icon" id="footer-fullscreen" title="Tela cheia (${fullscreenLabel})">${svg('fullscreen', 15)}</button>
  `;

  const listButton = $('#footer-list', footer);
  if (listButton) listButton.addEventListener('click', toggleSidebar);

  const prev = $('#footer-prev', footer);
  if (prev) prev.addEventListener('click', playPrevious);

  const next = $('#footer-next', footer);
  if (next) next.addEventListener('click', playNext);

  const skip = $('#skip-settings', footer);
  if (skip) skip.addEventListener('click', () => showSettingsPopover(skip));

  const start = $('#download-start', footer);
  if (start) start.addEventListener('click', () => startDownload());

  const cancel = $('#download-cancel', footer);
  if (cancel) cancel.addEventListener('click', cancelDownload);

  const reveal = $('#download-reveal', footer);
  if (reveal) reveal.addEventListener('click', revealDownload);

  const failed = $('#download-failed', footer);
  if (failed) failed.addEventListener('click', showDownloadFailure);

  const vlc = $('#footer-vlc', footer);
  if (vlc) vlc.addEventListener('click', () => openInVLC(state.currentID));

  const browser = $('#footer-browser', footer);
  if (browser) browser.addEventListener('click', () => openInBrowser(state.currentID));

  const copy = $('#footer-copy', footer);
  if (copy) copy.addEventListener('click', () => copyDirectLink(state.currentID));

  const reload = $('#footer-reload', footer);
  if (reload) reload.addEventListener('click', reload);

  const fullscreen = $('#footer-fullscreen', footer);
  if (fullscreen) fullscreen.addEventListener('click', toggleFullScreen);
}

function updateSkipSettingsButton() {
  const button = $('#skip-settings');
  if (!button) return;
  const active = state.settings.skipIntro || state.settings.skipEnding;
  button.classList.toggle('active', active);
  const label = button.querySelector('.skip-label');
  if (label) label.textContent = active ? 'Pular ativo' : 'Pular';
}

function updateSkipButtons() {
  const intro = $('#skip-intro');
  const ending = $('#skip-ending');
  const container = $('#skip-buttons');
  if (!intro || !ending || !container) return;

  const base =
    state.settings.showSkipButtons &&
    !!state.currentID &&
    state.player.hasVideo &&
    !state.player.hasEnded &&
    !state.isLoading &&
    !state.errorMessage;

  const showIntro =
    base &&
    state.settings.introSeconds >= 5 &&
    state.player.duration > state.settings.introSeconds + 20 &&
    state.player.currentTime > 0.8 &&
    state.player.currentTime < state.settings.introSeconds - 1;

  const showEnding =
    base &&
    state.settings.endingSeconds >= 5 &&
    state.player.duration > state.settings.endingSeconds + 20 &&
    state.player.currentTime >= state.player.duration - state.settings.endingSeconds;

  intro.classList.toggle('hidden', !showIntro);
  ending.classList.toggle('hidden', !showEnding);
  container.classList.toggle('hidden', !showIntro && !showEnding);
}

function updatePlayerOverlays() {
  const loading = $('#loading-overlay');
  const error = $('#error-overlay');
  const errorText = $('#error-text');

  if (loading) loading.classList.toggle('hidden', !state.isLoading || !!state.errorMessage);
  if (error) error.classList.toggle('hidden', !state.errorMessage);
  if (errorText) errorText.textContent = state.errorMessage || '';
}

function updateRowVisual(id) {
  if (!id) return;
  const row = document.querySelector(`.entry-row[data-entry-id="${cssEscape(id)}"]`);
  if (!row) return;
  const thumb = row.querySelector('.entry-thumb');
  if (!thumb) return;

  $$('.watched-check, .thumb-progress', thumb).forEach((element) => element.remove());

  if (isWatched(id)) {
    thumb.insertAdjacentHTML('beforeend', `<div class="watched-check">${svg('check', 9)}</div>`);
    return;
  }

  const fraction = progressFraction(id);
  if (fraction > 0.02) {
    thumb.insertAdjacentHTML(
      'beforeend',
      `<div class="thumb-progress"><div class="thumb-progress-inner" style="width:${(fraction * 100).toFixed(1)}%"></div></div>`
    );
  }
}

function updateSelection() {
  $$('.entry-row.selected').forEach((row) => row.classList.remove('selected'));
  if (!state.selectedEntryID) return;
  const row = document.querySelector(`.entry-row[data-entry-id="${cssEscape(state.selectedEntryID)}"]`);
  if (row) row.classList.add('selected');
}

// --------------------------------------------------------------- navegação

async function openFolder(id, autoplayLast = false) {
  if (!id) return;

  state.libraryMode = false;
  state.settings.libraryMode = false;

  if (state.currentID && state.player.duration > 1) {
    recordProgress(state.currentID, state.player.currentTime, state.player.duration);
  }
  if (state.currentID) stopPlayer();

  state.currentID = null;
  state.currentTitle = '';
  state.errorMessage = null;
  state.isLoading = false;
  state.selectedEntryID = null;
  state.showSidebar = true;
  state.settings.showSidebar = true;
  state.linkText = folderURL(id);
  state.folderSearch = '';
  state.settings.lastFolderID = id;

  addRecentFolder(id, '');
  persistSettings();
  persistRecents();
  renderAll();

  const token = ++browserRequestToken;

  if (state.browser.cache.has(id)) {
    const cached = state.browser.cache.get(id);
    if (token !== browserRequestToken) return;
    state.browser.stack = [cached];
    state.browser.isLoading = false;
    state.browser.error = null;
    updateRecentFolderName(id, cached.name);
    state.linkText = folderURL(id);
    persistRecents();
    renderAll();
    selectLastFileIfAny(cached, autoplayLast);
    return;
  }

  state.browser.stack = [];
  state.browser.isLoading = true;
  state.browser.error = null;
  renderAll();

  const result = await api.fetchFolder(id);
  if (token !== browserRequestToken) return;

  if (result && result.ok && result.content) {
    const content = result.content;
    state.browser.cache.set(id, content);
    state.browser.stack = [content];
    state.browser.isLoading = false;
    state.browser.error = null;
    updateRecentFolderName(id, content.name);
    state.linkText = folderURL(id);
    persistRecents();
    renderAll();
    selectLastFileIfAny(content, autoplayLast);
  } else {
    state.browser.isLoading = false;
    state.browser.stack = [];
    state.browser.error =
      (result && result.error) || 'Não foi possível abrir a pasta do Google Drive.';
    renderAll();
  }
}

function selectLastFileIfAny(folder, autoplayLast) {
  const lastID = state.settings.lastFileID;
  if (!lastID || !folder || !Array.isArray(folder.entries)) return;

  const entry = folder.entries.find((item) => item.id === lastID);
  if (!entry) return;

  state.selectedEntryID = entry.id;
  renderSidebar();
  updateSelection();

  if (autoplayLast && entry.isVideo) {
    openFile(entry.id, entry.name);
  }
}

async function openSubfolder(entry) {
  if (!entry || !entry.isFolder) return;

  state.libraryMode = false;
  state.settings.libraryMode = false;
  state.selectedEntryID = null;
  state.folderSearch = '';
  persistSettings();
  renderAll();

  if (state.browser.cache.has(entry.id)) {
    state.browser.stack.push(state.browser.cache.get(entry.id));
    state.browser.isLoading = false;
    state.browser.error = null;
    state.linkText = folderURL(entry.id);
    state.settings.lastFolderID = entry.id;
    addRecentFolder(entry.id, entry.name);
    persistSettings();
    persistRecents();
    renderAll();
    return;
  }

  const token = ++browserRequestToken;
  state.browser.isLoading = true;
  state.browser.error = null;
  renderAll();

  const result = await api.fetchFolder(entry.id);
  if (token !== browserRequestToken) return;

  if (result && result.ok && result.content) {
    const content = result.content;
    state.browser.cache.set(entry.id, content);
    state.browser.stack.push(content);
    state.browser.isLoading = false;
    state.browser.error = null;
    state.linkText = folderURL(entry.id);
    state.settings.lastFolderID = entry.id;
    addRecentFolder(entry.id, content.name);
    persistSettings();
    persistRecents();
    renderAll();
  } else {
    state.browser.isLoading = false;
    state.browser.error =
      (result && result.error) || 'Não foi possível abrir a subpasta.';
    renderSidebar();
  }
}

function goBackFolder() {
  if (state.browser.stack.length <= 1) return;

  state.browser.stack.pop();
  state.browser.error = null;
  state.folderSearch = '';
  state.selectedEntryID = null;

  const folder = currentFolder();
  if (!folder) return;

  state.linkText = folderURL(folder.id);
  state.settings.lastFolderID = folder.id;
  addRecentFolder(folder.id, folder.name);
  persistSettings();
  persistRecents();
  renderAll();
}

function closeFolder() {
  state.browser.stack = [];
  state.browser.error = null;
  state.folderSearch = '';
  state.selectedEntryID = null;
  state.showSidebar = true;
  state.settings.showSidebar = true;
  state.settings.lastFolderID = null;
  persistSettings();
  renderAll();
}

async function reloadFolder() {
  const folder = currentFolder();
  if (!folder) return;

  const token = ++browserRequestToken;
  state.browser.cache.delete(folder.id);
  state.browser.isLoading = true;
  state.browser.error = null;
  renderSidebar();

  const result = await api.fetchFolder(folder.id);
  if (token !== browserRequestToken) return;

  if (result && result.ok && result.content) {
    const content = result.content;
    state.browser.cache.set(folder.id, content);
    state.browser.stack = [content];
    state.browser.isLoading = false;
    state.browser.error = null;
    state.linkText = folderURL(content.id);
    state.settings.lastFolderID = content.id;
    addRecentFolder(content.id, content.name);
    persistSettings();
    persistRecents();
    renderAll();
  } else {
    state.browser.isLoading = false;
    state.browser.error =
      (result && result.error) || 'Não foi possível atualizar a pasta.';
    renderSidebar();
  }
}

function selectEntry(entry) {
  if (!entry) return;

  if (entry.isFolder) {
    state.libraryMode = false;
    state.settings.libraryMode = false;
    state.selectedEntryID = null;
    persistSettings();
    openSubfolder(entry);
    return;
  }

  if (entry.isVideo) {
    state.selectedEntryID = entry.id;
    updateSelection();
    openFile(entry.id, entry.name);
    return;
  }

  api.openExternal(fileViewURL(entry.id));
}

async function openFile(id, title = '') {
  if (!id) return;

  if (state.currentID && state.currentID !== id && state.player.duration > 1) {
    recordProgress(state.currentID, state.player.currentTime, state.player.duration);
  }

  const recent = state.recents.items.find((item) => item.id === id);
  const knownTitle = title || (recent && recent.title) || '';

  state.currentID = id;
  state.currentTitle = knownTitle || 'Carregando informações…';
  state.errorMessage = null;
  state.isLoading = true;
  state.selectedEntryID = id;

  state.didResume = false;
  state.didSkipIntro = false;
  state.didAdvance = false;
  state.lastSavedTick = 0;
  state.resumeTarget = state.settings.resumePlayback ? resumeTimeFor(id) : null;

  state.player.hasVideo = false;
  state.player.isReady = false;
  state.player.duration = 0;
  state.player.currentTime = 0;
  state.player.isPlaying = false;
  state.player.hasEnded = false;

  state.settings.lastFileID = id;
  addRecentItem(id, knownTitle);
  persistSettings();
  persistRecents();

  const input = $('#link-input');
  if (input && document.activeElement === input) input.blur();

  loadPlayer(id);
  renderAll();

  try {
    const result = await api.fetchTitle(id);
    if (!result || !result.ok || !result.title) return;
    if (state.currentID !== id) return;
    state.currentTitle = result.title;
    updateRecentItemTitle(id, result.title);
    renderFooter();
    updateWindowTitle();
  } catch (_) {
    // Título é opcional; o vídeo continua tocando.
  }
}

function openFromLink(text) {
  const target = parseTarget(text);
  if (!target) return false;

  if (target.kind === 'file') openFile(target.id);
  else openFolder(target.id);
  return true;
}

function openFromField() {
  const target = parseTarget(state.linkText);
  if (!target) {
    showAlert(
      'Link inválido',
      'Cole um link de pasta ou de arquivo do Google Drive, por exemplo:\n' +
        'https://drive.google.com/drive/folders/ID_DA_PASTA\n' +
        'https://drive.google.com/file/d/ID_DO_ARQUIVO/view'
    );
    const input = $('#link-input');
    if (input) input.focus();
    return;
  }

  if (target.kind === 'file') openFile(target.id);
  else openFolder(target.id);
}

async function pasteAndPlay() {
  let text = '';
  try {
    text = await api.readClipboard();
  } catch (_) {
    text = '';
  }

  const target = parseTarget(text);
  if (!target) {
    const input = $('#link-input');
    if (input) input.focus();
    showAlert(
      'Nada para colar',
      'Copie o link de uma pasta ou de um arquivo no Google Drive e tente novamente.'
    );
    return;
  }

  state.linkText = String(text || '').trim();
  renderHeader();
  if (target.kind === 'file') openFile(target.id);
  else openFolder(target.id);
}

function toggleSidebar() {
  state.showSidebar = !state.showSidebar;
  state.settings.showSidebar = state.showSidebar;
  persistSettings();
  closeMenus();
  renderHeader();
  renderSidebar();
  renderFooter();
}

// --------------------------------------------------------------- biblioteca

function setLibraryMode(value) {
  state.libraryMode = !!value;
  state.settings.libraryMode = state.libraryMode;

  if (state.libraryMode) {
    state.showSidebar = true;
    state.settings.showSidebar = true;
    ensureSelectedCollection();
  }

  persistSettings();
  renderAll();
}

function addCurrentFolder(collectionID) {
  const folder = currentFolder();
  const collection = findCollection(state.library, collectionID);
  if (!folder || !collection) return;

  const added = addSource(
    state.library,
    collectionID,
    'folder',
    folder.id,
    folder.name,
    folder.entries
  );

  persistLibrary();
  showToast(
    added
      ? `“${folder.name}” adicionada a ${collection.name}`
      : `Essa pasta já está em ${collection.name}`
  );
  renderSidebar();
}

function createCollectionFlow(addFolderAfter = false) {
  const folder = addFolderAfter ? currentFolder() : null;

  showPrompt({
    title: 'Nova coleção',
    message:
      'Dê um nome para a coleção (por exemplo, o nome do anime). Você pode adicionar várias temporadas dentro dela.',
    placeholder: 'Nome da coleção',
    actionTitle: 'Criar',
    onConfirm: (name) => {
      const id = createCollection(state.library, name);
      state.selectedCollectionID = id;
      state.settings.selectedCollectionID = id;

      if (addFolderAfter && folder) {
        addSource(state.library, id, 'folder', folder.id, folder.name, folder.entries);
        showToast('Pasta adicionada à nova coleção');
      } else {
        showToast('Coleção criada');
      }

      persistLibrary();
      persistSettings();
      renderAll();
    },
  });
}

function renameCollectionFlow(collectionID) {
  const collection = findCollection(state.library, collectionID);
  if (!collection) return;

  showPrompt({
    title: 'Renomear coleção',
    message: 'Escolha um novo nome para a coleção.',
    placeholder: 'Nome da coleção',
    actionTitle: 'Salvar',
    initial: collection.name,
    onConfirm: (name) => {
      if (renameCollection(state.library, collectionID, name)) {
        persistLibrary();
        showToast('Coleção renomeada');
        renderAll();
      }
    },
  });
}

function deleteCollectionFlow(collectionID) {
  const collection = findCollection(state.library, collectionID);
  if (!collection || collection.isDefault) return;

  showAlert(
    'Excluir coleção?',
    `A coleção “${collection.name}” e suas fontes serão removidas da biblioteca. Os vídeos continuam no Google Drive.`,
    [
      { label: 'Cancelar', className: 'secondary-btn' },
      {
        label: 'Excluir',
        className: 'secondary-btn danger',
        action: () => {
          if (deleteCollection(state.library, collectionID)) {
            ensureSelectedCollection();
            persistLibrary();
            persistSettings();
            showToast('Coleção excluída');
            renderAll();
          }
        },
      },
    ]
  );
}

function showCollectionOptions(anchor) {
  const collection = currentCollection();
  if (!collection) return;

  showMenu(
    [
      {
        label: 'Gerenciar fontes…',
        icon: 'sliders',
        action: openManageSources,
      },
      {
        label: 'Renomear coleção…',
        icon: 'doc',
        action: () => renameCollectionFlow(collection.id),
      },
      { type: 'separator' },
      {
        label: 'Excluir coleção',
        icon: 'trash',
        disabled: collection.isDefault,
        action: () => deleteCollectionFlow(collection.id),
      },
    ],
    { anchor, alignRight: true }
  );
}

function showCollectionPicker(anchor) {
  const items = state.library.collections.map((collection) => ({
    label: collection.name,
    checked: collection.id === state.selectedCollectionID,
    action: () => {
      state.selectedCollectionID = collection.id;
      state.settings.selectedCollectionID = collection.id;
      persistSettings();
      renderAll();
    },
  }));

  items.push({ type: 'separator' });
  items.push({
    label: 'Nova coleção…',
    icon: 'plus',
    action: () => createCollectionFlow(false),
  });

  showMenu(items, { anchor, width: 250 });
}

function showBookmarkMenu(anchor) {
  const items = [{ type: 'section', label: 'Adicionar pasta à biblioteca' }];

  for (const collection of state.library.collections) {
    items.push({
      label: collection.name,
      icon: 'folderFill',
      action: () => addCurrentFolder(collection.id),
    });
  }

  items.push({ type: 'separator' });
  items.push({
    label: 'Nova coleção…',
    icon: 'plus',
    action: () => createCollectionFlow(true),
  });

  showMenu(items, { anchor, width: 260 });
}

function openAddLibraryLink() {
  ensureSelectedCollection();
  const collection = currentCollection();
  if (!collection) {
    showToast('Crie uma coleção primeiro');
    return;
  }

  showAddLinkModal(collection.id, (message) => {
    showToast(message);
    renderAll();
  });
}

function openManageSources() {
  const collection = currentCollection();
  if (!collection) {
    showToast('Nenhuma coleção selecionada');
    return;
  }
  openManageSourcesModal(collection.id);
}

// ------------------------------------------------------------------ recents

function addRecentFolder(id, title) {
  if (!id) return;

  const existing = state.recents.folders.find((folder) => folder.id === id);
  const next = {
    id,
    title: title || (existing ? existing.title : ''),
    added: new Date().toISOString(),
  };

  state.recents.folders = [
    next,
    ...state.recents.folders.filter((folder) => folder.id !== id),
  ].slice(0, 20);
}

function updateRecentFolderName(id, title) {
  if (!id || !title) return;
  const folder = state.recents.folders.find((item) => item.id === id);
  if (!folder || folder.title === title) return;
  folder.title = title;
}

function addRecentItem(id, title) {
  if (!id) return;

  const existing = state.recents.items.find((item) => item.id === id);
  const next = {
    id,
    title: title || (existing ? existing.title : ''),
    added: new Date().toISOString(),
  };

  state.recents.items = [
    next,
    ...state.recents.items.filter((item) => item.id !== id),
  ].slice(0, 20);
}

function updateRecentItemTitle(id, title) {
  if (!id || !title) return;
  const item = state.recents.items.find((entry) => entry.id === id);
  if (!item || item.title === title) return;
  item.title = title;
  persistRecents();
}

function removeRecentFolder(id) {
  state.recents.folders = state.recents.folders.filter((folder) => folder.id !== id);
  persistRecents();
  renderContent();
}

function removeRecentItem(id) {
  state.recents.items = state.recents.items.filter((item) => item.id !== id);
  persistRecents();
  renderContent();
}

function showRecentsMenu(anchor) {
  const items = [];

  if (state.recents.folders.length > 0) {
    items.push({ type: 'section', label: 'Pastas' });
    for (const folder of state.recents.folders) {
      items.push({
        label: folder.title || 'Pasta do Drive',
        icon: 'folderFill',
        action: () => openFolder(folder.id),
      });
    }
  }

  if (state.recents.folders.length > 0 && state.recents.items.length > 0) {
    items.push({ type: 'separator' });
  }

  if (state.recents.items.length > 0) {
    items.push({ type: 'section', label: 'Vídeos' });
    for (const item of state.recents.items) {
      items.push({
        label: item.title || 'Vídeo do Drive',
        icon: 'film',
        action: () => {
          state.linkText = fileViewURL(item.id);
          renderHeader();
          openFile(item.id, item.title || '');
        },
      });
    }
  }

  if (items.length === 0) {
    items.push({ label: 'Nenhum item recente', disabled: true });
  } else {
    items.push({ type: 'separator' });
    items.push({
      label: 'Limpar recentes',
      icon: 'trash',
      action: () => {
        state.recents = { folders: [], items: [] };
        persistRecents();
        renderContent();
      },
    });
  }

  showMenu(items, { anchor, alignRight: true, width: 290 });
}

// ---------------------------------------------------------------- playback

function handlePlayerLoading(loading) {
  if (!state.currentID) {
    state.isLoading = false;
    return;
  }
  state.isLoading = !!loading;
  updatePlayerOverlays();
  updateSkipButtons();
}

function handlePlayerError(message) {
  state.isLoading = false;
  state.errorMessage = message || 'Falha ao carregar o player do Google Drive.';
  updatePlayerOverlays();
  updateSkipButtons();
}

function handlePlayerTick(payload) {
  if (!state.currentID || state.isLoading) return;

  const topHref = payload && typeof payload.topHref === 'string' ? payload.topHref : '';
  if (topHref && !topHref.includes(state.currentID)) return;

  const video = payload && payload.video;
  if (!video || typeof video !== 'object') return;

  const reportedDuration = Number(video.d);
  if (!(reportedDuration > 1) && state.player.duration > 1) return;

  state.player.hasVideo = true;
  state.player.isReady = Number(video.ready) >= 1;
  state.player.duration = Number.isFinite(reportedDuration)
    ? reportedDuration
    : state.player.duration;
  state.player.currentTime = Number(video.t) || 0;
  state.player.isPlaying = !video.paused && !video.ended;
  state.player.hasEnded = !!video.ended;

  if (!(state.player.duration > 1)) return;

  const id = state.currentID;
  const time = state.player.currentTime;
  const duration = state.player.duration;

  if (!state.didResume && state.player.isReady) {
    state.didResume = true;
    const target = state.resumeTarget;
    if (
      target != null &&
      target > 5 &&
      target < duration - 10 &&
      Math.abs(time - target) > 3
    ) {
      seekPlayer(target);
      state.player.currentTime = target;
      showToast(`Retomando de ${formatTime(target)}`);
    }
    state.resumeTarget = null;
  }

  if (Math.abs(time - state.lastSavedTick) >= 5) {
    state.lastSavedTick = time;
    recordProgress(id, time, duration);
  }

  if (
    state.settings.introSeconds >= 5 &&
    duration > state.settings.introSeconds + 20 &&
    time > 0.5 &&
    time < state.settings.introSeconds - 1
  ) {
    if (state.settings.skipIntro && state.player.isPlaying && !state.didSkipIntro) {
      state.didSkipIntro = true;
      seekPlayer(state.settings.introSeconds);
      state.player.currentTime = state.settings.introSeconds;
      showToast('Abertura pulada');
    }
  }

  const inEnding =
    state.settings.endingSeconds >= 5 &&
    duration > state.settings.endingSeconds + 20 &&
    time >= duration - state.settings.endingSeconds;

  if (
    !state.didAdvance &&
    (state.player.hasEnded ||
      time >= duration - 1.2 ||
      (state.settings.skipEnding && state.player.isPlaying && inEnding))
  ) {
    state.didAdvance = true;
    finishCurrentEpisode(state.settings.autoNext);
  }

  updateSkipButtons();
}

function finishCurrentEpisode(autoAdvance) {
  if (!state.currentID) return;
  const id = state.currentID;
  const duration = state.player.duration;
  markWatched(id, duration);

  const next = adjacentEntry(1, false);
  if (autoAdvance && next) {
    showToast('Próximo episódio…');
    playEntry(next);
  } else if (state.player.currentTime < duration - 1.5) {
    seekPlayer(Math.max(duration - 0.6, 0));
  }
}

function skipIntroNow() {
  if (!(state.player.duration > state.settings.introSeconds + 20)) return;
  state.didSkipIntro = true;
  seekPlayer(state.settings.introSeconds);
  state.player.currentTime = state.settings.introSeconds;
  showToast('Abertura pulada');
  updateSkipButtons();
}

function skipEndingNow() {
  if (!state.currentID) return;
  state.didAdvance = true;
  markWatched(state.currentID, state.player.duration);

  const next = adjacentEntry(1, false);
  if (next) {
    showToast('Próximo episódio…');
    playEntry(next);
  } else {
    seekPlayer(Math.max(state.player.duration - 0.6, 0));
  }
  updateSkipButtons();
}

function adjacentEntry(offset, wrapping) {
  const entries = playlistEntries();
  if (entries.length === 0) return null;

  const index = entries.findIndex((entry) => entry.id === state.currentID);
  if (index === -1) return offset > 0 ? entries[0] : entries[entries.length - 1];

  const nextIndex = index + offset;
  if (nextIndex >= 0 && nextIndex < entries.length) return entries[nextIndex];
  if (!wrapping) return null;
  return offset > 0 ? entries[0] : entries[entries.length - 1];
}

function playEntry(entry) {
  if (!entry) return;
  state.selectedEntryID = entry.id;
  updateSelection();
  openFile(entry.id, entry.name);
}

function playNext() {
  const next = adjacentEntry(1, true);
  if (next) playEntry(next);
}

function playPrevious() {
  const previous = adjacentEntry(-1, true);
  if (previous) playEntry(previous);
}

function reload() {
  if (!state.currentID) return;
  state.errorMessage = null;
  state.isLoading = true;
  state.didResume = false;
  state.didSkipIntro = false;
  state.didAdvance = false;
  state.lastSavedTick = 0;
  state.resumeTarget = state.settings.resumePlayback ? resumeTimeFor(state.currentID) : null;
  reloadPlayer();
  updatePlayerOverlays();
  updateSkipButtons();
}

async function toggleFullScreen() {
  state.fullscreen = !state.fullscreen;
  try {
    const value = await api.setFullscreen(state.fullscreen);
    state.fullscreen = !!value;
  } catch (_) {
    state.fullscreen = false;
  }
}

// ---------------------------------------------------------------- downloads

async function startDownload(id = state.currentID, filename = state.currentTitle) {
  if (!id) return;

  let name = String(filename || '').trim();
  if (!name) name = 'video.mkv';
  if (!name.includes('.')) name += '.mkv';

  const result = await api.download(id, name);
  if (!result || !result.ok) {
    showAlert(
      'Não foi possível baixar',
      (result && result.error) || 'Verifique a conexão e tente novamente.'
    );
    return;
  }

  state.downloads = { state: 'downloading', progress: 0, filename: name };
  renderFooter();
  showToast(`Baixando ${name}…`);
}

async function cancelDownload() {
  try {
    await api.cancelDownload();
  } catch (_) {}
  state.downloads = { state: 'idle' };
  renderFooter();
}

async function revealDownload() {
  const result = await api.revealDownload();
  if (!result || !result.ok) {
    showAlert(
      'Arquivo não encontrado',
      'O arquivo baixado não está mais na pasta Downloads.'
    );
  }
}

function showDownloadFailure() {
  const message =
    (state.downloads && state.downloads.message) ||
    'O download foi interrompido. Verifique a conexão e tente novamente.';
  showAlert('Download falhou', message);
  state.downloads = { state: 'idle' };
  renderFooter();
}

function handleDownloadState(next) {
  if (!next || typeof next !== 'object') return;

  if (next.state === 'downloading') {
    state.downloads = {
      state: 'downloading',
      progress: Number(next.progress) || 0,
      filename: next.filename || '',
    };

    const bar = document.querySelector('.download-progress-inner');
    const percent = document.querySelector('.download-percent');
    if (bar && percent) {
      const value = Math.max(0, Math.min(state.downloads.progress, 1));
      bar.style.width = `${(value * 100).toFixed(1)}%`;
      percent.textContent = `${Math.round(value * 100)}%`;
    } else {
      renderFooter();
    }
    return;
  }

  if (next.state === 'finished') {
    state.downloads = {
      state: 'finished',
      path: next.path || '',
      filename: next.filename || '',
    };
    renderFooter();
    showToast('Download concluído');
    return;
  }

  if (next.state === 'failed') {
    state.downloads = {
      state: 'failed',
      message: next.message || 'O download foi interrompido.',
    };
    renderFooter();
    showToast('Download falhou');
    return;
  }

  state.downloads = { state: 'idle' };
  renderFooter();
}

// ---------------------------------------------------------------- VLC/share

async function openInVLC(id = state.currentID) {
  if (!id) return;

  const result = await api.openVLC(id);
  if (result && result.ok) return;

  if (result && result.code === 'notFound') {
    showAlert(
      'VLC não encontrado',
      'O player integrado já toca o vídeo. Para MKV com legendas e qualidade original, instale o VLC (grátis).',
      [
        {
          label: 'Baixar VLC',
          className: 'primary-btn',
          action: () => {
            api.openExternal(
              result.downloadPage || 'https://www.videolan.org/vlc/download-windows.html'
            );
          },
        },
        { label: 'Cancelar', className: 'secondary-btn' },
      ]
    );
    return;
  }

  showAlert(
    'Não foi possível abrir o VLC',
    (result && result.error) || 'Tente novamente.'
  );
}

function openInBrowser(id) {
  if (!id) return;
  api.openExternal(fileViewURL(id));
}

async function copyToClipboard(text) {
  try {
    const result = await api.copyText(text);
    return !result || result.ok !== false;
  } catch (_) {
    return false;
  }
}

async function copyShareLink(id) {
  const ok = await copyToClipboard(fileViewURL(id));
  if (!ok) {
    showAlert('Não foi possível copiar', 'Tente novamente.');
    return;
  }
  showToast('Link de compartilhamento copiado');
}

async function copyFolderLink(id) {
  const ok = await copyToClipboard(folderURL(id));
  if (!ok) {
    showAlert('Não foi possível copiar', 'Tente novamente.');
    return;
  }
  showToast('Link da pasta copiado');
}

async function copyDirectLink(id) {
  const ok = await copyToClipboard(directURL(id));
  if (!ok) {
    showAlert('Não foi possível copiar', 'Tente novamente.');
    return;
  }

  showAlert(
    'Link direto copiado',
    isMacPlatform
      ? 'Cole no VLC, IINA ou em outro player compatível com MKV.'
      : 'Cole no VLC ou em outro player compatível com MKV.'
  );
}

function shareMenuItems(url) {
  const encoded = encodeURIComponent(url);
  return [
    {
      label: 'Copiar link',
      icon: 'link',
      action: async () => {
        const ok = await copyToClipboard(url);
        if (ok) showToast('Link copiado');
        else showAlert('Não foi possível copiar', 'Tente novamente.');
      },
    },
    { type: 'separator' },
    {
      label: 'E-mail',
      icon: 'mail',
      action: () =>
        api.openExternal(
          `mailto:?subject=${encodeURIComponent('Vídeo no Google Drive')}&body=${encoded}`
        ),
    },
    {
      label: 'WhatsApp',
      icon: 'whatsapp',
      action: () => api.openExternal(`https://wa.me/?text=${encoded}`),
    },
    {
      label: 'Telegram',
      icon: 'telegram',
      action: () => api.openExternal(`https://t.me/share/url?url=${encoded}`),
    },
    {
      label: 'X (Twitter)',
      icon: 'xSocial',
      action: () => api.openExternal(`https://twitter.com/intent/tweet?url=${encoded}`),
    },
    { type: 'separator' },
    {
      label: 'Abrir no navegador',
      icon: 'globe',
      action: () => api.openExternal(url),
    },
  ];
}

// ------------------------------------------------------------ context menu

function showEntryContextMenu(entry, x, y) {
  if (!entry) return;
  const items = [];

  if (entry.isFolder) {
    items.push({
      label: 'Abrir pasta',
      icon: 'folder',
      action: () => selectEntry(entry),
    });
    items.push({
      label: 'Copiar link da pasta',
      icon: 'link',
      action: () => copyFolderLink(entry.id),
    });
    items.push({
      label: 'Compartilhar pasta…',
      icon: 'share',
      submenu: shareMenuItems(folderURL(entry.id)),
    });
  } else if (entry.isVideo) {
    items.push({
      label: 'Reproduzir',
      icon: 'play',
      action: () => selectEntry(entry),
    });
    items.push({ type: 'separator' });

    if (isWatched(entry.id)) {
      items.push({
        label: 'Marcar como não assistido',
        icon: 'closeCircle',
        action: () => {
          markUnwatched(entry.id);
          showToast('Marcado como não assistido');
        },
      });
    } else {
      items.push({
        label: 'Marcar como assistido',
        icon: 'checkCircle',
        action: () => {
          const duration =
            (state.progress[entry.id] && state.progress[entry.id].duration) ||
            (state.currentID === entry.id ? state.player.duration : 0);
          markWatched(entry.id, duration);
          showToast('Marcado como assistido');
        },
      });
    }

    items.push({
      label: 'Resetar progresso',
      icon: 'reset',
      disabled: !state.progress[entry.id],
      action: () => {
        resetProgress(entry.id);
        showToast('Progresso resetado');
      },
    });

    items.push({ type: 'separator' });
    items.push({
      label: 'Abrir no VLC',
      icon: 'vlc',
      action: () => openInVLC(entry.id),
    });
    items.push({
      label: 'Baixar',
      icon: 'downloadCircle',
      action: () => startDownload(entry.id, entry.name),
    });
    items.push({
      label: 'Compartilhar…',
      icon: 'share',
      submenu: shareMenuItems(fileViewURL(entry.id)),
    });

    items.push({ type: 'separator' });
    items.push({
      label: 'Abrir no navegador',
      icon: 'globe',
      action: () => openInBrowser(entry.id),
    });
    items.push({
      label: 'Copiar link de compartilhamento',
      icon: 'link',
      action: () => copyShareLink(entry.id),
    });
    items.push({
      label: 'Copiar link direto',
      icon: 'copy',
      action: () => copyDirectLink(entry.id),
    });
  } else {
    items.push({
      label: 'Abrir no Drive',
      icon: 'globe',
      action: () => selectEntry(entry),
    });
    items.push({
      label: 'Copiar link',
      icon: 'link',
      action: () => copyShareLink(entry.id),
    });
  }

  if (state.libraryMode) {
    items.push({ type: 'separator' });
    items.push({
      label: 'Gerenciar fontes…',
      icon: 'sliders',
      action: openManageSources,
    });
  }

  showMenu(items, { x, y });
}

// -------------------------------------------------------------------- ajuda

function helpRowHTML(icon, title, text) {
  return `<div class="help-row">
    <span class="help-icon">${svg(icon, 18)}</span>
    <div class="help-text-wrap">
      <div class="help-title">${escapeHTML(title)}</div>
      <div class="help-text">${escapeHTML(text)}</div>
    </div>
  </div>`;
}

function shortcutRowHTML(keys, text) {
  return `<div class="shortcut-row">
    <span class="kbd">${escapeHTML(keys)}</span>
    <span>${escapeHTML(text)}</span>
  </div>`;
}

function showHelp() {
  const shortcuts = [
    shortcutRowHTML(isMacPlatform ? '⇧⌘V' : 'Ctrl+Shift+V', 'Colar link e reproduzir'),
    shortcutRowHTML(`${modLabel}R`, 'Recarregar player'),
    shortcutRowHTML(isMacPlatform ? '⇧⌘O' : 'Ctrl+Shift+O', 'Abrir no VLC'),
    shortcutRowHTML(`${modLabel}← / ${modLabel}→`, 'Episódio anterior / próximo'),
    shortcutRowHTML(fullscreenLabel, 'Tela cheia'),
  ].join('');

  const body = `<div class="help-body">
    ${helpRowHTML(
      'folder',
      'Cole o link da pasta',
      'No Google Drive, compartilhe a pasta como “Qualquer pessoa com o link” e copie o link. Todos os episódios aparecem na lista ao lado, com busca e miniaturas.'
    )}
    ${helpRowHTML(
      'booksFill',
      'Biblioteca de temporadas',
      `Use o botão “Biblioteca” (ou ${modLabel}B) para juntar os links de várias temporadas na mesma coleção. Os episódios são unidos e ordenados por temporada/episódio (S04E01…S05E12). Crie coleções, adicione links pelo “+” e mova as fontes em “Gerenciar fontes”.`
    )}
    ${helpRowHTML(
      'playCircle',
      'Player integrado',
      'Clique em um episódio para tocar dentro do app. O player do Drive converte MKV no servidor; não é preciso instalar codecs.'
    )}
    ${helpRowHTML(
      'chevronRight',
      'Próximo episódio',
      `Use as setas no rodapé ou ${modLabel}← / ${modLabel}→ para pular de episódio. Ao terminar (ou pular o encerramento), o próximo começa sozinho.`
    )}
    ${helpRowHTML(
      'forwardEnd',
      'Pular abertura e encerramento',
      'Os botões aparecem sobre o vídeo, acima da linha do tempo. O botão “Pular” no rodapé abre as opções: pulo automático, duração da abertura/encerramento e avanço para o próximo episódio. A escolha fica salva.'
    )}
    ${helpRowHTML(
      'checkCircle',
      'Retomar e assistidos',
      'O app salva onde você parou e retoma ao abrir o episódio de novo. Episódios concluídos ganham um ✓ na lista.'
    )}
    ${helpRowHTML(
      'info',
      'Botão direito no episódio',
      'Clique com o botão direito em qualquer episódio para marcar como assistido/não assistido, resetar o progresso, abrir no VLC, baixar, compartilhar ou copiar o link.'
    )}
    ${helpRowHTML(
      'vlc',
      'VLC para MKV completo',
      'Para legendas embutidas, faixas de áudio e qualidade original, use “Abrir no VLC”. O app envia o stream direto para o VLC instalado.'
    )}
    ${helpRowHTML(
      'downloadCircle',
      'Baixar',
      'Salva o arquivo original em Downloads. Útil para assistir offline ou abrir em outro player.'
    )}
    <div class="popover-divider"></div>
    <div class="help-shortcuts">
      <div class="help-title">Atalhos</div>
      ${shortcuts}
    </div>
    <div class="help-note">As pastas e arquivos precisam estar públicos (“qualquer pessoa com o link”) ou na conta com sessão iniciada no player.</div>
  </div>`;

  openModal({
    title: 'Como usar o DrivePlay',
    body,
    widthClass: 'wide',
    actions: [{ label: 'Fechar', className: 'secondary-btn' }],
  });
}

// -------------------------------------------------------- adicionar link

function showAddLinkModal(collectionID, onDone) {
  const collection = findCollection(state.library, collectionID);
  if (!collection) return null;

  let busy = false;

  return openModal({
    title: 'Adicionar à coleção',
    subtitle: collection.name,
    widthClass: 'medium',
    body: `<div class="field-row">
      <input class="modal-input" id="add-link-input" type="text" placeholder="Link da pasta (temporada) ou do vídeo…" autocomplete="off" spellcheck="false">
      <button type="button" class="paste-btn" id="add-link-paste">Colar</button>
    </div>
    <div class="modal-error hidden" id="add-link-error"></div>
    <div class="modal-note">Adicione quantas pastas quiser na mesma coleção. Os episódios são unidos e ordenados por temporada/episódio — S04E01…S05E12.</div>`,
    actions: [
      { label: 'Cancelar', className: 'secondary-btn' },
      {
        label: 'Adicionar',
        className: 'primary-btn',
        action: async (panel) => {
          if (busy) return false;

          const input = panel.querySelector('#add-link-input');
          const error = panel.querySelector('#add-link-error');
          const primary = panel.querySelector('.modal-actions .primary-btn');
          const cancel = panel.querySelector('.modal-actions .secondary-btn');
          if (!input) return false;

          const link = input.value.trim();
          if (!link) return false;

          const target = parseTarget(link);
          if (!target) {
            if (error) {
              error.textContent = 'Link inválido. Cole um link de pasta ou de arquivo do Google Drive.';
              error.classList.remove('hidden');
            }
            return false;
          }

          busy = true;
          input.disabled = true;
          if (primary) {
            primary.disabled = true;
            primary.textContent = 'Adicionando…';
          }
          if (cancel) cancel.disabled = true;
          if (error) error.classList.add('hidden');

          try {
            let message = '';

            if (target.kind === 'folder') {
              const result = await api.fetchFolder(target.id);
              if (!result || !result.ok || !result.content) {
                throw new Error(
                  (result && result.error) || 'Não foi possível abrir a pasta do Google Drive.'
                );
              }

              const content = result.content;
              const added = addSource(
                state.library,
                collectionID,
                'folder',
                target.id,
                content.name,
                content.entries
              );

              message = added
                ? `Pasta “${content.name}” adicionada`
                : 'Essa pasta já estava na coleção (itens atualizados)';
            } else {
              const result = await api.fetchTitle(target.id);
              const title =
                result && result.ok && result.title ? result.title : 'Vídeo do Drive';

              const added = addSource(state.library, collectionID, 'file', target.id, title, [
                {
                  id: target.id,
                  name: title,
                  isFolder: false,
                  isVideo: true,
                  modified: null,
                  thumbnail: null,
                  mimeType: null,
                },
              ]);

              message = added
                ? `Vídeo “${title}” adicionado`
                : 'Esse vídeo já estava na coleção';
            }

            persistLibrary();
            if (typeof onDone === 'function') onDone(message);
            return true;
          } catch (error) {
            if (error && error.message) {
              const errorElement = panel.querySelector('#add-link-error');
              if (errorElement) {
                errorElement.textContent = error.message;
                errorElement.classList.remove('hidden');
              }
            }

            busy = false;
            input.disabled = false;
            if (primary) {
              primary.disabled = !input.value.trim();
              primary.textContent = 'Adicionar';
            }
            if (cancel) cancel.disabled = false;
            input.focus();
            return false;
          }
        },
      },
    ],
    onMount: (panel, close, actions, buttons) => {
      const input = panel.querySelector('#add-link-input');
      const paste = panel.querySelector('#add-link-paste');
      const error = panel.querySelector('#add-link-error');
      const primary = buttons[1];

      if (input) {
        const sync = () => {
          if (!primary) return;
          primary.disabled = busy || !input.value.trim();
          if (error) error.classList.add('hidden');
        };

        input.addEventListener('input', sync);
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (primary && !primary.disabled) primary.click();
          }
        });
        sync();
      }

      if (paste && input) {
        paste.addEventListener('click', async () => {
          if (busy) return;
          let text = '';
          try {
            text = await api.readClipboard();
          } catch (_) {
            text = '';
          }
          if (!text) return;
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        });
      }
    },
  });
}

// ------------------------------------------------------- gerenciar fontes

function sourceRowHTML(source) {
  const count = sourceVideoCount(source);
  const kindLabel = source.kind === 'folder' ? 'pasta' : 'arquivo';
  const icon = source.kind === 'folder' ? 'folderFill' : 'filmFill';

  return `<div class="source-row" data-source-id="${escapeHTML(source.id)}">
    <span class="source-icon">${svg(icon, 15)}</span>
    <div class="source-text">
      <div class="source-name" title="${escapeHTML(source.name)}">${escapeHTML(source.name)}</div>
      <div class="source-sub">${count} episódio(s) · ${kindLabel}</div>
    </div>
    <button type="button" class="source-move" data-move-source="${escapeHTML(source.id)}">Mover para</button>
    <button type="button" class="source-trash" data-remove-source="${escapeHTML(source.id)}" title="Remover da coleção">${svg('trash', 13)}</button>
  </div>`;
}

function openManageSourcesModal(collectionID) {
  let collection = findCollection(state.library, collectionID);
  if (!collection) return null;

  let status = '';
  let refreshing = false;

  const body = `<div class="sources-head">
    <div class="modal-head">
      <div class="modal-head-text">
        <div class="modal-title">${escapeHTML(collection.name)}</div>
        <div class="modal-sub" id="sources-sub">${collection.sources.length} fonte(s) · ${episodeCount(state.library, collectionID)} episódio(s)</div>
      </div>
      <button type="button" class="secondary-btn" id="sources-done">Concluir</button>
    </div>
  </div>
  <div class="sources-list" id="sources-list"></div>
  <div class="sources-foot">
    <button type="button" class="secondary-btn" id="sources-add">${svg('plus', 13)} Adicionar link</button>
    <button type="button" class="secondary-btn" id="sources-refresh">${svg('refresh', 13)} Atualizar</button>
    <span class="sources-status" id="sources-status"></span>
  </div>`;

  return openModal({
    header: false,
    widthClass: 'sources',
    bodyClass: 'sources-body',
    body,
    dismissOnBackdrop: false,
    onMount: (panel, close) => {
      const list = panel.querySelector('#sources-list');
      const sub = panel.querySelector('#sources-sub');
      const statusElement = panel.querySelector('#sources-status');
      const done = panel.querySelector('#sources-done');
      const add = panel.querySelector('#sources-add');
      const refreshButton = panel.querySelector('#sources-refresh');

      const setStatus = (text) => {
        status = text || '';
        if (statusElement) statusElement.textContent = status;
      };

      const renderList = () => {
        collection = findCollection(state.library, collectionID);
        if (!collection) {
          close();
          return;
        }

        if (sub) {
          sub.textContent = `${collection.sources.length} fonte(s) · ${episodeCount(
            state.library,
            collectionID
          )} episódio(s)`;
        }

        if (!list) return;

        if (collection.sources.length === 0) {
          list.innerHTML = `<div class="sources-empty">
            <span class="sources-empty-icon">${svg('folderPlus', 28)}</span>
            <div class="sources-empty-title">Nenhuma fonte ainda</div>
            <div class="sources-empty-text">Adicione o link de uma pasta de temporada ou de um vídeo.</div>
          </div>`;
          return;
        }

        list.innerHTML = collection.sources.map(sourceRowHTML).join('');

        $$('.source-row', list).forEach((row) => {
          const sourceID = row.dataset.sourceId;
          const source = collection.sources.find((item) => item.id === sourceID);
          if (!source) return;

          const moveButton = row.querySelector('[data-move-source]');
          if (moveButton) {
            moveButton.addEventListener('click', () => {
              const others = state.library.collections.filter(
                (item) => item.id !== collectionID
              );

              const items = others.length
                ? others.map((other) => ({
                    label: other.name,
                    icon: 'folderFill',
                    action: () => {
                      if (moveSource(state.library, sourceID, collectionID, other.id)) {
                        persistLibrary();
                        setStatus(`Movido para “${other.name}”`);
                        renderList();
                        renderSidebar();
                        renderContent();
                      }
                    },
                  }))
                : [{ label: 'Nenhuma outra coleção', disabled: true }];

              showMenu(items, { anchor: moveButton, width: 230 });
            });
          }

          const trash = row.querySelector('[data-remove-source]');
          if (trash) {
            trash.addEventListener('click', () => {
              if (removeSource(state.library, collectionID, sourceID)) {
                persistLibrary();
                setStatus('Fonte removida');
                renderList();
                renderSidebar();
                renderContent();
              }
            });
          }
        });
      };

      if (done) done.addEventListener('click', close);

      if (add) {
        add.addEventListener('click', () => {
          showAddLinkModal(collectionID, (message) => {
            setStatus(message);
            showToast(message);
            renderList();
            renderSidebar();
            renderContent();
          });
        });
      }

      if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
          if (refreshing) return;
          refreshing = true;
          refreshButton.disabled = true;
          refreshButton.textContent = 'Atualizando…';
          state.libraryRefreshing = true;
          renderSidebar();

          const current = findCollection(state.library, collectionID);
          if (current) {
            const sources = [...current.sources];
            for (const source of sources) {
              if (source.kind !== 'folder') continue;
              try {
                const result = await api.fetchFolder(source.driveID);
                if (result && result.ok && result.content) {
                  updateSource(state.library, collectionID, source.id, {
                    name: result.content.name,
                    entries: result.content.entries,
                  });
                }
              } catch (_) {
                // Ignora falhas individuais; mantém a fonte antiga.
              }
            }
            persistLibrary();
          }

          refreshing = false;
          state.libraryRefreshing = false;
          refreshButton.disabled = false;
          refreshButton.innerHTML = `${svg('refresh', 13)} Atualizar`;
          setStatus('Fontes atualizadas');
          renderList();
          renderSidebar();
          renderContent();
        });
      }

      renderList();
      if (status) setStatus(status);
    },
  });
}

// ------------------------------------------------------------- menu events

function handleMenuAction(action) {
  if (!action || typeof action !== 'object') return;

  switch (action.type) {
    case 'paste':
      pasteAndPlay();
      break;
    case 'reload':
      reload();
      break;
    case 'vlc':
      if (state.currentID) openInVLC(state.currentID);
      break;
    case 'previous':
      playPrevious();
      break;
    case 'next':
      playNext();
      break;
    case 'library':
      setLibraryMode(!state.libraryMode);
      break;
    case 'fullscreen':
      toggleFullScreen();
      break;
    case 'settings':
      showSettingsPopover($('#skip-settings') || $('#library-toggle'));
      break;
    case 'help':
      showHelp();
      break;
    case 'toggle':
      if (
        action.key &&
        Object.prototype.hasOwnProperty.call(state.settings, action.key)
      ) {
        state.settings[action.key] = !!action.value;
        persistSettings();
        closePopover();
        updateSkipButtons();
        updateSkipSettingsButton();
      }
      break;
    default:
      break;
  }
}

function handleOpenLink(link) {
  if (typeof link !== 'string' || !link.trim()) return;
  state.linkText = link.trim();
  renderHeader();
  openFromLink(state.linkText);
}

// -------------------------------------------------------------------- init

function bindStaticEvents() {
  const input = $('#link-input');
  if (input) {
    input.addEventListener('input', () => {
      state.linkText = input.value;
      const clear = $('#clear-link');
      if (clear) clear.classList.toggle('hidden', !state.linkText);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        openFromField();
      }
    });
  }

  const open = $('#open-link');
  if (open) open.addEventListener('click', openFromField);

  const clear = $('#clear-link');
  if (clear) {
    clear.addEventListener('click', () => {
      state.linkText = '';
      if (input) {
        input.value = '';
        input.focus();
      }
      clear.classList.add('hidden');
    });
  }

  const toggle = $('#toggle-sidebar');
  if (toggle) toggle.addEventListener('click', toggleSidebar);

  const libraryToggle = $('#library-toggle');
  if (libraryToggle) {
    libraryToggle.addEventListener('click', () => setLibraryMode(!state.libraryMode));
  }

  const recents = $('#recents-btn');
  if (recents) {
    recents.addEventListener('click', () => showRecentsMenu(recents));
  }

  const help = $('#help-btn');
  if (help) help.addEventListener('click', showHelp);

  const skipIntro = $('#skip-intro');
  if (skipIntro) skipIntro.addEventListener('click', skipIntroNow);

  const skipEnding = $('#skip-ending');
  if (skipEnding) skipEnding.addEventListener('click', skipEndingNow);

  const retry = $('#error-retry');
  if (retry) retry.addEventListener('click', reload);

  const errorVLC = $('#error-vlc');
  if (errorVLC) errorVLC.addEventListener('click', () => openInVLC(state.currentID));

  const errorDownload = $('#error-download');
  if (errorDownload) errorDownload.addEventListener('click', () => startDownload());

  document.addEventListener('keydown', handleGlobalKeydown);

  window.addEventListener('resize', () => {
    closeMenus();
    closePopover();
  });

  window.addEventListener('beforeunload', () => {
    saveNow(api, 'progress', state.progress);
    saveNow(api, 'settings', settingsPayload());
    saveNow(api, 'recents', state.recents);
    saveNow(api, 'library', { collections: state.library.collections });
  });

  window.addEventListener('error', (event) => {
    console.error('DrivePlay:', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('DrivePlay:', event.reason);
  });
}

function handleGlobalKeydown(event) {
  if (event.key !== 'Escape') return;

  const menuRoot = $('#menu-root');
  if (menuRoot && menuRoot.childElementCount > 0) {
    closeMenus();
    return;
  }

  const popoverRoot = $('#popover-root');
  if (popoverRoot && popoverRoot.childElementCount > 0) {
    closePopover();
    return;
  }

  if (state.modalStack.length > 0) {
    const top = state.modalStack[state.modalStack.length - 1];
    top.close();
    return;
  }

  const active = document.activeElement;
  if (active && active.id === 'link-input') active.blur();
}

async function init() {
  document.body.classList.add(`platform-${api.platform}`);

  let loaded;
  try {
    loaded = await loadAll(api);
  } catch (error) {
    console.error('DrivePlay: erro ao carregar dados', error);
    loaded = {
      library: normalizeLibrary(null),
      progress: {},
      settings: { ...DEFAULT_SETTINGS },
      recents: { folders: [], items: [] },
    };
  }

  state.library = loaded.library;
  state.progress = loaded.progress;
  state.settings = loaded.settings;
  state.recents = loaded.recents;
  state.libraryMode = !!state.settings.libraryMode;
  state.showSidebar = state.settings.showSidebar !== false;
  state.selectedCollectionID = state.settings.selectedCollectionID;

  ensureSelectedCollection();
  state.settings.selectedCollectionID = state.selectedCollectionID;

  createPlayer($('#player-host'));

  setPlayerHandlers({
    onTick: handlePlayerTick,
    onLoading: handlePlayerLoading,
    onError: handlePlayerError,
    onFullscreen: (value) => {
      state.fullscreen = !!value;
      api.setFullscreen(!!value);
    },
  });

  bindStaticEvents();

  api.onDownload(handleDownloadState);
  api.onMenuAction(handleMenuAction);
  api.onOpenLink(handleOpenLink);

  persistSettings(true);
  renderAll();

  let launchLink = '';
  try {
    launchLink = await api.getLaunchLink();
  } catch (_) {
    launchLink = '';
  }

  if (launchLink) {
    state.linkText = launchLink;
    renderHeader();
    openFromLink(launchLink);
    return;
  }

  if (state.libraryMode) {
    state.showSidebar = true;
    state.settings.showSidebar = true;
    persistSettings(true);
    renderAll();
    return;
  }

  if (state.settings.lastFolderID) {
    openFolder(state.settings.lastFolderID, true);
    return;
  }

  if (state.settings.lastFileID) {
    openFile(state.settings.lastFileID);
    return;
  }

  setTimeout(() => {
    const input = $('#link-input');
    if (input) input.focus();
  }, 120);
}

init();



