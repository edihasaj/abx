/**
 * Live mode: drive the user's real Chrome over CDP instead of abx's
 * own headless Chromium.
 *
 * Requires Chrome to be running with --remote-debugging-port=9222
 * (use scripts/chrome-debug to launch).
 *
 * Each call connects fresh, runs the command, disconnects. No daemon.
 * Chrome lists tabs in a different order on each connection, so commands find
 * their tab by Chrome's target id (see resolveTab), never by position.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { wrapUntrustedContent } from './commands';

const CDP_URL = process.env.ABX_LIVE_CDP_URL || 'http://127.0.0.1:9222';

export interface ResolvedTab {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

type OutputWriter = (chunk: string) => void;

async function connect(): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
  } catch (err: any) {
    const detail = process.env.ABX_LIVE_DEBUG ? `\n[abx] underlying: ${err.message}` : '';
    const msg =
      `[abx] Cannot reach Chrome at ${CDP_URL}.${detail}\n` +
      `[abx] Run scripts/chrome-debug to relaunch Chrome with the debug port.`;
    throw new Error(msg);
  }
}

interface ListedTab extends ResolvedTab {
  id: string;
}

/** Chrome's target id for a tab. Unlike a list position, it never changes while the tab is open. */
async function tabId(context: BrowserContext, page: Page): Promise<string> {
  const session = await context.newCDPSession(page);
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    return targetInfo.targetId;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function listTabs(browser: Browser): Promise<ListedTab[]> {
  const tabs: ListedTab[] = [];
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      tabs.push({ browser, context, page, id: await tabId(context, page) });
    }
  }
  return tabs;
}

/** Finds a tab by its id, or by a unique id prefix of at least four characters. */
async function findTab(browser: Browser, wanted: string): Promise<ListedTab | null> {
  const key = wanted.trim().toUpperCase();
  const tabs = await listTabs(browser);
  const exact = tabs.find(tab => tab.id === key);
  if (exact || key.length < 4) return exact ?? null;
  const matches = tabs.filter(tab => tab.id.startsWith(key));
  if (matches.length > 1) throw new Error(`[abx] Tab id ${wanted} matches ${matches.length} tabs; use more of the id.`);
  return matches[0] ?? null;
}

function missingTab(wanted: string): Error {
  return new Error(`[abx] No open tab has id ${wanted}. Run abx live tabs to list them.`);
}

// Chrome lists tabs in a different order on every connection, so newtab and tab
// remember their tab here and later live commands act on it while it is open.
function pinFile(): string {
  return path.join(os.tmpdir(), `abx-live-${CDP_URL.replace(/[^a-z0-9]+/gi, '-')}.tab`);
}

function readPin(): string {
  try {
    return fs.readFileSync(pinFile(), 'utf8').trim();
  } catch {
    return '';
  }
}

function writePin(id: string): void {
  fs.writeFileSync(pinFile(), id, { mode: 0o600 });
}

function clearPin(): void {
  try {
    fs.unlinkSync(pinFile());
  } catch {}
}

/** The tab a live command acts on: --tab or ABX_LIVE_TAB, else the remembered tab, else the last one listed. */
export async function resolveTab(browser: Browser, wanted?: string): Promise<ResolvedTab> {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('[abx] Chrome is reachable but has no open windows.');
  }
  if (wanted) {
    const tab = await findTab(browser, wanted);
    if (!tab) throw missingTab(wanted);
    return tab;
  }
  const pinned = readPin();
  if (pinned) {
    const tab = await findTab(browser, pinned);
    if (tab) return tab;
    clearPin();
  }
  const context = contexts[contexts.length - 1];
  const pages = context.pages();
  if (pages.length === 0) {
    const page = await context.newPage();
    return { browser, context, page };
  }
  return { browser, context, page: pages[pages.length - 1] };
}

/** Splits a leading --tab <id> (or --tab=<id>) from the command; ABX_LIVE_TAB is the default. */
export function parseLiveArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { tab?: string; cmd: string; args: string[] } {
  let tab = env.ABX_LIVE_TAB || undefined;
  let rest = argv;
  if (rest[0] === '--tab') {
    tab = rest[1];
    if (!tab) throw new Error('Usage: abx live --tab <id> <cmd> [args]');
    rest = rest.slice(2);
  } else if (rest[0]?.startsWith('--tab=')) {
    tab = rest[0].slice('--tab='.length);
    rest = rest.slice(1);
  }
  return { tab, cmd: rest[0] ?? '', args: rest.slice(1) };
}

function shouldWrap(cmd: string): boolean {
  return cmd === 'text' || cmd === 'html' || cmd === 'snapshot';
}

export async function runLiveCommand(
  tab: ResolvedTab,
  cmd: string,
  args: string[],
  write: OutputWriter = chunk => process.stdout.write(chunk),
): Promise<void> {
  const { page } = tab;
  let output = '';
  let raw = false;

  switch (cmd) {
    case 'status':
    case undefined:
    case '': {
      const contexts = tab.browser.contexts();
      const tabCount = contexts.reduce((n, c) => n + c.pages().length, 0);
      output =
        `Connected: ${CDP_URL}\n` +
        `Contexts: ${contexts.length}\n` +
        `Tabs: ${tabCount}\n` +
        `Active tab: ${await tabId(tab.context, page)}\n` +
        `Active URL: ${page.url()}`;
      raw = true;
      break;
    }
    case 'url': {
      output = page.url();
      raw = true;
      break;
    }
    case 'goto': {
      const url = args[0];
      if (!url) throw new Error('Usage: abx live goto <url>');
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      output = `Navigated to ${url} (${resp?.status() ?? 'no response'})`;
      raw = true;
      break;
    }
    case 'reload': {
      await page.reload({ waitUntil: 'domcontentloaded' });
      output = `Reloaded ${page.url()}`;
      raw = true;
      break;
    }
    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded' });
      output = `Back → ${page.url()}`;
      raw = true;
      break;
    }
    case 'forward': {
      await page.goForward({ waitUntil: 'domcontentloaded' });
      output = `Forward → ${page.url()}`;
      raw = true;
      break;
    }
    case 'text': {
      output = (await page.locator('body').innerText()).trim();
      break;
    }
    case 'html': {
      const sel = args[0];
      output = sel ? await page.locator(sel).first().innerHTML() : await page.content();
      break;
    }
    case 'snapshot': {
      output = await page.locator('body').ariaSnapshot();
      break;
    }
    case 'click': {
      const sel = args[0];
      if (!sel) throw new Error('Usage: abx live click <selector>');
      if (sel.startsWith('@e')) throw new Error('[abx] @e refs are not yet supported in live mode — use a CSS selector.');
      await page.locator(sel).first().click();
      output = `Clicked ${sel}`;
      raw = true;
      break;
    }
    case 'fill': {
      const sel = args[0];
      const value = args.slice(1).join(' ');
      if (!sel) throw new Error('Usage: abx live fill <selector> <value>');
      if (sel.startsWith('@e')) throw new Error('[abx] @e refs are not yet supported in live mode — use a CSS selector.');
      await page.locator(sel).first().fill(value);
      output = `Filled ${sel}`;
      raw = true;
      break;
    }
    case 'upload': {
      const [sel, ...files] = args;
      if (!sel || files.length === 0) throw new Error('Usage: abx live upload <selector> <file> [file...]');
      if (sel.startsWith('@e')) throw new Error('[abx] @e refs are not yet supported in live mode — use a CSS selector.');
      const missing = files.filter(file => !fs.existsSync(file));
      if (missing.length) throw new Error(`[abx] File not found: ${missing.join(', ')}`);
      // Works on hidden file inputs too, which most upload widgets use.
      await page.locator(sel).first().setInputFiles(files);
      output = `Uploaded ${files.length} file${files.length === 1 ? '' : 's'} to ${sel}`;
      raw = true;
      break;
    }
    case 'select': {
      const sel = args[0];
      const value = args.slice(1).join(' ');
      if (!sel || !value) throw new Error('Usage: abx live select <selector> <value-or-label>');
      if (sel.startsWith('@e')) throw new Error('[abx] @e refs are not yet supported in live mode — use a CSS selector.');
      const chosen = await page.locator(sel).first().selectOption(value);
      output = `Selected ${chosen.join(', ') || value} in ${sel}`;
      raw = true;
      break;
    }
    case 'wait': {
      const sel = args[0];
      if (!sel) throw new Error('Usage: abx live wait <selector> [timeout-ms]');
      const timeout = Number(args[1] || 15000);
      await page.locator(sel).first().waitFor({ timeout: Number.isFinite(timeout) ? timeout : 15000 });
      output = `Found ${sel}`;
      raw = true;
      break;
    }
    case 'press': {
      const key = args[0];
      if (!key) throw new Error('Usage: abx live press <key>');
      await page.keyboard.press(key);
      output = `Pressed ${key}`;
      raw = true;
      break;
    }
    case 'type': {
      const text = args.join(' ');
      if (!text) throw new Error('Usage: abx live type <text>');
      await page.keyboard.type(text);
      output = `Typed ${text.length} chars`;
      raw = true;
      break;
    }
    case 'js': {
      const expr = args.join(' ');
      if (!expr) throw new Error('Usage: abx live js <expression>');
      const result = await page.evaluate(expr);
      output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      raw = true;
      break;
    }
    case 'screenshot': {
      // --full captures the whole page, so a long form can be checked in one image.
      const fullPage = args.includes('--full');
      const path = args.find(arg => arg !== '--full') || `/tmp/abx-live-${Date.now()}.png`;
      await page.screenshot({ path, fullPage });
      output = `Screenshot saved: ${path}${fullPage ? ' (full page)' : ''}`;
      raw = true;
      break;
    }
    case 'tabs': {
      const rows: Array<{ id: string; url: string; title: string; current: boolean }> = [];
      for (const listed of await listTabs(tab.browser)) {
        rows.push({ id: listed.id, url: listed.page.url(), title: await listed.page.title(), current: listed.page === page });
      }
      output = args.includes('--json')
        ? JSON.stringify(rows)
        : rows.map(row => `${row.current ? '→ ' : '  '}[${row.id}] ${row.title || '(untitled)'} — ${row.url}`).join('\n');
      raw = true;
      break;
    }
    case 'tab': {
      const wanted = args[0];
      if (!wanted) throw new Error('Usage: abx live tab <id>');
      const found = await findTab(tab.browser, wanted);
      if (!found) throw missingTab(wanted);
      await found.page.bringToFront();
      writePin(found.id);
      output = `Switched to tab ${found.id} → ${found.page.url()}`;
      raw = true;
      break;
    }
    case 'newtab': {
      let url: string | undefined;
      let jsonMode = false;
      for (const arg of args) {
        if (arg === '--json') jsonMode = true;
        else if (!url) url = arg;
      }

      const newPage = await tab.context.newPage();
      // Remember the tab before navigating, so a slow page still gets the next command.
      const id = await tabId(tab.context, newPage);
      writePin(id);
      if (url) {
        await newPage.goto(url, { waitUntil: 'domcontentloaded' });
      }

      output = jsonMode
        ? JSON.stringify({ tabId: id, url: url ?? null })
        : `Opened tab ${id}${url ? ` → ${url}` : ''}`;
      raw = true;
      break;
    }
    case 'closetab': {
      const wanted = args[0];
      let target: ListedTab | null = { ...tab, id: await tabId(tab.context, page) };
      if (wanted) {
        target = await findTab(tab.browser, wanted);
        if (!target) throw missingTab(wanted);
      }
      await target.page.close();
      if (readPin() === target.id) clearPin();
      output = `Closed tab ${target.id}`;
      raw = true;
      break;
    }
    case 'cookies': {
      const cookies = await tab.context.cookies();
      output = JSON.stringify(cookies, null, 2);
      raw = true;
      break;
    }
    default: {
      throw new Error(
        `[abx] Live mode does not yet support: ${cmd}\n` +
        `Available: status, url, goto, reload, back, forward, text, html, snapshot, click, fill, upload, select, wait, press, type, js, screenshot, tabs, tab, newtab, closetab, cookies`,
      );
    }
  }

  if (!raw && shouldWrap(cmd)) {
    write(wrapUntrustedContent(output, page.url()) + '\n');
  } else {
    write(output + '\n');
  }
}

export async function runLive(argv: string[]): Promise<number> {
  let browser: Browser | null = null;
  try {
    const { tab: wanted, cmd, args } = parseLiveArgs(argv);
    browser = await connect();
    const tab = await resolveTab(browser, wanted);
    await runLiveCommand(tab, cmd, args);
    return 0;
  } catch (err: any) {
    process.stderr.write((err.message ?? String(err)) + '\n');
    return 1;
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}

if (import.meta.main) {
  process.exit(await runLive(process.argv.slice(2)));
}
