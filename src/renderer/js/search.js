'use strict';
/* global document, CodeMirror, Editor, Notifications */

/**
 * Search & Replace — CodeMirror ベースの検索・置換パネル
 */
const Search = (() => {
  let _overlays = [];
  let _cursor = null;
  let _query = '';
  let _matchCount = 0;

  const panel = () => document.getElementById('search-panel');
  const replaceRow = () => document.getElementById('replace-row');
  const searchInput = () => document.getElementById('search-input');
  const replaceInput = () => document.getElementById('replace-input');

  // ─── 表示 ────────────────────────────────────────────────────────────────
  function open(withReplace = false, initialText = '') {
    panel().classList.remove('hidden');
    if (withReplace) {
      replaceRow().classList.remove('hidden');
    }
    if (initialText) {
      searchInput().value = initialText;
    }
    searchInput().focus();
    searchInput().select();
    _doSearch();
  }

  function close() {
    panel().classList.add('hidden');
    replaceRow().classList.add('hidden');
    _clearHighlights();
    Editor.focus();
  }

  // ─── クエリ構築 (regex再コンパイルを一箇所に集約) ────────────────────────
  function _buildQuery(extraFlags = '') {
    if (!_query) return null;
    const caseSensitive = document.getElementById('search-case').checked;
    const useRegex = document.getElementById('search-regex').checked;
    const flags = (caseSensitive ? '' : 'i') + extraFlags;
    try {
      return useRegex
        ? new RegExp(_query, flags)
        : new RegExp(_escapeRegex(_query), flags);
    } catch {
      return null;
    }
  }

  // ─── 検索実行 ────────────────────────────────────────────────────────────
  function _doSearch() {
    _clearHighlights();
    _query = searchInput().value;
    if (!_query) { _matchCount = 0; return; }

    const cm = Editor.getActiveInstance();
    if (!cm) return;

    const query = _buildQuery();
    if (!query) return;

    // SearchCursor でハイライト
    _cursor = cm.getSearchCursor(query);
    _matchCount = 0;

    cm.operation(() => {
      while (_cursor.findNext()) {
        _matchCount++;
        _overlays.push(cm.markText(_cursor.from(), _cursor.to(), {
          className: 'cm-searching',
        }));
      }
    });

    // 最初のマッチへ移動
    _cursor = cm.getSearchCursor(query);
    _findNext();
  }

  function _findNext() {
    const cm = Editor.getActiveInstance();
    if (!cm || !_query) return;

    const query = _buildQuery();
    if (!query) return;

    if (!_cursor) _cursor = cm.getSearchCursor(query, cm.getCursor());

    if (!_cursor.findNext()) {
      // ラップアラウンド
      _cursor = cm.getSearchCursor(query);
      if (!_cursor.findNext()) return;
    }

    cm.setSelection(_cursor.from(), _cursor.to());
    cm.scrollIntoView({ from: _cursor.from(), to: _cursor.to() }, 100);
  }

  function _findPrev() {
    const cm = Editor.getActiveInstance();
    if (!cm || !_query) return;

    const query = _buildQuery();
    if (!query) return;

    if (!_cursor) _cursor = cm.getSearchCursor(query, cm.getCursor());

    if (!_cursor.findPrevious()) {
      // ラップアラウンド
      _cursor = cm.getSearchCursor(query, { line: cm.lastLine() + 1, ch: 0 });
      if (!_cursor.findPrevious()) return;
    }

    cm.setSelection(_cursor.from(), _cursor.to());
    cm.scrollIntoView({ from: _cursor.from(), to: _cursor.to() }, 100);
  }

  // ─── 置換 ────────────────────────────────────────────────────────────────
  function replaceOne() {
    const cm = Editor.getActiveInstance();
    if (!cm || !_cursor) return;
    const replaceText = replaceInput().value;
    if (_cursor.from() && _cursor.to()) {
      cm.replaceRange(replaceText, _cursor.from(), _cursor.to());
      Notifications.show('1件置換しました', 'info', 1500);
    }
    _doSearch();
  }

  function replaceAll() {
    const cm = Editor.getActiveInstance();
    if (!cm || !_query) return;
    const replaceText = replaceInput().value;

    const query = _buildQuery('g');
    if (!query) return;

    const content = cm.getValue();
    const newContent = content.replace(query, replaceText);
    const count = (content.match(query) || []).length;
    if (count > 0) {
      cm.setValue(newContent);
      Notifications.show(`${count} 件を置換しました`, 'success');
    } else {
      Notifications.show('マッチする箇所がありません', 'warning');
    }
    _doSearch();
  }

  // ─── ハイライトクリア ────────────────────────────────────────────────────
  function _clearHighlights() {
    _overlays.forEach(mark => mark.clear());
    _overlays = [];
    _cursor = null;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  function init() {
    searchInput().addEventListener('input', _doSearch);
    searchInput().addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.shiftKey ? _findPrev() : _findNext(); }
      if (e.key === 'Escape') close();
    });

    document.getElementById('search-prev').addEventListener('click', _findPrev);
    document.getElementById('search-next').addEventListener('click', _findNext);
    document.getElementById('search-close').addEventListener('click', close);
    document.getElementById('search-case').addEventListener('change', _doSearch);
    document.getElementById('search-regex').addEventListener('change', _doSearch);

    document.getElementById('replace-one').addEventListener('click', replaceOne);
    document.getElementById('replace-all').addEventListener('click', replaceAll);

    replaceInput().addEventListener('keydown', (e) => {
      if (e.key === 'Enter') replaceOne();
    });

    // キーボードイベント連携
    window.addEventListener('editor-find', () => {
      const cm = Editor.getActiveInstance();
      const sel = cm ? cm.getSelection() : '';
      open(false, sel);
    });
    window.addEventListener('editor-replace', () => {
      const cm = Editor.getActiveInstance();
      const sel = cm ? cm.getSelection() : '';
      open(true, sel);
    });
    window.addEventListener('editor-escape', () => {
      if (!panel().classList.contains('hidden')) close();
    });
  }

  return { init, open, close, replaceOne, replaceAll };
})();
