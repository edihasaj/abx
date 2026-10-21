import * as path from 'path';

/**
 * Pick the Node binary that runs live.mjs (the live-Chrome driver).
 *
 * Order: ABX_NODE, then a `node` link next to the installed driver
 * (Homebrew's formula links libexec/node to the current node formula's
 * stable opt path, so Node upgrades never break it), then plain `node` from PATH.
 */
export function resolveLiveRuntime(
  env: Record<string, string | undefined>,
  execDir: string,
  exists: (file: string) => boolean,
): string {
  if (env.ABX_NODE) return env.ABX_NODE;
  const bundled = path.resolve(execDir, '..', 'libexec', 'node');
  if (exists(bundled)) return bundled;
  return 'node';
}
