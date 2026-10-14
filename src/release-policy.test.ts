import { expect, test } from "bun:test";

test("native publication requires an affirmative manual request on main", async () => {
  const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as {
    on: Record<string, { inputs: { publish: { type: string; default: boolean } } }>;
    jobs: Record<string, { if: string }>;
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs.publish.type).toBe("boolean");
  expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
  for (const job of ["bump", "release"]) {
    const enabled = new Function("github", "inputs", `return Boolean(${workflow.jobs[job].if})`);
    for (const [ref, publish, expected] of [
      ["refs/heads/main", false, false],
      ["refs/heads/main", true, true],
      ["refs/heads/feature", true, false],
    ] as const) {
      expect(enabled({ repository: "edihasaj/abx", ref }, { publish })).toBe(expected);
    }
  }
});
