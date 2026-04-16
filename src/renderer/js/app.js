'use strict';
/* global document, window,
   Notifications, Settings, Preview, Editor, Tabs,
   Search, Toolbar, StatusBar, ExportManager */

const { ipcRenderer } = require('electron');
const path = require('path');

/**
 * App — アプリケーションのエントリポイントとファイル操作統合
 */
const App = (() => {
  let _autoSaveTimer = null;
  let _sessionSaveTimer = null;

  // ─── 起動 ────────────────────────────────────────────────────────────────
  async function init() {
    // 設定読み込み
    await Settings.load();

    // モジュール初期化
    Tabs.init();
    Search.init();
    StatusBar.init();
    Toolbar.init();
    Toolbar.initAfterDOM();

    // ライトボックス
    _initLightbox();

    // ドラッグ&ドロップ
    _initDragDrop();

    // ペインリサイザー
    _initResizer();

    // CodeMirror スクロール同期
    _initEditorScrollSync();

    // 設定変更の反映
    Settings.onChange((s) => {
      Editor.applySettings(s);
      _resetAutoSave();
    });

    // セッション復元
    const restored = await _restoreSession();
    if (!restored) {
      const tab = Tabs.createTab();
      Tabs.activateTab(tab.id);
    }

    // 自動セッション保存 (30秒ごと)
    _sessionSaveTimer = setInterval(_saveSession, 30000);

    // 自動保存
    _resetAutoSave();

    // エディタスクロールイベントをエミット (同期スクロール用)
    window.addEventListener('tab-activated', () => {
      const cm = Editor.getActiveInstance();
      if (cm) {
        cm.on('scroll', () => {
          const info = cm.getScrollInfo();
          const ratio = info.height > info.clientHeight
            ? info.top / (info.height - info.clientHeight)
            : 0;
          window.dispatchEvent(new CustomEvent('editor-scroll', { detail: { ratio } }));
        });
      }
    });

    console.log('MarkdownViewer initialized');
  }

  // ─── ファイル操作 ────────────────────────────────────────────────────────

  function newFile() {
    const existing = Tabs.findReuseableTab();
    if (existing) {
      Tabs.activateTab(existing.id);
      return existing;
    }
    const tab = Tabs.createTab();
    Tabs.activateTab(tab.id);
    return tab;
  }

  async function openFile() {
    const result = await ipcRenderer.invoke('show-open-dialog');
    if (result.canceled || !result.filePaths.length) return;
    await openFilePaths(result.filePaths);
  }

  async function openFilePaths(filePaths) {
    for (const fp of filePaths) {
      await _openSingleFile(fp);
    }
  }

  async function _openSingleFile(filePath) {
    // 既に開いているかチェック
    const existing = Tabs.findTabByPath(filePath);
    if (existing) {
      Tabs.activateTab(existing.id);
      Notifications.show('すでに開いています', 'info', 2000);
      return;
    }

    // ファイルサイズチェック (2MB)
    try {
      const { size } = require('fs').statSync(filePath);
      if (size > 2 * 1024 * 1024) {
        const r = await ipcRenderer.invoke('show-message-box', {
          type: 'warning',
          title: '大容量ファイル',
          message: `ファイルサイズが 2MB を超えています (${(size/1024/1024).toFixed(1)} MB).\n開きますか?`,
          buttons: ['開く', 'キャンセル'],
          defaultId: 1,
        });
        if (r.response !== 0) return;
      }
    } catch { /* stat 失敗は無視 */ }

    const res = await ipcRenderer.invoke('read-file', filePath);
    if (!res.success) {
      Notifications.show(`ファイルを開けません: ${res.error}`, 'error');
      return;
    }

    // 空タブ再利用
    const reuse = Tabs.findReuseableTab();
    let tab;
    if (reuse) {
      Tabs.updateTabState(reuse.id, {
        title: path.basename(filePath),
        filePath,
        content: res.content,
        savedContent: res.content,
        isDirty: false,
        encoding: res.encoding,
        lineEnding: res.lineEnding,
      });
      Editor.setValue(res.content, reuse.id);
      tab = Tabs.getTab(reuse.id);
      Tabs.activateTab(reuse.id);
    } else {
      tab = Tabs.createTab({
        title: path.basename(filePath),
        filePath,
        content: res.content,
        encoding: res.encoding,
        lineEnding: res.lineEnding,
      });
      // savedContent を同期
      Tabs.updateTabState(tab.id, { savedContent: res.content, isDirty: false });
      Tabs.activateTab(tab.id);
    }

    // ファイル監視開始
    ipcRenderer.invoke('watch-file', filePath);

    // 最近使ったファイルに追加
    ipcRenderer.invoke('add-recent-file', filePath);
  }

  async function saveCurrentTab() {
    return saveTab(Tabs.getActiveTabId());
  }

  async function saveTab(tabId) {
    const tab = Tabs.getTab(tabId);
    if (!tab) return false;

    if (!tab.filePath) {
      return saveTabAs(tabId);
    }

    const content = Editor.getValue(tabId);
    const res = await ipcRenderer.invoke('write-file', tab.filePath, content, tab.encoding, tab.lineEnding);
    if (!res.success) {
      Notifications.show(`保存エラー: ${res.error}`, 'error');
      return false;
    }

    Tabs.updateTabState(tabId, { content, savedContent: content, isDirty: false });
    Notifications.show('保存しました', 'success', 1500);
    return true;
  }

  async function saveCurrentTabAs() {
    return saveTabAs(Tabs.getActiveTabId());
  }

  async function saveTabAs(tabId) {
    const tab = Tabs.getTab(tabId);
    if (!tab) return false;

    const result = await ipcRenderer.invoke('show-save-dialog', tab.filePath || tab.title + '.md');
    if (result.canceled) return false;

    let filePath = result.filePath;
    // 拡張子なしなら .md 付与
    if (!path.extname(filePath)) filePath += '.md';

    const content = Editor.getValue(tabId);
    const res = await ipcRenderer.invoke('write-file', filePath, content, tab.encoding, tab.lineEnding);
    if (!res.success) {
      Notifications.show(`保存エラー: ${res.error}`, 'error');
      return false;
    }

    // 新しいファイルパスで監視更新
    if (tab.filePath) ipcRenderer.invoke('unwatch-file', tab.filePath);
    ipcRenderer.invoke('watch-file', filePath);
    ipcRenderer.invoke('add-recent-file', filePath);

    Tabs.updateTabState(tabId, {
      filePath,
      title: path.basename(filePath),
      content,
      savedContent: content,
      isDirty: false,
    });

    Notifications.show('保存しました', 'success', 1500);
    return true;
  }

  async function reloadCurrentTab() {
    const tab = Tabs.getActiveTab();
    if (!tab || !tab.filePath) {
      Notifications.show('保存済みファイルがありません', 'warning');
      return;
    }
    if (tab.isDirty) {
      const r = await ipcRenderer.invoke('show-message-box', {
        type: 'question',
        title: '再読み込み',
        message: '未保存の変更があります。破棄して再読み込みしますか?',
        buttons: ['再読み込み', 'キャンセル'],
        defaultId: 1,
      });
      if (r.response !== 0) return;
    }
    const res = await ipcRenderer.invoke('read-file', tab.filePath);
    if (!res.success) {
      Notifications.show(`読み込みエラー: ${res.error}`, 'error');
      return;
    }
    Editor.setValue(res.content, tab.id);
    Tabs.updateTabState(tab.id, {
      content: res.content, savedContent: res.content, isDirty: false,
      encoding: res.encoding, lineEnding: res.lineEnding,
    });
    Notifications.show('再読み込みしました', 'info', 1500);
  }

  // ─── ファイル変更通知 ────────────────────────────────────────────────────

  function onFileChanged(filePath) {
    const tab = Tabs.getAllTabs().find(t => t.filePath === filePath);
    if (!tab) return;

    const bar = document.getElementById('file-change-bar');
    const msg = document.getElementById('file-change-msg');
    msg.textContent = `"${path.basename(filePath)}" が外部で変更されました`;
    bar.classList.remove('hidden');

    document.getElementById('file-change-reload').onclick = async () => {
      bar.classList.add('hidden');
      const res = await ipcRenderer.invoke('read-file', filePath);
      if (res.success) {
        Editor.setValue(res.content, tab.id);
        Tabs.updateTabState(tab.id, {
          content: res.content, savedContent: res.content, isDirty: false,
          encoding: res.encoding, lineEnding: res.lineEnding,
        });
        Notifications.show('再読み込みしました', 'info', 1500);
      }
    };
    document.getElementById('file-change-dismiss').onclick = () => {
      bar.classList.add('hidden');
    };
  }

  function onFileDeleted(filePath) {
    const tab = Tabs.getAllTabs().find(t => t.filePath === filePath);
    if (!tab) return;
    Notifications.show(`"${path.basename(filePath)}" が削除・移動されました`, 'warning', 6000);
    Tabs.updateTabState(tab.id, { isDirty: true });
  }

  // ─── アプリ終了 ──────────────────────────────────────────────────────────

  async function beforeClose() {
    await _saveSession();
    const ok = await Tabs.closeAllTabs();
    if (ok) {
      ipcRenderer.send('confirm-close');
    }
  }

  // ─── セッション ──────────────────────────────────────────────────────────

  async function _restoreSession() {
    if (!Settings.get('restoreSession')) return false;
    try {
      const data = await ipcRenderer.invoke('load-session');
      if (!data) return false;
      return Tabs.fromSessionData(data);
    } catch {
      return false;
    }
  }

  async function _saveSession() {
    try {
      const data = Tabs.toSessionData();
      await ipcRenderer.invoke('save-session', data);
    } catch { /* ignore */ }
  }

  // ─── 自動保存 ────────────────────────────────────────────────────────────

  function _resetAutoSave() {
    if (_autoSaveTimer) {
      clearInterval(_autoSaveTimer);
      _autoSaveTimer = null;
    }
    const s = Settings.get();
    if (s.autoSave) {
      const ms = (s.autoSaveInterval || 30) * 1000;
      _autoSaveTimer = setInterval(() => {
        const tab = Tabs.getActiveTab();
        if (tab && tab.isDirty && tab.filePath) {
          saveTab(tab.id);
        }
      }, ms);
    }
  }

  // ─── ペインリサイザー ────────────────────────────────────────────────────

  function _initResizer() {
    const resizer = document.getElementById('pane-resizer');
    const editorPane = document.getElementById('editor-pane');
    const mainContent = document.getElementById('main-content');
    let dragging = false;

    resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      resizer.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = mainContent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const total = rect.width;
      const pct = Math.max(15, Math.min(85, (x / total) * 100));
      editorPane.style.width = `${pct}%`;
      Editor.refresh();
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        resizer.classList.remove('dragging');
      }
    });
  }

  // ─── ドラッグ&ドロップ ───────────────────────────────────────────────────

  function _initDragDrop() {
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files)
        .filter(f => /\.(md|markdown|txt)$/i.test(f.name) || true)
        .map(f => f.path);
      if (files.length > 0) openFilePaths(files);
    });

    // 画像クリップボード貼り付け
    document.addEventListener('paste', async (e) => {
      const tab = Tabs.getActiveTab();
      if (!tab) return;
      const handled = await Editor.handleImagePaste(e, tab.filePath);
      if (!handled) {
        // TSV テーブル変換
        const cm = Editor.getActiveInstance();
        if (cm) Editor.handlePaste(cm, e);
      }
    });
  }

  // ─── CodeMirror スクロール同期 ───────────────────────────────────────────

  function _initEditorScrollSync() {
    // tab-activated 時に cm.on('scroll') を再バインド
    window.addEventListener('tab-activated', () => {
      const cm = Editor.getActiveInstance();
      if (!cm) return;
      // 既存リスナーはCM側が管理するので問題なし
      cm.on('scroll', () => {
        const info = cm.getScrollInfo();
        const ratio = info.height > info.clientHeight
          ? info.top / (info.height - info.clientHeight)
          : 0;
        window.dispatchEvent(new CustomEvent('editor-scroll', { detail: { ratio } }));
      });
    });
  }

  // ─── ライトボックス ──────────────────────────────────────────────────────

  function _initLightbox() {
    const lb = document.getElementById('lightbox');
    const backdrop = document.getElementById('lightbox-backdrop');
    const closeBtn = document.getElementById('lightbox-close');

    const close = () => lb.classList.add('hidden');
    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lb.classList.contains('hidden')) close();
    });
  }

  return {
    init,
    newFile,
    openFile,
    openFilePaths,
    saveCurrentTab,
    saveTab,
    saveCurrentTabAs,
    saveTabAs,
    reloadCurrentTab,
    onFileChanged,
    onFileDeleted,
    beforeClose,
  };
})();

window.App = App;

// ─── DOM Ready ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(err => {
    console.error('App init error:', err);
  });
});
