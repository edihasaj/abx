import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import playwrightPackage from '../node_modules/playwright/package.json' with { type: 'json' };
import playwrightBrowsers from '../node_modules/playwright-core/browsers.json' with { type: 'json' };

type BrowserMetadata = { name: string; revision: string };

// These JSON imports are embedded in the compiled CLI, so a package update
// automatically updates the fallback instead of leaving a second version pin.
const buildBrowsers = playwrightBrowsers.browsers as BrowserMetadata[];
const BUILD_PLAYWRIGHT_VERSION = playwrightPackage.version;
const BUILD_CHROMIUM_REVISION = buildBrowsers.find((browser) => browser.name === 'chromium')!.revision;
const BUILD_HEADLESS_SHELL_REVISION = buildBrowsers.find((browser) => browser.name === 'chromium-headless-shell')!.revision;

export interface PlaywrightInstall {
  cliPath?: string;
  packageRoot?: string;
  version: string;
  chromiumRevision: string;
  headlessShellRevision: string;
}

interface ResolveOptions {
  serverScript?: string | null;
  metaDir?: string;
  execPath?: string;
  existsSync?: (file: string) => boolean;
  readFileSync?: (file: string, encoding: BufferEncoding) => string;
}

function candidatePackageRoots(options: ResolveOptions): string[] {
  const roots = new Set<string>();
  const addRoot = (root: string) => {
    roots.add(root);
    roots.add(path.resolve(root, '..'));
  };

  if (options.serverScript) addRoot(path.dirname(options.serverScript));
  if (options.metaDir && !options.metaDir.includes('$bunfs')) addRoot(path.resolve(options.metaDir, '..'));
  if (options.execPath) {
    const execDir = path.dirname(options.execPath);
    addRoot(execDir);
    addRoot(path.resolve(execDir, '..', 'libexec'));
  }
  return [...roots];
}

function readJson<T>(file: string, readFileSync: ResolveOptions['readFileSync']): T | null {
  try {
    return JSON.parse((readFileSync || fs.readFileSync)(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Prefer the CLI shipped beside abx's server. This keeps browser downloads in
 * lockstep with the Playwright version the daemon will load at runtime.
 */
export function resolveVendoredPlaywright(options: ResolveOptions = {}): PlaywrightInstall {
  const existsSync = options.existsSync || fs.existsSync;
  for (const packageRoot of candidatePackageRoots(options)) {
    const cliPath = path.join(packageRoot, 'node_modules', 'playwright', 'cli.js');
    if (!existsSync(cliPath)) continue;

    const pkg = readJson<{ version?: string }>(
      path.join(packageRoot, 'node_modules', 'playwright', 'package.json'),
      options.readFileSync,
    );
    const browsers = readJson<{ browsers?: Array<{ name: string; revision: string }> }>(
      path.join(packageRoot, 'node_modules', 'playwright-core', 'browsers.json'),
      options.readFileSync,
    );
    const chromiumRevision = browsers?.browsers?.find((browser) => browser.name === 'chromium')?.revision;
    const headlessShellRevision = browsers?.browsers?.find((browser) => browser.name === 'chromium-headless-shell')?.revision;
    return {
      cliPath,
      packageRoot,
      version: pkg?.version || BUILD_PLAYWRIGHT_VERSION,
      chromiumRevision: chromiumRevision || BUILD_CHROMIUM_REVISION,
      headlessShellRevision: headlessShellRevision || chromiumRevision || BUILD_HEADLESS_SHELL_REVISION,
    };
  }
  return {
    version: BUILD_PLAYWRIGHT_VERSION,
    chromiumRevision: BUILD_CHROMIUM_REVISION,
    headlessShellRevision: BUILD_HEADLESS_SHELL_REVISION,
  };
}

export function playwrightBrowserDirectory(
  env: Record<string, string | undefined> = process.env,
  packageRoot?: string,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string {
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  if (configured === '0') {
    if (!packageRoot) throw new Error('Cannot resolve PLAYWRIGHT_BROWSERS_PATH=0 without the vendored Playwright package.');
    return path.join(packageRoot, 'node_modules', 'playwright-core', '.local-browsers');
  }
  if (configured) return path.resolve(env.INIT_CWD || process.cwd(), configured);
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'ms-playwright');
  return path.join(env.XDG_CACHE_HOME || path.join(homeDir, '.cache'), 'ms-playwright');
}

export function expectedHeadlessExecutable(
  browserDirectory: string,
  revision: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === 'darwin') {
    const suffix = arch === 'arm64' ? 'arm64' : 'x64';
    return path.join(browserDirectory, `chromium_headless_shell-${revision}`, `chrome-headless-shell-mac-${suffix}`, 'chrome-headless-shell');
  }
  if (platform === 'win32') {
    return path.join(browserDirectory, `chromium_headless_shell-${revision}`, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  }
  if (platform === 'linux') {
    const executable = arch === 'arm64' ? ['chrome-linux', 'headless_shell'] : ['chrome-headless-shell-linux64', 'chrome-headless-shell'];
    return path.join(browserDirectory, `chromium_headless_shell-${revision}`, ...executable);
  }
  return null;
}

/** Playwright selects chromium-headless-shell for chromium.launch({ headless: true }). */
export function isRegularExecutableFile(file: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && (platform === 'win32' || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

export function isHeadlessBrowserReady(
  install: PlaywrightInstall,
  env: Record<string, string | undefined> = process.env,
  isReadyFile?: (file: string) => boolean,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  homeDir: string = os.homedir(),
): boolean {
  const fileIsReady = isReadyFile || ((file: string) => isRegularExecutableFile(file, platform));
  const explicitBrowser = env.ABX_CHROMIUM_PATH;
  if (explicitBrowser) return fileIsReady(explicitBrowser);
  const browserDirectory = playwrightBrowserDirectory(env, install.packageRoot, platform, homeDir);
  const executable = expectedHeadlessExecutable(browserDirectory, install.headlessShellRevision, platform, arch);
  return executable !== null && fileIsReady(executable);
}

/** Build a version-pinned package-runner fallback when abx's own CLI is absent. */
export function playwrightFallbackCommand(
  runner: 'bunx' | 'npx',
  executable: string,
  version: string,
): string[] {
  const packageName = `playwright@${version}`;
  return runner === 'bunx'
    ? [executable, packageName, 'install', 'chromium']
    : [executable, '--yes', packageName, 'install', 'chromium'];
}
