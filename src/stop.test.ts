import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const children: ReturnType<typeof Bun.spawn>[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
    await child.exited;
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'abx-stop-'));
  directories.push(dir);
  const stateFile = join(dir, 'browse.json');
  const started = join(dir, 'unexpected-start');
  const serverScript = join(dir, 'should-not-start.ts');
  writeFileSync(serverScript, `await Bun.write(${JSON.stringify(started)}, 'started'); process.exit(1);`);
  const env = { ...process.env, BROWSE_STATE_FILE: stateFile, BROWSE_SERVER_SCRIPT: serverScript };
  return { dir, stateFile, started, env };
}

async function stop(f: ReturnType<typeof fixture>, args: string[] = []) {
  const cli = process.env.ABX_TEST_CLI ? [process.env.ABX_TEST_CLI] : [process.execPath, resolve('src/cli.ts')];
  const proc = Bun.spawn([...cli, ...args, 'stop'], {
    env: f.env, stdout: 'pipe', stderr: 'pipe',
  });
  children.push(proc);
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(existsSync(f.started)).toBe(false);
  return { code, stdout, stderr };
}

test('stop with no daemon never starts a browser, even with headed flags', async () => {
  const f = fixture();
  const result = await stop(f, ['--headed']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('not running');
  expect(existsSync(f.stateFile)).toBe(false);
});

test('stop with a stale daemon cleans its state without starting a browser', async () => {
  const f = fixture();
  const dead = Bun.spawn([process.execPath, '-e', 'process.exit(0)']);
  await dead.exited;
  writeFileSync(f.stateFile, JSON.stringify({ pid: dead.pid, port: 1, token: 'test' }));
  expect((await stop(f)).code).toBe(0);
  expect(existsSync(f.stateFile)).toBe(false);
});

async function daemon(f: ReturnType<typeof fixture>, mode: 'close' | 'response' | 'refuse') {
  const script = join(f.dir, 'fake-daemon.ts');
  writeFileSync(script, `
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      if (req.headers.get('Authorization') !== 'Bearer test') return new Response('bad token', { status: 401 });
      const body = await req.json();
      if (body.command !== 'stop') return new Response('unexpected command', { status: 400 });
      if (${JSON.stringify(mode)} === 'refuse') return new Response('denied', { status: 403 });
      if (${JSON.stringify(mode)} === 'close') process.exit(0);
      setTimeout(() => process.exit(0), 100);
      return new Response('Server stopped');
    }});
    await Bun.write(${JSON.stringify(f.stateFile)}, JSON.stringify({ pid: process.pid, port: server.port, token: 'test', binaryVersion: 'old-version' }));
  `);
  const proc = Bun.spawn([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' });
  children.push(proc);
  const deadline = Date.now() + 3000;
  while (!existsSync(f.stateFile) && Date.now() < deadline) await Bun.sleep(10);
  expect(existsSync(f.stateFile)).toBe(true);
  return proc;
}

for (const mode of ['close', 'response'] as const) {
  test(`stop succeeds when the daemon shuts down ${mode === 'close' ? 'before' : 'after'} its response`, async () => {
    const f = fixture();
    const proc = await daemon(f, mode);
    const result = await stop(f);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Server stopped');
    expect(result.stderr).not.toContain('Restarting');
    expect(result.stderr).not.toContain('crashed twice');
    expect(await proc.exited).toBe(0);
    expect(existsSync(f.stateFile)).toBe(false);
  });
}

test('a refused stop preserves the daemon and its state', async () => {
  const f = fixture();
  const proc = await daemon(f, 'refuse');
  const before = readFileSync(f.stateFile, 'utf8');
  const result = await stop(f);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('403');
  expect(proc.exitCode).toBe(null);
  expect(readFileSync(f.stateFile, 'utf8')).toBe(before);
});
