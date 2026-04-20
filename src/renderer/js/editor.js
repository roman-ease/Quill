'use strict';
/* global ipcRenderer, nodePath, nodeOs, CodeMirror, document, Settings, Preview, Tabs, Notifications */

/**
 * Editor — CodeMirror 5 ラッパー
 * 各タブごとに独立した CodeMirror インスタンスを管理
 */
const Editor = (() => {
  let _cm = null; // アクティブな CodeMirror インスタンス
  const _instances = new Map(); // tabId -> CodeMirror instance

  const container = () => document.getElementById('editor-container');

  // ─── キーバインド変換 ────────────────────────────────────────────────────
  function _toCodeMirrorKey(key) {
    // 'Ctrl+Shift+S' → 'Ctrl-Shift-S'
    return key.replace(/\+/g, '-');
  }

  function _buildExtraKeys(keybindings) {
    const kb = keybindings || {};
    const keys = {
      'Enter': 'newlineAndIndentContinueMarkdownList',
      'Tab': (cm) => _handleTab(cm, false),
      'Shift-Tab': (cm) => _handleTab(cm, true),
      'Escape': () => window.dispatchEvent(new CustomEvent('editor-escape')),
    };
    const actionMap = {
      'bold':          () => formatWrap('**', '**'),
      'italic':        () => formatWrap('*', '*'),
      'link':          () => insertLink(),
      'find':          () => window.dispatchEvent(new CustomEvent('editor-find')),
      'replace':       () => window.dispatchEvent(new CustomEvent('editor-replace')),
      'shortcut-help': () => window.dispatchEvent(new CustomEvent('show-shortcut-help')),
    };
    for (const [id, fn] of Object.entries(actionMap)) {
      const key = kb[id];
      if (key && !key.includes('Tab')) {
        keys[_toCodeMirrorKey(key)] = fn;
      }
    }
    return keys;
  }

  // ─── インスタンス作成 ────────────────────────────────────────────────────
  function createInstance(tabId) {
    const settings = Settings.get();
    const wrapper = document.createElement('div');
    // CSS の #editor-container > div { position: absolute; inset: 0; } で高さを制御
    container().appendChild(wrapper);

    const cm = CodeMirror(wrapper, {
      mode: 'markdown',
      theme: 'default',
      lineWrapping: settings.wordWrap !== false,
      lineNumbers: false,
      autofocus: true,
      tabSize: settings.tabSize || 2,
      indentWithTabs: false,
      styleActiveLine: true,
      extraKeys: _buildExtraKeys(settings.keybindings),
      placeholder: 'Markdown を入力してください...',
    });

    // スタイル適用
    applyStyleToInstance(cm, settings);

    // TSV/Excel 貼り付け → Markdown テーブル変換
    // cm.on('paste') は CodeMirror が自ら処理する前に発火するため、
    // event.preventDefault() を呼ぶと CM の生テキスト挿入をスキップできる
    cm.on('paste', (editor, event) => {
      const text = event.clipboardData && event.clipboardData.getData('text/plain');
      if (!text) return;
      const rows = _parseTsv(text);
      if (rows.length >= 2 && rows[0].length > 1) {
        event.preventDefault();
        const maxCols = Math.max(...rows.map(r => r.length));
        // セル内の | はエスケープ、改行は <br> に変換
        const esc = s => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        const header = rows[0].map(c => esc(c.trim()) || 'ヘッダー');
        const sep = Array(maxCols).fill('---');
        const tableRows = rows.slice(1).map(r => {
          const cells = Array(maxCols).fill('').map((_, i) => esc((r[i] || '').trim()));
          return `| ${cells.join(' | ')} |`;
        });
        const table = `\n| ${header.join(' | ')} |\n| ${sep.join(' | ')} |\n${tableRows.join('\n')}\n`;
        editor.replaceSelection(table);
      }
    });

    // 変更イベント
    cm.on('change', () => {
      const tab = Tabs.getActiveTab();
      if (!tab) return;
      const content = cm.getValue();
      const isDirty = content !== tab.savedContent;
      Tabs.updateTabState(tabId, { content, isDirty });
      Preview.scheduleRender(content, tab.filePath);
    });

    // カーソル移動
    cm.on('cursorActivity', () => {
      window.dispatchEvent(new CustomEvent('editor-cursor-changed'));
    });

    _instances.set(tabId, cm);
    return cm;
  }

  // ─── タブ切替時のアクティブインスタンス切替 ──────────────────────────────
  function activate(tabId, content, scrollTop) {
    // 全インスタンスを非表示
    // getWrapperElement() は .CodeMirror 要素を返す。その親が
    // position:absolute;inset:0 の外側ラッパーなので、そちらを hidden にしないと
    // 見えない外側 div がマウス・キーボードイベントを横取りしてしまう。
    _instances.forEach((cm) => {
      cm.getWrapperElement().parentElement.style.display = 'none';
    });

    let cm = _instances.get(tabId);
    if (!cm) {
      cm = createInstance(tabId);
      cm.setValue(content || '');
    }

    cm.getWrapperElement().parentElement.style.display = '';
    _cm = cm;

    // スクロール位置復元
    if (scrollTop !== undefined) {
      setTimeout(() => cm.scrollTo(0, scrollTop), 10);
    }

    cm.refresh();
    setTimeout(() => cm.focus(), 20);

    return cm;
  }

  // ─── インスタンス削除 ────────────────────────────────────────────────────
  function destroyInstance(tabId) {
    const cm = _instances.get(tabId);
    if (cm) {
      // 外側ラッパーごと削除しないと空の position:absolute div が残り続ける
      cm.getWrapperElement().parentElement.remove();
      _instances.delete(tabId);
    }
    if (_cm === cm) _cm = null;
  }

  // ─── コンテンツ操作 ──────────────────────────────────────────────────────
  function getValue(tabId) {
    const cm = tabId ? _instances.get(tabId) : _cm;
    return cm ? cm.getValue() : '';
  }

  function setValue(content, tabId) {
    const cm = tabId ? _instances.get(tabId) : _cm;
    if (!cm) return;
    const scrollInfo = cm.getScrollInfo();
    cm.setValue(content || '');
    cm.scrollTo(scrollInfo.left, scrollInfo.top);
  }

  function getScrollTop(tabId) {
    const cm = tabId ? _instances.get(tabId) : _cm;
    return cm ? cm.getScrollInfo().top : 0;
  }

  function getCursor() {
    if (!_cm) return { line: 1, ch: 1 };
    const pos = _cm.getCursor();
    return { line: pos.line + 1, ch: pos.ch + 1 };
  }

  function setScrollTop(top) {
    if (_cm) _cm.scrollTo(0, top);
  }

  // ─── 書式挿入 ────────────────────────────────────────────────────────────
  function formatWrap(before, after, cm) {
    const editor = cm || _cm;
    if (!editor) return;
    const sel = editor.getSelection();
    if (sel) {
      editor.replaceSelection(`${before}${sel}${after}`);
    } else {
      const cursor = editor.getCursor();
      editor.replaceRange(`${before}${after}`, cursor);
      editor.setCursor({ line: cursor.line, ch: cursor.ch + before.length });
    }
    editor.focus();
  }

  function insertLink() {
    if (!_cm) return;
    const sel = _cm.getSelection();
    const text = sel || 'リンクテキスト';
    const placeholder = `[${text}](https://)`;
    _cm.replaceSelection(placeholder);
    _cm.focus();
  }

  function insertImage(altText, src) {
    if (!_cm) return;
    _cm.replaceSelection(`![${altText || '画像'}](${src || ''})`);
    _cm.focus();
  }

  function insertText(text) {
    if (!_cm) return;
    _cm.replaceSelection(text);
    _cm.focus();
  }

  function insertAtLine(text) {
    if (!_cm) return;
    const cursor = _cm.getCursor();
    _cm.replaceRange(text + '\n', { line: cursor.line, ch: 0 });
    _cm.focus();
  }

  // テーブル挿入
  function insertTable(cols, rows) {
    if (!_cm) return;
    const header = Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ');
    const sep = Array(cols).fill('---').join(' | ');
    const emptyRow = Array(cols).fill('').join(' | ');
    const lines = [`| ${header} |`, `| ${sep} |`];
    for (let i = 0; i < rows; i++) lines.push(`| ${emptyRow} |`);
    _cm.replaceSelection('\n' + lines.join('\n') + '\n');
    _cm.focus();
  }

  // TOC 生成
  function insertTOC() {
    if (!_cm) return;
    const content = _cm.getValue();
    const headings = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const m = line.match(/^(#{1,6})\s+(.+)/);
      if (m) {
        const level = m[1].length;
        const text = m[2].trim();
        const anchor = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        headings.push(`${'  '.repeat(level - 1)}- [${text}](#${anchor})`);
      }
    }
    if (headings.length === 0) {
      Notifications.show('見出しが見つかりません', 'warning');
      return;
    }
    _cm.replaceSelection('## 目次\n\n' + headings.join('\n') + '\n\n');
    _cm.focus();
  }

  // Mermaid テンプレート
  function insertMermaidTemplate() {
    if (!_cm) return;
    const template = '\n```mermaid\nflowchart TD\n    A[開始] --> B{条件}\n    B -->|はい| C[処理1]\n    B -->|いいえ| D[処理2]\n    C --> E[終了]\n    D --> E\n```\n';
    _cm.replaceSelection(template);
    _cm.focus();
  }

  // タスクリスト トグル
  function toggleTaskItem(itemText, checked) {
    if (!_cm) return;
    const content = _cm.getValue();
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const taskMatch = line.match(/^(\s*[-*+]\s+)\[([ x])\]\s+(.+)/);
      if (taskMatch) {
        const text = taskMatch[3].trim();
        if (text === itemText.trim()) {
          const newState = checked ? 'x' : ' ';
          lines[i] = line.replace(/\[([ x])\]/, `[${newState}]`);
          _cm.setValue(lines.join('\n'));
          return;
        }
      }
    }
  }

  // RFC 4180 準拠の TSV パーサー
  // ダブルクォートで囲まれたフィールドは改行・タブ・引用符を含められる
  function _parseTsv(text) {
    const rows = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
      const row = [];

      while (true) {
        let field = '';

        if (i < n && text[i] === '"') {
          // クォートフィールド: "..." の中は改行・タブ可、"" はエスケープ済み引用符
          i++;
          while (i < n) {
            if (text[i] === '"') {
              if (i + 1 < n && text[i + 1] === '"') {
                field += '"';
                i += 2;
              } else {
                i++;
                break;
              }
            } else {
              field += text[i++];
            }
          }
        } else {
          // 非クォートフィールド
          while (i < n && text[i] !== '\t' && text[i] !== '\r' && text[i] !== '\n') {
            field += text[i++];
          }
        }

        row.push(field);

        if (i >= n || text[i] === '\r' || text[i] === '\n') {
          if (i < n && text[i] === '\r') i++;
          if (i < n && text[i] === '\n') i++;
          break;
        }
        if (text[i] === '\t') i++;
      }

      if (row.some(f => f.trim() !== '')) rows.push(row);
    }

    return rows;
  }

  // 画像クリップボード貼り付け
  async function handleImagePaste(event, filePath) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return false;

    // テキストが含まれている場合は画像として処理しない
    // (Excel等のセルコピーは image/png と text/plain(TSV) を両方含む)
    const textContent = event.clipboardData.getData('text/plain');
    if (textContent) return false;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result;
          // 保存先決定
          const settings = Settings.get();
          let saveDir;
          if (settings.imageSaveMode === 'fixed' && settings.imageSaveFolder) {
            saveDir = settings.imageSaveFolder;
          } else if (filePath) {
            const pathInfo = await ipcRenderer.invoke('path-info', filePath);
            saveDir = pathInfo.dir + '/images';
          } else {
            // 未保存ファイルは一時パス
            saveDir = nodeOs.tmpdir() + '/quill-images';
          }

          await ipcRenderer.invoke('ensure-dir', saveDir);
          const ext = item.type.replace('image/', '').replace('jpeg', 'jpg');
          const fileName = `image-${Date.now()}.${ext}`;
          const destPath = saveDir + '/' + fileName;
          await ipcRenderer.invoke('save-image', destPath, base64);

          // 相対パスで挿入
          if (filePath) {
            const rel = nodePath.relative(nodePath.dirname(filePath), destPath).replace(/\\/g, '/');
            insertImage('image', rel);
          } else {
            insertImage('image', destPath.replace(/\\/g, '/'));
          }
          Notifications.show('画像を保存しました', 'success');
        };
        reader.readAsDataURL(blob);
        return true;
      }
    }
    return false;
  }

  // ─── インデント ──────────────────────────────────────────────────────────
  function _handleTab(cm, reverse) {
    if (reverse) {
      // Shift-Tab: 常に indentLess (選択有無問わず)
      CodeMirror.commands.indentLess(cm);
      return;
    }

    if (cm.somethingSelected()) {
      // 選択行を一括インデント
      CodeMirror.commands.indentMore(cm);
    } else {
      const cursor = cm.getCursor();
      const line = cm.getLine(cursor.line);
      // リスト行 (- / * / + / 1. など) はリストレベルをインデント
      if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
        CodeMirror.commands.indentMore(cm);
      } else {
        // 通常行: タブサイズ分のスペースを挿入
        const spaces = ' '.repeat(Settings.get('tabSize') || 2);
        cm.replaceSelection(spaces);
      }
    }
  }

  // ─── スタイル適用 ────────────────────────────────────────────────────────
  function applyStyleToInstance(cm, settings) {
    const wrapper = cm.getWrapperElement();
    wrapper.style.height = '100%';
    cm.setOption('lineWrapping', settings.wordWrap !== false);
    cm.setOption('tabSize', settings.tabSize || 2);
    cm.getInputField().setAttribute('spellcheck', settings.spellCheck ? 'true' : 'false');
  }

  function applySettings(settings) {
    const extraKeys = _buildExtraKeys(settings.keybindings);
    _instances.forEach((cm) => {
      applyStyleToInstance(cm, settings);
      cm.setOption('extraKeys', extraKeys);
    });
  }

  function focus() {
    if (_cm) _cm.focus();
  }

  function refresh() {
    if (_cm) _cm.refresh();
  }

  function getActiveInstance() {
    return _cm;
  }

  return {
    createInstance,
    activate,
    destroyInstance,
    getValue,
    setValue,
    getScrollTop,
    setScrollTop,
    getCursor,
    formatWrap,
    insertLink,
    insertImage,
    insertText,
    insertAtLine,
    insertTable,
    insertTOC,
    insertMermaidTemplate,
    toggleTaskItem,
    handleImagePaste,
    applySettings,
    focus,
    refresh,
    getActiveInstance,
  };
})();

window.Editor = Editor;
