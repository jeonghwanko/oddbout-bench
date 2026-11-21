import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactAgentCommand } from "../tools/bench/redact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCH = path.join(ROOT, "tools/bench/bench.mjs");

function runBench(args, extra) {
  const r = spawnSync(process.execPath, [BENCH, ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 60_000, input: extra?.input,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
}

const output = (r) => `${r.stdout}\n${r.stderr}`;

describe("bench CLI 리뷰 보강", () => {
  it("시드 0 은 parseSeeds 와 seeds-file 에서 거부한다", () => {
    const a = runBench(["baselines", "--seeds", "0-1", "--agents", "fullCharge"]);
    assert.notEqual(a.status, 0);
    assert.match(output(a), /0 is rejected|bad seed range/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-seeds-"));
    const file = path.join(dir, "seeds.txt");
    fs.writeFileSync(file, "0\n1\n");
    const b = runBench(["seeds-commit", file]);
    assert.notEqual(b.status, 0);
    assert.match(output(b), /0 is rejected/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("시드 1-2 는 받는다", () => {
    const r = runBench(["baselines", "--seeds", "1-2", "--agents", "fullCharge"]);
    assert.equal(r.status, 0, output(r));
    assert.match(r.stdout, /fullCharge/);
  });

  it("--official 은 interval 방식을 거부한다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-official-"));
    const file = path.join(dir, "seeds.txt");
    fs.writeFileSync(file, Array.from({ length: 50 }, (_, i) => i + 1).join("\n"));
    const r = runBench(["run", "--official", "--seeds-file", file, "--mode", "interval:8", "--agent", "true", "--out", path.join(dir, "out")]);
    assert.notEqual(r.status, 0);
    assert.match(output(r), /segment mode/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("compare 는 먼저 두 요약을 verify 하고, 가짜 요약은 실패한다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-compare-"));
    const fake = {
      format: "oddbout-bench-summary/2", game: "pudding-escape", envVersion: "deadbeefdead",
      track: "state", actionMode: "segment", capS: 90, score: 1, episodes: [],
    };
    const a = path.join(dir, "a.json"), b = path.join(dir, "b.json");
    fs.writeFileSync(a, `${JSON.stringify(fake)}\n`);
    fs.writeFileSync(b, `${JSON.stringify(fake)}\n`);
    const r = runBench(["compare", a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL|envVersion/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("요약의 agent 명령에서 API 키 모양을 가린다", () => {
    assert.equal(redactAgentCommand('ANTHROPIC_API_KEY=sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ node agent.mjs'), "ANTHROPIC_API_KEY=*** node agent.mjs");
    assert.equal(redactAgentCommand("node agent.mjs sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "node agent.mjs sk-ant-***");
    assert.equal(redactAgentCommand("node tools/bench/examples/claude-agent.mjs"), "node tools/bench/examples/claude-agent.mjs");
  });
});
