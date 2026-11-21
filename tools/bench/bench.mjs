// 게임 벤치마크 CLI(2026-11-21). 1호 환경은 푸딩 탈출이다. 계약: docs/kaito-web/game-benchmark.md
// 실행(kaito_web/): node tools/bench/bench.mjs <명령> … 또는 npm run bench -- <명령> …
//   baselines [--seeds 1-40] [--mode segment|interval:8] [--agents random,fullCharge,oracle] [--json out.json]
//   run --agent "<명령>" [--seeds 1-10 | --seeds-file 경로] [--mode …] [--out 폴더] [--timeout 300]
//   verify <trace.json | summary.json …>
//   version
// Node 22.18+ 의 TypeScript 형 지우기로 src/sim 을 바로 읽는다. 확장자 없는 import 는 아래 훅이 `.ts` 를 붙인다(tools/pudding/measure-landings.mjs 와 같다).
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) { if (specifier.startsWith(".")) return next(`${specifier}.ts`, context); throw error; }
  },
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const B = await import(pathToFileURL(path.join(ROOT, "src/sim/bench/index.ts")).href);
const SUMMARY_FORMAT = "oddbout-bench-summary/1";
const BOOTSTRAP_RESAMPLES = 2000, BOOTSTRAP_SEED = 20261121;

/** 환경 판: 규칙 · 환경 소스(경로 차례)의 상대 경로와 내용을 sha256 에 넣은 앞 12 글자. */
function envVersion() {
  const dirs = ["src/sim/pudding", "src/sim/bench"];
  const files = [...dirs.flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith(".ts")).map(f => `${d}/${f}`)), "src/sim/rng.ts", "src/sim/types.ts"].sort();
  const h = createHash("sha256");
  for (const f of files) { h.update(f); h.update("\0"); h.update(fs.readFileSync(path.join(ROOT, f))); h.update("\0"); }
  return h.digest("hex").slice(0, 12);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true; else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/** "1-40" · "1,3,5-7" 를 시드 목록으로. */
function parseSeeds(spec) {
  const seeds = [];
  for (const part of String(spec).split(",").map(p => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad seed range: ${part}`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    for (let s = a; s <= b; s++) seeds.push(s);
  }
  if (!seeds.length) throw new Error("no seeds");
  return seeds;
}
/** 비공개 시드 파일: JSON 배열이거나 쉼표 · 공백 · 줄로 나눈 정수. */
function readSeedsFile(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  const list = text.startsWith("[") ? JSON.parse(text) : text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!list.length || !list.every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error(`seeds file must hold non-negative integers: ${file}`);
  return list;
}

const median = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const quantile = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

/** 시드 위 중앙값의 부트스트랩 95% 구간(시드 PRNG mulberry32, 시드 `BOOTSTRAP_SEED`, `BOOTSTRAP_RESAMPLES` 번). */
function bootstrapMedianCI(values) {
  let a = BOOTSTRAP_SEED >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const meds = [];
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) meds.push(median(values.map(() => values[Math.floor(rnd() * values.length)])));
  meds.sort((x, y) => x - y);
  return [meds[Math.floor(0.025 * meds.length)], meds[Math.min(meds.length - 1, Math.floor(0.975 * meds.length))]];
}

function summarize(results) {
  const scores = results.map(r => r.score), st = k => results.reduce((n, r) => n + r.stats[k], 0);
  const landings = st("landings") || 1;
  return {
    runs: results.length, median: median(scores), mean: Math.round(mean(scores) * 10) / 10, p90: quantile(scores, 0.9),
    ci95: bootstrapMedianCI(scores), perfectPct: Math.round(1000 * st("perfect") / landings) / 10, splatPct: Math.round(1000 * st("splat") / landings) / 10,
    decisionsPerRun: Math.round(mean(results.map(r => r.decisions))), invalidActions: results.reduce((n, r) => n + r.invalidActions, 0),
    reachedCap: results.filter(r => !r.stats.caught).length,
  };
}

function tableRow(name, s) {
  return { agent: name, runs: s.runs, "median m": s.median, "mean m": s.mean, "p90 m": s.p90, "95% CI (median)": `${s.ci95[0]}..${s.ci95[1]}`,
    "PERFECT %": s.perfectPct, "SPLAT %": s.splatPct, "decisions/run": s.decisionsPerRun, "300 s cap": s.reachedCap };
}

function cmdBaselines(args) {
  const seeds = parseSeeds(args.seeds ?? "1-40"), mode = String(args.mode ?? "segment"), version = envVersion();
  const env = new B.PuddingBenchEnv({ envVersion: version, actionMode: mode });
  const agents = String(args.agents ?? (env.mode.kind === "segment" ? "random,fullCharge,oracle" : "random,fullCharge")).split(",");
  const rows = [], json = { game: B.PUDDING_GAME, envVersion: version, actionMode: env.actionMode, seeds, agents: {} };
  for (const name of agents) {
    const t0 = performance.now(), results = [];
    for (const seed of seeds) results.push(B.runPuddingBaseline(name, seed, { envVersion: version, actionMode: mode }).result);
    const s = summarize(results);
    rows.push({ ...tableRow(name, s), "wall s": Math.round((performance.now() - t0) / 100) / 10 });
    json.agents[name] = { summary: s, results };
  }
  console.log(`${B.PUDDING_GAME} env ${version}, mode ${env.actionMode}, seeds ${args.seeds ?? "1-40"} (${seeds.length})`);
  console.table(rows);
  if (typeof args.json === "string") { fs.writeFileSync(args.json, `${JSON.stringify(json, null, 2)}\n`); console.log(`wrote ${args.json}`); }
}

/** 에이전트 프로세스와 JSON 줄로 말한다. 줄마다 하나의 JSON 객체다. */
class AgentProcess {
  constructor(command) {
    this.child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "inherit"], cwd: process.cwd() });
    this.lines = []; this.waiters = []; this.closed = false;
    createInterface({ input: this.child.stdout }).on("line", line => {
      if (!line.trim()) return;
      const w = this.waiters.shift();
      if (w) w(line); else this.lines.push(line);
    });
    this.child.on("exit", () => { this.closed = true; for (const w of this.waiters.splice(0)) w(null); });
    this.child.stdin.on("error", () => { this.closed = true; });
  }
  send(msg) { if (!this.closed) this.child.stdin.write(`${JSON.stringify(msg)}\n`); }
  /** 다음 줄(시간이 지나거나 프로세스가 끝나면 null). */
  next(timeoutMs) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    if (this.closed) return Promise.resolve(null);
    return new Promise(resolve => {
      const waiter = line => { clearTimeout(timer); resolve(line); };
      const timer = setTimeout(() => { const i = this.waiters.indexOf(waiter); if (i >= 0) this.waiters.splice(i, 1); resolve(null); }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  async stop() {
    this.send({ type: "end" });
    this.child.stdin.end();
    await new Promise(resolve => { if (this.closed) resolve(); else { const t = setTimeout(() => { this.child.kill(); resolve(); }, 2000); this.child.on("exit", () => { clearTimeout(t); resolve(); }); } });
  }
}

/**
 * 결정 하나의 행동을 받는다. 답 줄에 `step` 이 있으면 지금 결정 번호와 같아야 한다(시간이 지난 늦은 답을 버린다).
 * 시간이 지나거나 · 프로세스가 끝나거나 · JSON 이 아니면 null(잘못된 행동 → 빈 행동)을 돌려준다.
 */
async function readAction(agent, step, deadline) {
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return { action: null, timeout: true };
    const line = await agent.next(left);
    if (line === null) return { action: null, timeout: !agent.closed };
    let msg;
    try { msg = JSON.parse(line); } catch { return { action: null, timeout: false }; }
    if (msg && typeof msg === "object" && "step" in msg && msg.step !== step) continue;
    return { action: msg && typeof msg === "object" && "action" in msg ? msg.action : null, timeout: false };
  }
}

async function cmdRun(args) {
  if (typeof args.agent !== "string") throw new Error("run needs --agent \"<command>\"");
  const seeds = typeof args["seeds-file"] === "string" ? readSeedsFile(args["seeds-file"]) : parseSeeds(args.seeds ?? B.PUDDING_PRACTICE_SEEDS.join(","));
  const version = envVersion(), mode = String(args.mode ?? "segment"), timeoutMs = Number(args.timeout ?? 300) * 1000;
  const outDir = path.resolve(String(args.out ?? `bench-out/${B.PUDDING_GAME}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  fs.mkdirSync(outDir, { recursive: true });
  const env = new B.PuddingBenchEnv({ envVersion: version, actionMode: mode });
  const agent = new AgentProcess(args.agent);
  const rules = B.puddingRules(env.mode), results = [], traces = [];
  let timeouts = 0;
  for (const seed of seeds) {
    let obs = env.reset(seed), step = 0;
    agent.send({ type: "reset", game: B.PUDDING_GAME, seed, track: env.track, actionMode: env.actionMode, envVersion: version, rules });
    while (!env.isDone()) {
      agent.send({ type: "obs", step, obs });
      const { action, timeout } = await readAction(agent, step, Date.now() + timeoutMs);
      if (timeout) timeouts++;
      obs = env.step(action).obs;
      step++;
    }
    const result = env.result(), trace = env.trace(), file = `trace-seed-${seed}.json`;
    agent.send({ type: "done", result });
    fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(trace)}\n`);
    results.push(result); traces.push(file);
    console.error(`seed ${seed}: ${result.score} m, ${result.decisions} decisions, ${result.invalidActions} invalid`);
  }
  await agent.stop();
  const summary = {
    format: SUMMARY_FORMAT, game: B.PUDDING_GAME, envVersion: version, track: env.track, actionMode: env.actionMode, agent: args.agent,
    createdAt: new Date().toISOString(), timeouts, bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED },
    ...summarize(results), episodes: results.map((r, i) => ({ seed: r.seed, score: r.score, trace: traces[i], result: r })),
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`median ${summary.median} m (95% CI ${summary.ci95[0]}..${summary.ci95[1]}), ${seeds.length} seeds, ${summary.invalidActions} invalid, ${timeouts} timeouts`);
  console.log(`wrote ${outDir}`);
}

/** 기록 하나를 다시 돌린다. 문제가 있으면 { error } . */
function verifyTrace(trace, version) {
  if (!trace || typeof trace !== "object") return { error: "not an object" };
  if (trace.format !== B.BENCH_TRACE_FORMAT) return { error: `format ${trace.format} is not ${B.BENCH_TRACE_FORMAT}` };
  if (trace.game !== B.PUDDING_GAME) return { error: `unknown game ${trace.game}` };
  if (trace.envVersion !== version) return { error: `envVersion ${trace.envVersion} does not match this checkout (${version})`, versionMismatch: true };
  if (!Number.isSafeInteger(trace.seed) || trace.seed < 0) return { error: "bad seed" };
  if (trace.track !== "state") return { error: `track ${trace.track} is not supported` };
  if (!B.parsePuddingActionMode(String(trace.actionMode))) return { error: `bad actionMode ${trace.actionMode}` };
  try { return { result: B.replay(B.puddingEnvFor(trace, version), trace) }; }
  catch (error) { return { error: String(error?.message ?? error) }; }
}

function cmdVerify(args) {
  const version = envVersion();
  let failed = false;
  const say = (file, msg) => console.log(`${file}: ${msg}`);
  for (const file of args._) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { failed = true; say(file, `cannot read JSON (${error.message})`); continue; }
    const items = doc?.format === SUMMARY_FORMAT
      ? (doc.episodes ?? []).map(e => ({ file: path.join(path.dirname(file), String(e.trace)), claimed: e.score }))
      : [{ file, claimed: undefined, doc }];
    if (doc?.format === SUMMARY_FORMAT && doc.envVersion !== version) { failed = true; say(file, `summary envVersion ${doc.envVersion} does not match ${version}`); }
    const scores = [];
    for (const item of items) {
      let trace = item.doc;
      if (!trace) { try { trace = JSON.parse(fs.readFileSync(item.file, "utf8")); } catch (error) { failed = true; say(item.file, `cannot read trace (${error.message})`); continue; } }
      const r = verifyTrace(trace, version);
      if (r.error) { failed = true; say(item.file, `FAIL ${r.error}`); continue; }
      scores.push(r.result.score);
      const mismatch = item.claimed !== undefined && item.claimed !== r.result.score;
      if (mismatch) failed = true;
      say(item.file, `${mismatch ? "MISMATCH" : "OK"} seed ${trace.seed} ${r.result.score} m${item.claimed !== undefined ? ` (claimed ${item.claimed})` : ""}, `
        + `${r.result.decisions} decisions, ${r.result.invalidActions} invalid, ${JSON.stringify(r.result.stats)}`);
    }
    if (doc?.format === SUMMARY_FORMAT && scores.length) {
      const med = median(scores), ok = med === doc.median;
      if (!ok) failed = true;
      say(file, `${ok ? "OK" : "MISMATCH"} median ${med} m (claimed ${doc.median}) over ${scores.length} traces`);
    }
  }
  if (!args._.length) { console.error("verify needs trace or summary files"); failed = true; }
  process.exitCode = failed ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2)), cmd = args._.shift();
if (cmd === "baselines") cmdBaselines(args);
else if (cmd === "run") await cmdRun(args);
else if (cmd === "verify") cmdVerify(args);
else if (cmd === "version") console.log(envVersion());
else {
  console.error("usage: bench.mjs baselines|run|verify|version …  (docs/kaito-web/game-benchmark.md)");
  process.exitCode = 2;
}
