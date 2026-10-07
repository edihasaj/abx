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
bun test                         # unit tests and isolated daemon lifecycle checks
```

On Windows, install Bun and Node.js first, then build `dist/abx.exe`,
`dist/abx-server.js`, and `dist/live.mjs`. The CLI launches the server bundle
through Bun in a detached process so browser state survives the invoking shell.

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

`abx stop` stops only the recorded daemon. When none is running, it succeeds
without launching a browser. Shutdown can close the HTTP connection before
replying; the CLI checks that the daemon exited and never restarts it.

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

Tabs have ids from Chrome that stay the same while the tab is open; Chrome's tab
order changes between calls, so live mode never relies on it. `abx live newtab
[url]` prints the new tab's id, and later live commands act on that tab until it
closes. `abx live tabs` lists ids (`--json` for scripts), `abx live tab <id>`
switches to another tab, and `abx live closetab [id]` closes one. For a single
command, `abx live --tab <id> <cmd>` (or `ABX_LIVE_TAB`) picks the tab; four or
more leading characters of an id are enough when they are unique.

Forms work too: `abx live upload <selector>
<file>...` sets files on a file input (hidden inputs included), `abx live select
<selector> <value-or-label>` picks an option, and `abx live wait <selector>
[timeout-ms]` waits for an element. `abx live screenshot --full <path>` captures the
whole page.

## Configuration

- `ABX_CHROMIUM_PATH` — launch a specific Chromium/Chrome binary instead of
  Playwright's download.
- `PLAYWRIGHT_BROWSERS_PATH` — where the Chromium build lives (Playwright default).
- `ABX_LIVE_CDP_URL` — Chrome DevTools endpoint for `abx live` (default
  `http://127.0.0.1:9222`).
- `ABX_LIVE_TAB` — tab id for `abx live` commands, like `--tab`.
- `ABX_NODE` — Node binary that runs `abx live`. Homebrew installs link
  `node@24` (LTS) for it, so you rarely need this; otherwise `node` from PATH.
- `--proxy <url>` / `--headed` — per-invocation global flags.

## License

MIT. See [LICENSE](LICENSE).

Author: [Edi Hasaj](https://edihasaj.com).
