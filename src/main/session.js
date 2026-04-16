'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  theme: 'dark',
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
  syntaxTheme: 'github-dark',
  mermaidTheme: 'dark',
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
      this._settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      this._settings = { ...DEFAULT_SETTINGS };
    }
    return this._settings;
  }

  saveSettings(settings) {
    this._settings = { ...DEFAULT_SETTINGS, ...settings };
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

module.exports = { SessionManager };
