'use strict';
/* global ipcRenderer, document, Notifications */

/**
 * Settings Manager — 設定の読み込み・保存・UI 管理
 */
const Settings = (() => {
  let _settings = {};
  let _onChangeCallbacks = [];

  const DEFAULTS = {
    theme: 'sepia',
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
      _settings = { ...DEFAULTS, ...saved };
    } catch {
      _settings = { ...DEFAULTS };
    }
    applyTheme(_settings.theme);
    applyEditorVars();
    return _settings;
  }

  async function save(partial) {
    _settings = { ..._settings, ...partial };
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
    const autoMap = { dark: 'atom-one-dark', light: 'github', sepia: 'github', vaporwave: 'atom-one-dark', neon: 'vs2015' };
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
    _populateDialog();
    dlg.classList.remove('hidden');
  }

  function closeDialog() {
    document.getElementById('settings-dialog').classList.add('hidden');
  }

  function _populateDialog() {
    const s = _settings;
    _val('s-theme', s.theme);
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
    const newSettings = {
      theme: _val('s-theme'),
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
    };
    await save(newSettings);
    await ipcRenderer.invoke('set-always-on-top', newSettings.alwaysOnTop);
    await ipcRenderer.invoke('set-zoom-factor', newSettings.zoomFactor);
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

    document.getElementById('settings-dialog').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDialog();
    });
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

  return { load, save, get, onChange, openDialog, closeDialog, initDialogEvents };
})();
