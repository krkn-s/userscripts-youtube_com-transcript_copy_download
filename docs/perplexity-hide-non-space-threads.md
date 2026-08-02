# Perplexity Hide Space Threads

A small Safari-compatible userscript for Perplexity Library.

It adds a `Hide spaces` button to `https://www.perplexity.ai/library`. When enabled, the script hides threads that belong to a Space, including Bookmarks, and keeps regular non-Space threads visible. The button switches to `Show spaces` so hidden threads can be restored.

## Current Version

- Script file: `userscripts/perplexity-hide-non-space-threads.user.js`
- Script version: `2026.05.04.1`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- No dependencies.
- No network requests.
- No Perplexity data mutation.
- Works with existing and newly loaded Library threads.
- Detects Spaces and Bookmarks through the current Library collection pill UI, with a legacy fallback for `/spaces/...` links.
- Resets the filter state after navigation or reload.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also work with userscript managers that support standard userscript metadata.

Then install:

1. Open `userscripts/perplexity-hide-non-space-threads.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `www.perplexity.ai`.
4. Open or reload `https://www.perplexity.ai/library`.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/perplexity-hide-non-space-threads.user.js
```

## Usage

1. Open the Perplexity Library.
2. Use `Hide spaces` to hide threads linked to any Space or Bookmarks.
3. Use `Show spaces` to restore hidden threads.

The filter state is not persisted after reload.

## Compatibility Notes

- The script runs on `https://www.perplexity.ai/library*`.
- It is DOM-based and supports the current table-based Library layout plus an older `/spaces/...`-link layout.
- If Perplexity changes its Library markup, the row or Space detection selectors may need an update.

## Development

This repository keeps installable userscripts under `userscripts/` and per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/perplexity-hide-non-space-threads.user.js >/dev/null
```

Also search the repository for stale owner names, retired source repository links, and outdated version notes before release.

## License

MIT
