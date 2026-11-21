// 게임 벤치마크 CLI(2026-11-21). 1호 환경은 푸딩 탈출이다. 계약: docs/kaito-web/game-benchmark.md
// 실행(저장소 루트): node tools/bench/bench.mjs <명령> … 또는 npm run bench -- <명령> …
//   baselines [--seeds 1-50] [--mode segment|interval:8] [--agents random,fullCharge,oracle] [--json out.json]
//   run [--seeds 1-10 | --seeds-file 경로 [--round 이름]] [--official] [--mode …] [--out 폴더] [--timeout 300] -- 실행파일 [인수 …]
//   verify <trace.json | summary.json …> [--seeds-file 경로] [--official]
//   compare <a/summary.json> <b/summary.json>
//   seeds-commit <seeds-file> [--round 이름]
//   version
// Node 22.18+ 의 TypeScript 형 지우기로 src/sim 을 바로 읽는다. 확장자 없는 import 는 register-ts.mjs 훅이 `.ts` 를 붙인다.
import "./register-ts.mjs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { benchEnvVersion } from "./sources.mjs";
import { redactAgentArgv, redactAgentCommand } from "./redact.mjs";
import { AgentProcess } from "./agent-process.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const B = await import(pathToFileURL(path.join(ROOT, "src/sim/bench/index.ts")).href);
const SUMMARY_FORMAT = "oddbout-bench-summary/2";
const BOOTSTRAP = { resamples: B.BOOTSTRAP_RESAMPLES, seed: B.BOOTSTRAP_SEED };
const COMMAND_OPTIONS = new Map([
  ["baselines", ["seeds", "mode", "agents", "json"]],
  ["run", ["agent", "seeds", "seeds-file", "round", "mode", "out", "timeout", "official"]],
  ["verify", ["seeds-file", "official"]],
  ["compare", []],
  ["seeds-commit", ["round"]],
  ["version", []],
]);

/** 환경 판: 벤치 import 닫힘의 상대 경로와 내용을 sha256 에 넣은 앞 12 글자(`sources.mjs`). */
const envVersion = () => benchEnvVersion(ROOT);
const isSeed = n => Number.isSafeInteger(n) && n >= B.PUDDING_SEED_MIN && n <= B.PUDDING_SEED_MAX;

function parseArgs(cmd, argv) {
  const out = { _: [], agentArgv: [] };
  const options = COMMAND_OPTIONS.get(cmd);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" && cmd === "run") { out.agentArgv = argv.slice(i + 1); break; }
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    if (!options.includes(key)) throw new Error(`unknown ${cmd} option: ${a}`);
    if (Object.hasOwn(out, key)) throw new Error(`repeated option: ${a}`);
    if (key === "official") { out.official = true; continue; }
    const next = argv[++i];
    if (next === undefined || next.startsWith("--")) throw new Error(`${a} needs a value`);
    out[key] = next;
  }
  if (out._.length && (cmd === "run" || cmd === "baselines" || cmd === "version")) {
    throw new Error(`${cmd} does not take positional arguments before --`);
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
    if (!isSeed(a) || !isSeed(b) || b < a || b - a > 100000) throw new Error(`bad seed range: ${part} (seeds are ${B.PUDDING_SEED_MIN}..${B.PUDDING_SEED_MAX}, 0 is rejected)`);
    for (let s = a; s <= b; s++) seeds.push(s);
  }
  if (!seeds.length) throw new Error("no seeds");
  if (new Set(seeds).size !== seeds.length) throw new Error("seeds must not repeat");
  return seeds;
}
/** 비공개 시드 파일: JSON 배열이거나 쉼표 · 공백 · 줄로 나눈 정수. */
function readSeedsFile(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  const list = text.startsWith("[") ? JSON.parse(text) : text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!Array.isArray(list) || !list.length || !list.every(isSeed)) throw new Error(`seeds file must hold integers ${B.PUDDING_SEED_MIN}..${B.PUDDING_SEED_MAX} (0 is rejected): ${file}`);
  if (new Set(list).size !== list.length) throw new Error(`seeds must not repeat: ${file}`);
  return list;
}

/** 시드 회차 약속: 정렬한 시드 목록과 회차 이름의 sha256(`seedsCommitText`). */
function seedsCommit(seeds, round) {
  return { round, seeds: new Set(seeds).size, sha256: createHash("sha256").update(B.seedsCommitText(seeds, round)).digest("hex") };
}

/** 판 결과들의 정규화 점수와 기준 거리(segment 방식 기준 봇, 캐시). */
function scoreRuns(results) {
  return results.map(r => { const ref = B.puddingReference(r.seed); return { ref, normalized: B.puddingNormalizedScore(r.score, ref) }; });
}
/** 요약 칸(`summarizeRuns`). 기준 봇을 돌려 정규화 점수를 낸다. */
function summarize(results) {
  const scored = scoreRuns(results);
  return { stats: B.summarizeRuns(results, scored.map(x => x.normalized)), scored };
}

const fmtCi = ci => ci ? `${ci[0]}..${ci[1]}` : "-";
function tableRow(name, s) {
  return { agent: name, runs: s.runs, score: s.score, "score 95% CI": fmtCi(s.scoreCi95), "escape %": s.escapePct, "PERFECT %": s.perfectPct,
    "SPLAT %": s.splatPct, "invalid %": s.invalidPct, "median m": s.medianDistance, "mean m": s.meanDistance, "decisions/run": s.decisionsPerRun };
}

function cmdBaselines(args) {
  const seedSpec = String(args.seeds ?? "1-50"), seeds = parseSeeds(seedSpec), mode = String(args.mode ?? "segment"), version = envVersion();
  const env = new B.PuddingBenchEnv({ envVersion: version, actionMode: mode });
  const available = B.PUDDING_BASELINES.filter(name => env.mode.kind === "segment" || name !== "oracle");
  const agents = (args.agents ?? available.join(",")).split(",");
  if (agents.some(name => !available.includes(name)) || new Set(agents).size !== agents.length) {
    throw new Error(`--agents needs unique names from ${available.join(",")}`);
  }
  const rows = [], json = { game: B.PUDDING_GAME, envVersion: version, actionMode: env.actionMode, capS: B.PUDDING_CAP_S, seeds, agents: {} };
  const tr = performance.now();
  for (const seed of seeds) B.puddingReference(seed);      // 정규화 기준(segment 방식 random · oracle)을 먼저 돌려 둔다
  const refWall = Math.round((performance.now() - tr) / 100) / 10;
  for (const name of agents) {
    const t0 = performance.now(), results = [];
    for (const seed of seeds) {
      // segment 방식의 기준 봇은 정규화 기준과 같은 판이다(캐시를 같이 쓴다)
      results.push(env.mode.kind === "segment" ? B.puddingBaselineResult(name, seed) : B.runPuddingBaseline(name, seed, { envVersion: version, actionMode: mode }).result);
    }
    const { stats } = summarize(results);
    rows.push({ ...tableRow(name, stats), "wall s": Math.round((performance.now() - t0) / 100) / 10 });
    json.agents[name] = { summary: stats, results };
  }
  console.log(`${B.PUDDING_GAME} env ${version}, mode ${env.actionMode}, cap ${B.PUDDING_CAP_S} s, seeds ${seedSpec} (${seeds.length})`);
  console.log(`reference bots (segment random · oracle): ${refWall} s wall`);
  console.table(rows);
  if (typeof args.json === "string") { fs.writeFileSync(args.json, `${JSON.stringify(json, null, 2)}\n`); console.log(`wrote ${args.json}`); }
}

async function cmdRun(args) {
  if (args.agentArgv.length ? args.agent !== undefined : typeof args.agent !== "string" || !args.agent.trim()) {
    throw new Error("run needs an executable after -- or a legacy --agent command");
  }
  const seedsFile = typeof args["seeds-file"] === "string" ? args["seeds-file"] : null;
  if (seedsFile !== null && args.seeds !== undefined) throw new Error("choose --seeds or --seeds-file");
  const seeds = seedsFile ? readSeedsFile(seedsFile) : parseSeeds(args.seeds ?? B.PUDDING_PRACTICE_SEEDS.join(","));
  const official = args.official === true, round = typeof args.round === "string" ? args.round : null;
  if (official && seeds.length < B.OFFICIAL_MIN_SEEDS) throw new Error(`--official needs at least ${B.OFFICIAL_MIN_SEEDS} seeds (got ${seeds.length})`);
  if (official && !seedsFile) throw new Error("--official needs --seeds-file (private evaluation seeds)");
  if (round !== null && !seedsFile) throw new Error("--round needs --seeds-file");
  const timeoutS = Number(args.timeout ?? 300);
  if (!Number.isFinite(timeoutS) || timeoutS <= 0 || timeoutS * 1000 > 2_147_483_647) {
    throw new Error("--timeout must be greater than 0 and at most 2147483.647 seconds");
  }
  const version = envVersion(), mode = String(args.mode ?? "segment"), timeoutMs = timeoutS * 1000;
  const outDir = path.resolve(String(args.out ?? `bench-out/${B.PUDDING_GAME}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const env = new B.PuddingBenchEnv({ envVersion: version, actionMode: mode });
  if (official && env.mode.kind !== "segment") throw new Error("--official needs segment mode (interval is reference only, not ranked)");
  fs.mkdirSync(outDir, { recursive: true });
  const agent = new AgentProcess(args.agent, args.agentArgv);
  const rules = B.puddingRules(env.mode), results = [], traces = [];
  let timeouts = 0, agentExited = null, step = 0;
  try {
    for (const [episode, seed] of seeds.entries()) {
      let obs = env.reset(seed);
      // 시드는 에이전트에게 보내지 않는다(판 번호만). 기록 파일에는 시드가 남는다.
      agent.send({ type: "reset", game: B.PUDDING_GAME, episode, track: env.track, actionMode: env.actionMode, envVersion: version, rules });
      while (!env.isDone()) {
        const { action, timeout, exited } = await agent.readAction(step, obs, timeoutMs);
        if (timeout) timeouts++;
        if (exited && !agentExited) agentExited = { episode, step };
        obs = env.step(action).obs;
        step++;
      }
      const result = env.result(), trace = env.trace(), file = `trace-seed-${seed}.json`;
      const { seed: _seed, ...shown } = result;
      agent.send({ type: "done", episode, result: shown });
      fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(trace)}\n`);
      results.push(result); traces.push(file);
      console.error(`seed ${seed}: ${result.score} m, ${result.decisions} decisions, ${result.invalidActions} invalid`);
    }
  } finally {
    await agent.stop();
  }
  const { stats, scored } = summarize(results);
  const summary = {
    format: SUMMARY_FORMAT, game: B.PUDDING_GAME, envVersion: version, track: env.track, actionMode: env.actionMode, capS: B.PUDDING_CAP_S,
    official, seedsCommit: seedsFile ? seedsCommit(seeds, round) : null,
    agent: args.agentArgv.length ? redactAgentArgv(args.agentArgv) : redactAgentCommand(args.agent),
    createdAt: new Date().toISOString(), nodeVersion: process.version, timeouts, agentExited,
    agentMeta: agent.meta, ...(agent.metaTruncated ? { agentMetaTruncated: true } : {}),
    bootstrap: BOOTSTRAP,
    ...stats,
    episodes: results.map((r, i) => ({ seed: r.seed, score: r.score, normalized: scored[i].normalized, reference: scored[i].ref, trace: traces[i], result: r })),
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`score ${summary.score} (95% CI ${fmtCi(summary.scoreCi95)}), escape ${summary.escapePct}%, PERFECT ${summary.perfectPct}%, `
    + `median ${summary.medianDistance} m, ${seeds.length} seeds, ${summary.invalidActions} invalid, ${timeouts} timeouts`
    + (env.mode.kind === "segment" ? "" : " (interval mode: reference only, not ranked)"));
  console.log(`wrote ${outDir}`);
  if (agentExited) {
    console.error(`agent exited at episode ${agentExited.episode}, step ${agentExited.step}; the remaining decisions were invalid`);
    process.exitCode = 1;
  }
}

/** 기록 하나를 다시 돌린다. 문제가 있으면 { error } . */
function verifyTrace(trace, version) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) return { error: "not an object" };
  if (trace.format !== B.BENCH_TRACE_FORMAT) return { error: `format ${trace.format} is not ${B.BENCH_TRACE_FORMAT}` };
  if (trace.game !== B.PUDDING_GAME) return { error: `unknown game ${trace.game}` };
  if (trace.envVersion !== version) return { error: `envVersion ${trace.envVersion} does not match this checkout (${version})`, versionMismatch: true };
  if (!isSeed(trace.seed)) return { error: "bad seed" };
  if (trace.track !== "state") return { error: `track ${trace.track} is not supported` };
  if (!B.parsePuddingActionMode(String(trace.actionMode))) return { error: `bad actionMode ${trace.actionMode}` };
  try { return { result: B.replay(B.puddingEnvFor(trace, version), trace) }; }
  catch (error) { return { error: String(error?.message ?? error) }; }
}

/** 요약 폴더 안의 일반 파일만 받는다. */
function traceFileIn(dir, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
  const full = fs.realpathSync(path.resolve(dir, rel));
  const relative = path.relative(dir, full);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return fs.statSync(full).isFile() ? full : null;
}

/** 요약 하나: 칸 확인 → 기록마다 다시 돌리기 → 통계 다시 계산과 비교. 실패 까닭 목록을 돌려준다. */
function verifySummary(file, doc, version, seedSet, official, say) {
  const fails = [], dir = fs.realpathSync(path.dirname(path.resolve(file)));
  const fail = msg => { fails.push(msg); say(file, `FAIL ${msg}`); };
  if (doc.game !== B.PUDDING_GAME) fail(`game ${doc.game} is not ${B.PUDDING_GAME}`);
  if (doc.envVersion !== version) fail(`summary envVersion ${doc.envVersion} does not match ${version}`);
  if (doc.track !== "state") fail(`track ${doc.track} is not supported`);
  const mode = B.parsePuddingActionMode(String(doc.actionMode));
  if (!mode || B.actionModeName(mode) !== doc.actionMode) fail(`bad actionMode ${doc.actionMode}`);
  if (doc.capS !== B.PUDDING_CAP_S) fail(`capS ${doc.capS} is not ${B.PUDDING_CAP_S}`);
  if (!isDeepStrictEqual(doc.bootstrap, BOOTSTRAP)) fail("bootstrap settings do not match this checkout");
  if (typeof doc.official !== "boolean") fail("official must be a boolean");
  if (official && doc.official !== true) fail("summary is not an official run (--official)");
  const episodes = Array.isArray(doc.episodes) ? doc.episodes : [];
  if (!episodes.length) fail("summary has no episodes");
  if (doc.official === true) {
    if (doc.actionMode !== "segment") fail(`--official needs segment mode (got ${doc.actionMode})`);
    if (episodes.length < B.OFFICIAL_MIN_SEEDS) fail(`official summary needs at least ${B.OFFICIAL_MIN_SEEDS} seeds`);
    if (doc.seedsCommit == null) fail("official summary has no seedsCommit");
  }
  if (fails.length) return fails;
  const results = [], seenFiles = new Set(), seenSeeds = new Set();
  for (const [i, e] of episodes.entries()) {
    const where = `episode ${i}`;
    if (!e || typeof e !== "object") { fail(`${where}: not an object`); continue; }
    let tf;
    try { tf = traceFileIn(dir, e.trace); } catch { fail(`${where}: cannot read trace ${e.trace}`); continue; }
    if (!tf) { fail(`${where}: trace path must be relative and point to a file inside the summary folder: ${e.trace}`); continue; }
    if (seenFiles.has(tf)) { fail(`${where}: trace ${e.trace} is listed twice`); continue; }
    seenFiles.add(tf);
    if (typeof e.score !== "number") { fail(`${where}: score is missing`); continue; }
    let trace;
    try { trace = JSON.parse(fs.readFileSync(tf, "utf8")); } catch { fail(`${where}: cannot read trace ${e.trace}`); continue; }
    const r = verifyTrace(trace, version);
    if (r.error) { fail(`${where} (${e.trace}): ${r.error}`); continue; }
    if (trace.actionMode !== doc.actionMode) { fail(`${where}: trace actionMode ${trace.actionMode} is not the summary's ${doc.actionMode}`); continue; }
    if (e.seed !== trace.seed) { fail(`${where}: seed ${e.seed} is not the trace's seed ${trace.seed}`); continue; }
    if (seenSeeds.has(trace.seed)) { fail(`${where}: seed ${trace.seed} is listed twice`); continue; }
    seenSeeds.add(trace.seed);
    const ref = B.puddingReference(trace.seed), normalized = B.puddingNormalizedScore(r.result.score, ref);
    const ok = e.score === r.result.score && isDeepStrictEqual(e.result, r.result)
      && isDeepStrictEqual(e.reference, ref) && e.normalized === normalized;
    if (!ok) fail(`${where}: claimed score ${e.score} / normalized ${e.normalized} / reference / result do not match the replay (${r.result.score} m, normalized ${normalized})`);
    say(tf, `${ok ? "OK" : "MISMATCH"} seed ${trace.seed} ${r.result.score} m, normalized ${normalized} (claimed ${e.normalized}), ${r.result.decisions} decisions, ${r.result.invalidActions} invalid`);
    results.push(r.result);
  }
  if (seedSet && !isDeepStrictEqual(new Set(seedSet), seenSeeds)) {
    fail("trace seeds do not match the seeds file");
  }
  if (!fails.length && doc.seedsCommit !== null) {
    const round = typeof doc.seedsCommit?.round === "string" ? doc.seedsCommit.round : null;
    if (!isDeepStrictEqual(doc.seedsCommit, seedsCommit([...seenSeeds], round))) fail("seedsCommit does not match the replayed seeds");
  }
  if (!fails.length && results.length) {
    const { stats: re } = summarize(results);
    for (const [k, v] of Object.entries(re)) {
      if (JSON.stringify(doc[k]) !== JSON.stringify(v)) fail(`${k} ${JSON.stringify(doc[k])} is not the recomputed ${JSON.stringify(v)}`);
    }
    if (!fails.length) say(file, `OK score ${re.score} (95% CI ${fmtCi(re.scoreCi95)}), escape ${re.escapePct}%, median ${re.medianDistance} m over ${results.length} traces`);
  }
  return fails;
}

function cmdVerify(args) {
  const version = envVersion();
  const seedSet = typeof args["seeds-file"] === "string" ? readSeedsFile(args["seeds-file"]) : null, official = args.official === true;
  if (official && !seedSet) throw new Error("verify --official needs --seeds-file");
  if (official && new Set(seedSet).size < B.OFFICIAL_MIN_SEEDS) throw new Error(`--official needs at least ${B.OFFICIAL_MIN_SEEDS} seeds (got ${new Set(seedSet).size})`);
  let failed = false;
  const say = (file, msg) => console.log(`${file}: ${msg}`);
  for (const file of args._) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { failed = true; say(file, `cannot read JSON (${error.message})`); continue; }
    if (doc?.format === SUMMARY_FORMAT) { if (verifySummary(file, doc, version, seedSet, official, say).length) failed = true; continue; }
    if (official) { failed = true; say(file, "FAIL --official verifies summaries only"); continue; }
    const r = verifyTrace(doc, version);
    if (r.error) { failed = true; say(file, `FAIL ${r.error}`); continue; }
    say(file, `OK seed ${doc.seed} ${r.result.score} m, normalized ${B.puddingNormalizedScore(r.result.score, B.puddingReference(doc.seed))}, `
      + `${r.result.decisions} decisions, ${r.result.invalidActions} invalid, ${JSON.stringify(r.result.stats)}`);
    if (seedSet && !seedSet.includes(doc.seed)) { failed = true; say(file, `FAIL seed ${doc.seed} is not in the seeds file`); }
  }
  if (!args._.length) { console.error("verify needs trace or summary files"); failed = true; }
  process.exitCode = failed ? 1 : 0;
}

/** 두 요약을 같은 시드끼리 짝지어 정규화 점수 차(a − b)의 평균과 부트스트랩 95% 구간을 낸다. 먼저 이 체크아웃으로 두 요약을 verify 한다. */
function cmdCompare(args) {
  if (args._.length !== 2) throw new Error("compare needs two summary files");
  const [a, b] = args._.map(f => JSON.parse(fs.readFileSync(f, "utf8")));
  for (const [f, d] of [[args._[0], a], [args._[1], b]]) if (d?.format !== SUMMARY_FORMAT) throw new Error(`${f} is not a summary`);
  const version = envVersion();
  const say = (file, msg) => console.log(`${file}: ${msg}`);
  let failed = false;
  for (const [f, d] of [[args._[0], a], [args._[1], b]]) {
    if (verifySummary(f, d, version, null, false, say).length) failed = true;
  }
  if (failed) { process.exitCode = 1; return; }
  if (a.actionMode !== b.actionMode) console.error(`warning: actionMode differs (${a.actionMode} vs ${b.actionMode})`);
  const c = B.comparePaired(a.episodes, b.episodes);
  console.log(`a: ${args._[0]} (score ${a.score})\nb: ${args._[1]} (score ${b.score})`);
  console.log(`paired seeds ${c.pairs}: mean normalized difference a − b = ${c.meanDiff} (95% CI ${fmtCi(c.ci95)}), a better ${c.aWins}, b better ${c.bWins}, ties ${c.ties}`
    + (c.onlyA || c.onlyB ? `; unpaired: a ${c.onlyA}, b ${c.onlyB}` : ""));
  if (!c.pairs) process.exitCode = 1;
}

function cmdSeedsCommit(args) {
  if (args._.length !== 1) throw new Error("seeds-commit needs one seeds file");
  console.log(JSON.stringify(seedsCommit(readSeedsFile(args._[0]), typeof args.round === "string" ? args.round : null)));
}

const [cmd, ...argv] = process.argv.slice(2);
const args = COMMAND_OPTIONS.has(cmd) ? parseArgs(cmd, argv) : null;
if (cmd === "baselines") cmdBaselines(args);
else if (cmd === "run") await cmdRun(args);
else if (cmd === "verify") cmdVerify(args);
else if (cmd === "compare") cmdCompare(args);
else if (cmd === "seeds-commit") cmdSeedsCommit(args);
else if (cmd === "version") console.log(envVersion());
else {
  console.error("usage: bench.mjs baselines|run|verify|compare|seeds-commit|version …  (docs/kaito-web/game-benchmark.md)");
  process.exitCode = 2;
}
