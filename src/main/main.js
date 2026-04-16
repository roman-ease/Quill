'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc-handlers');
const { SessionManager } = require('./session');
const { FileWatcher } = require('./file-watcher');

// ─── Single Instance Lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // セカンダリ起動: プライマリにファイルパスを渡して即終了
  app.quit();
  process.exit(0);
}

// ─── Globals ─────────────────────────────────────────────────────────────────
let mainWindow = null;
const isDev = process.argv.includes('--dev');

// ─── Second Instance Handler ─────────────────────────────────────────────────
app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (!mainWindow) return;

  // ウィンドウをフォアグラウンドへ
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.show();

  // コマンドライン引数からファイルパスを抽出して送信
  const files = extractFilePaths(commandLine);
  if (files.length > 0) {
    mainWindow.webContents.send('open-files', files);
  }
});

// ─── App Ready ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await createWindow();

  // 起動時コマンドライン引数のファイルを開く
  const files = extractFilePaths(process.argv);
  if (files.length > 0) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-files', files);
    });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Create Window ───────────────────────────────────────────────────────────
async function createWindow() {
  const sessionManager = new SessionManager();
  const savedBounds = sessionManager.getWindowBounds();
  const settings = sessionManager.getSettings();

  mainWindow = new BrowserWindow({
    width: savedBounds.width || 1280,
    height: savedBounds.height || 800,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1e1e1e',
    show: false,
    title: 'MarkdownViewer',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
    },
  });

  // ズーム倍率を適用
  if (settings.zoomFactor) {
    mainWindow.webContents.setZoomFactor(settings.zoomFactor);
  }

  // 常に手前に表示
  if (settings.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true);
  }

  // メニュー構築
  buildMenu(mainWindow, sessionManager);

  // IPC ハンドラ登録
  const fileWatcher = new FileWatcher(mainWindow);
  registerIpcHandlers(mainWindow, sessionManager, fileWatcher);

  // HTML ロード
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 準備完了後に表示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // ウィンドウサイズ保存
  const saveBounds = () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      sessionManager.saveWindowBounds(mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // 終了前セッション保存
  mainWindow.on('close', (e) => {
    // レンダラーに終了確認を委譲
    e.preventDefault();
    mainWindow.webContents.send('app-before-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function extractFilePaths(argv) {
  const files = [];
  // 最初の引数はプロセス名、--dev 等のフラグを除外
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') || arg.startsWith('-')) continue;
    // Electron の内部パス等を除外
    if (arg.endsWith('.asar') || arg.endsWith('main.js')) continue;
    try {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved)) {
        files.push(resolved);
      }
    } catch {
      // ignore
    }
  }
  return files;
}

// レンダラーからの終了許可を受け取る
ipcMain.on('confirm-close', () => {
  if (mainWindow) {
    mainWindow.destroy();
  }
});
