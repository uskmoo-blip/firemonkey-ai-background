(() => {
  'use strict';

  const APP_ID = 'yk-ai-bg';
  const PANEL_ID = `${APP_ID}-panel`;
  const FAVORITES_ID = `${APP_ID}-favorites`;
  const SECTION_ID = `${APP_ID}-transfer`;
  const STYLE_ID = `${APP_ID}-transfer-style`;
  const INPUT_ID = `${APP_ID}-transfer-file`;

  const KEY_SETTINGS = 'yk-gem-bg-settings-v1';
  const KEY_IMAGE = 'yk-gem-bg-image-v1';
  const KEY_ACTIVE_SLOT = 'yk-gem-bg-fav9-active-slot';
  const DB_NAME = 'yk-gem-bg-fav9-db';
  const STORE_NAME = 'favorites';
  const SLOT_COUNT = 60;
  const BACKUP_KIND = 'yk-ai-background-backup';
  const BACKUP_VERSION = 1;

  let busy = false;

  function addStyle() {
    if (document.getElementById(STYLE_ID) || !document.documentElement) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SECTION_ID} {
        margin: 4px 0 14px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, .16);
      }

      #${SECTION_ID} .yk-ai-transfer-title {
        margin-bottom: 4px;
        text-align: center;
        font-weight: 700;
      }

      #${SECTION_ID} .yk-ai-transfer-note {
        margin: 0 4px 9px;
        color: rgba(255, 255, 255, .68);
        font-size: 12px;
        line-height: 1.45;
        text-align: center;
      }

      #${SECTION_ID} .yk-ai-transfer-row {
        display: flex;
        gap: 8px;
      }

      #${SECTION_ID} button {
        flex: 1;
        min-width: 0;
        min-height: 42px;
        padding: 8px 9px;
        border: 0;
        border-radius: 11px;
        background: rgba(255, 255, 255, .12);
        color: #fff;
        font: 14px system-ui, sans-serif;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      #${SECTION_ID} button:disabled {
        opacity: .52;
      }

      #${SECTION_ID} .yk-ai-transfer-status {
        min-height: 18px;
        margin-top: 7px;
        color: rgba(255, 255, 255, .72);
        font-size: 12px;
        text-align: center;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function siteName() {
    if (location.hostname === 'gemini.google.com') return 'gemini';
    if (location.hostname === 'chatgpt.com') return 'chatgpt';
    return location.hostname.replace(/[^a-z0-9.-]/gi, '_') || 'site';
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open error'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  async function readAllFavorites() {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error('IndexedDB getAll error'));
      });
    } finally {
      db.close();
    }
  }

  async function replaceAllFavorites(records) {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();

        records.forEach((record) => store.put(record));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB replace error'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB replace aborted'));
      });
    } finally {
      db.close();
    }
  }

  function parseSettings() {
    try {
      const raw = localStorage.getItem(KEY_SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function sanitiseRecord(source) {
    if (!source || typeof source !== 'object') return null;

    const slot = Number(source.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return null;
    if (typeof source.image !== 'string' || !source.image.startsWith('data:image/')) return null;

    return {
      slot,
      image: source.image,
      thumb: typeof source.thumb === 'string' ? source.thumb : '',
      size: Number.isFinite(Number(source.size)) ? Number(source.size) : 120,
      x: Number.isFinite(Number(source.x)) ? Number(source.x) : 50,
      y: Number.isFinite(Number(source.y)) ? Number(source.y) : 20,
      updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now()
    };
  }

  function validateBackup(value) {
    if (!value || typeof value !== 'object') throw new Error('バックアップ形式ではありません。');
    if (value.kind !== BACKUP_KIND) throw new Error('このスクリプト用のバックアップではありません。');
    if (Number(value.version) !== BACKUP_VERSION) throw new Error('未対応のバックアップバージョンです。');

    const favorites = Array.isArray(value.favorites)
      ? value.favorites.map(sanitiseRecord).filter(Boolean)
      : [];

    const unique = new Map();
    favorites.forEach((record) => unique.set(record.slot, record));

    return {
      settings: value.settings && typeof value.settings === 'object' ? value.settings : {},
      image: typeof value.image === 'string' ? value.image : '',
      activeSlot: Math.max(0, Math.min(SLOT_COUNT, Number(value.activeSlot) || 0)),
      favorites: Array.from(unique.values()).sort((a, b) => a.slot - b.slot),
      sourceSite: typeof value.sourceSite === 'string' ? value.sourceSite : 'unknown'
    };
  }

  function setStatus(message) {
    const status = document.querySelector(`#${SECTION_ID} .yk-ai-transfer-status`);
    if (status) status.textContent = message || '';
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll(`#${SECTION_ID} button`).forEach((button) => {
      button.disabled = value;
    });
  }

  function fileStamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  async function exportBackup() {
    if (busy) return;
    setBusy(true);
    setStatus('バックアップを作成しています…');

    try {
      const favorites = await readAllFavorites();
      const backup = {
        kind: BACKUP_KIND,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        sourceSite: siteName(),
        settings: parseSettings(),
        image: localStorage.getItem(KEY_IMAGE) || '',
        activeSlot: Number(localStorage.getItem(KEY_ACTIVE_SLOT)) || 0,
        favorites
      };

      const json = JSON.stringify(backup);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ai-background-${siteName()}-${fileStamp()}.json`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);

      setStatus(`書き出しました（お気に入り ${favorites.length}件）`);
    } catch (error) {
      console.error('[AI Background Transfer] export failed', error);
      setStatus('書き出しに失敗しました');
      alert('バックアップを書き出せませんでした。空き容量やFirefoxのダウンロード設定を確認してください。');
    } finally {
      setBusy(false);
    }
  }

  async function importBackupFile(file) {
    if (busy || !file) return;
    setBusy(true);
    setStatus('バックアップを確認しています…');

    try {
      const text = await file.text();
      const backup = validateBackup(JSON.parse(text));

      const sourceLabel = backup.sourceSite === 'gemini'
        ? 'Gemini'
        : backup.sourceSite === 'chatgpt' ? 'ChatGPT' : backup.sourceSite;

      const ok = confirm(
        `${sourceLabel}のバックアップをこのサイトへ読み込みます。\n\n` +
        `お気に入り ${backup.favorites.length}件と表示設定を、現在の内容と置き換えます。続けますか？`
      );
      if (!ok) {
        setStatus('読み込みをキャンセルしました');
        return;
      }

      setStatus('お気に入りを保存しています…');
      await replaceAllFavorites(backup.favorites);

      localStorage.setItem(KEY_SETTINGS, JSON.stringify(backup.settings));
      if (backup.image) localStorage.setItem(KEY_IMAGE, backup.image);
      else localStorage.removeItem(KEY_IMAGE);
      localStorage.setItem(KEY_ACTIVE_SLOT, String(backup.activeSlot));

      setStatus('読み込み完了。画面を更新します…');
      window.setTimeout(() => location.reload(), 500);
    } catch (error) {
      console.error('[AI Background Transfer] import failed', error);
      setStatus('読み込みに失敗しました');
      alert(`バックアップを読み込めませんでした。\n${error && error.message ? error.message : 'ファイルを確認してください。'}`);
    } finally {
      setBusy(false);
    }
  }

  function buildSection() {
    addStyle();

    const panel = document.getElementById(PANEL_ID);
    const favorites = document.getElementById(FAVORITES_ID);
    if (!panel || !favorites) return false;
    if (document.getElementById(SECTION_ID)) return true;

    const section = document.createElement('section');
    section.id = SECTION_ID;

    const title = document.createElement('div');
    title.className = 'yk-ai-transfer-title';
    title.textContent = '設定の移行・バックアップ';

    const note = document.createElement('p');
    note.className = 'yk-ai-transfer-note';
    note.textContent = 'Geminiで書き出し、ChatGPTで読み込むとお気に入り画像と表示設定をコピーできます。';

    const row = document.createElement('div');
    row.className = 'yk-ai-transfer-row';

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = '書き出す';
    exportButton.addEventListener('click', exportBackup);

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = '読み込む';

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      await importBackupFile(file);
    });

    importButton.addEventListener('click', () => input.click());

    const status = document.createElement('div');
    status.className = 'yk-ai-transfer-status';

    row.append(exportButton, importButton);
    section.append(title, note, row, input, status);
    favorites.after(section);
    return true;
  }

  const observer = new MutationObserver(buildSection);

  function start() {
    addStyle();
    buildSection();
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  window.addEventListener('pageshow', buildSection, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) buildSection();
  }, true);
})();