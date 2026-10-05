/**
 * Live mode: drive the user's real Chrome over CDP instead of abx's
 * own headless Chromium.
 *
 * Requires Chrome to be running with --remote-debugging-port=9222
 * (use scripts/chrome-debug to launch).
 *
 * Each call connects fresh, runs the command, disconnects. No daemon.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
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

async function activeTab(browser: Browser): Promise<ResolvedTab> {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('[abx] Chrome is reachable but has no open windows.');
  }
  const context = contexts[contexts.length - 1];
  const pages = context.pages();
  if (pages.length === 0) {
    const page = await context.newPage();
    return { browser, context, page };
  }
  return { browser, context, page: pages[pages.length - 1] };
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
      const lines: string[] = [];
      let i = 0;
      for (const ctx of tab.browser.contexts()) {
        for (const p of ctx.pages()) {
          lines.push(`${i++}\t${p.url()}\t${await p.title()}`);
        }
      }
      output = lines.join('\n');
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
      if (url) {
        await newPage.goto(url, { waitUntil: 'domcontentloaded' });
      }

      let tabId = 0;
      let found = false;
      for (const context of tab.browser.contexts()) {
        for (const candidate of context.pages()) {
          if (candidate === newPage) {
            found = true;
            break;
          }
          tabId += 1;
        }
        if (found) break;
      }

      output = jsonMode
        ? JSON.stringify({ tabId, url: url ?? null })
        : `Opened tab ${tabId}${url ? ` → ${url}` : ''}`;
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
        `Available: status, url, goto, reload, back, forward, text, html, snapshot, click, fill, upload, select, wait, press, type, js, screenshot, tabs, newtab, cookies`,
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
  const cmd = argv[0] ?? '';
  const args = argv.slice(1);
  let browser: Browser | null = null;
  try {
    browser = await connect();
    const tab = await activeTab(browser);
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
