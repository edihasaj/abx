import { describe, expect, test } from 'bun:test';
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
