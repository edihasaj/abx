import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('install-browser fails when a vendored Playwright CLI exits zero without the expected browser', async () => {
  const root = mkdtempSync(join(tmpdir(), 'abx-install-browser-'));
  directories.push(root);
  const playwrightDir = join(root, 'node_modules', 'playwright');
  const coreDir = join(root, 'node_modules', 'playwright-core');
  mkdirSync(playwrightDir, { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(join(playwrightDir, 'cli.js'), 'process.exit(0);');
  writeFileSync(join(playwrightDir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  writeFileSync(join(coreDir, 'browsers.json'), JSON.stringify({ browsers: [
    { name: 'chromium', revision: '100' },
    { name: 'chromium-headless-shell', revision: '100' },
  ] }));

  const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), 'install-browser'], {
    env: {
      ...process.env,
      ABX_CHROMIUM_PATH: '',
      BROWSE_SERVER_SCRIPT: join(root, 'abx-server.js'),
      PLAYWRIGHT_BROWSERS_PATH: join(root, 'browser-cache'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain('headless Chromium 100 executable was not found');
});
