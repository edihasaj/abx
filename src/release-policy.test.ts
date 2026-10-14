import { expect, test } from "bun:test";

test("native publication requires an affirmative manual request on production", async () => {
  const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as {
    on: Record<string, { inputs: { publish: { type: string; default: boolean }; run_native: { type: string; default: boolean } } }>;
    jobs: Record<string, { if: string }>;
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs.publish.type).toBe("boolean");
  expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
  expect(workflow.on.workflow_dispatch.inputs.run_native.default).toBe(false);
  for (const job of ["bump", "release"]) {
    const enabled = new Function("github", "inputs", `return Boolean(${workflow.jobs[job].if})`);
    for (const [ref, publish, run_native, expected] of [
      ["refs/heads/main", false, false, false],
      ["refs/heads/main", true, true, false],
      ["refs/heads/production", true, false, false],
      ["refs/heads/production", true, true, true],
      ["refs/heads/feature", true, true, false],
    ] as const) {
      expect(enabled({ event_name: "workflow_dispatch", repository: "edihasaj/abx", ref }, { publish, run_native })).toBe(expected);
    }
  }
});
