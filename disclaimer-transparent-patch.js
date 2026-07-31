(() => {
  'use strict';

  const STYLE_ID = 'yk-ai-disclaimer-transparent-style';

  function applyStyle() {
    if (!document.documentElement || document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.yk-ai-bg-on.yk-ai-site-chatgpt .yk-ai-disclaimer-soft {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border: 0 !important;
        border-color: transparent !important;
        border-radius: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  applyStyle();
  window.addEventListener('pageshow', applyStyle, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyStyle();
  }, true);
})();
