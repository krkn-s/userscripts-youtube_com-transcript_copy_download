# Repository Guidelines

## Project Structure & Module Organization

This repository is a collection of standalone userscripts.

- `userscripts/*.user.js` contains installable userscripts only.
- `docs/*.md` contains one documentation page per userscript.
- `README.md` is the public collection index with install links.

When adding a script, use matching names for code and docs:

```text
userscripts/example-feature.user.js
docs/example-feature.md
```

## Build, Test, and Development Commands

There is no build step. Userscripts are plain JavaScript files installed directly by a userscript manager.

Run syntax checks before committing (bun has no `--check` flag; `bun build --no-bundle` validates syntax, exit 0 means valid, stdout is discarded):

```sh
bun build --no-bundle userscripts/perplexity-hide-non-space-threads.user.js >/dev/null
bun build --no-bundle userscripts/youtube-default-to-subscriptions.user.js >/dev/null
bun build --no-bundle userscripts/youtube-transcript-copy-download.user.js >/dev/null
```

Search for stale metadata or retired names when renaming scripts:

```sh
rg -n "old-name|old-repo|old-owner" .
```

## Coding Style & Naming Conventions

Use plain JavaScript with no bundler or external runtime dependency. Keep scripts self-contained and compatible with Safari Userscripts where possible.

- Use two-space indentation for new scripts unless editing a file with an established style.
- Keep metadata blocks complete: `@name`, `@namespace`, `@version`, `@description`, `@author`, URL fields, `@match`, `@run-at`, `@grant`, and `@license`.
- Use `YYYY.MM.DD.N` for `@version`; start at `.1` for the first release of a day and increment `N` for each later update that same day, for example `2026.04.28.1`, then `2026.04.28.2`.
- Use lowercase kebab-case filenames. Userscripts must end in `.user.js`, and the matching documentation file must reuse the same base name with `.md`.
- Prefer concise product/action names without dates or noisy domain fragments, for example `youtube-transcript-copy-download.user.js` and `docs/youtube-transcript-copy-download.md`.
- Point `@downloadURL` and `@updateURL` to the raw file under `https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/`.

## Testing Guidelines

There is no automated test suite. At minimum, run `bun build --no-bundle <script> >/dev/null` on every changed userscript (exit code 0 means the syntax is valid). For behavior changes, manually test in the target site with the intended userscript manager and verify install/update URLs.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Add Perplexity and YouTube subscription userscripts` or `Simplify collection README index`.

Use a concise subject plus a detailed body when the change affects metadata, install URLs, documentation, or repository structure. PRs should describe the user-visible behavior, list changed scripts, mention manual testing, and include screenshots only when UI placement changes.

## Agent-Specific Instructions

Do not place documentation inside `userscripts/`. Keep installable files there only. When adding or renaming a userscript, update `README.md`, add or rename the matching file in `docs/`, and verify all raw GitHub URLs.
