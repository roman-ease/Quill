'use strict';
/* global ipcRenderer, document, Tabs, Preview, Settings, Notifications */

/**
 * Export Manager — HTML / PDF エクスポート
 */
const ExportManager = (() => {

  async function exportHtml() {
    const tab = Tabs.getActiveTab();
    if (!tab) { Notifications.show('タブが選択されていません', 'warning'); return; }

    const result = await ipcRenderer.invoke('show-save-dialog', (tab.filePath || 'document').replace(/\.md$/, '') + '.html');
    if (result.canceled) return;

    const previewBody = Preview.getPreviewHTML();
    const theme = Settings.get('theme');

    // CSS 変数を実値に解決
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const cssVars = [
      '--bg-base', '--bg-surface', '--bg-elevated', '--text-primary', '--text-secondary',
      '--preview-bg', '--preview-text', '--preview-code-bg', '--preview-border',
      '--preview-link', '--preview-blockquote-border', '--preview-blockquote-bg',
      '--preview-table-header', '--preview-table-border', '--preview-table-stripe',
    ].map(v => `${v}: ${cs.getPropertyValue(v).trim()};`).join('\n  ');

    // hljs スタイル取得
    const hljsThemeEl = document.getElementById('hljs-theme');
    let hljsCss = '';
    try {
      const res = await fetch(hljsThemeEl.href);
      hljsCss = await res.text();
    } catch { /* ignore */ }

    const html = `<!DOCTYPE html>
<html lang="ja" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_esc(tab.title)}</title>
  <style>
    :root { ${cssVars} }
    ${_getPreviewCssInlined()}
    ${hljsCss}
  </style>
</head>
<body style="background:var(--preview-bg);color:var(--preview-text);margin:0;padding:0;">
  <div id="preview-content" style="padding:24px 32px;">
    <div class="preview-body">
      ${previewBody}
    </div>
  </div>
</body>
</html>`;

    const res = await ipcRenderer.invoke('write-file', result.filePath, html, 'utf8', 'lf');
    if (res.success) {
      Notifications.show(`HTML を出力しました: ${result.filePath}`, 'success');
    } else {
      Notifications.show(`出力エラー: ${res.error}`, 'error');
    }
  }

  async function exportPdf() {
    const tab = Tabs.getActiveTab();
    if (!tab) { Notifications.show('タブが選択されていません', 'warning'); return; }

    const previewBody = Preview.getPreviewHTML();

    // PDF は常に白背景なので hljs も明色テーマ固定
    let hljsCss = '';
    try {
      const fs = require('fs');
      const path = require('path');
      const hljsPath = path.join(__dirname, '../../../node_modules/highlight.js/styles/github.min.css');
      hljsCss = fs.readFileSync(hljsPath, 'utf8');
    } catch { /* ignore */ }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root {
    --preview-bg: #ffffff;
    --preview-text: #1a1a1a;
    --preview-code-bg: #f5f5f5;
    --preview-border: #d0d0d0;
    --preview-link: #1a5fa8;
    --preview-blockquote-border: #b0b0b0;
    --preview-blockquote-bg: #f9f9f9;
    --preview-table-header: #eeeeee;
    --preview-table-border: #cccccc;
    --preview-table-stripe: #f5f5f5;
  }
  ${_getPreviewCssInlined()}
  ${hljsCss}
  body { background: #ffffff; color: #1a1a1a; margin: 0; padding: 20px 32px; }
  .preview-body { max-width: 100%; }
  pre { page-break-inside: avoid; }
  h1, h2, h3 { page-break-after: avoid; }
</style>
</head>
<body>
  <div class="preview-body">${previewBody}</div>
</body>
</html>`;

    Notifications.show('PDF を生成中...', 'info', 8000);
    const res = await ipcRenderer.invoke('print-to-pdf', html);
    if (res.canceled) return;
    if (res.success) {
      Notifications.show(`PDF を出力しました: ${res.filePath}`, 'success');
    } else {
      Notifications.show(`PDF 出力エラー: ${res.error}`, 'error');
    }
  }

  function _getPreviewCssInlined() {
    // preview.css の内容を取得 (link タグから fetch)
    // 代わりに基本スタイルをインライン定義
    return `
      .preview-body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; }
      .preview-body h1 { font-size: 2em; border-bottom: 1px solid var(--preview-border); padding-bottom: 0.3em; margin: 1.4em 0 0.5em; }
      .preview-body h2 { font-size: 1.5em; border-bottom: 1px solid var(--preview-border); padding-bottom: 0.2em; margin: 1.4em 0 0.5em; }
      .preview-body h3, .preview-body h4, .preview-body h5, .preview-body h6 { margin: 1.2em 0 0.4em; }
      .preview-body p { margin: 0.8em 0; }
      .preview-body a { color: var(--preview-link); }
      .preview-body code { background: var(--preview-code-bg); padding: 0.1em 0.4em; border-radius: 3px; font-family: monospace; font-size: 0.88em; }
      .preview-body pre { background: var(--preview-code-bg); border: 1px solid var(--preview-border); border-radius: 6px; overflow: hidden; margin: 0.8em 0; }
      .preview-body pre > code { display: block; padding: 14px 16px; background: none; border: none; font-size: 0.85em; white-space: pre; }
      .preview-body blockquote { border-left: 3px solid var(--preview-blockquote-border); background: var(--preview-blockquote-bg); padding: 0.5em 1em; margin: 0.8em 0; }
      .preview-body table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
      .preview-body th, .preview-body td { border: 1px solid var(--preview-table-border); padding: 6px 12px; }
      .preview-body th { background: var(--preview-table-header); }
      .preview-body img { max-width: 100%; }
      .preview-body hr { border: none; border-top: 1px solid var(--preview-border); margin: 1.5em 0; }
      .code-copy-btn { display: none; }
    `;
  }

  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { exportHtml, exportPdf };
})();

window.ExportManager = ExportManager;
