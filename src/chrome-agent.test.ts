import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";

function stub(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

test("chrome-agent default profile stays outside retired project checkouts", () => {
  const dir = mkdtempSync(join(tmpdir(), "abx-chrome-default-"));
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", "-p", bin]);
  stub(bin, "curl", "exit 1");
  try {
    const result = spawnSync(resolve("scripts/chrome-agent"), ["status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${bin}:${process.env.PATH}`,
        AGENT_CHROME_PROFILE_DIR: "",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `profile=${join(dir, "Library/Application Support/Agent Chrome")}`,
    );
    expect(existsSync(join(dir, "Projects/farm"))).toBe(false);

    const override = spawnSync(resolve("scripts/chrome-agent"), ["status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${bin}:${process.env.PATH}`,
        AGENT_CHROME_PROFILE_DIR: join(dir, "custom-profile"),
      },
    });
    expect(override.status).toBe(1);
    expect(override.stdout).toContain(`profile=${join(dir, "custom-profile")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chrome-agent stop removes a submitted launchd job and its CDP process", () => {
  const dir = mkdtempSync(join(tmpdir(), "abx-chrome-agent-"));
  const bin = join(dir, "bin");
  const profile = join(dir, "profile");
  Bun.spawnSync(["mkdir", "-p", bin, profile]);
  const job = join(dir, "launch-job");
  const endpoint = join(dir, "cdp-endpoint");
  const log = join(dir, "launchctl.log");
  writeFileSync(job, "loaded\n");
  writeFileSync(endpoint, "up\n");

  stub(
    bin,
    "launchctl",
    `echo "$1" >> "${log}"
case "$1" in
  remove) rm -f "${job}" ;;
  bootout) rm -f "${job}" ;;
  print) [[ -f "${job}" ]] ;;
esac`,
  );
  stub(
    bin,
    "curl",
    `if [[ "$*" == *"/json/close"* ]]; then rm -f "${endpoint}"; exit 0; fi
[[ -f "${endpoint}" ]]`,
  );
  stub(bin, "pkill", `rm -f "${endpoint}"`);

  try {
    const result = spawnSync(resolve("scripts/chrome-agent"), ["stop"], {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        AGENT_CHROME_PROFILE_DIR: profile,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("chrome-agent: stopped");
    expect(readFileSync(log, "utf8")).toStartWith("remove\n");
    expect(existsSync(job)).toBe(false);
    expect(existsSync(endpoint)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
