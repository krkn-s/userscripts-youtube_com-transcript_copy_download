# YouTube Default to My Subscriptions

A small userscript that redirects signed-in YouTube home page visits to the Subscriptions page.

When you open the YouTube home page while signed in, the script sends you to `https://www.youtube.com/feed/subscriptions` instead of leaving you on the default home feed.

## Current Version

- Script file: `userscripts/youtube-default-to-subscriptions.user.js`
- Script version: `2026.04.28.1`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- Runs at `document-start` for early redirects.
- Redirects only from the YouTube home page.
- Skips YouTube feed, watch, channel, and user pages.
- Checks for the `SID` cookie before redirecting, so signed-out visits are left alone.
- Avoids redirect loops when the referrer is already the Subscriptions page.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also work with userscript managers that support standard userscript metadata.

Then install:

1. Open `userscripts/youtube-default-to-subscriptions.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `youtube.com`.
4. Open or reload `https://www.youtube.com/`.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-default-to-subscriptions.user.js
```

## Behavior

- `https://www.youtube.com/` redirects to `/feed/subscriptions` when signed in.
- YouTube watch, channel, user, and feed pages are not redirected.
- Signed-out visits are not redirected.

## Compatibility Notes

- The script runs on `youtube.com` subdomains.
- Sign-in detection depends on YouTube exposing the `SID` cookie to the page.
- If YouTube changes its sign-in cookies, the detection logic may need an update.

## Development

This repository keeps installable userscripts under `userscripts/` and per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/youtube-default-to-subscriptions.user.js >/dev/null
```

Also search the repository for stale owner names, retired source repository links, and outdated version notes before release.

## License

MIT
