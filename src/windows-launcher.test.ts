import { describe, expect, test } from 'bun:test';
import {
  buildWindowsServerLauncher,
  findBrowserInstaller,
} from './windows-launcher';

describe('buildWindowsServerLauncher', () => {
  test('detaches Bun with the shipped server bundle', () => {
    const launcher = buildWindowsServerLauncher(
      'C:\\Program Files\\Bun\\bun.exe',
      'C:\\Program Files\\abx\\abx-server.js',
      '{"BROWSE_PARENT_PID":"0"}',
    );

    expect(launcher).toContain("['run',");
    expect(launcher).toContain('detached:true');
    expect(launcher).toContain('BROWSE_PARENT_PID');
    expect(launcher).not.toContain('server-node.mjs');
  });

  test('finds installers without a POSIX shell', () => {
    const found = findBrowserInstaller(
      ['bunx', 'npx'],
      (name) => (name === 'bunx' ? 'C:\\Tools\\bunx.exe' : null),
    );

    expect(found).toEqual({
      name: 'bunx',
      executable: 'C:\\Tools\\bunx.exe',
    });
  });
});
