# Notion Export Markdown

A small Safari-compatible userscript that adds two minimalist buttons to the
Notion page topbar (`app.notion.com`), placed just left of the "Edited …"
timestamp:

- `MD` — downloads the current page as a Markdown file.
- `⧉` — copies the same Markdown document to the clipboard.

Click = document with a YAML frontmatter block; **Shift+Click** = same
document without the frontmatter.

## Current Version

- Script file: `userscripts/notion-export-markdown.user.js`
- Script version: `2026.08.02.7`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- **No network calls.** The page is exported from the rendered DOM — the same
  editable page the reader sees — so there is no API request, token or
  server-side dependency.
- **Two delivery modes**: download the Markdown file (`MD`) or copy it to the
  clipboard (⧉); both honour the **Shift+Click** “no frontmatter” variant.
- **Block coverage**: paragraphs, H1–H3 headings, bulleted and numbered
  lists, to-dos, toggles, quotes, callouts, dividers, code blocks, images,
  videos, files, bookmarks, embeds and child-page links.
- **Inline formatting** preserved: bold, italic, strikethrough, inline code
  and links; emoji and text decorations (💬, 🟠, …) are kept as-is.
- **YAML frontmatter** with the page `title`, the last-edit `date` (read from
  the "Edited …" label when parseable), the source `url` and any non-empty
  page property displayed under the title ("Description", "Statut", "Date de
  soumission", "Auteur", …).
- Works in multiple open tabs: the exporter targets the visible page.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should
also work with other userscript managers supporting standard metadata.

Then:

1. Open `userscripts/notion-export-markdown.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `app.notion.com`.
4. Open or reload a Notion page.

If your userscript manager supports raw URLs directly, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/notion-export-markdown.user.js
```

## Output Example

For a page titled `Page FAP`, a simple click produces a file named
`notion-page-fap.md`:

````markdown
---
title: Page FAP
date: 2026-07-27
url: https://app.notion.com/p/Page-FAP-39629ad0e6ef80eb997dfcbd6aeb1f5b
Statut: À examiner
---

Solutions FAP, EGR & AdBlue à Dury (80) – Diagnostic, Nettoyage & Réparation | MH Auto Performance

**Texte d'accroche** *(court, orienté conversion + économie)*

Voyant moteur, mode dégradé, défaut AdBlue, FAP colmaté, vanne EGR HS ? **Diagnostic précis + solution durable** …

---

### 2) SECTION "VOTRE SYMPTÔME"

- 🔴 **Voyant moteur** ou voyant FAP allumé au tableau de bord
- 🔴 **Message AdBlue** ("Défaut système antipollution", …)
````

`Shift+Click` produces the same document starting directly with `# Page FAP`,
without the `---` block.

## Notes

- The exporter relies on the stable block classes prefixed `notion-` and the
  `data-block-id` attributes of the rendered page; Notion occasionally
  renames them, which may require a selector update.
- Block types not yet mapped (e.g. database views embedded in the page) fall
  back to their rendered text.
- The "Edited …" label does not always include the year; in that case the
  current year is used for the frontmatter `date`.

## Development

This repository keeps installable userscripts under `userscripts/` and
per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/notion-export-markdown.user.js >/dev/null
```

## License

MIT