import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { parseLiveArgs, resolveTab, runLiveCommand, type ResolvedTab } from './live';

const EXISTING = `A1B2${'0'.repeat(28)}`;
const OPENED = [`C3D4A${'1'.repeat(27)}`, `C3D4B${'2'.repeat(27)}`];

// A Chrome with one open tab. Each tab answers Target.getTargetInfo with its own id,
// and `pages` can be reordered to mimic Chrome listing tabs differently per connection.
function makeLiveTab() {
  const pages: Page[] = [];
  const ids = new Map<Page, string>();
  const navigated: string[] = [];
  const fronted: string[] = [];

  const addPage = (id: string, url: string): Page => {
    let currentUrl = url;
    const page = {
      url: () => currentUrl,
      title: async () => (currentUrl === 'about:blank' ? '' : `Page ${id.slice(0, 4)}`),
      goto: async (to: string) => {
        currentUrl = to;
        navigated.push(to);
        return null;
      },
      bringToFront: async () => { fronted.push(id); },
      close: async () => { pages.splice(pages.indexOf(page), 1); },
    } as unknown as Page;
    ids.set(page, id);
    pages.push(page);
    return page;
  };

  const context = {
    pages: () => [...pages],
    newPage: async () => addPage(OPENED[pages.length - 1], 'about:blank'),
    newCDPSession: async (page: Page) => ({
      send: async (method: string) => {
        expect(method).toBe('Target.getTargetInfo');
        return { targetInfo: { targetId: ids.get(page) } };
      },
      detach: async () => {},
    }),
  } as unknown as BrowserContext;
  const browser = { contexts: () => [context] } as unknown as Browser;
  const existingPage = addPage(EXISTING, 'https://existing.example/');

  return {
    browser,
    fronted,
    ids,
    navigated,
    pages,
    tab: { browser, context, page: existingPage } satisfies ResolvedTab,
  };
}

async function run(tab: ResolvedTab, cmd: string, args: string[] = []): Promise<string> {
  let output = '';
  await runLiveCommand(tab, cmd, args, chunk => {
    output += chunk;
  });
  return output;
}

describe('live tabs', () => {
  const savedTmp = process.env.TMPDIR;
  let tmp = '';

  // The remembered tab lives in the temp dir; keep each test's copy separate.
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abx-live-pin-'));
    process.env.TMPDIR = tmp;
  });

  afterEach(() => {
    process.env.TMPDIR = savedTmp;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('newtab reports the stable tab id and navigates', async () => {
    const fixture = makeLiveTab();
    expect(await run(fixture.tab, 'newtab')).toBe(`Opened tab ${OPENED[0]}\n`);
    expect(JSON.parse(await run(fixture.tab, 'newtab', ['https://example.com/', '--json']))).toEqual({
      tabId: OPENED[1],
      url: 'https://example.com/',
    });
    expect(fixture.navigated).toEqual(['https://example.com/']);
    expect(fixture.pages).toHaveLength(3);
  });

  test('later commands act on the tab newtab opened, wherever Chrome lists it', async () => {
    const fixture = makeLiveTab();
    await run(fixture.tab, 'newtab', ['https://form.example/']);
    // A fresh connection lists the new tab first, so "the last tab" would be the old one.
    fixture.pages.unshift(fixture.pages.pop()!);
    const resolved = await resolveTab(fixture.browser);
    expect(fixture.ids.get(resolved.page)).toBe(OPENED[0]);
    expect(resolved.page.url()).toBe('https://form.example/');
  });

  test('--tab and ABX_LIVE_TAB pick a tab by id or a unique prefix', async () => {
    const fixture = makeLiveTab();
    await run(fixture.tab, 'newtab');
    await run(fixture.tab, 'newtab');
    expect(fixture.ids.get((await resolveTab(fixture.browser, EXISTING.toLowerCase())).page)).toBe(EXISTING);
    expect(fixture.ids.get((await resolveTab(fixture.browser, 'C3D4B')).page)).toBe(OPENED[1]);
    await expect(resolveTab(fixture.browser, 'C3D4')).rejects.toThrow('matches 2 tabs');
    await expect(resolveTab(fixture.browser, 'A1B')).rejects.toThrow('No open tab has id A1B');
    await expect(resolveTab(fixture.browser, 'FFFF')).rejects.toThrow('No open tab has id FFFF');

    expect(parseLiveArgs(['--tab', 'C3D4B', 'fill', '#name', 'Chirp', 'Go'], {})).toEqual({
      tab: 'C3D4B',
      cmd: 'fill',
      args: ['#name', 'Chirp', 'Go'],
    });
    expect(parseLiveArgs(['--tab=A1B2', 'url'], { ABX_LIVE_TAB: 'C3D4A' })).toEqual({ tab: 'A1B2', cmd: 'url', args: [] });
    expect(parseLiveArgs(['url'], { ABX_LIVE_TAB: 'C3D4A' })).toEqual({ tab: 'C3D4A', cmd: 'url', args: [] });
    expect(parseLiveArgs([], {})).toEqual({ tab: undefined, cmd: '', args: [] });
    expect(() => parseLiveArgs(['--tab'], {})).toThrow('Usage: abx live --tab <id>');
  });

  test('tabs lists ids, tab switches, and closetab forgets a closed tab', async () => {
    const fixture = makeLiveTab();
    await run(fixture.tab, 'newtab', ['https://form.example/']);
    expect(await run(fixture.tab, 'tabs')).toBe(
      `→ [${EXISTING}] Page A1B2 — https://existing.example/\n` +
      `  [${OPENED[0]}] Page C3D4 — https://form.example/\n`,
    );
    expect(JSON.parse(await run(fixture.tab, 'tabs', ['--json']))).toEqual([
      { id: EXISTING, url: 'https://existing.example/', title: 'Page A1B2', current: true },
      { id: OPENED[0], url: 'https://form.example/', title: 'Page C3D4', current: false },
    ]);

    expect(await run(fixture.tab, 'tab', ['a1b2'])).toBe(`Switched to tab ${EXISTING} → https://existing.example/\n`);
    expect(fixture.fronted).toEqual([EXISTING]);
    // The existing tab is remembered now, even though the new tab is listed last.
    expect(fixture.ids.get((await resolveTab(fixture.browser)).page)).toBe(EXISTING);

    expect(await run(fixture.tab, 'closetab')).toBe(`Closed tab ${EXISTING}\n`);
    expect(fixture.pages).toHaveLength(1);
    // With the remembered tab gone, commands fall back to the last tab listed.
    expect(fixture.ids.get((await resolveTab(fixture.browser)).page)).toBe(OPENED[0]);
    await expect(run(fixture.tab, 'closetab', ['FFFF'])).rejects.toThrow('No open tab has id FFFF');
  });
});


function makeFormTab() {
  const calls: Array<{ method: string; selector: string; value: unknown }> = [];
  const page = {
    url: () => 'https://form.example/',
    locator: (selector: string) => ({
      first: () => ({
        setInputFiles: async (files: string[]) => { calls.push({ method: 'setInputFiles', selector, value: files }); },
        selectOption: async (value: string) => { calls.push({ method: 'selectOption', selector, value }); return [value]; },
        waitFor: async (options: { timeout: number }) => { calls.push({ method: 'waitFor', selector, value: options.timeout }); },
      }),
    }),
  } as unknown as Page;
  const context = { pages: () => [page] } as unknown as BrowserContext;
  const browser = { contexts: () => [context] } as unknown as Browser;
  return { calls, tab: { browser, context, page } satisfies ResolvedTab };
}

describe('live form controls', () => {
  test('uploads existing files to a file input, including several at once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abx-live-'));
    const logo = path.join(dir, 'logo.png');
    const shot = path.join(dir, 'shot.png');
    fs.writeFileSync(logo, 'x');
    fs.writeFileSync(shot, 'y');
    const fixture = makeFormTab();
    let output = '';
    await runLiveCommand(fixture.tab, 'upload', ['input[type=file]', logo, shot], chunk => { output += chunk; });
    expect(fixture.calls).toEqual([{ method: 'setInputFiles', selector: 'input[type=file]', value: [logo, shot] }]);
    expect(output).toBe('Uploaded 2 files to input[type=file]\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refuses missing files before touching the page', async () => {
    const fixture = makeFormTab();
    await expect(runLiveCommand(fixture.tab, 'upload', ['input', '/nope/missing.png'], () => {})).rejects.toThrow('File not found');
    expect(fixture.calls).toEqual([]);
  });

  test('selects an option by value or label and waits for elements', async () => {
    const fixture = makeFormTab();
    await runLiveCommand(fixture.tab, 'select', ['select[name=topic]', 'Developer', 'Tools'], () => {});
    await runLiveCommand(fixture.tab, 'wait', ['#done', '5000'], () => {});
    expect(fixture.calls).toEqual([
      { method: 'selectOption', selector: 'select[name=topic]', value: 'Developer Tools' },
      { method: 'waitFor', selector: '#done', value: 5000 },
    ]);
  });
});


describe('live screenshot', () => {
  test('captures the full page when asked', async () => {
    const shots: Array<{ path: string; fullPage: boolean }> = [];
    const page = { url: () => 'https://form.example/', screenshot: async (options: { path: string; fullPage: boolean }) => { shots.push(options); } } as unknown as Page;
    const context = { pages: () => [page] } as unknown as BrowserContext;
    const tab = { browser: { contexts: () => [context] } as unknown as Browser, context, page };
    let output = '';
    await runLiveCommand(tab, 'screenshot', ['--full', '/tmp/form.png'], chunk => { output += chunk; });
    await runLiveCommand(tab, 'screenshot', ['/tmp/view.png'], () => {});
    expect(shots).toEqual([{ path: '/tmp/form.png', fullPage: true }, { path: '/tmp/view.png', fullPage: false }]);
    expect(output).toBe('Screenshot saved: /tmp/form.png (full page)\n');
  });
});
