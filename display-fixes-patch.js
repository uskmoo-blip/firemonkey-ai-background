(() => {
  'use strict';

  const APP_ID = 'yk-ai-bg';
  const FILE_ID = `${APP_ID}-file`;
  const RANGES_ID = `${APP_ID}-ranges`;
  const FIT_ROW_ID = `${APP_ID}-fit-row`;
  const FIT_BUTTON_ID = `${APP_ID}-fit-cover`;
  const STYLE_ID = `${APP_ID}-display-fixes-style`;
  const KEY_IMAGE = 'yk-gem-bg-image-v1';
  const DISCLAIMER_CLASS = 'yk-ai-disclaimer-soft';
  const COMPOSER_SHELL_CLASS = 'yk-ai-composer-shell-clear';
  const DISCLAIMER_TEXT = 'ChatGPT の回答は必ずしも正しいとは限りません';

  let scanQueued = false;

  function addStyle() {
    if (document.getElementById(STYLE_ID) || !document.documentElement) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${FIT_ROW_ID} {
        display: flex;
        margin: 0 0 10px;
      }

      #${FIT_BUTTON_ID} {
        width: 100%;
        min-height: 42px;
        padding: 8px 10px;
        border: 0;
        border-radius: 11px;
        background: rgba(255, 255, 255, .12);
        color: #fff;
        font: 14px system-ui, sans-serif;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      html.yk-ai-bg-on .${DISCLAIMER_CLASS} {
        background: rgba(14, 14, 16, .10) !important;
        background-color: rgba(14, 14, 16, .10) !important;
        background-image: none !important;
        border-color: transparent !important;
        outline: none !important;
        box-shadow: none !important;
        backdrop-filter: blur(1px) !important;
        -webkit-backdrop-filter: blur(1px) !important;
      }

      html.yk-ai-bg-on.yk-ai-site-chatgpt .${COMPOSER_SHELL_CLASS} {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
        outline: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setRange(key, value) {
    const range = document.getElementById(`${APP_ID}-range-${key}`);
    if (!range) return false;
    range.value = String(value);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function coverSizeForImage(width, height) {
    const imageRatio = Math.max(0.01, width / Math.max(1, height));
    const viewportRatio = Math.max(0.01, innerWidth / Math.max(1, innerHeight));
    const raw = Math.max(100, (imageRatio / viewportRatio) * 100);
    return clamp(Math.ceil(raw / 5) * 5, 40, 400);
  }

  function applyCover(width, height) {
    if (!width || !height) return false;
    const size = coverSizeForImage(width, height);
    const applied = setRange('size', size);
    setRange('x', 50);
    setRange('y', 50);
    return applied;
  }

  function loadImageDimensions(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
      image.onerror = () => reject(new Error('Image decode error'));
      image.src = source;
    });
  }

  async function fitCurrentImage() {
    const source = localStorage.getItem(KEY_IMAGE) || '';
    if (!source) {
      alert('先に背景画像を選んでください。');
      return;
    }

    try {
      const dimensions = await loadImageDimensions(source);
      applyCover(dimensions.width, dimensions.height);
    } catch (error) {
      console.warn('[AI Background Display Fix] fit failed', error);
      alert('画像サイズを確認できませんでした。');
    }
  }

  function ensureFitButton() {
    const ranges = document.getElementById(RANGES_ID);
    if (!ranges) return false;

    let row = document.getElementById(FIT_ROW_ID);
    if (!row) {
      row = document.createElement('div');
      row.id = FIT_ROW_ID;

      const button = document.createElement('button');
      button.id = FIT_BUTTON_ID;
      button.type = 'button';
      button.textContent = '画面いっぱいに合わせる';
      button.addEventListener('click', fitCurrentImage);
      row.appendChild(button);
    }

    if (row.parentElement !== ranges.parentElement || row.nextElementSibling !== ranges) {
      ranges.before(row);
    }
    return true;
  }

  function bindAutoFit() {
    const input = document.getElementById(FILE_ID);
    if (!input || input.dataset.ykAutoFitBound === '1') return false;
    input.dataset.ykAutoFitBound = '1';

    input.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      loadImageDimensions(url)
        .then(({ width, height }) => {
          applyCover(width, height);
          window.setTimeout(() => applyCover(width, height), 450);
          window.setTimeout(() => applyCover(width, height), 1200);
        })
        .catch((error) => console.warn('[AI Background Display Fix] auto fit failed', error))
        .finally(() => URL.revokeObjectURL(url));
    }, true);

    return true;
  }

  function softenDisclaimer() {
    if (location.hostname !== 'chatgpt.com' || !document.body) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!text.includes(DISCLAIMER_TEXT)) continue;

      let element = node.parentElement;
      let level = 0;
      while (element && level < 6) {
        const rect = element.getBoundingClientRect();
        if (rect.height > 0 && rect.height <= 190 && rect.width >= 120) {
          element.classList.add(DISCLAIMER_CLASS);
        }
        if (element.matches('form') || element.querySelector('textarea,[contenteditable="true"]')) break;
        element = element.parentElement;
        level += 1;
      }
      break;
    }
  }

  function findComposerInput() {
    if (location.hostname !== 'chatgpt.com' || !document.body) return null;

    const candidates = Array.from(document.querySelectorAll(
      'textarea, [contenteditable="true"], [data-virtualkeyboard="true"]'
    )).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width >= 120 &&
        rect.height > 0 &&
        rect.bottom >= innerHeight * 0.58;
    });

    candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return candidates[0] || null;
  }

  function clearComposerFooter() {
    const input = findComposerInput();
    if (!input) return;

    const inputRect = input.getBoundingClientRect();
    let element = input.closest('form') || input.parentElement;
    let level = 0;

    while (element && level < 8 && element !== document.body && element !== document.documentElement) {
      const rect = element.getBoundingClientRect();
      const broad = rect.width >= innerWidth * 0.82;
      const nearBottom = rect.bottom >= innerHeight - 140;
      const footerSized = rect.height >= inputRect.height + 18 && rect.height <= Math.min(500, innerHeight * 0.48);

      if (broad && nearBottom && footerSized) {
        element.classList.add(COMPOSER_SHELL_CLASS);
      }

      if (element.matches('main,[role="main"]')) break;
      element = element.parentElement;
      level += 1;
    }
  }

  function scan() {
    scanQueued = false;
    addStyle();
    ensureFitButton();
    bindAutoFit();
    softenDisclaimer();
    clearComposerFooter();
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    window.setTimeout(scan, 80);
  }

  const observer = new MutationObserver(queueScan);

  function start() {
    scan();
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  window.addEventListener('pageshow', queueScan, true);
  window.addEventListener('resize', queueScan, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) queueScan();
  }, true);
})();
