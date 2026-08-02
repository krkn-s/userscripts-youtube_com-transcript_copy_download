# DeepSeek Chat Export

A small Safari-compatible userscript for shared DeepSeek conversations.

It adds two minimalist buttons — `MD` and `JSON` — next to the Share button on
`https://chat.deepseek.com/a/chat/s/*`. Clicking one downloads the whole
conversation as a file:

- `MD` produces a readable Markdown document (title, export metadata, and each
  message with French section labels: `Utilisateur`, `DeepSeek`, `Pensée`,
  `Réponse`).
- `JSON` produces the structured dataset with the same content.

Both exports include the **thinking chain** of every assistant message: the
reasoning segments, the `Found N web pages` search steps and the `Read N pages`
steps with their source links.

## Current Version

- Script file: `userscripts/deepseek-chat-export.user.js`
- Script version: `2026.08.02.2`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- No dependencies, no network requests, no runtime payloads: everything is
  parsed from the rendered page.
- Full-history export, not just the visible messages: the DeepSeek message list
  is DOM-virtualized, so the script sweeps the list (scrolls up and down,
  deduplicating on `data-virtual-list-item-key`) before reading messages.
- Preserves Markdown structure of answers: headings, lists, tables, code
  blocks, links, bold, italics, block quotes and KaTeX expressions (exported
  from the original LaTeX source stored in the page).
- Thinking chain blocks: reasoning text, search steps and read steps with
  source links.
- No data mutation: it only reads the DOM and restores the scroll position
  after the scan.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also
work with userscript managers that support standard userscript metadata.

Then install:

1. Open `userscripts/deepseek-chat-export.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `chat.deepseek.com`.
4. Open or reload the shared conversation page.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/deepseek-chat-export.user.js
```

## Usage

1. Open a shared DeepSeek conversation: `https://chat.deepseek.com/a/chat/s/<id>`.
2. Click `MD` to download the conversation as Markdown, or `JSON` for the
   structured export.
3. The file is named `deepseek-<title-slug>-<date>.<ext>`.

### Exported JSON shape

```json
{
  "title": "Conversation title",
  "url": "https://chat.deepseek.com/a/chat/s/<id>",
  "shareId": "<id>",
  "exportedAt": "2026-08-02T10:00:00.000Z",
  "tool": "deepseek-chat-export/2026.08.02.2",
  "messages": [
    { "role": "user", "content": "…" },
    {
      "role": "assistant",
      "content": "…",
      "thinkingLabel": "Thought for 6 seconds",
      "thinking": [
        { "type": "text", "content": "…" },
        { "type": "search", "text": "Found 59 web pages" },
        { "type": "read", "text": "Read 5 pages", "links": [{ "title": "…", "url": "https://…" }] }
      ]
    }
  ]
}
```

## Compatibility Notes

- Runs on `https://chat.deepseek.com/a/chat/s/*` (shared conversations only).
- The extraction relies on DOM classes prefixed `ds-` (`.ds-message`,
  `.ds-assistant-message-main-content`, `.ds-think-content`, `.ds-markdown`);
  DeepSeek keeps those stable, but layout or class changes may require an
  update of the parsing selectors.
- Very old browsers without `URL.createObjectURL` / `Blob` will not download.

## Development

This repository keeps installable userscripts under `userscripts/` and
per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/deepseek-chat-export.user.js >/dev/null
```

Also search the repository for stale owner names, retired source repository
links, and outdated version notes before release.

## License

MIT