// ==UserScript==
// @name         DeepSeek Chat Export
// @namespace    https://github.com/krkn-s
// @version      2026.08.02.4
// @description  Exports a DeepSeek shared conversation (including the thinking chain) as Markdown or JSON from the share page.
// @author       krkn-s
// @homepage     https://github.com/krkn-s/userscripts
// @homepageURL  https://github.com/krkn-s/userscripts
// @supportURL   https://github.com/krkn-s/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/deepseek-chat-export.user.js
// @updateURL    https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/deepseek-chat-export.user.js
// @match        https://chat.deepseek.com/a/chat/s/*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

/**
 * DeepSeek Chat Export
 * --------------------
 * Adds two minimalist buttons (MD / JSON) next to the Share button on a
 * DeepSeek shared conversation page. Clicking one downloads the whole
 * conversation — user messages, assistant answers and the thinking chain
 * (reasoning blocks, "Found N web pages" and "Read N pages" tool rows) —
 * as a Markdown file or as structured JSON.
 *
 * The message list is DOM-virtualized on the share page: only the messages
 * near the current scroll position actually exist in the DOM. The exporter
 * therefore sweeps the virtualized list (scroll up/down, deduplicating on
 * `data-virtual-list-item-key`) before reading the messages, so the export
 * always covers the entire conversation, not just the visible window.
 */

(function () {
  'use strict';

  const VERSION = '2026.08.02.4';
  const TOOL = 'deepseek-chat-export/' + VERSION;
  const SHARE_PREFIX = '/a/chat/s/';

  /* ---------------------------------------------------------------- *
   *  Generic helpers
   * ---------------------------------------------------------------- */

  function nodeText(el) {
    return el ? (el.textContent || '').trim() : '';
  }

  function settle(ms) {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
          setTimeout(resolve, ms || 40);
        });
      } else {
        setTimeout(resolve, ms || 40);
      }
    });
  }

  function slugify(input) {
    return String(input)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function escapeInline(text) {
    return String(text).replace(/([\\*_`#\[])/g, '\\$1').replace(/\]/g, '\\]');
  }

  /* ---------------------------------------------------------------- *
   *  HTML -> Markdown conversion (works on the .ds-markdown subtrees)
   * ---------------------------------------------------------------- */

  function inlineChildren(el) {
    var inner = '';
    for (var i = 0; i < el.childNodes.length; i += 1) inner += inlineSource(el.childNodes[i]);
    return inner;
  }

  function inlineChildren(el) {
    var parts = [];
    for (var i = 0; i < el.childNodes.length; i += 1) {
      var piece = inlineSource(el.childNodes[i]);
      if (piece) parts.push(piece);
    }
    return parts.join(' ').replace(/ {2,}/g, ' ');
  }

  function inlineSource(node) {
    if (node.nodeType === 3) {
      // Text node
      return escapeInline(node.textContent.replace(/\s+/g, ' ').trim());
    }
    if (node.nodeType !== 1) return '';
    var el = node;
    var tag = el.tagName.toUpperCase();
    var cls = el.getAttribute && el.getAttribute('class') ? el.getAttribute('class') : '';

    // Noise / decoration we never want in the export
    if (
      cls.indexOf('ds-markdown-cite') !== -1 || // DeepSeek inline citation marker
      cls.indexOf('ds-icon') !== -1 ||
      el.getAttribute && el.getAttribute('aria-hidden') === 'true' ||
      el.hidden
    ) {
      return '';
    }

    // Floating citation chip (hover popover): its direct children hide a dash
    // and an absolutely positioned overlay digit. Checked on direct children
    // only so legitimate parents are never dropped.
    if (el.children) {
      var absChild = false;
      var hiddenChild = false;
      for (var ci = 0; ci < el.children.length; ci += 1) {
        var st = el.children[ci].getAttribute && el.children[ci].getAttribute('style') || '';
        if (st.indexOf('position: absolute') !== -1) absChild = true;
        if (st.indexOf('opacity: 0') !== -1) hiddenChild = true;
      }
      if (absChild && hiddenChild) return '';
    }

    // KaTeX expressions: prefer the original LaTeX source kept in the
    // annotation, otherwise the MathML text.
    if (cls.indexOf('katex') !== -1) {
      var ann = el.querySelector('annotation[encoding="application/x-tex"]');
      if (ann && ann.textContent.trim()) return escapeInline(ann.textContent.trim());
      var mathml = el.querySelector('.katex-mathml');
      if (mathml) return escapeInline(mathml.textContent.trim());
      return '';
    }

    if (tag === 'BR') return '  \n';
    if (tag === 'A') {
      var label = inlineChildren(el);
      label = label.trim();
      var href = el.getAttribute('href') || '';
      return '[' + label + '](' + href + ')';
    }
    if (tag === 'STRONG' || tag === 'B') return '**' + inlineChildren(el) + '**';
    if (tag === 'EM' || tag === 'I') return '*' + inlineChildren(el) + '*';
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return '~~' + inlineChildren(el) + '~~';
    if (tag === 'CODE') return '`' + nodeText(el) + '`';
    if (tag === 'IMG') {
      return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
    }
    if (tag === 'UL' || tag === 'OL' || tag === 'TABLE' || tag === 'PRE' || tag === 'BLOCKQUOTE') {
      return blockLines(el, 0).join(' ');
    }
    // Generic container (span, div, sub, sup, …)
    return inlineChildren(el);
  }

  function listLines(listEl, depth) {
    var lines = [];
    var ol = listEl.tagName.toUpperCase() === 'OL';
    var index = 1;
    for (var i = 0; i < listEl.children.length; i += 1) {
      var li = listEl.children[i];
      if (li.tagName.toUpperCase() !== 'LI') continue;
      var prefix = Array(depth + 1).join('  ') + (ol ? index + '. ' : '- ');
      index += 1;
      var parts = [];
      for (var j = 0; j < li.childNodes.length; j += 1) {
        var child = li.childNodes[j];
        var tag = child.tagName ? child.tagName.toUpperCase() : '';
        if (tag === 'UL' || tag === 'OL') {
          parts.push(listLines(child, depth + 1).join('\n'));
        } else if (child.nodeType === 3) {
          var t = escapeInline(child.textContent.replace(/\s+/g, ' ').trim());
          if (t) parts.push(t);
        } else if (tag === 'P') {
          var pt = inlineSource(child).trim();
          if (pt) parts.push(pt);
        } else if (child.nodeType === 1) {
          var it = inlineSource(child).trim();
          if (it) parts.push(it);
        }
      }
      lines.push(prefix + parts.join(' ').replace(/ {2,}/g, ' '));
    }
    return lines;
  }

  function tableLines(tableEl) {
    var rows = tableEl.querySelectorAll('tr');
    var lines = [];
    var cellsOf = function (tr) { return Array.prototype.slice.call(tr.querySelectorAll('th, td')); };
    for (var r = 0; r < rows.length; r += 1) {
      var cells = cellsOf(rows[r]);
      var row = cells.map(function (c) {
        return inlineSource(c).trim().replace(/\|/g, '\\|');
      });
      lines.push('| ' + row.join(' | ') + ' |');
      if (r === 0 && rows.length > 1) {
        lines.push('| ' + cells.map(function () { return '---'; }).join(' | ') + ' |');
      }
    }
    return lines;
  }

  function blockLines(el, depth) {
    var out = [];
    depth = depth || 0;
    for (var i = 0; i < el.childNodes.length; i += 1) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) {
        var t = node.textContent.replace(/\s+/g, ' ');
        if (t.trim()) out.push(t.trim());
        continue;
      }
      if (node.nodeType !== 1) continue;
      var tag = node.tagName.toUpperCase();
      var cls = node.getAttribute && node.getAttribute('class') ? node.getAttribute('class') : '';
      if (cls.indexOf('ds-markdown-cite') !== -1 || cls.indexOf('ds-icon') !== -1) continue;

      if (tag === 'P') {
        var line = inlineSource(node).trim();
        if (line) out.push(line);
      } else if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
        out.push(Array(Number(tag.charAt(1)) + 1).join('#') + ' ' + inlineSource(node).trim());
      } else if (tag === 'UL' || tag === 'OL') {
        out = out.concat(listLines(node, depth));
      } else if (tag === 'BLOCKQUOTE') {
        var quote = blockLines(node, depth).join('\n').split('\n').map(function (l) { return '> ' + l; });
        out = out.concat(quote);
      } else if (tag === 'PRE') {
        var codeEl = node.querySelector('code');
        var code = codeEl ? codeEl.textContent : node.textContent;
        var lang = '';
        var clsCode = codeEl && codeEl.getAttribute('class') ? codeEl.getAttribute('class') : '';
        var m = clsCode.match(/language-([\w+-]+)/);
        if (m) lang = m[1];
        code = code.replace(/\n$/, '');
        out.push('```' + lang + '\n' + code + '\n```');
      } else if (tag === 'TABLE') {
        out = out.concat(tableLines(node));
      } else if (tag === 'HR') {
        out.push('---');
      } else if (tag === 'IMG') {
        out.push(inlineSource(node));
      } else {
        out = out.concat(blockLines(node, depth));
      }
    }
    return out;
  }

  function htmlToMarkdown(rootEl) {
    if (!rootEl) return '';
    return blockLines(rootEl).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------------------------------------------------------- *
   *  Message parsing
   * ---------------------------------------------------------------- */

  // Recognizes the tool rows interleaved with the thinking chain. Only rows
  // whose direct children carry the label text ("Found N web pages" /
  // "Read N pages") are matched, so containers are never misclassified.
  function classifyToolRow(rowEl) {
    for (var i = 0; i < rowEl.childNodes.length; i += 1) {
      var child = rowEl.childNodes[i];
      if (child.nodeType === 3) {
        var t = child.textContent.trim();
        if (/^Found\s+[\d.,]+\s+web\s+pages?/i.test(t)) return { type: 'search', text: t };
        if (/^Read\s+[\d.,]+\s+pages?/i.test(t)) {
          return { type: 'read', text: t, links: linksOf(rowEl) };
        }
      } else if (child.nodeType === 1 && child.children.length === 0) {
        var t2 = child.textContent.trim();
        if (/^Found\s+[\d.,]+\s+web\s+pages?/i.test(t2)) return { type: 'search', text: t2 };
        if (/^Read\s+[\d.,]+\s+pages?/i.test(t2)) {
          return { type: 'read', text: t2, links: linksOf(rowEl) };
        }
      }
    }
    return null;
  }

  function linksOf(rowEl) {
    var links = [];
    var anchors = rowEl.querySelectorAll('a[href]');
    for (var j = 0; j < anchors.length; j += 1) {
      links.push({ title: anchors[j].textContent.trim(), url: anchors[j].href });
    }
    return links;
  }

  function parseThinking(assistantEl, contentEl) {
    var thinking = [];
    var label = null;
    // "Thought for N seconds" label lives in a span somewhere above the content.
    var spans = assistantEl.querySelectorAll('span');
    for (var i = 0; i < spans.length; i += 1) {
      var t = spans[i].textContent.trim();
      if (/^Thought\s+for\b/i.test(t)) { label = t; break; }
    }
    // Walk the message subtree in document order, stopping before the answer
    // content. Thinking text rows carry the semantic class "ds-think-content"
    // and tool rows (Found / Read) are classified by their leaf text.
    (function walk(el) {
      if (el === contentEl) return;
      var cls = el.getAttribute && el.getAttribute('class') ? el.getAttribute('class') : '';
      if (cls.indexOf('ds-think-content') !== -1) {
        var mdEl = el.querySelector('.ds-markdown');
        var txt = mdEl ? htmlToMarkdown(mdEl) : nodeText(el);
        if (txt) thinking.push({ type: 'text', content: txt });
        return; // handled, do not descend further into this row
      }
      var tool = classifyToolRow(el);
      if (tool) {
        thinking.push(tool);
        return; // handled row: leaf subtree holds nothing else to classify
      }
      for (var c = 0; c < el.children.length; c += 1) walk(el.children[c]);
    })(assistantEl);
    return { thinking: thinking, thinkingLabel: label };
  }

  function parseAssistantMessage(assistantEl) {
    var contentEl = assistantEl.querySelector('.ds-assistant-message-main-content');
    if (!contentEl) return { role: 'assistant', thinking: [], thinkingLabel: null, content: '' };
    var mood = parseThinking(assistantEl, contentEl);
    return {
      role: 'assistant',
      thinking: mood.thinking,
      thinkingLabel: mood.thinkingLabel,
      content: htmlToMarkdown(contentEl)
    };
  }

  function parseUserMessage(userEl) {
    var clone = userEl.cloneNode(true);
    var noise = clone.querySelectorAll('[role="button"], svg, .ds-icon, .ds-focus-ring, .ds-button');
    for (var i = 0; i < noise.length; i += 1) noise[i].parentNode.removeChild(noise[i]);
    var kids = Array.prototype.slice.call(clone.children);
    var pick = null;
    for (var j = 0; j < kids.length; j += 1) {
      if (kids[j].textContent.trim()) { pick = kids[j]; break; }
    }
    var content = pick ? pick.textContent.trim() : clone.textContent.trim();
    return { role: 'user', content: content };
  }

  function parseMessage(messageEl) {
    if (messageEl.querySelector('.ds-assistant-message-main-content')) {
      return parseAssistantMessage(messageEl);
    }
    return parseUserMessage(messageEl);
  }

  /* ---------------------------------------------------------------- *
   *  Full history collection (virtualized list scan)
   * ---------------------------------------------------------------- */

  function findScroller() {
    var list = document.querySelector('.ds-virtual-list-items');
    var node = list ? list.parentElement : document.querySelector('.ds-scroll-area');
    while (node) {
      if (node.scrollHeight > node.clientHeight + 80 && getComputedStyle(node).overflowY !== 'visible') {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  async function collectAllMessages() {
    var items = new Map();
    var scroller = findScroller();

    function capture() {
      var visible = document.querySelectorAll('.ds-virtual-list-visible-items > div[data-virtual-list-item-key]');
      for (var i = 0; i < visible.length; i += 1) {
        var wrapper = visible[i];
        var key = wrapper.getAttribute('data-virtual-list-item-key');
        if (!key || items.has(key)) continue;
        var messageEl = wrapper.querySelector('.ds-message');
        if (!messageEl) continue;
        try {
          var parsed = parseMessage(messageEl);
          parsed.key = Number(key);
          items.set(key, parsed);
        } catch (err) {
          console.warn('[deepseek-chat-export] skipped item ' + key, err);
        }
      }
    }

    capture();
    if (scroller) {
      var original = scroller.scrollTop;
      var max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      var step = Math.max(120, Math.round(scroller.clientHeight * 0.55));
      // Down, up, down again: covers recycled nodes and any layout jitter.
      for (var pass = 0; pass < 3 && items.size < 200; pass += 1) {
        if (pass % 2 === 0) {
          for (var y = 0; y <= max; y += step) { scroller.scrollTop = y; await settle(); capture(); }
          scroller.scrollTop = max;
        } else {
          for (var y2 = max; y2 >= 0; y2 -= step) { scroller.scrollTop = y2; await settle(); capture(); }
          scroller.scrollTop = 0;
        }
        await settle(60);
      }
      scroller.scrollTop = original;
      await settle(40);
    }

    var all = Array.prototype.slice.call(items.values())
      .sort(function (a, b) { return (a.key || 0) - (b.key || 0); });

    if (!all.length) {
      // Fallback: whatever .ds-message the DOM holds right now.
      var direct = document.querySelectorAll('.ds-message');
      for (var k = 0; k < direct.length; k += 1) {
        all.push(parseMessage(direct[k]));
      }
    }
    return all;
  }

  /* ---------------------------------------------------------------- *
   *  Export serialization
   * ---------------------------------------------------------------- */

  function conversationTitle() {
    return nodeText(document.title).replace(/\s*[-–]\s*DeepSeek\s*$/i, '') || 'DeepSeek conversation';
  }

  function shareIdFromPath() {
    var path = (location.pathname || '');
    var i = path.lastIndexOf('/');
    return path.slice(i + 1);
  }

  function buildData(messages) {
    var data = {
      title: conversationTitle(),
      url: location.href.split('#')[0],
      shareId: shareIdFromPath(),
      exportedAt: new Date().toISOString(),
      tool: TOOL,
      messages: []
    };
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (m.role === 'assistant') {
        var am = { role: 'assistant', content: m.content };
        if (m.thinking && m.thinking.length) am.thinking = m.thinking;
        if (m.thinkingLabel) am.thinkingLabel = m.thinkingLabel;
        data.messages.push(am);
      } else {
        data.messages.push({ role: 'user', content: m.content });
      }
    }
    return data;
  }

  function buildJson(data) {
    return JSON.stringify(data, null, 2);
  }

  function buildMarkdown(data) {
    var lines = [];
    lines.push('# ' + data.title);
    lines.push('');
    lines.push('> ' + data.url);
    lines.push('>');
    lines.push('> Export: ' + data.exportedAt + ' — ' + data.tool);
    lines.push('');
    for (var i = 0; i < data.messages.length; i += 1) {
      var m = data.messages[i];
      lines.push('---');
      lines.push('');
      if (m.role === 'user') {
        lines.push('## 🙂 Utilisateur');
        lines.push('');
        lines.push(m.content);
        lines.push('');
      } else {
        lines.push('## 🤖 DeepSeek');
        if (m.thinking && m.thinking.length) {
          lines.push('');
          lines.push('### 🧠 Pensée' + (m.thinkingLabel ? ' — ' + m.thinkingLabel : ''));
          lines.push('');
          for (var b = 0; b < m.thinking.length; b += 1) {
            var block = m.thinking[b];
            if (block.type === 'text') {
              lines.push(block.content.split('\n').map(function (l) { return '> ' + l; }).join('\n'));
              lines.push('');
            } else if (block.type === 'search') {
              lines.push('> 🔎 ' + block.text);
              lines.push('');
            } else if (block.type === 'read') {
              lines.push('> 📚 ' + block.text);
              (block.links || []).forEach(function (l) {
                lines.push('>   - [' + l.title + '](' + l.url + ')');
              });
              lines.push('');
            }
          }
        }
        lines.push('### 💬 Réponse');
        lines.push('');
        lines.push(m.content);
        lines.push('');
      }
    }
    return lines.join('\n').trim() + '\n';
  }

  /* ---------------------------------------------------------------- *
   *  UI: two minimalist buttons next to Share, plus a small toast
   * ---------------------------------------------------------------- */

  function injectStyles() {
    if (document.getElementById('ds-export-style')) return;
    var style = document.createElement('style');
    style.id = 'ds-export-style';
    style.textContent = [
      '.ds-export-btn{align-self:center;cursor:pointer}',
      '.ds-export-btn .ds-export-label{font-size:12px;font-weight:600;letter-spacing:.4px;line-height:1;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;padding:0 4px}',
      '.ds-export-btn:active{transform:scale(.97)}',
      '.ds-export-btn[aria-disabled="true"]{opacity:.45;cursor:wait;pointer-events:none}',
      '#ds-export-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;padding:8px 14px;border-radius:999px;background:color-mix(in srgb,currentColor 12%,transparent);border:1px solid color-mix(in srgb,currentColor 30%,transparent);font:600 12px/1 sans-serif;color:currentColor;opacity:0;transition:opacity .25s ease;pointer-events:none}',
      '#ds-export-toast.show{opacity:1}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function showToast(message) {
    var toast = document.getElementById('ds-export-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ds-export-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    // Force reflow so the transition replays on repeated toasts.
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove('show'); }, 2800);
  }

  function makeButton(label, title) {
    // Mirror the page Share button construction one-to-one — same class batch
    // and same internal wrappers (.ds-button__background, .ds-button__icon,
    // .ds-icon), so height, centering and capsule shape match the native UI
    // exactly instead of looking vertically offset.
    var btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.title = title;
    btn.className = [
      'ds-button',
      'ds-button--iconLabelPrimary',
      'ds-button--icon',
      'ds-button--capsule',
      'ds-button--l',
      'ds-button--icon-relative-m',
      'ds-export-btn',
      label === 'MD' ? 'ds-export-btn-md' : 'ds-export-btn-json'
    ].join(' ');
    btn.style.setProperty('--dsl-button-height', '34px');
    var bg = document.createElement('div');
    bg.className = 'ds-button__background';
    var icon = document.createElement('div');
    icon.className = 'ds-button__icon ds-button__icon--last-child';
    var dsIcon = document.createElement('div');
    dsIcon.className = 'ds-icon';
    dsIcon.setAttribute('style', 'font-size: inherit;');
    var labelEl = document.createElement('span');
    labelEl.className = 'ds-export-label';
    labelEl.textContent = label;
    dsIcon.appendChild(labelEl);
    icon.appendChild(dsIcon);
    btn.appendChild(bg);
    btn.appendChild(icon);
    return btn;
  }

  function findShareButton() {
    var capsules = document.querySelectorAll('.ds-button--capsule');
    for (var i = 0; i < capsules.length; i += 1) {
      var path = capsules[i].querySelector('svg path');
      if (path && path.getAttribute('d') && path.getAttribute('d').indexOf('M7.95889 1.52285') !== -1) {
        return capsules[i];
      }
    }
    return null;
  }

  var busy = false;

  function setBusy(value) {
    ['ds-export-btn-md', 'ds-export-btn-json'].forEach(function (sel) {
      var btn = document.querySelector('.' + sel);
      if (!btn) return;
      if (value) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
    });
  }

  async function runExport(kind) {
    if (busy) return;
    busy = true;
    setBusy(true);
    showToast(kind === 'json' ? 'Export JSON…' : 'Export Markdown…');
    try {
      var messages = await collectAllMessages();
      if (!messages.length) { showToast('Aucun message trouvé sur cette page.'); return; }
      var data = buildData(messages);
      var body = kind === 'json' ? buildJson(data) : buildMarkdown(data);
      var ext = kind === 'json' ? 'json' : 'md';
      var stamp = new Date().toISOString().slice(0, 10);
      var filename = 'deepseek-' + (slugify(data.title).slice(0, 60) || 'conversation') + '-' + stamp + '.' + ext;
      var blob = new Blob([body], { type: kind === 'json' ? 'application/json' : 'text/markdown' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      showToast(kind === 'json' ? 'JSON téléchargé ✓ (' + data.messages.length + ' messages)' : 'Markdown téléchargé ✓ (' + data.messages.length + ' messages)');
    } catch (err) {
      console.error('[deepseek-chat-export]', err);
      showToast('Erreur : ' + (err && err.message ? err.message : err));
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  // The Share button carries per-instance hashed classes that can override its
  // vertical alignment inside the header row (e.g. align-self / margins). Our
  // buttons lack those classes, so they fall back to the row default and can
  // end up top-aligned next to a centered Share button. Copy the resolved
  // vertical alignment of the Share button onto ours so they sit on the same
  // line, whatever the surrounding flex rules are.
  function mirrorShareAlignment(md, json, share) {
    try {
      var cs = window.getComputedStyle(share);
      [md, json].forEach(function (btn) {
        btn.style.alignSelf = (cs.alignSelf && cs.alignSelf !== 'auto') ? cs.alignSelf : 'center';
        if (cs.marginTop) btn.style.marginTop = cs.marginTop;
        if (cs.marginBottom) btn.style.marginBottom = cs.marginBottom;
      });
      md.style.marginRight = '6px';
    } catch (e) { /* never block the injection */ }
  }

  function injectButtons() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('.ds-export-btn-md')) return;
    var share = findShareButton();
    if (!share) return;
    var md = makeButton('MD', 'Exporter la conversation en Markdown');
    var json = makeButton('JSON', 'Exporter la conversation en JSON');
    function wire(btn, kind) {
      btn.addEventListener('click', function () { runExport(kind); });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          runExport(kind);
        }
      });
    }
    wire(md, 'md');
    wire(json, 'json');
    share.parentNode.insertBefore(md, share);
    share.parentNode.insertBefore(json, share);
    mirrorShareAlignment(md, json, share);
  }

  function start() {
    injectStyles();
    injectButtons();
    var observer = new MutationObserver(function () {
      if (!document.querySelector('.ds-export-btn-md')) injectButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Stop watching after a while to keep the page cheap.
    setTimeout(function () { observer.disconnect(); }, 300000);
  }

  /* ---------------------------------------------------------------- *
   *  Export API (also used by the manual test suite)
   * ---------------------------------------------------------------- */
  var API = {
    VERSION: VERSION,
    slugify: slugify,
    htmlToMarkdown: htmlToMarkdown,
    parseMessage: parseMessage,
    parseThinking: parseThinking,
    buildData: buildData,
    buildJson: buildJson,
    buildMarkdown: buildMarkdown
  };

  // Boot in the browser only, and only on the share page.
  if (typeof document !== 'undefined' && typeof location !== 'undefined') {
    if ((location.pathname || '').indexOf(SHARE_PREFIX) !== -1) {
      var boot = function () { start(); };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
      } else {
        boot();
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})();