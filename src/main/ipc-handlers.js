'use strict';

const { ipcMain, dialog, shell, app, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

function registerIpcHandlers(mainWindow, sessionManager, fileWatcher) {

  // ─── ファイル読み込み ────────────────────────────────────────────
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      const stats = fs.statSync(filePath);
      const buffer = fs.readFileSync(filePath);

      // エンコーディング検出
      let encoding = 'utf8';
      let content;
      if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
        encoding = 'utf16le';
        content = buffer.toString('utf16le').replace(/^\uFEFF/, '');
      } else if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        encoding = 'utf8bom';
        content = buffer.slice(3).toString('utf8');
      } else {
        content = buffer.toString('utf8');
      }

      // 改行コード検出
      const lineEnding = content.includes('\r\n') ? 'crlf' : 'lf';

      return { success: true, content, encoding, lineEnding, size: stats.size };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── ファイル書き込み ────────────────────────────────────────────
  ipcMain.handle('write-file', async (event, filePath, content, encoding, lineEnding) => {
    try {
      // 改行コード変換
      let text = content.replace(/\r\n/g, '\n');
      if (lineEnding === 'crlf') {
        text = text.replace(/\n/g, '\r\n');
      }

      let buffer;
      if (encoding === 'utf16le') {
        const bom = Buffer.from([0xFF, 0xFE]);
        const data = Buffer.from(text, 'utf16le');
        buffer = Buffer.concat([bom, data]);
      } else if (encoding === 'utf8bom') {
        const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
        const data = Buffer.from(text, 'utf8');
        buffer = Buffer.concat([bom, data]);
      } else {
        buffer = Buffer.from(text, 'utf8');
      }

      fs.writeFileSync(filePath, buffer);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── ファイルダイアログ ──────────────────────────────────────────
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'ファイルを開く',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown ファイル', extensions: ['md', 'markdown'] },
        { name: 'テキストファイル', extensions: ['txt'] },
        { name: 'すべてのファイル', extensions: ['*'] },
      ],
      ...options,
    });
    return result;
  });

  ipcMain.handle('show-save-dialog', async (event, defaultPath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '名前を付けて保存',
      defaultPath: defaultPath || 'untitled.md',
      filters: [
        { name: 'Markdown ファイル', extensions: ['md'] },
        { name: 'テキストファイル', extensions: ['txt'] },
        { name: 'すべてのファイル', extensions: ['*'] },
      ],
    });
    return result;
  });

  // ─── 確認ダイアログ ──────────────────────────────────────────────
  ipcMain.handle('show-message-box', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options);
    return result;
  });

  // ─── 外部ブラウザでリンクを開く ─────────────────────────────────
  ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
  });

  // ─── ファイルをエクスプローラーで表示 ───────────────────────────
  ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // ─── ファイル監視 ───────────────────────────────────────────────
  ipcMain.handle('watch-file', (event, filePath) => {
    fileWatcher.watch(filePath);
    return { success: true };
  });

  ipcMain.handle('unwatch-file', (event, filePath) => {
    fileWatcher.unwatch(filePath);
    return { success: true };
  });

  // ─── セッション管理 ─────────────────────────────────────────────
  ipcMain.handle('save-session', async (event, sessionData) => {
    sessionManager.saveSession(sessionData);
    return { success: true };
  });

  ipcMain.handle('load-session', async () => {
    return sessionManager.loadSession();
  });

  ipcMain.handle('save-settings', async (event, settings) => {
    sessionManager.saveSettings(settings);
    return { success: true };
  });

  ipcMain.handle('load-settings', async () => {
    return sessionManager.getSettings();
  });

  // ─── 最近使ったファイル ─────────────────────────────────────────
  ipcMain.handle('add-recent-file', async (event, filePath) => {
    if (filePath === '__clear__') {
      sessionManager.clearRecentFiles();
    } else {
      sessionManager.addRecentFile(filePath);
    }
    return { success: true };
  });

  ipcMain.handle('get-recent-files', async () => {
    return sessionManager.getRecentFiles();
  });

  // ─── ディレクトリ作成 ───────────────────────────────────────────
  ipcMain.handle('ensure-dir', async (event, dirPath) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── ファイル存在確認 ───────────────────────────────────────────
  ipcMain.handle('file-exists', async (event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  // ─── パス操作 ───────────────────────────────────────────────────
  ipcMain.handle('path-info', async (event, filePath) => {
    return {
      dir: path.dirname(filePath),
      base: path.basename(filePath),
      ext: path.extname(filePath),
      name: path.basename(filePath, path.extname(filePath)),
    };
  });

  ipcMain.handle('path-join', async (event, ...parts) => {
    return path.join(...parts);
  });

  ipcMain.handle('path-resolve', async (event, ...parts) => {
    return path.resolve(...parts);
  });

  // ─── 画像を Base64 変換 ─────────────────────────────────────────
  ipcMain.handle('read-image-base64', async (event, imagePath) => {
    try {
      const buffer = fs.readFileSync(imagePath);
      const ext = path.extname(imagePath).toLowerCase().slice(1);
      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
      };
      const mime = mimeMap[ext] || 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  });

  // ─── 画像ファイルを保存 ─────────────────────────────────────────
  ipcMain.handle('save-image', async (event, destPath, base64Data) => {
    try {
      const base64 = base64Data.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── アプリ情報 ─────────────────────────────────────────────────
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

  // ─── ウィンドウ制御 ─────────────────────────────────────────────
  ipcMain.handle('set-always-on-top', (event, flag) => {
    mainWindow.setAlwaysOnTop(flag);
  });

  ipcMain.handle('set-zoom-factor', (event, factor) => {
    mainWindow.webContents.setZoomFactor(factor);
  });

  // ─── タイトルバー更新 ───────────────────────────────────────────
  ipcMain.on('set-title', (event, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title);
    }
  });

  // ─── メニューアイテムのチェック状態更新 ─────────────────────────
  ipcMain.on('set-menu-item-checked', (event, id, checked) => {
    const menu = Menu.getApplicationMenu();
    if (menu) {
      const item = menu.getMenuItemById(id);
      if (item) item.checked = checked;
    }
  });

  // ─── PDF 出力 ───────────────────────────────────────────────────
  ipcMain.handle('print-to-pdf', async (event, htmlContent) => {
    const { BrowserWindow: BW } = require('electron');
    const pdfWin = new BW({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'PDF として保存',
      defaultPath: 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (result.canceled) {
      pdfWin.destroy();
      return { success: false, canceled: true };
    }

    try {
      await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
      const pdfData = await pdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
      });
      fs.writeFileSync(result.filePath, pdfData);
      pdfWin.destroy();
      return { success: true, filePath: result.filePath };
    } catch (err) {
      pdfWin.destroy();
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIpcHandlers };
