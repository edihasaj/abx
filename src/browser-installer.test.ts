import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'path';
import {
  expectedHeadlessExecutable,
  isHeadlessBrowserReady,
  isRegularExecutableFile,
  playwrightFallbackCommand,
  playwrightBrowserDirectory,
  resolveVendoredPlaywright,
} from './browser-installer';
import { chromiumExecutableOverride } from './browser-manager';

describe('browser installer', () => {
  test('uses the vendored Playwright CLI and its matching browser revision', () => {
    const root = '/opt/abx/libexec';
    const files = new Map([
      [path.join(root, 'node_modules/playwright/package.json'), JSON.stringify({ version: '1.59.1' })],
      [path.join(root, 'node_modules/playwright-core/browsers.json'), JSON.stringify({ browsers: [
        { name: 'chromium', revision: '1217' },
        { name: 'chromium-headless-shell', revision: '1217' },
      ] })],
    ]);
    const install = resolveVendoredPlaywright({
      serverScript: path.join(root, 'abx-server.js'),
      existsSync: (file) => file === path.join(root, 'node_modules/playwright/cli.js'),
      readFileSync: (file) => files.get(file) || '',
    });

    expect(install).toMatchObject({
      cliPath: path.join(root, 'node_modules/playwright/cli.js'),
      version: '1.59.1',
      chromiumRevision: '1217',
      headlessShellRevision: '1217',
    });
  });

  test('checks Playwrights headless-shell executable before reporting ready', () => {
    const install = { packageRoot: '/opt/abx/libexec', version: '1.59.1', chromiumRevision: '1217', headlessShellRevision: '1217' };
    const executable = expectedHeadlessExecutable('/cache', '1217', 'darwin', 'arm64')!;
    expect(executable).toBe('/cache/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell');
    expect(isHeadlessBrowserReady(install, {}, (file) => file === executable, 'darwin', 'arm64', '/home/edi')).toBe(false);
    expect(isHeadlessBrowserReady(install, { PLAYWRIGHT_BROWSERS_PATH: '/cache' }, (file) => file === executable, 'darwin', 'arm64', '/home/edi')).toBe(true);
  });

  test('keeps explicit browser paths and Playwright cache overrides intact', () => {
    expect(playwrightBrowserDirectory({ PLAYWRIGHT_BROWSERS_PATH: 'browsers', INIT_CWD: '/work' }, '/opt/abx', 'linux', '/home/edi')).toBe('/work/browsers');
    expect(isHeadlessBrowserReady(
      { version: '1.59.1', chromiumRevision: '1217', headlessShellRevision: '1217' },
      { ABX_CHROMIUM_PATH: '/Applications/Chrome' },
      (file) => file === '/Applications/Chrome',
    )).toBe(true);
  });

  test('pins the package-runner fallback to abxs Playwright version', () => {
    expect(playwrightFallbackCommand('bunx', '/bin/bunx', '1.59.1')).toEqual([
      '/bin/bunx', 'playwright@1.59.1', 'install', 'chromium',
    ]);
    expect(playwrightFallbackCommand('npx', 'npx.cmd', '1.59.1')).toEqual([
      'npx.cmd', '--yes', 'playwright@1.59.1', 'install', 'chromium',
    ]);
  });

  test('applies ABX_CHROMIUM_PATH to the normal headless launch path', () => {
    expect(chromiumExecutableOverride({ ABX_CHROMIUM_PATH: '/Applications/Chrome' })).toEqual({
      executablePath: '/Applications/Chrome',
    });
    expect(chromiumExecutableOverride({})).toEqual({});
  });

  test('does not treat directories or non-executable POSIX files as ready browsers', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'abx-browser-ready-'));
    const executable = path.join(root, 'chromium');
    const nonExecutable = path.join(root, 'not-executable');
    try {
      writeFileSync(executable, '#!/bin/sh\n', { mode: 0o755 });
      writeFileSync(nonExecutable, 'browser', { mode: 0o644 });
      expect(isRegularExecutableFile(root, 'darwin')).toBe(false);
      expect(isRegularExecutableFile(nonExecutable, 'darwin')).toBe(false);
      expect(isRegularExecutableFile(executable, 'darwin')).toBe(true);
      expect(isRegularExecutableFile(nonExecutable, 'win32')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
