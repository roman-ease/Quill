'use strict';
/* global document, Editor, Tabs, Settings */

/**
 * Status Bar — カーソル位置・単語数・行数・エンコード・改行コード表示
 */
const StatusBar = (() => {

  function init() {
    // カーソル位置変更
    window.addEventListener('editor-cursor-changed', _update);
    window.addEventListener('tab-activated', _update);
    window.addEventListener('tab-state-changed', _update);

    // エンコーディングクリック
    document.getElementById('status-encoding').addEventListener('click', _cycleEncoding);
    document.getElementById('status-lineending').addEventListener('click', _cycleLineEnding);
  }

  function _update() {
    const tab = Tabs.getActiveTab();
    if (!tab) { _reset(); return; }

    // ファイルパス
    const fpEl = document.getElementById('status-filepath');
    fpEl.textContent = tab.filePath || '新規ファイル';
    fpEl.title = tab.filePath || '新規ファイル';

    // カーソル位置
    const cursor = Editor.getCursor();
    document.getElementById('status-cursor').textContent = `${cursor.line}:${cursor.ch}`;

    // 単語数・行数
    const content = tab.content || '';
    const words = _countWords(content);
    const lines = content.split('\n').length;
    document.getElementById('status-words').textContent = `${words} 語`;
    document.getElementById('status-lines').textContent = `${lines} 行`;

    // エンコード
    const encMap = { utf8: 'UTF-8', utf8bom: 'UTF-8 BOM', utf16le: 'UTF-16 LE' };
    document.getElementById('status-encoding').textContent = encMap[tab.encoding] || 'UTF-8';

    // 改行コード
    document.getElementById('status-lineending').textContent = (tab.lineEnding || 'lf').toUpperCase();
  }

  function _reset() {
    document.getElementById('status-filepath').textContent = '';
    document.getElementById('status-cursor').textContent = '1:1';
    document.getElementById('status-words').textContent = '0 語';
    document.getElementById('status-lines').textContent = '1 行';
    document.getElementById('status-encoding').textContent = 'UTF-8';
    document.getElementById('status-lineending').textContent = 'LF';
  }

  function _countWords(text) {
    // 日本語・英語混在の単語カウント
    const stripped = text
      .replace(/```[\s\S]*?```/g, '') // コードブロック除外
      .replace(/`[^`]+`/g, '')         // インラインコード除外
      .trim();
    if (!stripped) return 0;
    // ASCII 単語
    const asciiWords = (stripped.match(/\b[a-zA-Z0-9]+\b/g) || []).length;
    // CJK 文字数 (1文字を1語として計算)
    const cjkChars = (stripped.match(/[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
    return asciiWords + cjkChars;
  }

  function _cycleEncoding() {
    const tab = Tabs.getActiveTab();
    if (!tab) return;
    const cycle = { utf8: 'utf8bom', utf8bom: 'utf16le', utf16le: 'utf8' };
    const next = cycle[tab.encoding] || 'utf8';
    Tabs.updateTabState(tab.id, { encoding: next, isDirty: true });
    _update();
  }

  function _cycleLineEnding() {
    const tab = Tabs.getActiveTab();
    if (!tab) return;
    const next = tab.lineEnding === 'lf' ? 'crlf' : 'lf';
    Tabs.updateTabState(tab.id, { lineEnding: next, isDirty: true });
    _update();
  }

  return { init, update: _update };
})();
