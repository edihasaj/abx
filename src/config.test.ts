import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { packageRootFor } from './config';

describe('packageRootFor', () => {
  test('recognizes the compiled Windows executable', () => {
    expect(
      packageRootFor(
        '/Projects/abx/dist/abx.exe',
        '/virtual/bun/root',
      ),
    ).toBe(path.resolve('/Projects/abx/dist', '..'));
  });
});
