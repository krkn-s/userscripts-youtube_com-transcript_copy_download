// ==UserScript==
// @name         Notion Export Markdown
// @namespace    https://github.com/krkn-s
// @version      2026.08.02.6
// @description  Adds an MD button to the Notion topbar to download the current page as Markdown, with optional YAML frontmatter.
// @author       krkn-s
// @homepage     https://github.com/krkn-s/userscripts
// @homepageURL  https://github.com/krkn-s/userscripts
// @supportURL   https://github.com/krkn-s/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/notion-export-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/notion-export-markdown.user.js
// @match        https://app.notion.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

/**
 * Notion Export Markdown
 * ----------------------
 * Adds two minimalist buttons to the Notion page topbar, just left of the
 * "Edited …" timestamp: "MD" downloads the current page as a Markdown
 * document, the copy button (⧉) puts the same document on the clipboard.
 * Click = with YAML frontmatter, Shift+Click = without frontmatter.
 *
 * The whole page is parsed from the rendered DOM (the same editable page the
 * reader sees), so no network request, API call or authentication token is
 * needed. Supported blocks: paragraphs, headings, bulleted/numbered lists,
 * to-dos, toggles, quotes, callouts, dividers, code blocks, images, links,
 * bookmarks / embeds and child-page links. Inline formatting (bold, italic,
 * strikethrough, inline code and links) is preserved.
 *
 * The YAML frontmatter contains the page title, the last-edit date (read from
 * the "Edited …" label when parseable) and the source URL, plus any non-empty
 * page property shown under the title ("Description", "Date de soumission",
 * "Auteur", …).
 */

(function () {
  'use strict';

  const VERSION = '2026.08.02.7';
  const BTN_MD_CLASS = 'notion-md-export-button';
  const BTN_COPY_CLASS = 'notion-md-copy-button';

  /* ---------------------------------------------------------------- *
   *  Generic helpers
   * ---------------------------------------------------------------- */

  function nodeText(el) {
    return el ? (el.textContent || '').trim() : '';
  }

  function slugify(input) {
    return String(input)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Escape Markdown punctuation in plain text. Newlines become hard breaks so
  // single line-breaks inside a paragraph survive in the exported document.
  function escapeInline(text) {
    return String(text)
      .replace(/([\\*_`#\[\]])/g, '\\$1')
      .replace(/\r/g, '')
      .replace(/\n+/g, '  \n');
  }

  function yamlQuote(value) {
    var s = String(value == null ? '' : value);
    var safe = /^[\w\u00C0-\u024F\u0400-\u04FF]/.test(s) &&
      /^(?:[\w\u00C0-\u024F\u0400-\u04FF]|[-_ .:/@#+()§%!?,'"=])+$/.test(s) &&
      !/\s:/.test(s) && !/:\s/.test(s) && !/:$/.test(s) && !/ #/.test(s) && !/ $/.test(s);
    if (safe) return s;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /* ---------------------------------------------------------------- *
   *  Rich text: content-editable leaf -> inline Markdown
   * ---------------------------------------------------------------- */

  // One leaf = one contenteditable text run inside a block. Its children are
  // text nodes and token spans carrying inline styles (bold, italic, code).
  function leafToMarkdown(leafEl) {
    var out = '';
    var kids = leafEl.childNodes;
    for (var i = 0; i < kids.length; i += 1) {
      out += inlineNode(kids[i]);
    }
    return out.trim();
  }

  function inlineChildren(el) {
    var out = '';
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i += 1) out += inlineNode(kids[i]);
    return out;
  }

  function inlineNode(node) {
    if (node.nodeType === 3) {
      // Notion inserts stray whitespace text nodes between tokenized spans
      // (and HTML dumps add pretty-print indentation). Collapse all runs so
      // only real single spaces survive between tokens.
      var text = (node.nodeValue || '').replace(/[ \t\r\n]+/g, ' ');
      return escapeInline(text);
    }
    if (node.nodeType !== 1) return '';
    var el = node;
    var cls = el.getAttribute && el.getAttribute('class') ? el.getAttribute('class') : '';
    var tag = el.tagName.toUpperCase();

    // Decorative helpers that must never reach the export.
    if (
      (el.getAttribute && el.getAttribute('aria-hidden') === 'true') ||
      cls.indexOf('notion-enable-hover') !== -1 && el.children.length === 0 && !nodeText(el)
    ) {
      return '';
    }
    if (tag === 'BR') return '  \n';

    // Inline link.
    if (tag === 'A') {
      var href = el.getAttribute('href') || '';
      var label = inlineChildren(el).trim();
      return label ? '[' + label + '](' + href + ')' : href;
    }

    // Inline code: literal text, only backticks escaped. Whitespace is
    // collapsed the same way as plain text (dump/editor artifacts).
    if (cls.indexOf('notion-inline-code-container') !== -1 || cls.indexOf('inlineCode') !== -1) {
      var codeText = (nodeText(el) || '').replace(/\s+/g, ' ').replace(/`/g, '\\`');
      return codeText ? '`' + codeText + '`' : '';
    }

    var inner = inlineChildren(el);

    // Notion styles its tokens with inline styles: read them directly.
    var st = el.style;
    var open = '';
    var close = '';
    if (st) {
      var w = st.fontWeight;
      if (w === '600' || w === '700' || w === '800' || w === '900' || w === 'bold') { open += '**'; close = '**' + close; }
      if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') { open += '*'; close = '*' + close; }
      if ((st.textDecorationLine || st.textDecoration || '').indexOf('line-through') !== -1) { open += '~~'; close = '~~' + close; }
    }
    if (open) {
      var trimmed = inner.trim();
      return trimmed ? open + trimmed + close : '';
    }
    return inner;
  }

  /* ---------------------------------------------------------------- *
   *  Blocks: one `.notion-XX-block` element -> Markdown lines
   * ---------------------------------------------------------------- */

  var BLOCK_TYPES = [
    'header', 'sub_header', 'sub_sub_header', 'text', 'bulleted_list',
    'numbered_list', 'to_do', 'toggle', 'quote', 'callout', 'divider',
    'code', 'image', 'video', 'audio', 'pdf', 'file', 'embed', 'bookmark',
    'link_to_page', 'child_page', 'column_list', 'column', 'synced',
    'breadcrumb', 'equation', 'table', 'table_row', 'page'
  ];

  function blockType(block) {
    var cls = block.className || '';
    for (var i = 0; i < BLOCK_TYPES.length; i += 1) {
      if (cls.indexOf('notion-' + BLOCK_TYPES[i] + '-block') !== -1) return BLOCK_TYPES[i];
    }
    return 'unknown';
  }

  function blockLeafs(block) {
    return Array.prototype.slice.call(block.querySelectorAll('[data-content-editable-leaf="true"]'));
  }

  function blockText(block) {
    var leafs = blockLeafs(block);
    var parts = [];
    for (var i = 0; i < leafs.length; i += 1) {
      var t = leafToMarkdown(leafs[i]);
      if (t) parts.push(t);
    }
    return parts.join('\n');
  }

  // Directly nested blocks (toggle content, columns, …). Flat list renderings
  // (the common case) have none.
  function directChildBlocks(block) {
    var out = [];
    var all = block.querySelectorAll('[data-block-id]');
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el === block) continue;
      var p = el.parentElement;
      var nearest = null;
      while (p && p !== block && p !== document.body) {
        if (p.hasAttribute && p.hasAttribute('data-block-id')) { nearest = p; break; }
        p = p.parentElement;
      }
      if (!nearest && p === block && /block/.test(el.className || '')) out.push(el);
    }
    return out;
  }

  function firstLink(block) {
    var anchors = block.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i += 1) {
      var href = anchors[i].getAttribute('href') || '';
      if (href && href !== '#') return anchors[i];
    }
    return null;
  }

  function linkOf(anchor) {
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) === '/') href = location.origin + href;
    var label = nodeText(anchor);
    if (!label) label = href;
    return '[' + label.replace(/\s+/g, ' ').trim() + '](' + href + ')';
  }

  function tableLines(block) {
    var rows = block.querySelectorAll('tr');
    var lines = [];
    for (var r = 0; r < rows.length; r += 1) {
      var cells = Array.prototype.slice.call(rows[r].querySelectorAll('th, td'));
      if (!cells.length) continue;
      var row = cells.map(function (c) {
        return inlineChildren(c).trim().replace(/\|/g, '\\|');
      });
      lines.push('| ' + row.join(' | ') + ' |');
      if (r === 0 && rows.length > 1) {
        lines.push('| ' + cells.map(function () { return '---'; }).join(' | ') + ' |');
      }
    }
    return lines;
  }

  function bullets(chars) {
    return Array(chars + 1).join('  ');
  }

  // Render one block. `ctx` carries list numbering state across siblings.
  function blockToLines(block, depth, ctx) {
    var type = blockType(block);
    var out = [];
    var text, i, n;

    switch (type) {
      case 'text':
        text = blockText(block);
        if (text) out.push(text);
        break;

      case 'header':
        text = blockText(block).trim();
        if (text) out.push(bullets(depth + 1).replace(/  /g, '#') + ' ' + text);
        break;
      case 'sub_header':
        text = blockText(block).trim();
        if (text) out.push('## ' + text);
        break;
      case 'sub_sub_header':
        text = blockText(block).trim();
        if (text) out.push('### ' + text);
        break;

      case 'bulleted_list':
        text = blockText(block).replace(/\n+/g, ' ');
        if (text) out.push(bullets(depth) + '- ' + text);
        break;
      case 'numbered_list':
        text = blockText(block).replace(/\n+/g, ' ');
        if (text) {
          ctx.number = ctx.previousType === 'numbered_list' ? ctx.number + 1 : 1;
          out.push(bullets(depth) + ctx.number + '. ' + text);
        }
        break;
      case 'to_do':
        text = blockText(block).replace(/\n+/g, ' ');
        if (text) {
          var done = !!block.querySelector('[aria-checked="true"]');
          out.push(bullets(depth) + '- [' + (done ? 'x' : ' ') + '] ' + text);
        }
        break;
      case 'toggle':
        text = blockText(block).trim();
        if (text) out.push(text);
        break;

      case 'quote': {
        var q = blockText(block);
        if (q) {
          for (i = 0; i < q.split('\n').length; i += 1) out.push('> ' + q.split('\n')[i]);
        }
        break;
      }
      case 'callout': {
        var c = blockText(block);
        if (c) {
          var icon = '';
          var ic = block.querySelector('.notion-callout-emoji, [data-emoji="true"]');
          if (ic) icon = nodeText(ic) + ' ';
          var cLines = c.split('\n');
          for (i = 0; i < cLines.length; i += 1) out.push('> ' + icon + cLines[i]);
        }
        break;
      }

      case 'divider':
        out.push('---');
        break;

      case 'code':
        text = blockText(block);
        if (!text) {
          var pre = block.querySelector('pre');
          if (pre) text = pre.textContent.trim();
        }
        if (text) {
          var lang = '';
          var langEl = block.querySelector('[class*="language-"], [data-language]');
          if (langEl) {
            var m = (langEl.className || '').match(/language-([\w+-]+)/);
            if (m) lang = m[1];
            else if (langEl.getAttribute('data-language')) lang = langEl.getAttribute('data-language');
          }
          out.push('```' + lang + '\n' + text.replace(/\n$/, '') + '\n```');
        }
        break;

      case 'image': {
        var img = block.querySelector('img[src]');
        if (img) out.push('![' + (img.getAttribute('alt') || '') + '](' + img.src + ')');
        break;
      }
      case 'video':
      case 'audio':
      case 'pdf':
      case 'file': {
        var a = firstLink(block);
        if (a) out.push(linkOf(a));
        else if (type === 'video' || type === 'audio') {
          var src = block.querySelector('source[src]');
          if (src) out.push('[' + (type === 'video' ? 'Vidéo' : 'Audio') + '](' + src.getAttribute('src') + ')');
        }
        break;
      }
      case 'bookmark':
      case 'embed':
      case 'link_to_page':
      case 'child_page': {
        var a2 = firstLink(block);
        if (a2) out.push(linkOf(a2));
        else {
          text = blockText(block);
          if (text) out.push(text);
        }
        break;
      }

      // Columns: render only the nested blocks.
      case 'column_list':
      case 'column':
        break;

      case 'table':
      case 'table_row':
        n = tableLines(block);
        if (n.length) { for (i = 0; i < n.length; i += 1) out.push(n[i]); break; }
        text = blockText(block);
        if (text) out.push(text);
        break;

      default:
        text = blockText(block);
        if (text) out.push(text);
        break;
    }

    // Nested blocks (toggle content, quote content, columns, expanded child
    // pages, …). Flat sibling blocks (the common case) have none.
    var nested = directChildBlocks(block);
    if (nested.length) {
      var childCtx = { number: 0, previousType: '' };
      for (n = 0; n < nested.length; n += 1) {
        var sub = blockToLines(nested[n], depth + 1, childCtx);
        for (var s = 0; s < sub.length; s += 1) out.push(sub[s]);
        childCtx.previousType = blockType(nested[n]);
      }
    }

    return out;
  }

  /* ---------------------------------------------------------------- *
   *  Whole page -> Markdown
   * ---------------------------------------------------------------- */

  function collectBlocks(rootEl) {
    var out = [];
    var visit = function (el) {
      if (el.hasAttribute && el.hasAttribute('data-block-id')) { out.push(el); return; }
      for (var c = 0; c < el.children.length; c += 1) visit(el.children[c]);
    };
    for (var i = 0; i < rootEl.children.length; i += 1) visit(rootEl.children[i]);
    return out;
  }

  // The `.notion-page-content` of the currently visible page tab.
  function pageRoot() {
    var roots = Array.prototype.slice.call(document.querySelectorAll('main .notion-page-content'));
    if (!roots.length) roots = Array.prototype.slice.call(document.querySelectorAll('.notion-page-content'));
    for (var i = 0; i < roots.length; i += 1) {
      if (roots[i].offsetParent !== null) return roots[i];
    }
    return roots[roots.length - 1] || null;
  }

  function pageToMarkdown(rootEl) {
    var lines = [];
    var ctx = { number: 0, previousType: '' };
    var blocks = collectBlocks(rootEl);
    var prevList = '';
    for (var i = 0; i < blocks.length; i += 1) {
      var type = blockType(blocks[i]);
      var chunk = blockToLines(blocks[i], 0, ctx);
      ctx.previousType = type;
      if (!chunk.length) continue;
      var separator = (prevList && type === prevList) ? '\n' : '\n\n';
      if (lines.length) lines.push(separator);
      for (var j = 0; j < chunk.length; j += 1) lines.push(chunk[j]);
      prevList = (type === 'bulleted_list' || type === 'numbered_list') ? type : '';
    }
    return lines.join('').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ---------------------------------------------------------------- *
   *  Metadata: title, last-edit date, page properties, frontmatter
   * ---------------------------------------------------------------- */

  function pageLayout(rootEl) {
    var el = rootEl;
    while (el && el !== document.body) {
      var cls = typeof el.className === 'string' ? el.className : '';
      if (/(^|\s)layout(\s|$)/.test(cls)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function pageTitle(rootEl) {
    try {
      var layout = pageLayout(rootEl);
      if (layout) {
        var h1 = layout.querySelector('h1[data-content-editable-leaf="true"]');
        var t = nodeText(h1);
        if (t) return t;
      }
    } catch (e) { /* fall back */ }
    return String(document.title)
      .replace(/\s*[|·–]\s*Notion\s*$/i, '')
      .trim() || 'Page';
  }

  function parseDateLabel(label) {
    // "Edited Jul 27" / "Updated Jul 27, 2025" -> YYYY-MM-DD
    var m = String(label || '').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
    if (!m) return '';
    var day = Number(m[2]);
    var year = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (day < 1 || day > 31) return '';
    if (year < 100) year += 2000;
    var months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    var check = new Date(year, months[m[1]], day);
    if (check.getFullYear() !== year || check.getMonth() !== months[m[1]] || check.getDate() !== day) return '';
    return String(year) + '-' + String(months[m[1]] + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function lastEditedDate() {
    var bars = document.querySelectorAll('.notion-topbar');
    for (var i = 0; i < bars.length; i += 1) {
      var buttons = bars[i].querySelectorAll('div[role="button"]');
      for (var j = 0; j < buttons.length; j += 1) {
        var t = buttons[j].textContent || '';
        if (/^\s*(Edited|Updated)\b/i.test(t)) {
          var d = parseDateLabel(t);
          if (d) return d;
        }
      }
    }
    return '';
  }

  function pageProperties(rootEl) {
    var props = {};
    try {
      var layout = pageLayout(rootEl);
      if (!layout) return props;
      var cells = layout.querySelectorAll('div[role="cell"]');
      for (var i = 0; i < cells.length; i += 1) {
        var label = (cells[i].textContent || '').trim();
        if (!label || label.length > 80) continue;
        var col = cells[i];
        for (var up = 0; up < 6 && col; up += 1) {
          col = col.parentElement;
          if (col && /flex-direction:\s*column/.test(col.getAttribute('style') || '')) break;
        }
        if (!col) continue;
        var valueEl = null;
        var kids = col.children;
        for (var k = 0; k < kids.length; k += 1) {
          if (kids[k].hasAttribute && kids[k].hasAttribute('data-block-id')) { valueEl = kids[k]; break; }
        }
        if (!valueEl) continue;
        var value = (valueEl.textContent || '').trim();
        if (value && value !== 'Empty' && value !== '—' && !props[label]) props[label] = value;
      }
    } catch (e) { /* best effort */ }
    return props;
  }

  function buildFrontmatter(meta) {
    var lines = ['---'];
    lines.push('title: ' + yamlQuote(meta.title));
    if (meta.date) lines.push('date: ' + meta.date);
    lines.push('url: ' + yamlQuote(meta.url));
    for (var key in meta.properties) {
      if (Object.prototype.hasOwnProperty.call(meta.properties, key)) {
        lines.push(key + ': ' + yamlQuote(meta.properties[key]));
      }
    }
    lines.push('---');
    return lines.join('\n');
  }

  function buildMarkdown(meta, body, withFrontmatter) {
    var head = withFrontmatter ? buildFrontmatter(meta) : '# ' + meta.title;
    return head + '\n\n' + body.trim() + '\n';
  }

  /* ---------------------------------------------------------------- *
   *  UI: MD button (download) + copy button, toast
   * ---------------------------------------------------------------- */

  function injectStyles() {
    if (document.getElementById('notion-md-export-style')) return;
    var style = document.createElement('style');
    style.id = 'notion-md-export-style';
    style.textContent = [
      '.' + BTN_MD_CLASS + ',.' + BTN_COPY_CLASS + '{display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:28px;padding:0 6px;margin-inline-end:2px;border:none;border-radius:6px;background:transparent;color:var(--c-texPri,#37352f);font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;letter-spacing:.4px;cursor:pointer;user-select:none;white-space:nowrap}',
      '.' + BTN_COPY_CLASS + '{font-size:14px;letter-spacing:0}',
      '.' + BTN_MD_CLASS + ':hover,.' + BTN_COPY_CLASS + ':hover{background:var(--ca-bacIntTra,rgba(0,0,0,.06))}',
      '.' + BTN_MD_CLASS + ':active,.' + BTN_COPY_CLASS + ':active{transform:scale(.94)}',
      '.' + BTN_MD_CLASS + '[aria-busy="true"],.' + BTN_COPY_CLASS + '[aria-busy="true"]{opacity:.45;cursor:wait;pointer-events:none}',
      '#notion-md-export-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;background:#2f3437;color:#fff;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);opacity:0;transition:opacity .25s ease;pointer-events:none}',
      '#notion-md-export-toast.show{opacity:1}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function showToast(message) {
    var toast = document.getElementById('notion-md-export-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'notion-md-export-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    void toast.offsetWidth; // reflow so the transition replays
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove('show'); }, 2600);
  }

  function makeMdButton() {
    var btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Exporter la page en Markdown');
    btn.className = BTN_MD_CLASS;
    btn.textContent = 'MD';
    btn.title = 'Exporter la page en Markdown — Clic : frontmatter YAML, Maj+Clic : sans frontmatter';
    btn.addEventListener('click', function (e) { runExport(!e.shiftKey); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        runExport(!e.shiftKey);
      }
    });
    return btn;
  }

  function makeCopyButton() {
    var btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Copier la page en Markdown');
    btn.className = BTN_COPY_CLASS;
    btn.textContent = '\u29C9'; // two overlapping squares, the classic copy glyph
    btn.title = 'Copier la page en Markdown — Clic : frontmatter YAML, Maj+Clic : sans frontmatter';
    btn.addEventListener('click', function (e) { runCopy(!e.shiftKey); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        runCopy(!e.shiftKey);
      }
    });
    return btn;
  }

  // The "Edited Jul 27" label rendered as a div[role=button] in the topbar.
  function findEditedAnchor(bar) {
    var buttons = bar.querySelectorAll('div[role="button"]');
    for (var i = 0; i < buttons.length; i += 1) {
      var t = (buttons[i].textContent || '').trim();
      if (/^(Edited|Updated)\b/i.test(t)) return buttons[i];
    }
    return null;
  }

  function injectButton() {
    var bars = document.querySelectorAll('.notion-topbar-action-buttons');
    for (var i = 0; i < bars.length; i += 1) {
      var bar = bars[i];
      var mdBtn = bar.querySelector('.' + BTN_MD_CLASS);
      var copyBtn = bar.querySelector('.' + BTN_COPY_CLASS);
      if (mdBtn && copyBtn) continue;
      var anchor = findEditedAnchor(bar);
      if (anchor && anchor.parentElement) {
        // [copy] [MD] [Edited …]
        if (!mdBtn) {
          mdBtn = makeMdButton();
          anchor.parentElement.insertBefore(mdBtn, anchor);
        }
        if (!copyBtn) {
          copyBtn = makeCopyButton();
          anchor.parentElement.insertBefore(copyBtn, mdBtn);
        }
      } else {
        if (!mdBtn) {
          mdBtn = makeMdButton();
          bar.insertBefore(mdBtn, bar.firstChild);
        }
        if (!copyBtn) {
          copyBtn = makeCopyButton();
          bar.insertBefore(copyBtn, mdBtn);
        }
      }
    }
  }

  var busy = false;

  function setBusy(value) {
    var buttons = document.querySelectorAll('.' + BTN_MD_CLASS + ',.' + BTN_COPY_CLASS);
    for (var i = 0; i < buttons.length; i += 1) {
      if (value) buttons[i].setAttribute('aria-busy', 'true');
      else buttons[i].removeAttribute('aria-busy');
    }
  }

  function download(name, body, mime) {
    var blob = new Blob([body], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Download to a file (MD button).
  function runExport(withFrontmatter) {
    if (busy) return;
    busy = true;
    setBusy(true);
    try {
      var res = captureExport(withFrontmatter);
      if (res.error) {
        showToast(res.error);
        return;
      }
      download(res.filename, res.markdown, 'text/markdown');
      showToast('Markdown téléchargé ✓ (' + (withFrontmatter ? 'frontmatter inclus' : 'sans frontmatter') + ')');
    } catch (err) {
      console.error('[notion-export-markdown]', err);
      showToast('Erreur : ' + (err && err.message ? err.message : err));
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  // Copy the export to the clipboard (copy button).
  function runCopy(withFrontmatter) {
    if (busy) return;
    busy = true;
    setBusy(true);
    try {
      var res = captureExport(withFrontmatter);
      if (res.error) {
        showToast(res.error);
        return;
      }
      copyText(res.markdown).then(function () {
        showToast('Markdown copié ✓' + (withFrontmatter ? ' — frontmatter inclus' : ' — sans frontmatter'));
      }, function (err) {
        console.error('[notion-export-markdown]', err);
        showToast('Erreur : copie impossible (presse-papiers indisponible)');
      });
    } catch (err) {
      console.error('[notion-export-markdown]', err);
      showToast('Erreur : ' + (err && err.message ? err.message : err));
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  // Shared export pipeline used by both buttons.
  function captureExport(withFrontmatter) {
    var root = pageRoot();
    if (!root) return { error: 'Aucune page chargée à exporter.' };
    var title = pageTitle(root) || 'Page';
    var meta = {
      title: title,
      date: lastEditedDate(),
      url: location.href.split('#')[0],
      properties: pageProperties(root)
    };
    var body = pageToMarkdown(root);
    return {
      markdown: buildMarkdown(meta, body, withFrontmatter),
      filename: 'notion-' + (slugify(title).slice(0, 80) || 'page') + '.md'
    };
  }

  // Copy with a fallback for engines without the async Clipboard API.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('execCommand copy failed'));
  }

  /* ---------------------------------------------------------------- *
   *  Boot + keep-alive (Notion re-renders the topbar on navigation)
   * ---------------------------------------------------------------- */

  function start() {
    if (typeof document === 'undefined') return;
    injectStyles();
    injectButton();
    var observer = new MutationObserver(function () {
      injectButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 600000);
  }

  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  if (typeof document !== 'undefined' && typeof location !== 'undefined') {
    if (/^https:\/\/app\.notion\.com/i.test(location.href)) boot();
  }
})();