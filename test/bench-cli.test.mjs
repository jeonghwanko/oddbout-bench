import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactAgentArgv, redactAgentCommand } from "../tools/bench/redact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCH = path.join(ROOT, "tools/bench/bench.mjs");

function runBench(args, extra) {
  const r = spawnSync(process.execPath, [BENCH, ...args], {
    cwd: ROOT, encoding: "utf8", timeout: extra?.timeout ?? 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
}

const output = (r) => `${r.stdout}\n${r.stderr}`;
const writeJson = (file, doc) => fs.writeFileSync(file, JSON.stringify(doc));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

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
    assert.equal(redactAgentCommand('APP_TOKEN="a value with spaces" node agent.mjs'), "APP_TOKEN=*** node agent.mjs");
    assert.equal(redactAgentArgv(["node", "--api-key", "a value with spaces", "APP_TOKEN=a value with spaces"]), "node --api-key *** APP_TOKEN=***");
  });

  it("옵션이 잘못됐거나 시드 파일에 중복이 있으면 실행을 거절한다", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-options-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const seeds = path.join(dir, "seeds.txt");
    fs.writeFileSync(seeds, "1\n2\n1\n");
    for (const [args, diagnostic] of [
      [["seeds-commit", seeds], /seeds must not repeat/],
      [["run", "--official=true", "--", "node"], /unknown run option/],
      [["run", "--timeout", "1e12", "--", "node"], /at most/],
      [["baselines", "--seeds", "1", "--agents", "typo"], /unique names/],
    ]) {
      const run = runBench(args);
      assert.equal(run.status, 1, output(run));
      assert.match(run.stderr, diagnostic);
    }
  });

  it("에이전트 argv, 이전 판 답변, 긴 출력, 결과의 비밀 문자열을 처리한다", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-agent-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "test agent.mjs");
    const fakeKey = "sk-ant-test-example-not-a-real-key";
    fs.writeFileSync(file, `
      import { createInterface } from "node:readline";
      const arg = process.argv[2];
      if (arg !== "value with spaces & punctuation") process.exit(2);
      const send = msg => process.stdout.write(JSON.stringify(msg) + "\\n");
      const key = ${JSON.stringify(fakeKey)};
      send({ type: "meta", received: arg, nested: { [key]: key, password: "placeholder value" } });
      let episode, previousStep;
      createInterface({ input: process.stdin }).on("line", line => {
        const msg = JSON.parse(line);
        if (msg.type === "reset") episode = msg.episode;
        if (msg.type !== "obs") return;
        if (msg.step === 0) process.stdout.write("x".repeat(100_000) + "\\n");
        if (episode === 1) send({ step: previousStep, action: null });
        else previousStep ??= msg.step;
        const action = msg.obs.grounded ? { waitMs: 0, holdMs: 1000 } : { pressAfterMs: null };
        send({ step: msg.step, action: { ...action, info: key } });
      });
    `);
    const out = path.join(dir, "out");
    const run = runBench(["run", "--seeds", "1-2", "--out", out, "--timeout", "5", "--", process.execPath, file, "value with spaces & punctuation"]);
    assert.equal(run.status, 0, output(run));
    const summary = readJson(path.join(out, "summary.json"));
    assert.equal(summary.invalidActions, 0);
    assert.equal(summary.timeouts, 0);
    assert.equal(summary.agentMeta.received, "value with spaces & punctuation");
    assert.deepEqual(summary.agentMeta.nested, { "sk-ant-***": "sk-ant-***", password: "***" });
    for (const { trace } of summary.episodes) {
      const raw = fs.readFileSync(path.join(out, trace), "utf8");
      assert.match(raw, /sk-ant-\*\*\*/);
      assert.ok(!raw.includes(fakeKey));
    }
  });

  it("stdout 연결이 끊기면 남은 결정에서 응답을 기다리지 않는다", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-disconnect-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "agent.mjs");
    fs.writeFileSync(file, `
      if (process.platform === "win32") process.exit(1);
      process.stdout.destroy();
      setTimeout(() => {}, 15_000);
    `);
    const out = path.join(dir, "out");
    const run = runBench(["run", "--seeds", "1", "--out", out, "--timeout", "300", "--", process.execPath, file], { timeout: 10_000 });
    assert.equal(run.status, 1, output(run));
    const summary = readJson(path.join(out, "summary.json"));
    assert.deepEqual(summary.agentExited, { episode: 0, step: 0 });
    assert.equal(summary.timeouts, 0);
  });

  it("compare 와 verify 는 실제 요약의 시드 약속, bootstrap 및 경로를 확인한다", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oddbout-verify-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const seeds = path.join(dir, "seeds.txt");
    fs.writeFileSync(seeds, "1\n");
    const out = path.join(dir, "out");
    const run = runBench(["run", "--seeds-file", seeds, "--round", "test", "--out", out, "--", process.execPath, "tools/bench/examples/heuristic-agent.mjs"]);
    assert.equal(run.status, 0, output(run));
    const file = path.join(out, "summary.json");
    const summary = readJson(file);
    const valid = runBench(["compare", file, file]);
    assert.equal(valid.status, 0, output(valid));
    assert.match(valid.stdout, /paired seeds 1: mean normalized difference a − b = 0/);
    const altered = path.join(out, "altered.json");
    const external = path.join(dir, "external");
    fs.mkdirSync(external);
    const episode = summary.episodes[0];
    fs.copyFileSync(path.join(out, episode.trace), path.join(external, episode.trace));
    fs.symlinkSync(external, path.join(out, "linked"), process.platform === "win32" ? "junction" : "dir");
    for (const [doc, diagnostic] of [
      [{ ...summary, seedsCommit: { ...summary.seedsCommit, seeds: 2 } }, /seedsCommit does not match/],
      [{ ...summary, bootstrap: { ...summary.bootstrap, seed: 0 } }, /bootstrap settings/],
      [{ ...summary, official: true }, /official summary needs at least 50 seeds/],
      [{ ...summary, episodes: [{ ...episode, trace: `linked/${episode.trace}` }] }, /file inside the summary folder/],
    ]) {
      writeJson(altered, doc);
      const check = runBench(["verify", altered]);
      assert.equal(check.status, 1, output(check));
      assert.match(check.stdout, diagnostic);
    }
    const comparison = runBench(["compare", file, altered]);
    assert.equal(comparison.status, 1, output(comparison));
    assert.doesNotMatch(comparison.stdout, /paired seeds/);
  });
});
