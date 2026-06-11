# abx

**Fast headless browser for AI coding agents.** A persistent [Bun](https://bun.sh)
daemon over [Playwright](https://playwright.dev) Chromium, driven by a terse
CLI — navigate, read, click, snapshot, screenshot, and replay, with state held
across calls so each command is a single fast round-trip.

abx is one corner of an agent fleet alongside
[**vmlab**](https://github.com/edihasaj/vmlab) (cross-OS orchestrator) and
[**guiport**](https://github.com/edihasaj/guiport) (native desktop driver).
vmlab's `abx` transport drives this for web verification.

## Install

macOS 13+.

```sh
# Homebrew (recommended) — universal binary, auto-updates with `brew upgrade`
brew install edihasaj/abx/abx

# fetch the Chromium build abx drives (one-time)
abx install-browser
```

`install-browser` shells out to `bunx`/`npx` to run Playwright's own installer.
No Node/Bun on the machine? Either install one (`brew install bun`) and re-run,
or point abx at an existing browser:

```sh
export ABX_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

From source:

```sh
git clone https://github.com/edihasaj/abx && cd abx
bun install && bun run build      # → dist/abx
```

## Quickstart

```sh
abx goto https://example.com      # navigate (server starts on first call)
abx text                          # page text
abx snapshot -i                   # interactive elements with @ref handles
abx click @e3                     # act on a ref
abx screenshot shot.png           # capture
abx stop                          # shut the daemon down
```

State (current page, cookies, tabs) persists between calls via the background
server, so multi-step flows don't re-launch the browser each time.

## Commands

| Group | Commands |
|---|---|
| Navigation | `goto <url>` · `back` · `forward` · `reload` · `url` |
| Content | `text` · `html [sel]` · `links` · `forms` · `accessibility` |
| Interaction | `click` · `fill` · `select` · `hover` · `type` · `press` · `scroll` · `wait` · `viewport` · `upload` |
| Inspection | `js` · `eval` · `css` · `attrs` · `console` · `network` · `dialog` · `cookies` · `storage` · `perf` · `is` |
| Visual | `screenshot` · `pdf` · `responsive` |
| Snapshot | `snapshot [-i] [-c] [-d N] [-s sel] [-D] [-a] [-C]` · `diff <url1> <url2>` |
| Tabs | `tabs` · `tab <id>` · `newtab [url]` · `closetab [id]` |
| Live Chrome | `live <cmd>` — drive your real Chrome over CDP (`:9222`) |
| Server | `status` · `stop` · `restart` · `useragent` · `header` · `cookie` |

Run `abx --help` for the full surface, or `abx --version` for the build.

After `snapshot`, elements get `@e1`, `@e2`… handles usable as selectors
(`click @e3`, `fill @e4 "value"`). `-C` surfaces non-ARIA clickables as `@c1`…

## Live Chrome

`abx live <cmd>` drives your real, logged-in Chrome over the DevTools protocol
(port 9222) instead of the headless Chromium — useful for authenticated
sessions. Start Chrome with remote debugging first (see `scripts/`).

## Configuration

- `ABX_CHROMIUM_PATH` — launch a specific Chromium/Chrome binary instead of
  Playwright's download.
- `PLAYWRIGHT_BROWSERS_PATH` — where the Chromium build lives (Playwright default).
- `--proxy <url>` / `--headed` — per-invocation global flags.

## License

MIT. See [LICENSE](LICENSE).

Author: [Edi Hasaj](https://edihasaj.com).
