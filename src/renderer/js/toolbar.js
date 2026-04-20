'use strict';
/* global ipcRenderer, document, Editor, Tabs, Search, Settings, Notifications */

/**
 * Toolbar — ツールバーボタン・ビューモード・テーマ切替
 */
const Toolbar = (() => {
  let _focusMode = false;
  let _viewMode = 'split'; // 'split' | 'preview'
  let _syncScroll = true;

  // ─── Mermaid テンプレート ─────────────────────────────────────────────────
  const _MERMAID_TEMPLATES = {
    flowchart:
      '\n```mermaid\nflowchart TD\n    A[開始] --> B{条件}\n    B -->|はい| C[処理1]\n    B -->|いいえ| D[処理2]\n    C --> E[終了]\n    D --> E\n```\n',
    sequence:
      '\n```mermaid\nsequenceDiagram\n    participant A as クライアント\n    participant B as サーバー\n    A->>B: リクエスト\n    B-->>A: レスポンス\n    A->>B: 確認\n    B-->>A: 完了\n```\n',
    class:
      '\n```mermaid\nclassDiagram\n    class Animal {\n        +String name\n        +int age\n        +speak() void\n    }\n    class Dog {\n        +fetch() void\n    }\n    Animal <|-- Dog\n```\n',
    er:
      '\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string name\n        string email\n    }\n    ORDER {\n        int id PK\n        int user_id FK\n        date created_at\n    }\n    USER ||--o{ ORDER : "places"\n```\n',
    state:
      '\n```mermaid\nstateDiagram-v2\n    [*] --> 待機\n    待機 --> 処理中 : 開始\n    処理中 --> 完了 : 成功\n    処理中 --> エラー : 失敗\n    完了 --> [*]\n    エラー --> 待機 : リトライ\n```\n',
    gantt:
      '\n```mermaid\ngantt\n    title プロジェクト計画\n    dateFormat YYYY-MM-DD\n    section 設計\n        要件定義   :a1, 2024-01-01, 7d\n        設計書作成 :a2, after a1, 5d\n    section 開発\n        実装       :b1, after a2, 14d\n        テスト     :b2, after b1, 7d\n```\n',
  };

  // ─── Init ────────────────────────────────────────────────────────────────
  function init() {
    // ツールバーボタン
    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      _handleAction(btn.dataset.action);
    });

    // テーマドロップダウン
    const themeBtn = document.getElementById('theme-btn');
    const themeMenu = document.getElementById('theme-menu');
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      themeMenu.classList.toggle('hidden');
    });
    themeMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-theme]');
      if (!item) return;
      _setTheme(item.dataset.theme);
      themeMenu.classList.add('hidden');
    });

    // 最近使ったファイルドロップダウン
    const recentBtn = document.getElementById('recent-btn');
    const recentMenu = document.getElementById('recent-menu');
    recentBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await _buildRecentMenu();
      recentMenu.classList.toggle('hidden');
    });

    // Mermaid テンプレートドロップダウン
    const mermaidBtn = document.getElementById('mermaid-btn');
    const mermaidMenu = document.getElementById('mermaid-menu');
    mermaidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mermaidMenu.classList.toggle('hidden');
    });
    mermaidMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-mermaid]');
      if (!item) return;
      const tmpl = _MERMAID_TEMPLATES[item.dataset.mermaid];
      if (tmpl) Editor.insertText(tmpl);
      mermaidMenu.classList.add('hidden');
    });

    // グローバルクリックでドロップダウンを閉じる
    document.addEventListener('click', () => {
      themeMenu.classList.add('hidden');
      recentMenu.classList.add('hidden');
      mermaidMenu.classList.add('hidden');
    });

    // フォーカスモード: ホバーで一時表示
    const toolbar = document.getElementById('toolbar');
    toolbar.addEventListener('mouseenter', () => {
      if (_focusMode) toolbar.classList.add('focus-peek');
    });
    toolbar.addEventListener('mouseleave', () => {
      if (_focusMode) toolbar.classList.remove('focus-peek');
    });

    // IPC メニューイベント
    _bindIpcEvents();

    // 設定反映
    const s = Settings.get();
    _syncScroll = s.syncScroll !== false;
    _updateSyncScrollBtn();
    _initSyncScroll();
  }

  // ─── アクション処理 ──────────────────────────────────────────────────────
  function _handleAction(action) {
    switch (action) {
      case 'new-file':      window.App.newFile(); break;
      case 'open-file':     window.App.openFile(); break;
      case 'save':          window.App.saveCurrentTab(); break;
      case 'bold':          Editor.formatWrap('**', '**'); break;
      case 'italic':        Editor.formatWrap('*', '*'); break;
      case 'strikethrough': Editor.formatWrap('~~', '~~'); break;
      case 'inline-code':   Editor.formatWrap('`', '`'); break;
      case 'code-block':    Editor.insertText('\n```\n\n```\n'); break;
      case 'link':          Editor.insertLink(); break;
      case 'image':         _insertImageDialog(); break;
      case 'blockquote':    Editor.formatWrap('> ', ''); break;
      case 'hr':            Editor.insertText('\n---\n'); break;
      case 'insert-table':  _showTableDialog(); break;
      case 'insert-toc':    Editor.insertTOC(); break;
      case 'find':          Search.open(false); break;
      case 'view-split':    setViewMode('split'); break;
      case 'view-preview':  setViewMode('preview'); break;
      case 'toggle-sync-scroll': _toggleSyncScroll(); break;
      case 'toggle-focus-mode':  toggleFocusMode(); break;
      case 'settings':      Settings.openDialog(); break;
    }
  }

  // ─── ビューモード ────────────────────────────────────────────────────────
  function setViewMode(mode) {
    _viewMode = mode;
    document.body.classList.toggle('view-preview', mode === 'preview');
    document.getElementById('view-split-btn').classList.toggle('active', mode === 'split');
    document.getElementById('view-preview-btn').classList.toggle('active', mode === 'preview');
    if (mode === 'split') Editor.refresh();
  }

  // ─── テーマ ──────────────────────────────────────────────────────────────
  function _setTheme(theme) {
    Settings.save({ theme });
    // テーマメニューのアクティブ状態更新
    document.querySelectorAll('#theme-menu [data-theme]').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === theme);
    });
  }

  // ─── フォーカスモード ────────────────────────────────────────────────────
  function toggleFocusMode(force) {
    _focusMode = force !== undefined ? force : !_focusMode;
    const toolbar = document.getElementById('toolbar');
    const btn = document.getElementById('focus-mode-btn');
    if (_focusMode) {
      toolbar.classList.add('focus-hidden');
      toolbar.classList.remove('focus-peek');
      btn.classList.add('active');
    } else {
      toolbar.classList.remove('focus-hidden');
      btn.classList.remove('active');
    }
    // メニューのチェック状態をツールバーボタンと同期
    ipcRenderer.send('set-menu-item-checked', 'focus-mode', _focusMode);
    Editor.refresh();
  }

  // ─── 同期スクロール ──────────────────────────────────────────────────────
  function _toggleSyncScroll() {
    _syncScroll = !_syncScroll;
    Settings.save({ syncScroll: _syncScroll });
    _updateSyncScrollBtn();
  }

  function _updateSyncScrollBtn() {
    document.getElementById('sync-scroll-btn').classList.toggle('active', _syncScroll);
  }

  let _scrollSource = null;
  let _scrollTimer = null;

  function _initSyncScroll() {
    const previewPane = document.getElementById('preview-content');

    // エディタのスクロールを監視
    window.addEventListener('editor-scroll', (e) => {
      if (!_syncScroll || _scrollSource === 'preview') return;
      _scrollSource = 'editor';
      clearTimeout(_scrollTimer);
      const ratio = e.detail.ratio;
      previewPane.scrollTop = ratio * (previewPane.scrollHeight - previewPane.clientHeight);
      _scrollTimer = setTimeout(() => { _scrollSource = null; }, 100);
    });

    // プレビューのスクロールをエディタと同期
    previewPane.addEventListener('scroll', () => {
      if (!_syncScroll || _scrollSource === 'editor') return;
      _scrollSource = 'preview';
      clearTimeout(_scrollTimer);
      const cm = Editor.getActiveInstance();
      if (cm) {
        const ratio = previewPane.scrollTop / (previewPane.scrollHeight - previewPane.clientHeight);
        if (isFinite(ratio)) {
          const info = cm.getScrollInfo();
          cm.scrollTo(0, ratio * (info.height - info.clientHeight));
        }
      }
      _scrollTimer = setTimeout(() => { _scrollSource = null; }, 100);
    });
  }

  // ─── テーブルダイアログ ──────────────────────────────────────────────────
  function _showTableDialog() {
    const dlg = document.getElementById('table-dialog');
    dlg.classList.remove('hidden');
    document.getElementById('table-cols').value = '3';
    document.getElementById('table-rows').value = '3';
  }

  function _hideTableDialog() {
    document.getElementById('table-dialog').classList.add('hidden');
  }

  function _initTableDialog() {
    document.getElementById('table-insert-btn').addEventListener('click', () => {
      const cols = parseInt(document.getElementById('table-cols').value) || 3;
      const rows = parseInt(document.getElementById('table-rows').value) || 3;
      Editor.insertTable(cols, rows);
      _hideTableDialog();
    });
    document.getElementById('table-cancel-btn').addEventListener('click', _hideTableDialog);
    document.getElementById('table-dialog').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) _hideTableDialog();
    });
  }

  // ─── 画像挿入ダイアログ ──────────────────────────────────────────────────
  function _insertImageDialog() {
    const dlg = document.getElementById('image-dialog');
    const input = document.getElementById('image-src-input');
    input.value = '';
    dlg.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  }

  function _initImageDialog() {
    const dlg = document.getElementById('image-dialog');
    const insertBtn = document.getElementById('image-insert-btn');
    const cancelBtn = document.getElementById('image-cancel-btn');
    const input = document.getElementById('image-src-input');

    const doInsert = () => {
      const src = input.value.trim();
      if (src) Editor.insertImage('image', src);
      dlg.classList.add('hidden');
    };
    const doCancel = () => dlg.classList.add('hidden');

    insertBtn.addEventListener('click', doInsert);
    cancelBtn.addEventListener('click', doCancel);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) doCancel(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doInsert();
      if (e.key === 'Escape') doCancel();
    });
  }

  // ─── 最近使ったファイルメニュー ─────────────────────────────────────────
  async function _buildRecentMenu() {
    const menu = document.getElementById('recent-menu');
    menu.innerHTML = '';
    const files = await ipcRenderer.invoke('get-recent-files');
    if (files.length === 0) {
      menu.innerHTML = '<div class="dropdown-item" style="color:var(--text-muted);">(なし)</div>';
      return;
    }
    files.forEach(f => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = f;
      item.title = f;
      item.addEventListener('click', () => {
        menu.classList.add('hidden');
        window.App.openFilePaths([f]);
      });
      menu.appendChild(item);
    });
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--border-color);margin:4px 0;';
    menu.appendChild(sep);
    const clearBtn = document.createElement('div');
    clearBtn.className = 'dropdown-item';
    clearBtn.textContent = '履歴をクリア';
    clearBtn.addEventListener('click', async () => {
      menu.classList.add('hidden');
      await ipcRenderer.invoke('add-recent-file', '__clear__');
    });
    menu.appendChild(clearBtn);
  }

  // ─── IPC メニューイベント ────────────────────────────────────────────────
  function _bindIpcEvents() {
    ipcRenderer.on('menu-new-file',    () => window.App.newFile());
    ipcRenderer.on('menu-open-file',   () => window.App.openFile());
    ipcRenderer.on('menu-save',        () => window.App.saveCurrentTab());
    ipcRenderer.on('menu-save-as',     () => window.App.saveCurrentTabAs());
    ipcRenderer.on('menu-reload-file', () => window.App.reloadCurrentTab());
    ipcRenderer.on('menu-close-tab',   () => Tabs.closeTab(Tabs.getActiveTabId()));
    ipcRenderer.on('menu-find',        () => Search.open(false));
    ipcRenderer.on('menu-replace',     () => Search.open(true));
    ipcRenderer.on('menu-insert-table', () => _showTableDialog());
    ipcRenderer.on('menu-insert-toc',   () => Editor.insertTOC());
    ipcRenderer.on('menu-insert-mermaid', () => Editor.insertMermaidTemplate());
    ipcRenderer.on('menu-export-html',  () => window.ExportManager.exportHtml());
    ipcRenderer.on('menu-export-pdf',   () => window.ExportManager.exportPdf());
    ipcRenderer.on('menu-settings',     () => Settings.openDialog());
    ipcRenderer.on('menu-about',        () => _showAbout());
    ipcRenderer.on('menu-shortcut-help', () => _showShortcutHelp());

    ipcRenderer.on('open-files',    (_, files) => window.App.openFilePaths(files));
    ipcRenderer.on('file-changed',  (_, fp) => window.App.onFileChanged(fp));
    ipcRenderer.on('file-deleted',  (_, fp) => window.App.onFileDeleted(fp));
    ipcRenderer.on('app-before-close', () => window.App.beforeClose());

    ipcRenderer.on('set-view-mode', (_, mode) => setViewMode(mode));
    ipcRenderer.on('set-theme',     (_, theme) => _setTheme(theme));
    ipcRenderer.on('toggle-focus-mode', (_, checked) => toggleFocusMode(checked));
    ipcRenderer.on('toggle-sync-scroll', (_, checked) => {
      _syncScroll = checked;
      _updateSyncScrollBtn();
    });
    ipcRenderer.on('tab-next', () => Tabs.nextTab());
    ipcRenderer.on('tab-prev', () => Tabs.prevTab());
    window.addEventListener('show-shortcut-help', () => _showShortcutHelp());
    ipcRenderer.on('format-bold', () => Editor.formatWrap('**', '**'));
    ipcRenderer.on('format-italic', () => Editor.formatWrap('*', '*'));
    ipcRenderer.on('format-link', () => Editor.insertLink());
  }

  function _showAbout() {
    const dlg = document.getElementById('about-dialog');
    ipcRenderer.invoke('get-app-version').then(v => {
      document.getElementById('about-version').textContent = `バージョン: ${v}`;
    });
    dlg.classList.remove('hidden');
    document.getElementById('about-close-btn').onclick = () => dlg.classList.add('hidden');
    dlg.onclick = (e) => { if (e.target === dlg) dlg.classList.add('hidden'); };
  }

  function _showShortcutHelp() {
    const dlg = document.getElementById('shortcut-help-dialog');
    const tbody = document.getElementById('shortcut-help-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      const kb = Settings.get('keybindings') || {};
      for (const { group, actions } of Settings.SHORTCUT_DEFS) {
        const groupRow = document.createElement('tr');
        groupRow.innerHTML = `<th colspan="2">${group}</th>`;
        tbody.appendChild(groupRow);
        for (const { id, label } of actions) {
          const key = kb[id] || '';
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${label}</td><td><kbd>${key}</kbd></td>`;
          tbody.appendChild(tr);
        }
      }
    }
    dlg.classList.remove('hidden');
    document.getElementById('shortcut-help-close-btn').onclick = () => dlg.classList.add('hidden');
    dlg.onclick = (e) => { if (e.target === dlg) dlg.classList.add('hidden'); };
  }

  function initAfterDOM() {
    _initTableDialog();
    _initImageDialog();
    Settings.initDialogEvents();
  }

  return { init, initAfterDOM, setViewMode, toggleFocusMode };
})();
