'use strict';

const fs = require('fs');
const path = require('path');

/**
 * FileWatcher — 全タブのファイルを一括監視し、変更・消失をレンダラーへ通知する
 * fs.watchFile を使用してポーリング間隔 1500ms で監視（CPU 負荷配慮）
 */
class FileWatcher {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    // filePath -> { mtime, exists }
    this.watching = new Map();
    this._interval = null;
    this._pollInterval = 1500; // 1.5 秒ポーリング
  }

  watch(filePath) {
    if (this.watching.has(filePath)) return;

    try {
      const stat = fs.statSync(filePath);
      this.watching.set(filePath, {
        mtime: stat.mtimeMs,
        exists: true,
      });
    } catch {
      this.watching.set(filePath, { mtime: 0, exists: false });
    }

    this._ensurePolling();
  }

  unwatch(filePath) {
    this.watching.delete(filePath);
    if (this.watching.size === 0) {
      this._stopPolling();
    }
  }

  unwatchAll() {
    this.watching.clear();
    this._stopPolling();
  }

  _ensurePolling() {
    if (this._interval) return;
    this._interval = setInterval(() => this._poll(), this._pollInterval);
  }

  _stopPolling() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _poll() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this._stopPolling();
      return;
    }

    for (const [filePath, state] of this.watching) {
      try {
        const stat = fs.statSync(filePath);
        if (!state.exists) {
          // 消失していたファイルが復活
          state.exists = true;
          state.mtime = stat.mtimeMs;
        } else if (stat.mtimeMs !== state.mtime) {
          // ファイルが外部で変更された
          state.mtime = stat.mtimeMs;
          this._send('file-changed', filePath);
        }
      } catch {
        if (state.exists) {
          // ファイルが削除・移動された
          state.exists = false;
          this._send('file-deleted', filePath);
        }
      }
    }
  }

  _send(channel, ...args) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args);
      }
    } catch {
      // window が破棄されている場合は無視
    }
  }
}

module.exports = { FileWatcher };
