# Userscripts

A collection of userscripts maintained by <https://github.com/krkn-s>.

Install a userscript manager first. These scripts are used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension. For other
browsers, [Violentmonkey](https://github.com/violentmonkey/violentmonkey) is a
good alternative.

## Available Scripts

| Script | Site | What it does | Install |
| --- | --- | --- | --- |
| [DeepSeek Chat Export](docs/deepseek-chat-export.md) | DeepSeek | Exports a shared conversation (with thinking chain) as Markdown or JSON. | [Install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/deepseek-chat-export.user.js) |
| [Notion Export Markdown](docs/notion-export-markdown.md) | Notion | Downloads or copies the current Notion page as Markdown, with optional YAML frontmatter. | [Install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/notion-export-markdown.user.js) |
| [Perplexity Hide Space Threads](docs/perplexity-hide-non-space-threads.md) | Perplexity | Hides Library threads attached to Spaces or Bookmarks. | [Install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/perplexity-hide-non-space-threads.user.js) |
| [YouTube Default to My Subscriptions](docs/youtube-default-to-subscriptions.md) | YouTube | Redirects signed-in home page visits to Subscriptions. | [Install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-default-to-subscriptions.user.js) |
| [YouTube Transcript Copy & Download](docs/youtube-transcript-copy-download.md) | YouTube | Copies or downloads timestamped video transcripts. | [Install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-transcript-copy-download.user.js) |

## Repository Layout

```text
userscripts/*.user.js  installable userscripts
docs/*.md              per-script documentation
README.md              collection index
```

## Installing a Script

1. Open the raw install link for the script you want.
2. Confirm the installation in your userscript manager.
3. Make sure the script is enabled for the target website.
4. Reload the target website.

## License

MIT
