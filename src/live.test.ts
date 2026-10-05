import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { runLiveCommand, type ResolvedTab } from './live';

function makeLiveTab() {
  const pages: Page[] = [];
  const navigated: string[] = [];

  const existingPage = {
    url: () => 'https://existing.example/',
  } as unknown as Page;
  pages.push(existingPage);

  const context = {
    pages: () => pages,
    newPage: async () => {
      let currentUrl = 'about:blank';
      const page = {
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          navigated.push(url);
          return null;
        },
      } as unknown as Page;
      pages.push(page);
      return page;
    },
  } as unknown as BrowserContext;
  const browser = {
    contexts: () => [context],
  } as unknown as Browser;

  return {
    navigated,
    pages,
    tab: { browser, context, page: existingPage } satisfies ResolvedTab,
  };
}

describe('live newtab', () => {
  test('opens a blank tab and reports its live tab index', async () => {
    const fixture = makeLiveTab();
    let output = '';

    await runLiveCommand(fixture.tab, 'newtab', [], chunk => {
      output += chunk;
    });

    expect(fixture.pages).toHaveLength(2);
    expect(fixture.navigated).toEqual([]);
    expect(output).toBe('Opened tab 1\n');
  });

  test('navigates the new tab and supports the normal --json contract', async () => {
    const fixture = makeLiveTab();
    let output = '';

    await runLiveCommand(fixture.tab, 'newtab', ['https://example.com/', '--json'], chunk => {
      output += chunk;
    });

    expect(fixture.navigated).toEqual(['https://example.com/']);
    expect(JSON.parse(output)).toEqual({
      tabId: 1,
      url: 'https://example.com/',
    });
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
