'use strict';

const { Menu, app } = require('electron');
const { DEFAULT_KEYBINDINGS } = require('./session');

const isMac = process.platform === 'darwin';

function toAccelerator(key) {
  if (!key) return undefined;
  return key.replace(/^Ctrl\+/, 'CmdOrCtrl+');
}

function buildMenu(mainWindow, sessionManager, keybindings) {
  const kb = { ...DEFAULT_KEYBINDINGS, ...(keybindings || {}) };
  const acc = (id) => toAccelerator(kb[id]);

  const send = (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  const template = [
    // ─── macOS アプリメニュー ────────────────────────────────────
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: 'Quill について', click: () => send('menu-about') },
        { type: 'separator' },
        { label: '設定...', accelerator: 'Cmd+,', click: () => send('menu-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: '終了', accelerator: 'Cmd+Q', click: () => send('app-before-close') },
      ],
    }] : []),

    // ─── ファイル ────────────────────────────────────────────────
    {
      label: 'ファイル',
      submenu: [
        {
          label: '新規ファイル',
          accelerator: acc('new-file'),
          click: () => send('menu-new-file'),
        },
        {
          label: '開く...',
          accelerator: acc('open-file'),
          click: () => send('menu-open-file'),
        },
        {
          label: '最近使ったファイル',
          id: 'recent-files',
          submenu: buildRecentFilesMenu(sessionManager, send),
        },
        { type: 'separator' },
        {
          label: '上書き保存',
          accelerator: acc('save'),
          click: () => send('menu-save'),
        },
        {
          label: '名前を付けて保存...',
          accelerator: acc('save-as'),
          click: () => send('menu-save-as'),
        },
        { type: 'separator' },
        {
          label: '再読み込み',
          accelerator: acc('reload'),
          click: () => send('menu-reload-file'),
        },
        { type: 'separator' },
        {
          label: 'HTML としてエクスポート...',
          click: () => send('menu-export-html'),
        },
        {
          label: 'PDF としてエクスポート...',
          click: () => send('menu-export-pdf'),
        },
        { type: 'separator' },
        {
          label: 'タブを閉じる',
          accelerator: acc('close-tab'),
          click: () => send('menu-close-tab'),
        },
        // macOS では Cmd+Q / アプリメニューで終了するため不要
        ...(!isMac ? [
          { type: 'separator' },
          {
            label: '終了',
            accelerator: 'Alt+F4',
            click: () => send('app-before-close'),
          },
        ] : []),
      ],
    },

    // ─── 編集 ────────────────────────────────────────────────────
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '元に戻す' },
        { role: 'redo', label: 'やり直し' },
        { type: 'separator' },
        { role: 'cut', label: '切り取り' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' },
        { role: 'selectAll', label: 'すべて選択' },
        { type: 'separator' },
        {
          label: '検索...',
          accelerator: acc('find'),
          click: () => send('menu-find'),
        },
        {
          label: '検索と置換...',
          accelerator: acc('replace'),
          click: () => send('menu-replace'),
        },
        { type: 'separator' },
        {
          label: '太字',
          accelerator: acc('bold'),
          click: () => send('format-bold'),
        },
        {
          label: '斜体',
          accelerator: acc('italic'),
          click: () => send('format-italic'),
        },
        {
          label: 'リンク',
          accelerator: acc('link'),
          click: () => send('format-link'),
        },
      ],
    },

    // ─── 挿入 ────────────────────────────────────────────────────
    {
      label: '挿入',
      submenu: [
        {
          label: 'テーブル...',
          accelerator: acc('insert-table'),
          click: () => send('menu-insert-table'),
        },
        {
          label: '目次を生成',
          accelerator: acc('insert-toc'),
          click: () => send('menu-insert-toc'),
        },
        {
          label: 'Mermaid テンプレート',
          submenu: [
            { label: 'フローチャート',     click: () => send('menu-insert-mermaid', 'flowchart') },
            { label: 'シーケンス図',       click: () => send('menu-insert-mermaid', 'sequence')  },
            { label: 'クラス図',           click: () => send('menu-insert-mermaid', 'class')     },
            { label: 'ER 図',             click: () => send('menu-insert-mermaid', 'er')        },
            { label: '状態遷移図',         click: () => send('menu-insert-mermaid', 'state')     },
            { label: 'ガントチャート',     click: () => send('menu-insert-mermaid', 'gantt')     },
            { type: 'separator' },
            { label: 'パイチャート',       click: () => send('menu-insert-mermaid', 'pie')       },
            { label: 'マインドマップ',     click: () => send('menu-insert-mermaid', 'mindmap')   },
            { label: 'タイムライン',       click: () => send('menu-insert-mermaid', 'timeline')  },
            { label: 'XY チャート',        click: () => send('menu-insert-mermaid', 'xychart')   },
            { label: 'Git グラフ',         click: () => send('menu-insert-mermaid', 'git')       },
            { label: 'ユーザージャーニー', click: () => send('menu-insert-mermaid', 'journey')   },
          ],
        },
      ],
    },

    // ─── 表示 ────────────────────────────────────────────────────
    {
      label: '表示',
      submenu: [
        {
          label: '分割ビュー',
          type: 'radio',
          id: 'view-split',
          checked: true,
          click: () => send('set-view-mode', 'split'),
        },
        {
          label: 'プレビューのみ',
          type: 'radio',
          id: 'view-preview',
          click: () => send('set-view-mode', 'preview'),
        },
        { type: 'separator' },
        {
          label: 'フォーカスモード',
          accelerator: acc('focus-mode'),
          type: 'checkbox',
          id: 'focus-mode',
          click: (menuItem) => send('toggle-focus-mode', menuItem.checked),
        },
        {
          label: '同期スクロール',
          type: 'checkbox',
          id: 'sync-scroll',
          checked: true,
          click: (menuItem) => send('toggle-sync-scroll', menuItem.checked),
        },
        { type: 'separator' },
        {
          label: 'テーマ',
          submenu: [
            {
              label: 'Dark',
              type: 'radio',
              id: 'theme-dark',
              checked: true,
              click: () => send('set-theme', 'dark'),
            },
            {
              label: 'Light',
              type: 'radio',
              id: 'theme-light',
              click: () => send('set-theme', 'light'),
            },
            {
              label: 'Sepia',
              type: 'radio',
              id: 'theme-sepia',
              click: () => send('set-theme', 'sepia'),
            },
            {
              label: 'Vaporwave',
              type: 'radio',
              id: 'theme-vaporwave',
              click: () => send('set-theme', 'vaporwave'),
            },
            {
              label: 'Terminal',
              type: 'radio',
              id: 'theme-terminal',
              click: () => send('set-theme', 'terminal'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'ズームイン',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => mainWindow.webContents.setZoomFactor(
            Math.min(mainWindow.webContents.getZoomFactor() + 0.1, 3.0)
          ),
        },
        {
          label: 'ズームアウト',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.setZoomFactor(
            Math.max(mainWindow.webContents.getZoomFactor() - 0.1, 0.3)
          ),
        },
        {
          label: 'ズームリセット',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.setZoomFactor(1.0),
        },
      ],
    },

    // ─── タブ ────────────────────────────────────────────────────
    {
      label: 'タブ',
      submenu: [
        {
          label: '新規タブ',
          accelerator: acc('new-tab'),
          click: () => send('menu-new-file'),
        },
        {
          label: '次のタブ',
          accelerator: acc('next-tab'),
          click: () => send('tab-next'),
        },
        {
          label: '前のタブ',
          accelerator: acc('prev-tab'),
          click: () => send('tab-prev'),
        },
      ],
    },

    // ─── ヘルプ ──────────────────────────────────────────────────
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: 'キーボードショートカット',
          accelerator: acc('shortcut-help'),
          click: () => send('menu-shortcut-help'),
        },
        { type: 'separator' },
        // macOS では設定は Cmd+, / アプリメニューから開くが、発見性のためここにも残す
        {
          label: '設定...',
          click: () => send('menu-settings'),
        },
        // macOS ではバージョン情報はアプリメニューに表示するため除外
        ...(!isMac ? [
          { type: 'separator' },
          { label: 'バージョン情報', click: () => send('menu-about') },
        ] : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function buildRecentFilesMenu(sessionManager, send) {
  const recents = sessionManager.getRecentFiles();
  if (recents.length === 0) {
    return [{ label: '(なし)', enabled: false }];
  }
  const items = recents.map((filePath) => ({
    label: filePath,
    click: () => send('open-files', [filePath]),
  }));
  items.push(
    { type: 'separator' },
    { label: '履歴をクリア', click: () => {
      sessionManager.clearRecentFiles();
      send('recent-files-cleared');
    }}
  );
  return items;
}

module.exports = { buildMenu };
