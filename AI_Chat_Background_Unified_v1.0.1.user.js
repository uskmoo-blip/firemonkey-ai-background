// ==UserScript==
// @name         AI Chat Background Unified (Android)
// @namespace    yk.local.ai.chat.background
// @version      1.0.1
// @description  ChatGPT / Gemini共通。背景、60枠お気に入り、画像ごとの位置保存、ドラッグ・ピンチ、半透明吹き出しを1本で管理します。
// @match        https://chatgpt.com/*
// @match        https://gemini.google.com/*
// @run-at       document-end
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'yk-ai-bg';
  const ROOT_ID = `${APP_ID}-root`;
  const SITE = location.hostname === 'chatgpt.com' ? 'chatgpt' :
    location.hostname === 'gemini.google.com' ? 'gemini' : '';

  if (!SITE || window.top !== window.self || document.getElementById(ROOT_ID)) return;

  /*
   * Gemini安定版の保存名を継続使用します。
   * localStorage / IndexedDBはサイトごとに分離されるため、ChatGPTでも同名で安全です。
   */
  const KEY_SETTINGS = 'yk-gem-bg-settings-v1';
  const KEY_IMAGE = 'yk-gem-bg-image-v1';
  const KEY_ACTIVE_SLOT = 'yk-gem-bg-fav9-active-slot';
  const DB_NAME = 'yk-gem-bg-fav9-db';
  const STORE_NAME = 'favorites';

  const LEGACY_CHATGPT_SETTINGS = 'yk-bg-lite-settings-v1';
  const LEGACY_CHATGPT_IMAGE = 'yk-bg-lite-image-v1';

  const SLOT_COUNT = 60;
  const DEFAULTS = Object.freeze({
    enabled: false,
    assistantOpacity: 0.72,
    userOpacity: 0.78,
    darkness: 0.20,
    size: 120,
    x: 50,
    y: 20,
    glassBlur: 9,
    borderOpacity: 0.18
  });

  const LIMITS = Object.freeze({
    assistantOpacity: [0.10, 1],
    userOpacity: [0.10, 1],
    darkness: [0, 0.80],
    size: [40, 400],
    x: [-200, 200],
    y: [-200, 200],
    glassBlur: [0, 24],
    borderOpacity: [0, 0.50]
  });

  const state = {
    settings: { ...DEFAULTS },
    image: '',
    activeSlot: 0,
    records: new Map(),
    pendingFileAction: null,
    db: null,
    dbUnavailable: false,
    domRefreshTimer: 0,
    settingsSaveTimer: 0,
    slotSaveTimer: 0,
    editing: false,
    thumbnailMigrationRunning: false
  };

  const ui = {};
  const pointers = new Map();
  let dragStart = null;
  let pinchStart = null;

  const log = (...args) => console.log('[AI Background]', ...args);
  const warn = (...args) => console.warn('[AI Background]', ...args);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function numberOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normaliseSettings(source) {
    const merged = { ...DEFAULTS, ...(source && typeof source === 'object' ? source : {}) };

    Object.entries(LIMITS).forEach(([key, [min, max]]) => {
      merged[key] = clamp(numberOr(merged[key], DEFAULTS[key]), min, max);
    });

    merged.enabled = Boolean(merged.enabled);
    return merged;
  }

  function readJson(key, fallback = {}) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      warn(`保存データ「${key}」を読み込めませんでした。`, error);
      return fallback;
    }
  }

  function migrateChatGptLegacyData() {
    if (SITE !== 'chatgpt') return;

    if (!localStorage.getItem(KEY_SETTINGS)) {
      const legacy = localStorage.getItem(LEGACY_CHATGPT_SETTINGS);
      if (legacy) localStorage.setItem(KEY_SETTINGS, legacy);
    }

    if (!localStorage.getItem(KEY_IMAGE)) {
      const legacy = localStorage.getItem(LEGACY_CHATGPT_IMAGE);
      if (legacy) localStorage.setItem(KEY_IMAGE, legacy);
    }
  }

  function loadState() {
    migrateChatGptLegacyData();
    state.settings = normaliseSettings(readJson(KEY_SETTINGS, DEFAULTS));
    state.image = localStorage.getItem(KEY_IMAGE) || '';
    state.activeSlot = clamp(numberOr(localStorage.getItem(KEY_ACTIVE_SLOT), 0), 0, SLOT_COUNT);
  }

  function saveSettingsNow() {
    clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = 0;
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(state.settings));
  }

  function queueSettingsSave(delay = 100) {
    clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = window.setTimeout(saveSettingsNow, delay);
  }

  function saveImage(image) {
    state.image = image || '';
    if (state.image) localStorage.setItem(KEY_IMAGE, state.image);
    else localStorage.removeItem(KEY_IMAGE);
  }

  function setActiveSlot(slot) {
    state.activeSlot = clamp(numberOr(slot, 0), 0, SLOT_COUNT);
    localStorage.setItem(KEY_ACTIVE_SLOT, String(state.activeSlot));
  }

  function createElement(tag, attributes = {}, text = '') {
    const element = document.createElement(tag);

    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') element.className = value;
      else if (key === 'hidden') element.hidden = Boolean(value);
      else if (key === 'dataset') Object.assign(element.dataset, value);
      else if (key === 'style') element.setAttribute('style', value);
      else element.setAttribute(key, String(value));
    });

    if (text) element.textContent = text;
    return element;
  }

  function slotLabel(slot) {
    const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
      '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
    return slot <= 20 ? circled[slot - 1] : String(slot);
  }

  function addStyles() {
    const style = createElement('style', { id: `${APP_ID}-style` });
    style.textContent = `
      #${APP_ID}-layer,
      #${APP_ID}-shade {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      #${APP_ID}-layer {
        z-index: -2;
        background-color: #000;
        background-repeat: no-repeat;
        background-position: var(--yk-ai-x) var(--yk-ai-y);
        background-size: var(--yk-ai-size) auto;
      }

      #${APP_ID}-shade {
        z-index: -1;
        background: rgba(0, 0, 0, var(--yk-ai-darkness));
      }

      html.yk-ai-bg-on,
      html.yk-ai-bg-on body {
        background: transparent !important;
        background-image: none !important;
      }

      html.yk-ai-bg-on body {
        isolation: isolate;
      }

      /* ChatGPTの大きな背景面 */
      html.yk-ai-bg-on.yk-ai-site-chatgpt main,
      html.yk-ai-bg-on.yk-ai-site-chatgpt [role="main"],
      html.yk-ai-bg-on.yk-ai-site-chatgpt [class*="bg-token-main-surface"],
      html.yk-ai-bg-on.yk-ai-site-chatgpt [class*="bg-token-bg-primary"],
      html.yk-ai-bg-on.yk-ai-site-chatgpt [class*="main-surface"] {
        background-color: transparent !important;
        background-image: none !important;
      }

      /* Geminiの大きな背景面 */
      html.yk-ai-bg-on.yk-ai-site-gemini main,
      html.yk-ai-bg-on.yk-ai-site-gemini chat-window,
      html.yk-ai-bg-on.yk-ai-site-gemini .chat-window,
      html.yk-ai-bg-on.yk-ai-site-gemini conversation-container,
      html.yk-ai-bg-on.yk-ai-site-gemini .conversation-container,
      html.yk-ai-bg-on.yk-ai-site-gemini .chat-history,
      html.yk-ai-bg-on.yk-ai-site-gemini infinite-scroller,
      html.yk-ai-bg-on.yk-ai-site-gemini .scroll-container,
      html.yk-ai-bg-on.yk-ai-site-gemini .content-container,
      html.yk-ai-bg-on.yk-ai-site-gemini .yk-ai-large-surface {
        background-color: transparent !important;
        background-image: none !important;
      }

      html.yk-ai-bg-on.yk-ai-site-chatgpt header,
      html.yk-ai-bg-on.yk-ai-site-chatgpt nav,
      html.yk-ai-bg-on.yk-ai-site-chatgpt aside,
      html.yk-ai-bg-on.yk-ai-site-gemini header,
      html.yk-ai-bg-on.yk-ai-site-gemini nav,
      html.yk-ai-bg-on.yk-ai-site-gemini bard-sidenav-container {
        background: rgba(20, 20, 22, .62) !important;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }

      html.yk-ai-bg-on .yk-ai-assistant-bubble,
      html.yk-ai-bg-on .yk-ai-user-bubble {
        display: block !important;
        width: fit-content !important;
        box-sizing: border-box !important;
        border: 1px solid rgba(255, 255, 255, var(--yk-ai-border-opacity)) !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, .16) !important;
        backdrop-filter: blur(var(--yk-ai-glass-blur)) !important;
        -webkit-backdrop-filter: blur(var(--yk-ai-glass-blur)) !important;
      }

      html.yk-ai-bg-on .yk-ai-assistant-bubble {
        max-width: calc(100vw - 64px) !important;
        margin-left: 14px !important;
        margin-right: auto !important;
        padding: 12px 14px !important;
        border-radius: 18px !important;
        background: rgba(28, 28, 30, var(--yk-ai-assistant)) !important;
      }

      html.yk-ai-bg-on .yk-ai-user-bubble {
        max-width: calc(100vw - 104px) !important;
        margin-left: auto !important;
        margin-right: 14px !important;
        padding: 10px 14px !important;
        border-radius: 20px !important;
        background: rgba(48, 49, 55, var(--yk-ai-user)) !important;
      }

      html.yk-ai-bg-on .yk-ai-assistant-bubble > *,
      html.yk-ai-bg-on .yk-ai-user-bubble > * {
        background-color: transparent !important;
      }

      /* ChatGPTのユーザーメッセージ外枠はレイアウトだけ維持 */
      html.yk-ai-bg-on.yk-ai-site-chatgpt [data-message-author-role="user"] {
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
      }

      /* Geminiのユーザーメッセージ外枠 */
      html.yk-ai-bg-on.yk-ai-site-gemini user-query {
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
      }

      #${ROOT_ID} {
        position: fixed;
        right: max(10px, env(safe-area-inset-right));
        bottom: calc(190px + env(safe-area-inset-bottom));
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 9px;
        font-family: system-ui, -apple-system, sans-serif;
      }

      #${ROOT_ID} button,
      #${APP_ID}-panel button,
      #${APP_ID}-edit-done {
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      #${ROOT_ID} > button {
        width: 46px;
        height: 46px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, .25);
        border-radius: 50%;
        background: rgba(25, 25, 28, .92);
        color: #fff;
        font: 21px/1 system-ui, sans-serif;
        box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
      }

      #${APP_ID}-panel {
        position: fixed;
        left: max(10px, env(safe-area-inset-left));
        right: max(10px, env(safe-area-inset-right));
        bottom: calc(76px + env(safe-area-inset-bottom));
        z-index: 2147483647;
        max-height: min(78dvh, 760px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 18px;
        background: rgba(24, 24, 27, .98);
        color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        box-shadow: 0 8px 30px rgba(0, 0, 0, .48);
      }

      #${APP_ID}-panel[hidden] {
        display: none !important;
      }

      #${APP_ID}-panel .yk-ai-row {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }

      #${APP_ID}-panel .yk-ai-wide {
        flex: 1;
        min-width: 0;
        min-height: 42px;
        padding: 8px 10px;
        border: 0;
        border-radius: 11px;
        font: 15px system-ui, sans-serif;
      }

      #${APP_ID}-panel .yk-ai-primary {
        display: grid;
        place-items: center;
        background: #fff;
        color: #111;
        text-align: center;
      }

      #${APP_ID}-panel .yk-ai-secondary {
        background: rgba(255, 255, 255, .12);
        color: #fff;
      }

      #${APP_ID}-status {
        margin: 4px 0 8px;
        color: rgba(255, 255, 255, .76);
        font-size: 13px;
        text-align: center;
      }

      #${APP_ID}-favorites {
        margin: 14px 0 16px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, .16);
      }

      #${APP_ID}-favorites-title {
        margin-bottom: 8px;
        text-align: center;
        font-weight: 700;
      }

      #${APP_ID}-favorites-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
      }

      #${APP_ID}-favorites-grid button {
        min-width: 0;
        height: 44px;
        padding: 0;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .22);
        border-radius: 9px;
        background: rgba(255, 255, 255, .08);
        color: #fff;
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;
        font: 14px system-ui, sans-serif;
      }

      #${APP_ID}-favorites-grid button.yk-ai-filled {
        color: transparent;
      }

      #${APP_ID}-favorites-grid button.yk-ai-active {
        border: 3px solid rgba(255, 255, 255, .98);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, .45), inset 0 0 0 1px rgba(255, 255, 255, .28);
      }

      #${APP_ID}-favorites-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      #${APP_ID}-favorites-actions button:disabled {
        opacity: .40;
      }

      #${APP_ID}-ranges {
        padding-top: 4px;
        border-top: 1px solid rgba(255, 255, 255, .16);
      }

      #${APP_ID}-ranges label {
        display: block;
        margin: 12px 0 4px;
        font-size: 14px;
      }

      #${APP_ID}-ranges input[type="range"] {
        width: 100%;
        accent-color: #fff;
      }

      #${APP_ID}-edit-layer {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        display: none;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        background: rgba(0, 0, 0, .035);
      }

      #${APP_ID}-edit-layer.yk-ai-active {
        display: block;
      }

      #${APP_ID}-edit-hint {
        position: fixed;
        left: 50%;
        top: calc(14px + env(safe-area-inset-top));
        z-index: 2147483646;
        display: none;
        transform: translateX(-50%);
        padding: 9px 13px;
        border-radius: 999px;
        background: rgba(20, 20, 22, .93);
        color: #fff;
        font: 14px system-ui, sans-serif;
        box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
        white-space: nowrap;
      }

      #${APP_ID}-edit-hint.yk-ai-active {
        display: block;
      }

      #${APP_ID}-edit-done {
        position: fixed;
        right: max(14px, env(safe-area-inset-right));
        bottom: calc(24px + env(safe-area-inset-bottom));
        z-index: 2147483647;
        display: none;
        min-width: 76px;
        height: 44px;
        border: 1px solid rgba(255, 255, 255, .25);
        border-radius: 999px;
        background: rgba(25, 25, 28, .96);
        color: #fff;
        font: 15px system-ui, sans-serif;
      }

      #${APP_ID}-edit-done.yk-ai-active {
        display: block;
      }

      #${APP_ID}-error {
        position: fixed;
        top: 150px;
        right: 10px;
        z-index: 2147483647;
        padding: 8px 10px;
        border-radius: 10px;
        background: #d93025;
        color: #fff;
        font: 700 13px system-ui, sans-serif;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function buildUi() {
    ui.layer = createElement('div', { id: `${APP_ID}-layer` });
    ui.shade = createElement('div', { id: `${APP_ID}-shade` });
    ui.editLayer = createElement('div', { id: `${APP_ID}-edit-layer` });
    ui.editHint = createElement('div', { id: `${APP_ID}-edit-hint` }, '1本指で移動・2本指で拡大縮小');
    ui.editDone = createElement('button', { id: `${APP_ID}-edit-done`, type: 'button' }, '完了');

    ui.root = createElement('div', { id: ROOT_ID });
    ui.toggle = createElement('button', {
      id: `${APP_ID}-toggle`,
      type: 'button',
      title: '背景のON/OFF',
      'aria-label': '背景のON/OFF'
    }, '○');
    ui.settingsButton = createElement('button', {
      id: `${APP_ID}-settings`,
      type: 'button',
      title: '背景設定',
      'aria-label': '背景設定'
    }, '⚙');
    ui.root.append(ui.toggle, ui.settingsButton);

    ui.panel = createElement('section', { id: `${APP_ID}-panel`, hidden: true });

    const topRow = createElement('div', { className: 'yk-ai-row' });
    ui.currentFileButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-primary',
      type: 'button'
    }, '背景画像を選ぶ');
    ui.fileInput = createElement('input', {
      id: `${APP_ID}-file`,
      type: 'file',
      accept: 'image/*',
      hidden: true
    });
    ui.closeButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-secondary',
      type: 'button'
    }, '閉じる');
    topRow.append(ui.currentFileButton, ui.closeButton, ui.fileInput);

    const editRow = createElement('div', { className: 'yk-ai-row' });
    ui.editButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-secondary',
      type: 'button'
    }, '背景を直接調整');
    editRow.appendChild(ui.editButton);

    ui.status = createElement('div', { id: `${APP_ID}-status` });

    const favorites = createElement('section', { id: `${APP_ID}-favorites` });
    favorites.appendChild(createElement('div', { id: `${APP_ID}-favorites-title` }, 'お気に入り 60枠'));
    ui.favoriteGrid = createElement('div', { id: `${APP_ID}-favorites-grid` });

    for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
      const button = createElement('button', {
        type: 'button',
        dataset: { slot: String(slot) },
        'aria-label': `空き枠 ${slotLabel(slot)}`
      }, slotLabel(slot));
      button.addEventListener('click', () => activateSlot(slot));
      ui.favoriteGrid.appendChild(button);
    }

    const favoriteActions = createElement('div', { id: `${APP_ID}-favorites-actions` });
    ui.overwriteButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-secondary',
      type: 'button'
    }, '選択中を上書き');
    ui.deleteFavoriteButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-secondary',
      type: 'button'
    }, '選択中を削除');
    favoriteActions.append(ui.overwriteButton, ui.deleteFavoriteButton);
    favorites.append(ui.favoriteGrid, favoriteActions);

    ui.ranges = createElement('section', { id: `${APP_ID}-ranges` });
    const siteName = SITE === 'chatgpt' ? 'ChatGPT' : 'Gemini';
    addRange(`${siteName}吹き出しの濃さ`, 'assistantOpacity', 0.10, 1, 0.02, '%', 100);
    addRange('自分の吹き出しの濃さ', 'userOpacity', 0.10, 1, 0.02, '%', 100);
    addRange('ガラスのぼかし', 'glassBlur', 0, 24, 1, 'px', 1);
    addRange('枠線の濃さ', 'borderOpacity', 0, 0.50, 0.02, '%', 100);
    addRange('背景の暗さ', 'darkness', 0, 0.80, 0.02, '%', 100);
    addRange('背景サイズ', 'size', 40, 400, 5, '%', 1);
    addRange('背景の左右位置', 'x', -200, 200, 2, '%', 1);
    addRange('背景の上下位置', 'y', -200, 200, 2, '%', 1);

    const bottomRow = createElement('div', { className: 'yk-ai-row', style: 'margin-top:16px' });
    ui.removeCurrentButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-secondary',
      type: 'button'
    }, '現在画像を外す');
    ui.resetButton = createElement('button', {
      className: 'yk-ai-wide yk-ai-secondary',
      type: 'button'
    }, '表示設定を初期化');
    bottomRow.append(ui.removeCurrentButton, ui.resetButton);

    ui.panel.append(topRow, editRow, ui.status, favorites, ui.ranges, bottomRow);
    document.body.append(ui.layer, ui.shade, ui.editLayer, ui.editHint, ui.editDone, ui.root, ui.panel);
  }

  function addRange(labelText, key, min, max, step, suffix, multiplier) {
    const label = createElement('label');
    const value = createElement('span', { id: `${APP_ID}-value-${key}` });
    label.append(document.createTextNode(`${labelText} `), value);

    const range = createElement('input', {
      id: `${APP_ID}-range-${key}`,
      type: 'range',
      min,
      max,
      step,
      dataset: { key, suffix, multiplier: String(multiplier) }
    });

    range.addEventListener('input', () => {
      state.settings[key] = clamp(numberOr(range.value, DEFAULTS[key]), min, max);
      updateRangeValue(range);
      queueSettingsSave();
      applyVisualState();

      if (key === 'size' || key === 'x' || key === 'y') {
        queueActiveSlotSave();
      }
    });

    ui.ranges.append(label, range);
  }

  function updateRangeValue(range) {
    const key = range.dataset.key;
    const multiplier = numberOr(range.dataset.multiplier, 1);
    const suffix = range.dataset.suffix || '';
    const value = document.getElementById(`${APP_ID}-value-${key}`);
    if (value) value.textContent = `${Math.round(state.settings[key] * multiplier)}${suffix}`;
  }

  function syncPanel() {
    ui.ranges.querySelectorAll('input[type="range"]').forEach((range) => {
      const key = range.dataset.key;
      range.value = String(state.settings[key]);
      updateRangeValue(range);
    });
    renderStatus();
  }

  function renderStatus() {
    if (!state.image) {
      ui.status.textContent = '背景画像は未選択です';
      return;
    }

    if (state.activeSlot && state.records.has(state.activeSlot)) {
      ui.status.textContent = `現在：お気に入り ${slotLabel(state.activeSlot)}`;
    } else {
      ui.status.textContent = '現在：単独画像（お気に入り未登録）';
    }
  }

  function applyVisualState() {
    const active = Boolean(state.settings.enabled && state.image);
    const html = document.documentElement;

    html.classList.toggle('yk-ai-bg-on', active);
    html.classList.toggle('yk-ai-site-chatgpt', SITE === 'chatgpt');
    html.classList.toggle('yk-ai-site-gemini', SITE === 'gemini');

    html.style.setProperty('--yk-ai-assistant', String(state.settings.assistantOpacity));
    html.style.setProperty('--yk-ai-user', String(state.settings.userOpacity));
    html.style.setProperty('--yk-ai-darkness', String(state.settings.darkness));
    html.style.setProperty('--yk-ai-size', `${state.settings.size}%`);
    html.style.setProperty('--yk-ai-x', `${state.settings.x}%`);
    html.style.setProperty('--yk-ai-y', `${state.settings.y}%`);
    html.style.setProperty('--yk-ai-glass-blur', `${state.settings.glassBlur}px`);
    html.style.setProperty('--yk-ai-border-opacity', String(state.settings.borderOpacity));

    ui.layer.style.backgroundImage = state.image ? `url("${state.image}")` : 'none';
    ui.layer.style.display = active ? 'block' : 'none';
    ui.shade.style.display = active ? 'block' : 'none';
    ui.toggle.textContent = active ? '◐' : '○';
    ui.toggle.setAttribute('aria-pressed', String(active));

    scheduleDomRefresh();
  }

  function openPanel() {
    syncPanel();
    ui.panel.hidden = false;
    refreshFavorites()
      .then(migrateMissingThumbnails)
      .catch((error) => warn('お気に入りを更新できませんでした。', error));
  }

  function closePanel() {
    ui.panel.hidden = true;
    renderFavorites();
  }

  function bindUiEvents() {
    ui.settingsButton.addEventListener('click', () => {
      if (ui.panel.hidden) openPanel();
      else closePanel();
    });

    ui.closeButton.addEventListener('click', closePanel);

    ui.toggle.addEventListener('click', () => {
      if (!state.image) {
        openPanel();
        return;
      }
      state.settings.enabled = !state.settings.enabled;
      saveSettingsNow();
      applyVisualState();
    });

    ui.fileInput.addEventListener('change', handleFileSelection);

    ui.currentFileButton.addEventListener('click', () => {
      state.pendingFileAction = { type: 'current' };
      ui.fileInput.click();
    });

    ui.overwriteButton.addEventListener('click', () => {
      if (!state.activeSlot || !state.records.has(state.activeSlot)) return;
      state.pendingFileAction = { type: 'slot', slot: state.activeSlot };
      ui.fileInput.click();
    });

    ui.deleteFavoriteButton.addEventListener('click', deleteActiveFavorite);

    ui.removeCurrentButton.addEventListener('click', () => {
      saveImage('');
      setActiveSlot(0);
      state.settings.enabled = false;
      saveSettingsNow();
      applyVisualState();
      renderFavorites();
      syncPanel();
    });

    ui.resetButton.addEventListener('click', () => {
      const enabled = state.settings.enabled;
      state.settings = { ...DEFAULTS, enabled };
      saveSettingsNow();
      applyVisualState();
      syncPanel();
      queueActiveSlotSave(0);
    });

    ui.editButton.addEventListener('click', startEditMode);
    ui.editDone.addEventListener('click', stopEditMode);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        saveSettingsNow();
        saveActiveSlotTransform().catch(() => {});
      } else {
        scheduleDomRefresh();
      }
    });

    window.addEventListener('pagehide', () => {
      saveSettingsNow();
      saveActiveSlotTransform().catch(() => {});
    });

    window.addEventListener('resize', scheduleDomRefresh, { passive: true });
    window.addEventListener('popstate', scheduleDomRefresh, { passive: true });
    window.addEventListener('hashchange', scheduleDomRefresh, { passive: true });
  }

  async function handleFileSelection(event) {
    const file = event.target.files && event.target.files[0];
    const action = state.pendingFileAction || { type: 'current' };
    state.pendingFileAction = null;
    event.target.value = '';

    if (!file) return;

    try {
      const prepared = await prepareImage(file);

      if (action.type === 'slot' && action.slot) {
        await saveActiveSlotTransform();
        const record = {
          slot: action.slot,
          image: prepared.image,
          thumb: prepared.thumb,
          size: state.settings.size,
          x: state.settings.x,
          y: state.settings.y,
          updatedAt: Date.now()
        };
        await dbPut(record);
        state.records.set(action.slot, toRecordMetadata(record));
        setActiveSlot(action.slot);
      } else {
        setActiveSlot(0);
      }

      saveImage(prepared.image);
      state.settings.enabled = true;
      saveSettingsNow();
      applyVisualState();
      renderFavorites();
      syncPanel();
    } catch (error) {
      warn('画像を読み込めませんでした。', error);
      alert('画像を読み込めませんでした。別の画像で試してください。');
    }
  }

  async function prepareImage(file) {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const full = renderImageDataUrl(image, 1440, 0.80);
    const thumb = renderImageDataUrl(image, 280, 0.70);
    return { image: full, thumb };
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image decode error'));
      image.src = source;
    });
  }

  function renderImageDataUrl(image, maxSide, quality) {
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas context unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    const webp = canvas.toDataURL('image/webp', quality);
    if (webp.startsWith('data:image/webp')) return webp;
    return canvas.toDataURL('image/jpeg', quality);
  }

  function openDatabase() {
    if (state.dbUnavailable) return Promise.reject(new Error('IndexedDB unavailable'));
    if (state.db) return Promise.resolve(state.db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
        }
      };

      request.onsuccess = () => {
        state.db = request.result;
        state.db.onversionchange = () => {
          state.db.close();
          state.db = null;
        };
        resolve(state.db);
      };

      request.onerror = () => {
        state.dbUnavailable = true;
        reject(request.error || new Error('IndexedDB open error'));
      };
    });
  }

  async function dbGet(slot) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(slot);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('IndexedDB get error'));
    });
  }

  async function dbListMetadata() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const result = [];
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(result);
          return;
        }
        const record = cursor.value;
        if (record && record.slot >= 1 && record.slot <= SLOT_COUNT && record.image) {
          result.push(toRecordMetadata(record));
        }
        cursor.continue();
      };

      request.onerror = () => reject(request.error || new Error('IndexedDB cursor error'));
    });
  }

  function toRecordMetadata(record) {
    return {
      slot: Number(record.slot),
      thumb: record.thumb || '',
      size: numberOr(record.size, DEFAULTS.size),
      x: numberOr(record.x, DEFAULTS.x),
      y: numberOr(record.y, DEFAULTS.y),
      updatedAt: numberOr(record.updatedAt, 0)
    };
  }

  async function dbPut(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB put error'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB put aborted'));
    });
  }

  async function dbDelete(slot) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(slot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB delete error'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB delete aborted'));
    });
  }

  async function refreshFavorites() {
    try {
      const records = await dbListMetadata();
      state.records = new Map(records.map((record) => [record.slot, record]));
      state.dbUnavailable = false;
    } catch (error) {
      state.dbUnavailable = true;
      warn('お気に入りDBを読み込めませんでした。', error);
    }

    if (state.activeSlot && !state.records.has(state.activeSlot)) setActiveSlot(0);
    renderFavorites();
  }

  function renderFavorites() {
    const showThumbnails = !ui.panel.hidden;

    ui.favoriteGrid.querySelectorAll('button[data-slot]').forEach((button) => {
      const slot = Number(button.dataset.slot);
      const record = state.records.get(slot);
      const filled = Boolean(record);
      const hasThumb = Boolean(record && record.thumb);
      const active = filled && slot === state.activeSlot;

      button.classList.toggle('yk-ai-filled', filled && hasThumb && showThumbnails);
      button.classList.toggle('yk-ai-active', active);
      button.textContent = filled && hasThumb && showThumbnails ? '' : slotLabel(slot);
      button.style.backgroundImage = filled && hasThumb && showThumbnails ? `url("${record.thumb}")` : 'none';
      button.setAttribute('aria-label', `${filled ? 'お気に入り' : '空き枠'} ${slotLabel(slot)}${active ? ' 選択中' : ''}`);
    });

    const canEdit = Boolean(state.activeSlot && state.records.has(state.activeSlot));
    ui.overwriteButton.disabled = !canEdit || state.dbUnavailable;
    ui.deleteFavoriteButton.disabled = !canEdit || state.dbUnavailable;
    renderStatus();
  }

  async function migrateMissingThumbnails() {
    if (state.thumbnailMigrationRunning || state.dbUnavailable || ui.panel.hidden) return;
    state.thumbnailMigrationRunning = true;

    try {
      const missingSlots = Array.from(state.records.values())
        .filter((record) => !record.thumb)
        .map((record) => record.slot);

      for (const slot of missingSlots) {
        if (ui.panel.hidden) break;
        const record = await dbGet(slot);
        if (!record || !record.image || record.thumb) continue;

        try {
          const image = await loadImage(record.image);
          record.thumb = renderImageDataUrl(image, 280, 0.70);
          record.updatedAt = Date.now();
          await dbPut(record);
          state.records.set(slot, toRecordMetadata(record));
          renderFavorites();
          await new Promise((resolve) => window.setTimeout(resolve, 40));
        } catch (error) {
          warn(`お気に入り${slot}のサムネイルを作成できませんでした。`, error);
        }
      }
    } finally {
      state.thumbnailMigrationRunning = false;
    }
  }

  async function activateSlot(slot) {
    const metadata = state.records.get(slot);

    if (!metadata) {
      if (state.dbUnavailable) {
        alert('お気に入り保存領域を利用できません。Firefoxのサイトデータ設定を確認してください。');
        return;
      }
      state.pendingFileAction = { type: 'slot', slot };
      ui.fileInput.click();
      return;
    }

    try {
      await saveActiveSlotTransform();
      const record = await dbGet(slot);
      if (!record || !record.image) throw new Error('Favorite image is missing');

      setActiveSlot(slot);
      saveImage(record.image);
      state.settings.size = clamp(numberOr(record.size, DEFAULTS.size), ...LIMITS.size);
      state.settings.x = clamp(numberOr(record.x, DEFAULTS.x), ...LIMITS.x);
      state.settings.y = clamp(numberOr(record.y, DEFAULTS.y), ...LIMITS.y);
      state.settings.enabled = true;
      saveSettingsNow();
      applyVisualState();
      syncPanel();
      renderFavorites();
    } catch (error) {
      warn('お気に入りを切り替えられませんでした。', error);
      alert('お気に入りを切り替えられませんでした。');
    }
  }

  function queueActiveSlotSave(delay = 280) {
    clearTimeout(state.slotSaveTimer);
    state.slotSaveTimer = window.setTimeout(() => {
      saveActiveSlotTransform().catch((error) => warn('画像位置を保存できませんでした。', error));
    }, delay);
  }

  async function saveActiveSlotTransform() {
    clearTimeout(state.slotSaveTimer);
    state.slotSaveTimer = 0;

    if (!state.activeSlot || state.dbUnavailable) return;
    const metadata = state.records.get(state.activeSlot);
    if (!metadata) return;

    if (metadata.size === state.settings.size &&
        metadata.x === state.settings.x &&
        metadata.y === state.settings.y) return;

    const record = await dbGet(state.activeSlot);
    if (!record || !record.image) return;

    record.size = state.settings.size;
    record.x = state.settings.x;
    record.y = state.settings.y;
    record.updatedAt = Date.now();
    await dbPut(record);
    state.records.set(state.activeSlot, toRecordMetadata(record));
  }

  async function deleteActiveFavorite() {
    const slot = state.activeSlot;
    if (!slot || !state.records.has(slot)) return;
    if (!confirm(`お気に入り ${slotLabel(slot)} を削除しますか？`)) return;

    try {
      await dbDelete(slot);
      state.records.delete(slot);
      setActiveSlot(0);
      renderFavorites();
      syncPanel();
    } catch (error) {
      warn('お気に入りを削除できませんでした。', error);
      alert('お気に入りを削除できませんでした。');
    }
  }

  function startEditMode() {
    if (!state.image) {
      alert('先に背景画像を選んでください。');
      return;
    }

    state.settings.enabled = true;
    saveSettingsNow();
    applyVisualState();
    closePanel();

    state.editing = true;
    ui.editLayer.classList.add('yk-ai-active');
    ui.editHint.classList.add('yk-ai-active');
    ui.editDone.classList.add('yk-ai-active');
    ui.root.style.display = 'none';
  }

  function stopEditMode() {
    state.editing = false;
    pointers.clear();
    dragStart = null;
    pinchStart = null;

    ui.editLayer.classList.remove('yk-ai-active');
    ui.editHint.classList.remove('yk-ai-active');
    ui.editDone.classList.remove('yk-ai-active');
    ui.root.style.display = 'flex';

    saveSettingsNow();
    syncPanel();
    saveActiveSlotTransform().catch((error) => warn('画像位置を保存できませんでした。', error));
  }

  function bindEditGestures() {
    ui.editLayer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        ui.editLayer.setPointerCapture(event.pointerId);
      } catch (_) {}

      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 1) {
        dragStart = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: state.settings.x,
          y: state.settings.y
        };
        pinchStart = null;
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinchStart = {
          distance: pointerDistance(a, b),
          size: state.settings.size
        };
        dragStart = null;
      }
    });

    ui.editLayer.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 1 && dragStart) {
        const point = pointers.get(event.pointerId);
        const dx = point.x - dragStart.startX;
        const dy = point.y - dragStart.startY;
        state.settings.x = clamp(dragStart.x + (dx / Math.max(1, innerWidth)) * 180, ...LIMITS.x);
        state.settings.y = clamp(dragStart.y + (dy / Math.max(1, innerHeight)) * 180, ...LIMITS.y);
        applyVisualState();
      } else if (pointers.size === 2 && pinchStart) {
        const [a, b] = Array.from(pointers.values());
        const currentDistance = pointerDistance(a, b);
        if (pinchStart.distance > 0) {
          state.settings.size = clamp(pinchStart.size * (currentDistance / pinchStart.distance), ...LIMITS.size);
          applyVisualState();
        }
      }
    });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      try {
        if (ui.editLayer.hasPointerCapture(event.pointerId)) {
          ui.editLayer.releasePointerCapture(event.pointerId);
        }
      } catch (_) {}

      if (pointers.size === 1) {
        const [pointerId, point] = Array.from(pointers.entries())[0];
        dragStart = {
          pointerId,
          startX: point.x,
          startY: point.y,
          x: state.settings.x,
          y: state.settings.y
        };
        pinchStart = null;
      } else if (pointers.size === 0) {
        dragStart = null;
        pinchStart = null;
        queueSettingsSave(0);
        queueActiveSlotSave(0);
      }
    };

    ui.editLayer.addEventListener('pointerup', endPointer);
    ui.editLayer.addEventListener('pointercancel', endPointer);
  }

  function pointerDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function scheduleDomRefresh() {
    clearTimeout(state.domRefreshTimer);
    state.domRefreshTimer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        markMessageBubbles();
        if (SITE === 'gemini') markGeminiLargeSurfaces();
      });
    }, 70);
  }

  function markMessageBubbles() {
    if (SITE === 'gemini') markGeminiBubbles();
    else markChatGptBubbles();
  }

  function markGeminiBubbles() {
    document.querySelectorAll('model-response').forEach((response) => {
      const target = response.querySelector(':scope > .response-container') ||
        response.querySelector('.response-container') || response;
      target.classList.add('yk-ai-assistant-bubble');
    });

    document.querySelectorAll('user-query').forEach((query) => {
      const target = query.querySelector(':scope > .query-content') ||
        query.querySelector('.query-content') ||
        query.querySelector('.query-text') || query;
      target.classList.add('yk-ai-user-bubble');
    });
  }

  function markChatGptBubbles() {
    document.querySelectorAll('[data-message-author-role="assistant"]').forEach((message) => {
      message.classList.add('yk-ai-assistant-bubble');
    });

    document.querySelectorAll('[data-message-author-role="user"]').forEach((message) => {
      const existing = message.querySelector('.yk-ai-user-bubble');
      if (existing) return;

      const preferred = message.querySelector(
        '[class*="user-message-bubble"], [class*="message-surface"], [class*="rounded-3xl"]'
      );
      if (preferred && preferred !== message) {
        preferred.classList.add('yk-ai-user-bubble');
        return;
      }

      const messageRect = message.getBoundingClientRect();
      const candidates = Array.from(message.querySelectorAll('div')).filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 28 || rect.height < 22 || rect.width >= messageRect.width * 0.97) return false;
        const style = getComputedStyle(element);
        const radius = parseFloat(style.borderTopLeftRadius) || 0;
        const visibleBackground = style.backgroundColor &&
          style.backgroundColor !== 'transparent' &&
          style.backgroundColor !== 'rgba(0, 0, 0, 0)';
        return radius >= 10 && (visibleBackground || element.textContent.trim().length > 0);
      });

      candidates.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });

      if (candidates[0]) candidates[0].classList.add('yk-ai-user-bubble');
      else message.classList.add('yk-ai-user-bubble');
    });
  }

  function markGeminiLargeSurfaces() {
    if (!document.documentElement.classList.contains('yk-ai-bg-on')) return;

    document.querySelectorAll('.yk-ai-large-surface').forEach((element) => {
      if (!isLargeDarkSurface(element)) element.classList.remove('yk-ai-large-surface');
    });

    const candidates = new Set();
    const selectors = [
      'main', 'chat-window', 'conversation-container', 'infinite-scroller',
      '.chat-window', '.conversation-container', '.chat-history',
      '.scroll-container', '.content-container'
    ];

    document.querySelectorAll(selectors.join(',')).forEach((root) => {
      candidates.add(root);

      let ancestor = root.parentElement;
      for (let depth = 0; ancestor && ancestor !== document.body && depth < 3; depth += 1) {
        candidates.add(ancestor);
        ancestor = ancestor.parentElement;
      }

      try {
        root.querySelectorAll(':scope > div, :scope > section, :scope > * > div, :scope > * > section')
          .forEach((element) => candidates.add(element));
      } catch (_) {}
    });

    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    let current = center;
    for (let depth = 0; current && current !== document.body && depth < 7; depth += 1) {
      candidates.add(current);
      current = current.parentElement;
    }

    candidates.forEach((element) => {
      if (isLargeDarkSurface(element)) element.classList.add('yk-ai-large-surface');
    });
  }

  function isLargeDarkSurface(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.id && element.id.startsWith(APP_ID)) return false;
    if (element.closest(`#${ROOT_ID}, #${APP_ID}-panel, #${APP_ID}-edit-layer`)) return false;
    if (element.matches('input, textarea, button, [contenteditable="true"], form, footer')) return false;
    if (element.closest('input-area-v2, input-area, .input-area, [class*="input-area"]')) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < innerWidth * 0.86 || rect.height < innerHeight * 0.30) return false;

    const style = getComputedStyle(element);
    return isNearBlack(style.backgroundColor);
  }

  function isNearBlack(color) {
    const values = String(color).match(/[\d.]+/g);
    if (!values || values.length < 3) return false;

    const red = Number(values[0]);
    const green = Number(values[1]);
    const blue = Number(values[2]);
    const alpha = values.length >= 4 ? Number(values[3]) : 1;
    return alpha > 0.45 && red < 34 && green < 34 && blue < 38;
  }

  function observeDom() {
    const observer = new MutationObserver(scheduleDomRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    state.observer = observer;
  }

  function showFatalError(error) {
    console.error('[AI Background] 初期化に失敗しました。', error);
    const badge = createElement('div', { id: `${APP_ID}-error` }, 'AI BG Error');
    (document.body || document.documentElement).appendChild(badge);
  }

  async function init() {
    loadState();
    addStyles();
    buildUi();
    bindUiEvents();
    bindEditGestures();
    observeDom();

    await refreshFavorites();
    syncPanel();
    applyVisualState();
    scheduleDomRefresh();
    window.setTimeout(scheduleDomRefresh, 700);
    window.setTimeout(scheduleDomRefresh, 1800);
    log(`${SITE}で起動しました。`);
  }

  init().catch(showFatalError);
})();
