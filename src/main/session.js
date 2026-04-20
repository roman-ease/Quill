'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

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

const DEFAULT_SETTINGS = {
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

class SessionManager {
  constructor() {
    this._dataDir = app.getPath('userData');
    this._sessionFile = path.join(this._dataDir, 'session.json');
    this._settingsFile = path.join(this._dataDir, 'settings.json');
    this._recentFile = path.join(this._dataDir, 'recent-files.json');
    this._windowFile = path.join(this._dataDir, 'window-bounds.json');

    this._settings = null;
  }

  // ─── 設定 ────────────────────────────────────────────────────────
  getSettings() {
    if (this._settings) return this._settings;
    try {
      const raw = fs.readFileSync(this._settingsFile, 'utf8');
      const parsed = JSON.parse(raw);
      this._settings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        keybindings: { ...DEFAULT_KEYBINDINGS, ...(parsed.keybindings || {}) },
      };
    } catch {
      this._settings = { ...DEFAULT_SETTINGS, keybindings: { ...DEFAULT_KEYBINDINGS } };
    }
    return this._settings;
  }

  saveSettings(settings) {
    this._settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      keybindings: { ...DEFAULT_KEYBINDINGS, ...(settings.keybindings || {}) },
    };
    this._writeJson(this._settingsFile, this._settings);
  }

  // ─── セッション ──────────────────────────────────────────────────
  loadSession() {
    try {
      const raw = fs.readFileSync(this._sessionFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  saveSession(sessionData) {
    this._writeJson(this._sessionFile, sessionData);
  }

  // ─── 最近使ったファイル ──────────────────────────────────────────
  getRecentFiles() {
    try {
      const raw = fs.readFileSync(this._recentFile, 'utf8');
      const files = JSON.parse(raw);
      // 存在しないファイルを除外
      return files.filter((f) => {
        try { fs.accessSync(f); return true; } catch { return false; }
      });
    } catch {
      return [];
    }
  }

  addRecentFile(filePath) {
    let files = this.getRecentFiles();
    files = files.filter((f) => f !== filePath);
    files.unshift(filePath);
    if (files.length > 10) files = files.slice(0, 10);
    this._writeJson(this._recentFile, files);
  }

  clearRecentFiles() {
    this._writeJson(this._recentFile, []);
  }

  // ─── ウィンドウサイズ ────────────────────────────────────────────
  getWindowBounds() {
    try {
      const raw = fs.readFileSync(this._windowFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { width: 1280, height: 800 };
    }
  }

  saveWindowBounds(bounds) {
    this._writeJson(this._windowFile, bounds);
  }

  // ─── ヘルパー ────────────────────────────────────────────────────
  _writeJson(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // write failure is non-fatal
    }
  }
}

module.exports = { SessionManager, DEFAULT_KEYBINDINGS };
