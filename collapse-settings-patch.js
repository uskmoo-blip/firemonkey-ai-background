(() => {
  'use strict';

  const PANEL_ID = 'yk-ai-bg-panel';
  const RANGES_ID = 'yk-ai-bg-ranges';
  const DETAILS_ID = 'yk-ai-bg-advanced';
  const BODY_ID = 'yk-ai-bg-advanced-body';
  const STYLE_ID = 'yk-ai-bg-collapse-style';

  function addStyle() {
    if (document.getElementById(STYLE_ID) || !document.documentElement) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${DETAILS_ID} {
        margin-top: 4px;
        border-top: 1px solid rgba(255, 255, 255, .16);
      }

      #${DETAILS_ID} > summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 46px;
        box-sizing: border-box;
        padding: 0 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, .10);
        color: #fff;
        cursor: pointer;
        list-style: none;
        font: 700 15px system-ui, sans-serif;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      #${DETAILS_ID} > summary::marker,
      #${DETAILS_ID} > summary::-webkit-details-marker {
        display: none;
        content: '';
      }

      #${DETAILS_ID} > summary::after {
        content: '▼';
        margin-left: 10px;
        font-size: 12px;
        opacity: .78;
        transition: transform .16s ease;
      }

      #${DETAILS_ID}[open] > summary::after {
        transform: rotate(180deg);
      }

      #${BODY_ID} {
        padding-top: 8px;
      }

      #${DETAILS_ID} #${RANGES_ID} {
        padding-top: 0 !important;
        border-top: 0 !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function findBottomRow(panel, ranges) {
    const next = ranges.nextElementSibling;
    if (next && next.textContent.includes('現在画像を外す')) return next;

    return Array.from(panel.children).find((element) =>
      element !== ranges && element.textContent.includes('現在画像を外す')
    ) || null;
  }

  function applyCollapse() {
    addStyle();

    const panel = document.getElementById(PANEL_ID);
    const ranges = document.getElementById(RANGES_ID);
    if (!panel || !ranges) return false;

    const existing = document.getElementById(DETAILS_ID);
    if (existing?.contains(ranges)) return true;
    existing?.remove();

    const bottomRow = findBottomRow(panel, ranges);
    if (!bottomRow) return false;

    const details = document.createElement('details');
    details.id = DETAILS_ID;

    const summary = document.createElement('summary');
    summary.textContent = '詳細設定';

    const body = document.createElement('div');
    body.id = BODY_ID;

    ranges.before(details);
    body.append(ranges, bottomRow);
    details.append(summary, body);
    return true;
  }

  const observer = new MutationObserver(() => applyCollapse());

  function start() {
    addStyle();
    applyCollapse();

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  window.addEventListener('pageshow', applyCollapse, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyCollapse();
  }, true);
})();
