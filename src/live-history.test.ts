import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { runLiveCommand } from './live';

// Opt-in: use a new tab in the dedicated agent Chrome, never existing tabs.
const endpoint = process.env.ABX_TEST_CDP_URL;
test.skipIf(!endpoint)('live history restores a ready cached document without a second load event', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request) {
      const name = new URL(request.url).pathname;
      return new Response(`<!doctype html><title>${name}</title><h1>${name}</h1>
        <script>window.addEventListener('pageshow', e => { window.wasRestored = e.persisted; });</script>`,
      { headers: { 'content-type': 'text/html' } });
    },
  });
  const browser = await chromium.connectOverCDP(endpoint!);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const tab = { browser, context, page };
  const base = `http://127.0.0.1:${server.port}`;
  try {
    await page.goto(base + '/first');
    await page.goto(base + '/second');
    await runLiveCommand(tab, 'back', [], () => {});
    expect(page.url()).toBe(base + '/first');
    expect(await page.locator('h1').innerText()).toBe('/first');
    await runLiveCommand(tab, 'forward', [], () => {});
    expect(page.url()).toBe(base + '/second');
    expect(await page.locator('h1').innerText()).toBe('/second');
  } finally {
    await page.close();
    await browser.close();
    server.stop(true);
  }
}, 15_000);

test.skipIf(!endpoint)('fresh history traversal waits for deferred DOM initialization', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/deferred.js') {
        await Bun.sleep(700);
        return new Response('window.deferredReady = true;', { headers: { 'content-type': 'text/javascript' } });
      }
      return new Response(`<!doctype html><title>${pathname}</title><script defer src="/deferred.js"></script><h1>${pathname}</h1>`,
        { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
    },
  });
  const browser = await chromium.launch({ headless: true, args: ['--disable-features=BackForwardCache'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const tab = { browser, context, page };
  const base = `http://127.0.0.1:${server.port}`;
  try {
    await page.goto(base + '/first');
    await page.goto(base + '/second');
    await runLiveCommand(tab, 'back', [], () => {});
    expect(await page.evaluate('window.deferredReady')).toBe(true);
    await runLiveCommand(tab, 'forward', [], () => {});
    expect(await page.evaluate('window.deferredReady')).toBe(true);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 15_000);
