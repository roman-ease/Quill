# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# 依存関係のインストール
npm install

# 通常起動
npm start

# 開発モード (DevTools 自動起動)
npm run dev

# Windows 向けインストーラービルド (dist/ に出力)
npm run build

# macOS 向け DMG ビルド
npm run build:mac

# Windows 向けアンパックビルド (インストーラーなし)
npm run build:dir
```

テスト・リントのスクリプトはない。動作確認は `npm run dev` で DevTools を開いて行う。

## アーキテクチャ

Electron の標準的な Main/Renderer 分離構成。バンドラーは使用せず、ライブラリは `node_modules` から直接 HTML でロードする。

### プロセス構成

```
src/main/main.js        ← メインプロセス エントリ (BrowserWindow, シングルインスタンス管理)
src/main/ipc-handlers.js ← ipcMain.handle の登録 (ファイル IO, ダイアログ, PDF 出力等)
src/main/session.js     ← SessionManager: 設定/セッション/最近使ったファイルの永続化
src/main/menu.js        ← ネイティブメニュー構築 (ショートカットのカスタマイズに対応)
src/main/file-watcher.js ← fs.watch によるファイル監視、変更/削除を renderer へ通知

src/preload.js          ← contextBridge: whitelisted な IPC チャンネルと Node API を公開
                           highlight.js もここで UMD なしに安全に公開する

src/renderer/index.html ← エントリ HTML。ライブラリを <script> で直接読み込む
src/renderer/js/app.js       ← App: ファイル操作統合、セッション管理、D&D、ペインリサイザー
src/renderer/js/editor.js    ← Editor: CodeMirror 5 ラッパー、タブごとにインスタンス管理
src/renderer/js/preview.js   ← Preview: marked → DOMPurify → Mermaid/KaTeX レンダリング
src/renderer/js/tabs.js      ← Tabs: タブの状態・UI・セッションシリアライズ
src/renderer/js/settings.js  ← Settings: 設定の読み込み・保存・ダイアログ UI
src/renderer/js/toolbar.js   ← Toolbar: ツールバーのイベントハンドリング
src/renderer/js/search.js    ← Search: 検索・置換 UI と CodeMirror 検索連携
src/renderer/js/outline.js   ← Outline: アウトラインドロワー
src/renderer/js/export.js    ← ExportManager: HTML/PDF エクスポート
src/renderer/js/statusbar.js ← StatusBar: 行/列/文字数/エンコーディング表示
src/renderer/js/notifications.js ← Notifications: トースト通知
```

### セキュリティモデル

`nodeIntegration: false` + `contextIsolation: true`。レンダラーは `window.ipcRenderer` 経由でのみ Main と通信する。`src/preload.js` で 3 種のチャンネルホワイトリスト (INVOKE_CHANNELS / SEND_CHANNELS / ON_CHANNELS) を管理しており、リストにないチャンネルはエラーになる。新しい IPC チャンネルを追加するときはここのリストも更新する必要がある。

### Renderer のモジュールシステム

バンドラーなし。各 JS ファイルは IIFE で定義され、`window.ModuleName = ModuleName` としてグローバルに公開する。依存関係の解決は HTML の `<script>` ロード順に依存する。モジュール間は `window.App`, `window.Editor`, `window.Tabs` 等で相互参照する。

### IPC 通信フロー

```
Renderer (window.ipcRenderer.invoke / send)
  ↓ contextBridge (src/preload.js でホワイトリスト検査)
Main (ipc-handlers.js の ipcMain.handle / ipcMain.on)
  ↓
SessionManager / FileWatcher / dialog / shell / fs
```

Main → Renderer への push 通知は `mainWindow.webContents.send(channel, ...)` で行い、Renderer 側は `window.ipcRenderer.on(channel, listener)` で受け取る。

### 設定・セッションの永続化

`SessionManager` が `app.getPath('userData')` (Windows: `%APPDATA%\Quill`) に以下を JSON で保存する:

| ファイル | 内容 |
|---|---|
| `settings.json` | アプリ設定全般 |
| `session.json` | タブ一覧・コンテンツ・スクロール位置 |
| `recent-files.json` | 最近使ったファイル (最大 10 件) |
| `window-bounds.json` | ウィンドウサイズ・位置 |
| `templates.json` | ユーザー定義テンプレート |

### Mermaid / KaTeX の遅延ロード

- Mermaid は初回のコードブロックレンダリング時に `globalThis.mermaid` を参照して初期化する。テーマ変更時は `mermaid.initialize()` を再呼び出しする。
- KaTeX は設定で有効化されている場合のみ `window.katex` を参照する。
- どちらも dynamic import は使わず、HTML の `<script>` でロード済みのグローバルを使う。

### プレビューレンダリングパイプライン

```
Markdown テキスト
  → resolveImagePaths (相対パス → Base64 変換)
  → preprocessKaTeX (数式プレースホルダー化)
  → marked.parse (カスタム renderer で hljs ハイライト / Mermaid プレースホルダー)
  → DOMPurify.sanitize
  → innerHTML 設定
  → renderMermaid (プレースホルダーを SVG に置換)
  → renderKaTeX (プレースホルダーを数式に置換)
```

DOMPurify の `afterSanitizeAttributes` フックで `file://` スキームの画像 src を保持している (`preview.js` 先頭)。

### ショートカットのカスタマイズ

ショートカットは Settings (`settings.json` の `keybindings` オブジェクト) → `menu.js` (Electron アクセラレーター) → `editor.js` (CodeMirror extraKeys) の 3 箇所で同期して使用する。変更後は `ipcRenderer.send('rebuild-menu')` でメニューを再構築する。

### 同期スクロール

エディタスクロール → `CustomEvent('editor-scroll')` → `preview.js` / `statusbar.js` が傾聴。逆方向 (プレビュー → エディタ) は `CustomEvent('preview-scroll')` を使用。`scrollSource` フラグとタイムアウトでループを防止している。
