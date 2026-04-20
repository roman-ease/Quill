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
const sessionManager = new SessionManager();

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
    title: 'Quill',
    icon: path.join(__dirname, '../../assets/icon.ico'),
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
  buildMenu(mainWindow, sessionManager, settings.keybindings);

  // IPC ハンドラ登録
  const fileWatcher = new FileWatcher(mainWindow);
  registerIpcHandlers(mainWindow, sessionManager, fileWatcher);

  // HTML ロード
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 準備完了後に表示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (savedBounds.isMaximized) mainWindow.maximize();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // ウィンドウサイズ保存
  const saveBounds = () => {
    if (mainWindow.isMinimized()) return;
    const isMaximized = mainWindow.isMaximized();
    const data = isMaximized
      ? { ...sessionManager.getWindowBounds(), isMaximized: true }
      : { ...mainWindow.getBounds(), isMaximized: false };
    sessionManager.saveWindowBounds(data);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('maximize', saveBounds);
  mainWindow.on('unmaximize', saveBounds);

  // 終了前セッション保存
  let _closeForced = false;
  mainWindow.on('close', (e) => {
    if (_closeForced) return; // フォールバック強制終了は通す
    // レンダラーに終了確認を委譲
    e.preventDefault();
    mainWindow.webContents.send('app-before-close');

    // レンダラーが 4 秒以内に confirm-close を返さなければ強制終了
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        _closeForced = true;
        mainWindow.destroy();
      }
    }, 4000);
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
    // .asar パッケージ内パスを除外 (Electron 内部パス)
    if (arg.includes('.asar')) continue;
    try {
      const resolved = path.resolve(arg);
      if (fs.statSync(resolved).isFile()) {
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

// ショートカット変更後のメニュー再構築

ipcMain.on('rebuild-menu', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const settings = sessionManager.getSettings();
    buildMenu(mainWindow, sessionManager, settings.keybindings);
  }
});
