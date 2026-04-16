'use strict';

const { Menu, app } = require('electron');

function buildMenu(mainWindow, sessionManager) {
  const send = (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  const template = [
    // ─── ファイル ───────────────────────────────────────────────
    {
      label: 'ファイル(&F)',
      submenu: [
        {
          label: '新規ファイル',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu-new-file'),
        },
        {
          label: '開く...',
          accelerator: 'CmdOrCtrl+O',
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
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu-save'),
        },
        {
          label: '名前を付けて保存...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu-save-as'),
        },
        { type: 'separator' },
        {
          label: '再読み込み',
          accelerator: 'CmdOrCtrl+R',
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
          accelerator: 'CmdOrCtrl+W',
          click: () => send('menu-close-tab'),
        },
        {
          label: '終了',
          accelerator: 'Alt+F4',
          click: () => send('app-before-close'),
        },
      ],
    },

    // ─── 編集 ───────────────────────────────────────────────────
    {
      label: '編集(&E)',
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
          accelerator: 'CmdOrCtrl+F',
          click: () => send('menu-find'),
        },
        {
          label: '検索と置換...',
          accelerator: 'CmdOrCtrl+H',
          click: () => send('menu-replace'),
        },
        { type: 'separator' },
        {
          label: '太字',
          accelerator: 'CmdOrCtrl+B',
          click: () => send('format-bold'),
        },
        {
          label: '斜体',
          accelerator: 'CmdOrCtrl+I',
          click: () => send('format-italic'),
        },
        {
          label: 'リンク',
          accelerator: 'CmdOrCtrl+K',
          click: () => send('format-link'),
        },
      ],
    },

    // ─── 挿入 ───────────────────────────────────────────────────
    {
      label: '挿入(&I)',
      submenu: [
        {
          label: 'テーブル...',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('menu-insert-table'),
        },
        {
          label: '目次を生成',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => send('menu-insert-toc'),
        },
        {
          label: 'Mermaid テンプレート',
          click: () => send('menu-insert-mermaid'),
        },
      ],
    },

    // ─── 表示 ───────────────────────────────────────────────────
    {
      label: '表示(&V)',
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
          accelerator: 'CmdOrCtrl+Shift+F',
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

    // ─── タブ ───────────────────────────────────────────────────
    {
      label: 'タブ(&T)',
      submenu: [
        {
          label: '新規タブ',
          accelerator: 'CmdOrCtrl+T',
          click: () => send('menu-new-file'),
        },
        {
          label: '次のタブ',
          accelerator: 'CmdOrCtrl+Tab',
          click: () => send('tab-next'),
        },
        {
          label: '前のタブ',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: () => send('tab-prev'),
        },
      ],
    },

    // ─── ヘルプ ──────────────────────────────────────────────────
    {
      label: 'ヘルプ(&H)',
      submenu: [
        {
          label: '設定...',
          click: () => send('menu-settings'),
        },
        { type: 'separator' },
        {
          label: 'バージョン情報',
          click: () => send('menu-about'),
        },
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
