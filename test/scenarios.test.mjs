import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "tools", "bench", "scenarios.mjs");
const readJson = file => JSON.parse(readFileSync(file, "utf8"));

function command(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, expected, result.error?.message ?? result.stderr);
  return result;
}

test("같은 사례를 재현하고, 정확한 3초 결과만 검증하고 비교한다", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "pudding-judgment-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cases = path.join(dir, "cases.json"), duplicate = path.join(dir, "duplicate.json");
  for (const out of [cases, duplicate]) command(["build", "--per-category", "1", "--out", out]);
  assert.equal(readFileSync(cases, "utf8"), readFileSync(duplicate, "utf8"));
  const manifest = readJson(cases);
  assert.deepEqual(manifest.cases.map(row => row.category), ["ground", "air", "recovery", "chase"]);
  assert.equal(new Set(manifest.cases.map(row => row.seed)).size, 4);

  const result = path.join(dir, "result.json");
  const args = ["run", "--cases", cases, "--out", result, "--jobs", "2", "--", process.execPath, "tools/bench/examples/heuristic-agent.mjs"];
  command(args);
  assert.match(command(args, 1).stderr, /result file already exists/);
  const rows = readJson(result);
  assert.equal(rows.cases.length, 4);
  for (const row of rows.cases) {
    assert.equal(row.status, "ok");
    assert.ok(row.outcome.elapsedS <= 3);
    if (row.outcome.survived) assert.equal(row.outcome.elapsedS, 3);
  }
  command(["verify", "--cases", cases, result]);
  const report = JSON.parse(command(["compare", "--cases", cases, result, result]).stdout);
  assert.equal(report[0].group, "all");
  assert.equal(report[0].meanDifferenceM, 0);
  assert.deepEqual(report[0].distanceDifferenceCi95M, [0, 0]);

  rows.cases[0].outcome.distanceM += 1;
  const tampered = path.join(dir, "tampered.json");
  writeFileSync(tampered, JSON.stringify(rows));
  assert.match(command(["verify", "--cases", cases, tampered], 1).stderr, /replay mismatch/);
  assert.match(command(["compare", "--cases", cases, result, tampered], 1).stderr, /replay mismatch/);

  writeFileSync(duplicate, `${JSON.stringify(manifest)}\n`);
  assert.match(command(["verify", "--cases", duplicate, result], 1).stderr, /case set or format mismatch/);
});
