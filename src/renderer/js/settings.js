'use strict';
/* global ipcRenderer, document, Notifications */

/**
 * Settings Manager — 設定の読み込み・保存・UI 管理
 */
const Settings = (() => {
  let _settings = {};
  let _onChangeCallbacks = [];
  let _draftKeybindings = null;
  let _captureHandler = null;

  const DEFAULT_KEYBINDINGS = {
    'new-file':      'Ctrl+N',
    'open-file':     'Ctrl+O',
    'save':          'Ctrl+S',
    'save-as':       'Ctrl+Shift+S',
    'reload':        'Ctrl+R',
    'close-tab':     'Ctrl+W',
    'find':          'Ctrl+F',
    'replace':       'Ctrl+H',
    'bold':          'Ctrl+B',
    'italic':        'Ctrl+I',
    'link':          'Ctrl+K',
    'insert-table':  'Ctrl+Shift+T',
    'insert-toc':    'Ctrl+Shift+C',
    'new-tab':       'Ctrl+T',
    'next-tab':      'Ctrl+Tab',
    'prev-tab':      'Ctrl+Shift+Tab',
    'focus-mode':    'Ctrl+Shift+F',
    'shortcut-help': 'F1',
  };

  const SHORTCUT_DEFS = [
    { group: 'ファイル', actions: [
      { id: 'new-file',   label: '新規ファイル' },
      { id: 'open-file',  label: 'ファイルを開く' },
      { id: 'save',       label: '上書き保存' },
      { id: 'save-as',    label: '名前を付けて保存' },
      { id: 'reload',     label: '再読み込み' },
      { id: 'close-tab',  label: 'タブを閉じる' },
    ]},
    { group: 'タブ', actions: [
      { id: 'new-tab',  label: '新規タブ' },
      { id: 'next-tab', label: '次のタブ', fixed: true },
      { id: 'prev-tab', label: '前のタブ', fixed: true },
    ]},
    { group: '編集', actions: [
      { id: 'find',         label: '検索' },
      { id: 'replace',      label: '検索と置換' },
      { id: 'bold',         label: '太字' },
      { id: 'italic',       label: '斜体' },
      { id: 'link',         label: 'リンク挿入' },
      { id: 'insert-table', label: 'テーブル挿入' },
      { id: 'insert-toc',   label: '目次を生成' },
    ]},
    { group: '表示', actions: [
      { id: 'focus-mode',  label: 'フォーカスモード' },
      { id: 'zoom-in',     label: 'ズームイン',      fixed: true, key: 'Ctrl+Plus' },
      { id: 'zoom-out',    label: 'ズームアウト',    fixed: true, key: 'Ctrl+Minus' },
      { id: 'zoom-reset',  label: 'ズームリセット',  fixed: true, key: 'Ctrl+0' },
    ]},
    { group: 'ヘルプ', actions: [
      { id: 'shortcut-help', label: 'ショートカット一覧' },
    ]},
  ];

  const DEFAULTS = {
    theme: 'light',
    defaultTheme: 'last',
    editorFontSize: 14,
    previewFontSize: 15,
    editorFont: 'Consolas, "Courier New", monospace',
    editorLineHeight: 1.6,
    wordWrap: true,
    tabSize: 2,
    spellCheck: false,
    syncScroll: true,
    autoSave: false,
    autoSaveInterval: 30,
    imageSaveMode: 'relative',
    imageSaveFolder: '',
    encoding: 'utf8',
    lineEnding: 'lf',
    restoreSession: true,
    syntaxTheme: 'auto',
    mermaidTheme: 'auto',
    katexEnabled: false,
    openLinksInBrowser: false,
    rememberWindowSize: true,
    alwaysOnTop: false,
    zoomFactor: 1.0,
  };

  async function load() {
    try {
      const saved = await ipcRenderer.invoke('load-settings');
      _settings = {
        ...DEFAULTS,
        ...saved,
        keybindings: { ...DEFAULT_KEYBINDINGS, ...((saved && saved.keybindings) || {}) },
      };
    } catch {
      _settings = { ...DEFAULTS, keybindings: { ...DEFAULT_KEYBINDINGS } };
    }
    // 起動時テーマを決定: 'last' 以外が指定されていればそのテーマを強制適用
    if (_settings.defaultTheme && _settings.defaultTheme !== 'last') {
      _settings.theme = _settings.defaultTheme;
    }
    applyTheme(_settings.theme);
    applyEditorVars();
    return _settings;
  }

  async function save(partial) {
    _settings = {
      ..._settings,
      ...partial,
      keybindings: { ..._settings.keybindings, ...(partial.keybindings || {}) },
    };
    await ipcRenderer.invoke('save-settings', _settings);
    applyTheme(_settings.theme);
    applyEditorVars();
    _onChangeCallbacks.forEach(cb => cb(_settings));
  }

  function get(key) {
    return key ? _settings[key] : { ..._settings };
  }

  function onChange(cb) {
    _onChangeCallbacks.push(cb);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme || 'dark');

    // hljs テーマ切替
    const themeMap = {
      'github-dark': 'github-dark',
      'github': 'github',
      'atom-one-dark': 'atom-one-dark',
      'vs2015': 'vs2015',
      'monokai': 'monokai',
    };
    // auto の場合はアプリテーマに応じて自動選択
    const autoMap = { dark: 'atom-one-dark', light: 'github', sepia: 'github', vaporwave: 'atom-one-dark', terminal: 'vs2015' };
    const syntaxSetting = _settings.syntaxTheme;
    const resolved = (!syntaxSetting || syntaxSetting === 'auto')
      ? autoMap[theme || 'dark'] || 'github-dark'
      : syntaxSetting;
    const hljsTheme = themeMap[resolved] || 'github-dark';
    const link = document.getElementById('hljs-theme');
    if (link) {
      link.href = `../../node_modules/highlight.js/styles/${hljsTheme}.css`;
    }
  }

  function applyEditorVars() {
    const root = document.documentElement;
    root.style.setProperty('--editor-font', _settings.editorFont);
    root.style.setProperty('--editor-font-size', `${_settings.editorFontSize}px`);
    root.style.setProperty('--editor-line-height', _settings.editorLineHeight);
    root.style.setProperty('--preview-font-size', `${_settings.previewFontSize}px`);
  }

  // ─── Settings Dialog UI ─────────────────────────────────────────────────
  function openDialog() {
    const dlg = document.getElementById('settings-dialog');
    _draftKeybindings = { ...(_settings.keybindings || DEFAULT_KEYBINDINGS) };
    if (_captureHandler) { _captureHandler(); _captureHandler = null; }
    _populateDialog();
    _populateShortcutTab();
    dlg.classList.remove('hidden');
  }

  function closeDialog() {
    if (_captureHandler) { _captureHandler(); _captureHandler = null; }
    document.getElementById('settings-dialog').classList.add('hidden');
  }

  function _populateDialog() {
    const s = _settings;
    _val('s-theme', s.theme);
    _val('s-default-theme', s.defaultTheme);
    _val('s-editor-font-size', s.editorFontSize);
    _val('s-preview-font-size', s.previewFontSize);
    _val('s-editor-font', s.editorFont);
    _val('s-editor-line-height', s.editorLineHeight);
    _checked('s-word-wrap', s.wordWrap);
    _val('s-tab-size', s.tabSize);
    _checked('s-spell-check', s.spellCheck);
    _checked('s-sync-scroll', s.syncScroll);
    _checked('s-auto-save', s.autoSave);
    _val('s-auto-save-interval', s.autoSaveInterval);
    _val('s-image-save-mode', s.imageSaveMode);
    _val('s-image-save-folder', s.imageSaveFolder);
    _val('s-encoding', s.encoding);
    _val('s-line-ending', s.lineEnding);
    _checked('s-restore-session', s.restoreSession);
    _val('s-syntax-theme', s.syntaxTheme);
    _val('s-mermaid-theme', s.mermaidTheme);
    _checked('s-katex-enabled', s.katexEnabled);
    _checked('s-open-links-browser', s.openLinksInBrowser);
    _checked('s-remember-window-size', s.rememberWindowSize);
    _checked('s-always-on-top', s.alwaysOnTop);
    _val('s-zoom-factor', s.zoomFactor);
  }

  async function _saveFromDialog() {
    if (_captureHandler) { _captureHandler(); _captureHandler = null; }
    const newSettings = {
      theme: _val('s-theme'),
      defaultTheme: _val('s-default-theme'),
      editorFontSize: Number(_val('s-editor-font-size')),
      previewFontSize: Number(_val('s-preview-font-size')),
      editorFont: _val('s-editor-font'),
      editorLineHeight: Number(_val('s-editor-line-height')),
      wordWrap: _checked('s-word-wrap'),
      tabSize: Number(_val('s-tab-size')),
      spellCheck: _checked('s-spell-check'),
      syncScroll: _checked('s-sync-scroll'),
      autoSave: _checked('s-auto-save'),
      autoSaveInterval: Number(_val('s-auto-save-interval')),
      imageSaveMode: _val('s-image-save-mode'),
      imageSaveFolder: _val('s-image-save-folder'),
      encoding: _val('s-encoding'),
      lineEnding: _val('s-line-ending'),
      restoreSession: _checked('s-restore-session'),
      syntaxTheme: _val('s-syntax-theme'),
      mermaidTheme: _val('s-mermaid-theme'),
      katexEnabled: _checked('s-katex-enabled'),
      openLinksInBrowser: _checked('s-open-links-browser'),
      rememberWindowSize: _checked('s-remember-window-size'),
      alwaysOnTop: _checked('s-always-on-top'),
      zoomFactor: Number(_val('s-zoom-factor')),
      keybindings: { ..._draftKeybindings },
    };
    await save(newSettings);
    await ipcRenderer.invoke('set-always-on-top', newSettings.alwaysOnTop);
    await ipcRenderer.invoke('set-zoom-factor', newSettings.zoomFactor);
    ipcRenderer.send('rebuild-menu');
    closeDialog();
    Notifications.show('設定を保存しました', 'success');
  }

  function initDialogEvents() {
    // タブ切替
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = document.getElementById(`pane-${tab.dataset.pane}`);
        if (pane) pane.classList.add('active');
      });
    });

    document.getElementById('settings-save-btn').addEventListener('click', _saveFromDialog);
    document.getElementById('settings-cancel-btn').addEventListener('click', closeDialog);
    document.getElementById('settings-close-btn').addEventListener('click', closeDialog);

    document.getElementById('sc-reset-all-btn').addEventListener('click', () => {
      if (_captureHandler) { _captureHandler(); _captureHandler = null; }
      _draftKeybindings = { ...DEFAULT_KEYBINDINGS };
      _populateShortcutTab();
    });

    document.getElementById('settings-dialog').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDialog();
    });
  }

  // ─── Shortcut Tab ───────────────────────────────────────────────────────

  function _populateShortcutTab() {
    const tbody = document.getElementById('shortcut-edit-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    for (const { group, actions } of SHORTCUT_DEFS) {
      const groupRow = document.createElement('tr');
      groupRow.innerHTML = `<th colspan="3">${group}</th>`;
      tbody.appendChild(groupRow);

      for (const def of actions) {
        const tr = document.createElement('tr');
        tr.dataset.actionId = def.id;
        tbody.appendChild(tr);
        _renderShortcutRow(tr, def);
      }
    }
  }

  function _renderShortcutRow(tr, def) {
    const { id, label, fixed, key: fixedKey } = def;
    if (fixed) {
      tr.dataset.fixed = 'true';
      const displayKey = fixedKey || _draftKeybindings[id] || '';
      tr.innerHTML = `
        <td>${_scEscapeHtml(label)}</td>
        <td><span class="sc-key-badge">${_scEscapeHtml(displayKey)}</span></td>
        <td><div class="sc-actions"><span class="sc-fixed-label">変更不可</span></div></td>`;
      return;
    }
    const key = _draftKeybindings[id] || '';
    const isConflict = _hasConflict(id, key);
    tr.innerHTML = `
      <td>${_scEscapeHtml(label)}</td>
      <td><span class="sc-key-badge${isConflict ? ' sc-conflict' : ''}">${_scEscapeHtml(key)}</span></td>
      <td><div class="sc-actions">
        <button class="sc-edit-btn">編集</button>
        <button class="sc-reset-btn">リセット</button>
      </div></td>`;
    tr.querySelector('.sc-edit-btn').addEventListener('click', () => _enterCapture(tr, def));
    tr.querySelector('.sc-reset-btn').addEventListener('click', () => _resetKey(tr, def));
  }

  function _hasConflict(id, key) {
    if (!key) return false;
    return Object.entries(_draftKeybindings).some(([k, v]) => k !== id && v === key);
  }

  function _refreshConflictHighlights() {
    const tbody = document.getElementById('shortcut-edit-tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr[data-action-id]');
    const keyToIds = {};
    rows.forEach(tr => {
      const id = tr.dataset.actionId;
      const key = _draftKeybindings[id];
      if (key) {
        if (!keyToIds[key]) keyToIds[key] = [];
        keyToIds[key].push(id);
      }
    });
    rows.forEach(tr => {
      if (tr.dataset.fixed) return;
      const badge = tr.querySelector('.sc-key-badge');
      if (!badge || badge.classList.contains('sc-capture-hint')) return;
      const key = _draftKeybindings[tr.dataset.actionId];
      badge.classList.toggle('sc-conflict', !!(key && keyToIds[key] && keyToIds[key].length > 1));
    });
  }

  function _buildDisplayKey(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    const key = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
    const keyMap = {
      ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
      'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    };
    const mapped = keyMap[key] || (key.length === 1 ? key.toUpperCase() : key);
    if (parts.length === 0 && !/^F\d{1,2}$/.test(mapped)) return null;
    parts.push(mapped);
    return parts.join('+');
  }

  function _enterCapture(tr, def) {
    const { id } = def;
    if (_captureHandler) { _captureHandler(); _captureHandler = null; }

    const badge = tr.querySelector('.sc-key-badge');
    const actCell = tr.querySelector('.sc-actions');
    const prevKey = _draftKeybindings[id] || '';

    badge.textContent = 'キーを押してください...';
    badge.className = 'sc-key-badge sc-capture-hint';
    actCell.innerHTML = '<button class="sc-cancel-btn">キャンセル</button>';

    const finish = (key) => {
      document.removeEventListener('keydown', onKey, true);
      _captureHandler = null;
      _draftKeybindings[id] = key;
      _renderShortcutRow(tr, def);
      _refreshConflictHighlights();
    };

    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = _buildDisplayKey(e);
      if (!key) return;
      finish(key);
    };

    actCell.querySelector('.sc-cancel-btn').addEventListener('click', () => finish(prevKey));
    document.addEventListener('keydown', onKey, true);
    _captureHandler = () => finish(prevKey);
  }

  function _resetKey(tr, def) {
    const { id } = def;
    if (_captureHandler) { _captureHandler(); _captureHandler = null; }
    _draftKeybindings[id] = DEFAULT_KEYBINDINGS[id] || '';
    _renderShortcutRow(tr, def);
    _refreshConflictHighlights();
  }

  function _scEscapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  function _val(id, value) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (value !== undefined) { el.value = String(value); return; }
    return el.value;
  }
  function _checked(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    if (value !== undefined) { el.checked = Boolean(value); return; }
    return el.checked;
  }

  return { load, save, get, onChange, openDialog, closeDialog, initDialogEvents, DEFAULT_KEYBINDINGS, SHORTCUT_DEFS };
})();
