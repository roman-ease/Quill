'use strict';
/* global document, Editor, Preview, Settings, Notifications */
const { ipcRenderer } = require('electron');

/**
 * Tab Manager — タブの状態管理・UI 管理
 */
const Tabs = (() => {
  let _tabs = [];
  let _activeTabId = null;
  let _tabCounter = 0;
  const _scrollPositions = new Map(); // tabId -> { editor, preview }

  const tabList = () => document.getElementById('tab-list');
  const previewContent = () => document.getElementById('preview-content');

  // ─── タブ作成 ────────────────────────────────────────────────────────────
  function createTab(options = {}) {
    const id = `tab-${++_tabCounter}`;
    const tab = {
      id,
      title: options.title || '新規ファイル',
      filePath: options.filePath || null,
      content: options.content || '',
      savedContent: options.content || '',
      isDirty: false,
      encoding: options.encoding || Settings.get('encoding') || 'utf8',
      lineEnding: options.lineEnding || Settings.get('lineEnding') || 'lf',
    };
    _tabs.push(tab);
    _renderTabEl(tab);
    return tab;
  }

  // ─── 空タブ再利用 ────────────────────────────────────────────────────────
  function findReuseableTab() {
    return _tabs.find(t => !t.filePath && t.content === '' && !t.isDirty);
  }

  // ─── 既開きタブ検索 ──────────────────────────────────────────────────────
  function findTabByPath(filePath) {
    return _tabs.find(t => t.filePath && t.filePath === filePath);
  }

  // ─── タブアクティブ化 ────────────────────────────────────────────────────
  function activateTab(tabId) {
    // 現在アクティブタブのスクロール位置を保存
    if (_activeTabId) {
      _scrollPositions.set(_activeTabId, {
        editor: Editor.getScrollTop(_activeTabId),
        preview: previewContent() ? previewContent().scrollTop : 0,
      });
    }

    _activeTabId = tabId;
    const tab = getTab(tabId);
    if (!tab) return;

    // タブ UI 更新
    document.querySelectorAll('.tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === tabId);
    });

    // スクロール位置復元
    const scroll = _scrollPositions.get(tabId) || { editor: 0, preview: 0 };

    // エディタ切替
    Editor.activate(tabId, tab.content, scroll.editor);

    // プレビュー更新
    Preview.render(tab.content, tab.filePath).then(() => {
      if (previewContent()) previewContent().scrollTop = scroll.preview;
    });

    // タイトルバー更新
    _updateTitle(tab);

    // ステータスバー更新
    window.dispatchEvent(new CustomEvent('tab-activated', { detail: tab }));
  }

  // ─── タブ状態更新 ────────────────────────────────────────────────────────
  function updateTabState(tabId, updates) {
    const tab = getTab(tabId);
    if (!tab) return;
    Object.assign(tab, updates);
    _updateTabEl(tab);
    _updateTitle(tab);
    window.dispatchEvent(new CustomEvent('tab-state-changed', { detail: tab }));
  }

  // ─── タブを閉じる ────────────────────────────────────────────────────────
  async function closeTab(tabId, skipConfirm = false) {
    const tab = getTab(tabId);
    if (!tab) return;

    if (!skipConfirm && tab.isDirty) {
      const result = await ipcRenderer.invoke('show-message-box', {
        type: 'question',
        title: '未保存の変更',
        message: `"${tab.title}" の変更を保存しますか?`,
        buttons: ['保存', '保存しない', 'キャンセル'],
        defaultId: 0,
        cancelId: 2,
      });
      if (result.response === 2) return false; // キャンセル
      if (result.response === 0) {
        const saved = await window.App.saveTab(tabId);
        if (!saved) return false;
      }
    }

    // ファイル監視解除
    if (tab.filePath) {
      ipcRenderer.invoke('unwatch-file', tab.filePath);
    }

    // エディタ破棄
    Editor.destroyInstance(tabId);

    // 配列から削除
    const idx = _tabs.findIndex(t => t.id === tabId);
    _tabs.splice(idx, 1);
    _scrollPositions.delete(tabId);

    // DOM から削除
    const el = tabList().querySelector(`[data-tab-id="${tabId}"]`);
    if (el) el.remove();

    // 次のタブをアクティブ化
    if (_activeTabId === tabId) {
      _activeTabId = null;
      if (_tabs.length > 0) {
        const nextIdx = Math.min(idx, _tabs.length - 1);
        activateTab(_tabs[nextIdx].id);
      } else {
        // タブが0になったら新規タブを作る
        const newTab = createTab();
        activateTab(newTab.id);
      }
    }

    return true;
  }

  // 未保存チェック付き全タブ閉じ
  async function closeAllTabs() {
    const dirtyTabs = _tabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
      const names = dirtyTabs.map(t => t.title).join(', ');
      const result = await ipcRenderer.invoke('show-message-box', {
        type: 'question',
        title: '未保存の変更',
        message: `以下のファイルに未保存の変更があります:\n${names}\n\n保存しますか?`,
        buttons: ['すべて保存', '保存しない', 'キャンセル'],
        defaultId: 0,
        cancelId: 2,
      });
      if (result.response === 2) return false;
      if (result.response === 0) {
        for (const tab of dirtyTabs) {
          await window.App.saveTab(tab.id);
        }
      }
    }
    return true;
  }

  // ─── タブ並び替え ────────────────────────────────────────────────────────
  function _initDragSort() {
    tabList().addEventListener('dragstart', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      e.dataTransfer.setData('text/plain', tab.dataset.tabId);
      tab.classList.add('dragging');
    });
    tabList().addEventListener('dragend', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) tab.classList.remove('dragging');
      tabList().querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });
    tabList().addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('.tab');
      if (!target) return;
      tabList().querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
      target.classList.add('drag-over');
    });
    tabList().addEventListener('drop', (e) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      const toEl = e.target.closest('.tab');
      if (!toEl || toEl.dataset.tabId === fromId) return;
      const toId = toEl.dataset.tabId;
      const fromIdx = _tabs.findIndex(t => t.id === fromId);
      const toIdx = _tabs.findIndex(t => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = _tabs.splice(fromIdx, 1);
      _tabs.splice(toIdx, 0, moved);
      _rebuildTabDOM();
    });
  }

  // ─── DOM 操作 ────────────────────────────────────────────────────────────
  function _renderTabEl(tab) {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.tabId = tab.id;
    el.draggable = true;
    el.innerHTML = `
      <span class="tab-title ${tab.isDirty ? 'tab-dirty' : ''}" title="${_escAttr(tab.filePath || tab.title)}">${_esc(tab.title)}</span>
      <button class="tab-close" title="閉じる">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      activateTab(tab.id);
    });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    tabList().appendChild(el);
  }

  function _updateTabEl(tab) {
    const el = tabList().querySelector(`[data-tab-id="${tab.id}"]`);
    if (!el) return;
    const titleEl = el.querySelector('.tab-title');
    titleEl.textContent = tab.title;
    titleEl.title = tab.filePath || tab.title;
    titleEl.className = `tab-title${tab.isDirty ? ' tab-dirty' : ''}`;
  }

  function _rebuildTabDOM() {
    tabList().innerHTML = '';
    _tabs.forEach(t => _renderTabEl(t));
    // アクティブ再適用
    if (_activeTabId) {
      const el = tabList().querySelector(`[data-tab-id="${_activeTabId}"]`);
      if (el) el.classList.add('active');
    }
  }

  function _updateTitle(tab) {
    const dirty = tab.isDirty ? '● ' : '';
    const title = tab.filePath ? `${dirty}${tab.title} — MarkdownViewer` : `${dirty}新規ファイル — MarkdownViewer`;
    ipcRenderer.send('set-title', title);
  }

  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _escAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  // ─── ナビゲーション ──────────────────────────────────────────────────────
  function nextTab() {
    if (_tabs.length === 0) return;
    const idx = _tabs.findIndex(t => t.id === _activeTabId);
    const next = (idx + 1) % _tabs.length;
    activateTab(_tabs[next].id);
  }

  function prevTab() {
    if (_tabs.length === 0) return;
    const idx = _tabs.findIndex(t => t.id === _activeTabId);
    const prev = (idx - 1 + _tabs.length) % _tabs.length;
    activateTab(_tabs[prev].id);
  }

  // ─── Getters ─────────────────────────────────────────────────────────────
  function getTab(tabId) {
    return _tabs.find(t => t.id === tabId) || null;
  }

  function getActiveTab() {
    return _activeTabId ? getTab(_activeTabId) : null;
  }

  function getAllTabs() {
    return [..._tabs];
  }

  function getActiveTabId() {
    return _activeTabId;
  }

  // ─── Session Serialization ───────────────────────────────────────────────
  function toSessionData() {
    return {
      tabs: _tabs.map(t => ({
        id: t.id,
        title: t.title,
        filePath: t.filePath,
        content: t.content,
        savedContent: t.savedContent,
        isDirty: t.isDirty,
        encoding: t.encoding,
        lineEnding: t.lineEnding,
        scroll: _scrollPositions.get(t.id) || { editor: 0, preview: 0 },
      })),
      activeTabId: _activeTabId,
      counter: _tabCounter,
    };
  }

  function fromSessionData(data) {
    if (!data || !data.tabs || data.tabs.length === 0) return false;
    _tabCounter = data.counter || 0;

    data.tabs.forEach(savedTab => {
      const tab = {
        id: savedTab.id,
        title: savedTab.title,
        filePath: savedTab.filePath,
        content: savedTab.content || '',
        savedContent: savedTab.savedContent || '',
        isDirty: savedTab.isDirty || false,
        encoding: savedTab.encoding || 'utf8',
        lineEnding: savedTab.lineEnding || 'lf',
      };
      _tabs.push(tab);
      if (savedTab.scroll) _scrollPositions.set(tab.id, savedTab.scroll);
      _renderTabEl(tab);
    });

    const targetId = data.activeTabId || (_tabs[0] && _tabs[0].id);
    if (targetId) activateTab(targetId);
    return true;
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  function init() {
    _initDragSort();

    document.getElementById('new-tab-btn').addEventListener('click', () => {
      window.App.newFile();
    });
  }

  return {
    init,
    createTab,
    findReuseableTab,
    findTabByPath,
    activateTab,
    updateTabState,
    closeTab,
    closeAllTabs,
    nextTab,
    prevTab,
    getTab,
    getActiveTab,
    getAllTabs,
    getActiveTabId,
    toSessionData,
    fromSessionData,
  };
})();
