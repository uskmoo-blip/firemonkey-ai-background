// ==UserScript==
// @name         AI Chat Background Unified (Android)
// @namespace    yk.local.ai.chat.background
// @version      1.4.1
// @description  ChatGPT / Gemini共通。横長画像の自動フィット、ChatGPTフッター透過、設定移行に対応した背景カスタマイズ統合版です。
// @match        https://chatgpt.com/*
// @match        https://gemini.google.com/*
// @run-at       document-start
// @noframes
// @grant        GM.info
// @require      https://raw.githubusercontent.com/uskmoo-blip/firemonkey-ai-background/main/ai-chat-background.user.js?v=1.1.0
// @require      https://raw.githubusercontent.com/uskmoo-blip/firemonkey-ai-background/main/collapse-settings-patch.js?v=1.2.0
// @require      https://raw.githubusercontent.com/uskmoo-blip/firemonkey-ai-background/main/transfer-settings-patch.js?v=1.3.0
// @require      https://raw.githubusercontent.com/uskmoo-blip/firemonkey-ai-background/main/display-fixes-patch.js?v=1.4.1
// @updateURL    https://raw.githubusercontent.com/uskmoo-blip/firemonkey-ai-background/main/install.user.js
// @downloadURL  https://raw.githubusercontent.com/uskmoo-blip/firemonkey-ai-background/main/install.user.js
// @homepageURL  https://github.com/uskmoo-blip/firemonkey-ai-background
// ==/UserScript==

// 本体とUI補助モジュールは @require で読み込みます。
