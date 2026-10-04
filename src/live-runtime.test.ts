import { describe, expect, test } from 'bun:test';
import { resolveLiveRuntime } from './live-runtime';

const execDir = '/opt/homebrew/Cellar/abx/1.0.0/bin';
const bundled = '/opt/homebrew/Cellar/abx/1.0.0/libexec/node';

describe('resolveLiveRuntime', () => {
  test('ABX_NODE wins over everything', () => {
    expect(resolveLiveRuntime({ ABX_NODE: '/custom/node' }, execDir, () => true)).toBe('/custom/node');
  });

  test('uses the node linked next to the installed driver', () => {
    expect(resolveLiveRuntime({}, execDir, (f) => f === bundled)).toBe(bundled);
  });

  test('falls back to node on PATH', () => {
    expect(resolveLiveRuntime({}, execDir, () => false)).toBe('node');
  });
});
