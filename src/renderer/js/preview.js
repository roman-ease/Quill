'use strict';
/* global ipcRenderer, nodePath, document, Settings, Notifications, Tabs */

const { marked } = require('marked');
const hljs = require('highlight.js');
const createDOMPurify = require('dompurify');

const DOMPurify = createDOMPurify(window);

// DOMPurify: file:// src の画像を許可
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG' && node.getAttribute('src')) {
    const src = node.getAttribute('src');
    if (src.startsWith('data:') || src.startsWith('file:')) {
      node.setAttribute('src', src);
    }
  }
});

const Preview = (() => {
  let _mermaidLoaded = false;
  let _katexLoaded = false;
  let _mermaidModule = null;
  let _currentMermaidTheme = null;

  // アプリテーマ → Mermaid テーマのマッピング
  const _MERMAID_THEME_MAP = { dark: 'dark', light: 'default', sepia: 'neutral', vaporwave: 'dark', terminal: 'dark' };

  function _resolveMermaidTheme() {
    const setting = Settings.get('mermaidTheme');
    if (setting && setting !== 'auto') return setting;
    const appTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    return _MERMAID_THEME_MAP[appTheme] || 'dark';
  }
  let _katexModule = null;
  let _renderTimer = null;
  const DEBOUNCE_MS = 250;

  // marked の設定
  marked.setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
  });

  // カスタムレンダラー
  const renderer = new marked.Renderer();

  // 見出し: ID 付与
  renderer.heading = function(text, level, raw) {
    const id = raw.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').trim();
    return `<h${level} id="${id}">${text}</h${level}>\n`;
  };

  // コードブロック: hljs ハイライト + コピーボタン + Mermaid 判定
  renderer.code = function(code, language) {
    if (language === 'mermaid') {
      return `<div class="mermaid">${escapeHtml(code)}</div>\n`;
    }

    let highlighted = '';
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }

    return `<pre><button class="code-copy-btn" data-code="${escapeAttr(code)}">コピー</button><code class="hljs language-${escapeHtml(language || '')}">${highlighted}</code></pre>\n`;
  };

  // リンク: 外部リンク判定
  renderer.link = function(href, title, text) {
    const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const externalAttr = isExternal ? ' data-external="true"' : '';
    return `<a href="${escapeAttr(href || '')}"${titleAttr}${externalAttr}>${text}</a>`;
  };

  // 画像: 相対パス → file:// (Base64 変換はファイル保存時に実施)
  renderer.image = function(href, title, text) {
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    return `<img src="${escapeAttr(href || '')}" alt="${escapeAttr(text || '')}"${titleAttr} data-lightbox="true">`;
  };

  marked.use({ renderer });

  // ─── Public API ──────────────────────────────────────────────────────────

  function scheduleRender(content, filePath) {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => render(content, filePath), DEBOUNCE_MS);
  }

  async function render(content, filePath) {
    const container = document.getElementById('preview-content');
    if (!container) return;

    if (!content || content.trim() === '') {
      container.innerHTML = `
        <div class="preview-empty">
          <div class="preview-empty-icon">📝</div>
          <div>Markdown を入力するとここにプレビューが表示されます</div>
        </div>`;
      return;
    }

    // 画像パスの解決: 相対パスを file:// に変換
    let processedContent = content;
    if (filePath) {
      processedContent = await resolveImagePaths(content, filePath);
    }

    // KaTeX 前処理
    if (Settings.get('katexEnabled')) {
      processedContent = preprocessKaTeX(processedContent);
    }

    // Markdown → HTML
    let html = marked.parse(processedContent);

    // XSS サニタイズ
    html = DOMPurify.sanitize(html, {
      ADD_ATTR: ['data-external', 'data-lightbox', 'data-code'],
      ADD_TAGS: ['math', 'maction', 'semantics', 'mrow', 'msup', 'msub', 'msubsup',
                  'munder', 'mover', 'munderover', 'mfrac', 'msqrt', 'mroot',
                  'mi', 'mn', 'mo', 'mtext', 'mspace', 'menclose', 'mtable',
                  'mtr', 'mtd', 'mfenced', 'mstyle', 'merror', 'annotation'],
      FORCE_BODY: false,
    });

    container.innerHTML = `<div class="preview-body">${html}</div>`;

    // Mermaid レンダリング
    const mermaidNodes = container.querySelectorAll('.mermaid');
    if (mermaidNodes.length > 0) {
      await renderMermaid(mermaidNodes);
    }

    // KaTeX レンダリング
    if (Settings.get('katexEnabled')) {
      await renderKaTeX(container);
    }

    // コードコピーボタン
    attachCopyButtons(container);

    // ライトボックス
    attachLightboxListeners(container);

    // 外部リンク
    attachLinkListeners(container);

    // タスクリスト チェックボックス
    attachTaskListeners(container);
  }

  // ─── Mermaid ─────────────────────────────────────────────────────────────

  async function renderMermaid(nodes) {
    const wantedTheme = _resolveMermaidTheme();

    if (!_mermaidLoaded) {
      try {
        // mermaid.min.js を <script> タグで読み込み済み → globalThis.mermaid を使用
        // dynamic import は ts-dedent などのベア指定子を解決できないため使用しない
        if (!globalThis.mermaid) throw new Error('mermaid がロードされていません');
        _mermaidModule = globalThis.mermaid;
        _mermaidModule.initialize({
          startOnLoad: false,
          theme: wantedTheme,
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });
        _mermaidLoaded = true;
        _currentMermaidTheme = wantedTheme;
      } catch (err) {
        nodes.forEach(n => { n.textContent = `(Mermaid の読み込みに失敗しました: ${err.message})`; });
        return;
      }
    } else if (_currentMermaidTheme !== wantedTheme) {
      // テーマ変更時に再初期化
      _mermaidModule.initialize({
        startOnLoad: false,
        theme: wantedTheme,
        securityLevel: 'loose',
        fontFamily: 'inherit',
      });
      _currentMermaidTheme = wantedTheme;
    }

    // render() が body に直接挿入した一時要素を除去してからレンダリング開始
    _purgeMermaidOrphans();

    for (const node of nodes) {
      const code = node.textContent;
      try {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let _parseError = null;
        _mermaidModule.parseError = (err) => { _parseError = err; };
        const { svg } = await _mermaidModule.render(id, code);
        // render() 後に残った一時要素をその都度除去
        _purgeMermaidOrphans();
        if (_parseError || _mermaidSvgHasError(svg)) {
          node.textContent = code;
        } else {
          node.innerHTML = svg;
        }
      } catch {
        _purgeMermaidOrphans();
        node.textContent = code;
      }
    }
  }

  // Mermaid が render() 中に body へ直接挿入する一時要素を除去する
  // エラー時はこれらが残留して画面下部に表示されてしまうため、毎レンダリング時に掃除する
  function _purgeMermaidOrphans() {
    document.querySelectorAll('[id^="mermaid-"]').forEach(el => {
      if (!el.closest('#preview-content')) el.remove();
    });
  }

  function _mermaidSvgHasError(svg) {
    if (typeof svg !== 'string') return false;
    return svg.includes('Syntax error') || svg.includes('syntax-error') || svg.includes('error-icon');
  }

  // ─── KaTeX ───────────────────────────────────────────────────────────────

  function preprocessKaTeX(text) {
    // $$...$$  ブロック数式
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) =>
      `<span class="math-block" data-math="${escapeAttr(math.trim())}"></span>`
    );
    // $...$ インライン数式 (改行なし)
    text = text.replace(/\$([^\n$]+?)\$/g, (_, math) =>
      `<span class="math-inline" data-math="${escapeAttr(math.trim())}"></span>`
    );
    return text;
  }

  async function renderKaTeX(container) {
    if (!_katexLoaded) {
      try {
        _katexModule = require('katex');
        // KaTeX CSS
        if (!document.getElementById('katex-css')) {
          const link = document.createElement('link');
          link.id = 'katex-css';
          link.rel = 'stylesheet';
          const katexCssPath = require('path').join(__dirname, '../../../node_modules/katex/dist/katex.min.css');
          link.href = 'file:///' + katexCssPath.replace(/\\/g, '/');
          document.head.appendChild(link);
        }
        _katexLoaded = true;
      } catch {
        return;
      }
    }

    container.querySelectorAll('.math-block').forEach(el => {
      try {
        el.innerHTML = _katexModule.renderToString(el.dataset.math, {
          displayMode: true, throwOnError: false,
        });
      } catch { /* ignore */ }
    });
    container.querySelectorAll('.math-inline').forEach(el => {
      try {
        el.innerHTML = _katexModule.renderToString(el.dataset.math, {
          displayMode: false, throwOnError: false,
        });
      } catch { /* ignore */ }
    });
  }

  // ─── Image Path Resolution ───────────────────────────────────────────────

  async function resolveImagePaths(content, filePath) {
    const dir = nodePath.dirname(filePath);
    // ![alt](./relative/path.png) パターン
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const replacements = [];
    let match;

    while ((match = imgRegex.exec(content)) !== null) {
      const [full, alt, src] = match;
      if (src.startsWith('http://') || src.startsWith('https://') ||
          src.startsWith('data:') || src.startsWith('file://')) {
        continue;
      }
      // 相対または絶対パス
      const absPath = nodePath.isAbsolute(src) ? src : nodePath.join(dir, src);
      try {
        const base64 = await ipcRenderer.invoke('read-image-base64', absPath);
        if (base64) {
          replacements.push({ full, replacement: `![${alt}](${base64})` });
        }
      } catch { /* ignore missing images */ }
    }

    let result = content;
    for (const { full, replacement } of replacements) {
      result = result.replaceAll(full, replacement);
    }
    return result;
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────

  function attachCopyButtons(container) {
    container.querySelectorAll('.code-copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const code = btn.dataset.code || '';
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = 'コピーしました!';
          setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
        } catch {
          btn.textContent = 'エラー';
        }
      });
    });
  }

  function attachLightboxListeners(container) {
    container.querySelectorAll('img[data-lightbox="true"]').forEach(img => {
      img.addEventListener('click', () => {
        const lb = document.getElementById('lightbox');
        const lbImg = document.getElementById('lightbox-img');
        lbImg.src = img.src;
        lb.classList.remove('hidden');
      });
    });
  }

  function attachLinkListeners(container) {
    container.querySelectorAll('a[data-external="true"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (Settings.get('openLinksInBrowser')) {
          ipcRenderer.invoke('open-external', a.href);
        }
      });
    });
    // ハッシュリンク (スムーズスクロール)
    container.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function attachTaskListeners(container) {
    container.querySelectorAll('.task-list-item input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        // Tabs モジュールを通じてエディタの [ ] / [x] を書き換え
        const checked = cb.checked;
        const listItem = cb.closest('li');
        const itemText = listItem ? listItem.textContent.trim().replace(/^.\s/, '') : '';
        if (window.Editor) {
          window.Editor.toggleTaskItem(itemText, checked);
        }
      });
    });
  }

  // ─── HTML Export helper ──────────────────────────────────────────────────

  function getPreviewHTML() {
    const body = document.querySelector('#preview-content .preview-body');
    return body ? body.innerHTML : '';
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { scheduleRender, render, getPreviewHTML };
})();
