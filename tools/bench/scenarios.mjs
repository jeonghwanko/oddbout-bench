import "./register-ts.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { AgentProcess } from "./agent-process.mjs";
import { redactAgentArgv } from "./redact.mjs";
import { benchEnvVersion } from "./sources.mjs";

const CASE_FORMAT = "oddbout-pudding-scenarios/1";
const RESULT_FORMAT = "oddbout-pudding-scenario-results/1";
const HORIZON_S = 3;
const CATEGORIES = ["ground", "air", "recovery", "chase"];
const CONTINUATION = "fullCharge";
const root = fileURLToPath(new URL("../..", import.meta.url));
const B = await import("../../src/sim/bench/index.ts");
const envVersion = benchEnvVersion(root);

const isSeed = n => Number.isSafeInteger(n) && n >= B.PUDDING_SEED_MIN && n <= B.PUDDING_SEED_MAX;
const round = n => Math.round(n * 1000) / 1000 || 0;
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

function readSeedPool(file) {
  if (!file) return Array.from({ length: 400 }, (_, i) => 1001 + i);
  const text = readFileSync(file, "utf8").trim();
  const values = text.startsWith("[") ? JSON.parse(text) : text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!Array.isArray(values) || !values.length || !values.every(isSeed) || new Set(values).size !== values.length) {
    throw new Error("expected a pool of distinct nonzero uint32 seeds");
  }
  return values;
}

function category(obs) {
  if (obs.t < 1 || obs.t > B.PUDDING_CAP_S - HORIZON_S || obs.spoonGapM < 2.5) return null;
  if (obs.spoonGapM < 8) return "chase";
  if (obs.decision === "air") return "air";
  if (obs.lastSegment.grades.includes("splat") && obs.stumbleS > 0) return "recovery";
  if (obs.decision === "ground" && obs.stumbleS === 0 && obs.freezeS === 0) return "ground";
  return null;
}

function candidates(seed, want, index) {
  const env = new B.PuddingBenchEnv({ envVersion });
  const policy = B.createPuddingBaseline(index % 2 ? "random" : "fullCharge", seed, env);
  const wantedDecision = index % 4 < 2 ? "ground" : "air";
  let obs = env.reset(seed);
  const steps = [], matches = [];
  while (!env.isDone()) {
    if (category(obs) === want && (want !== "chase" || obs.decision === wantedDecision)) matches.push(steps.length);
    const action = policy.act(obs, env);
    steps.push(action);
    obs = env.step(action).obs;
  }
  if (!matches.length) return null;
  const indexInMatches = (Math.imul(seed, 0x9e3779b9) >>> 0) % matches.length;
  return steps.slice(0, matches[indexInMatches]);
}

function buildCases(pool, count) {
  const cases = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    for (const want of CATEGORIES) {
      let prefix = null, seed;
      while (!prefix && cursor < pool.length) {
        seed = pool[cursor++];
        prefix = candidates(seed, want, i);
      }
      if (!prefix) throw new Error(`seed pool exhausted while looking for ${want} case ${i + 1}`);
      cases.push({ id: `${want}-${String(i + 1).padStart(2, "0")}`, category: want, seed, prefix });
    }
  }
  return { format: CASE_FORMAT, envVersion, track: "state", actionMode: "segment", horizonS: HORIZON_S, continuation: CONTINUATION, cases };
}

function loadCaseSet(file) {
  const raw = readFileSync(file);
  const doc = JSON.parse(raw);
  if (doc?.format !== CASE_FORMAT || doc.envVersion !== envVersion || doc.track !== "state" || doc.actionMode !== "segment"
    || doc.horizonS !== HORIZON_S || doc.continuation !== CONTINUATION || !Array.isArray(doc.cases) || !doc.cases.length) {
    throw new Error("case set settings do not match this checkout");
  }
  const ids = new Set(), seeds = new Set();
  const cases = doc.cases.map(item => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9-]+$/.test(item.id) || !CATEGORIES.includes(item.category)
      || ids.has(item.id) || !isSeed(item.seed) || seeds.has(item.seed) || !Array.isArray(item.prefix)) {
      throw new Error("invalid or repeated case ID, seed, or replay prefix");
    }
    ids.add(item.id);
    seeds.add(item.seed);
    const env = new B.PuddingBenchEnv({ envVersion });
    env.reset(item.seed);
    for (const action of item.prefix) {
      if (env.isDone() || env.stepRaw(action).invalid) throw new Error(`invalid replay prefix for ${item.id}`);
    }
    const obs = env.observe();
    if (env.isDone() || category(obs) !== item.category) throw new Error(`unexpected replay state for ${item.id}`);
    return { item, obs, env };
  });
  return { hash: createHash("sha256").update(raw).digest("hex"), cases };
}

function evaluate({ env, item, obs }, action) {
  const branch = env.clone(HORIZON_S * B.STEPS_PER_S);
  const first = branch.step(action);
  let next = first.obs;
  const policy = B.createPuddingBaseline(CONTINUATION, item.seed, branch);
  while (!branch.isDone()) next = branch.step(policy.act(next, branch)).obs;
  return {
    invalid: first.info.invalid,
    firstGrades: first.obs.lastSegment.grades,
    survived: !branch.result().stats.caught,
    distanceM: round((branch.internalRun().wx - env.internalRun().wx) / B.PER_M),
    elapsedS: round(next.t - obs.t),
  };
}

async function runCase(entry, argv, timeoutMs) {
  const { item, obs, env } = entry;
  const agent = new AgentProcess(undefined, argv);
  let response, outcome;
  try {
    const rules = B.puddingRules(env.mode);
    const objective = "In this scenario your single action is scored by survival and distance over the next 3 game seconds."
      + " After your action, a fixed policy fully charges on the ground and never dives in the air.";
    agent.send({ type: "reset", game: env.game, episode: 0, track: env.track, actionMode: env.actionMode,
      envVersion, rules: { ...rules, summary: `${rules.summary}\n${objective}` } });
    response = await agent.readAction(0, obs, timeoutMs);
    outcome = evaluate(entry, response.action);
    agent.send({ type: "done", episode: 0, result: { score: outcome.distanceM, decisions: 1, invalidActions: Number(outcome.invalid) } });
  } finally {
    await agent.stop();
  }
  const status = response.timeout ? "timeout" : response.exited ? "exited" : outcome.invalid ? "invalid" : "ok";
  console.error(`${item.id}: ${status}, ${outcome.distanceM} m, ${outcome.survived ? "survived" : "caught"}`);
  return { id: item.id, action: response.action, status, outcome, agentMeta: agent.meta };
}

function verifyResults(set, file) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (doc?.format !== RESULT_FORMAT || doc.caseSetSha256 !== set.hash || doc.envVersion !== envVersion
    || !Array.isArray(doc.cases) || doc.cases.length !== set.cases.length) throw new Error(`${file}: case set or format mismatch`);
  for (const [i, entry] of set.cases.entries()) {
    const row = doc.cases[i];
    if (row?.id !== entry.item.id || !Object.hasOwn(row, "action")) throw new Error(`${file}: missing or unexpected case ${entry.item.id}`);
    const outcome = evaluate(entry, row.action);
    const validStatus = [outcome.invalid ? "invalid" : "ok"];
    if (row.action === null) validStatus.push("timeout", "exited");
    if (!isDeepStrictEqual(outcome, row.outcome) || !validStatus.includes(row.status)) {
      throw new Error(`${file}: replay mismatch for ${row.id}`);
    }
  }
  return doc.cases;
}

function stats(rows) {
  return {
    cases: rows.length,
    survived: rows.filter(row => row.outcome.survived).length,
    meanDistanceM: round(rows.reduce((sum, row) => sum + row.outcome.distanceM, 0) / rows.length),
    firstPerfect: rows.filter(row => row.outcome.firstGrades.includes("perfect")).length,
    firstSplat: rows.filter(row => row.outcome.firstGrades.includes("splat")).length,
    invalid: rows.filter(row => row.status === "invalid").length,
    timeout: rows.filter(row => row.status === "timeout").length,
    exited: rows.filter(row => row.status === "exited").length,
  };
}

function compare(set, a, b) {
  const report = [];
  for (const group of ["all", ...CATEGORIES]) {
    const selected = set.cases.flatMap(({ item }, i) => group === "all" || item.category === group ? [i] : []);
    if (!selected.length) continue;
    const left = selected.map(i => a[i]), right = selected.map(i => b[i]);
    const differences = selected.map(i => a[i].outcome.distanceM - b[i].outcome.distanceM);
    const mean = values => round(values.reduce((sum, value) => sum + value, 0) / values.length);
    report.push({ group, a: stats(left), b: stats(right), meanDifferenceM: mean(differences),
      distanceDifferenceCi95M: differences.length > 1 ? B.bootstrapCI(differences, mean) : null });
  }
  return report;
}

const options = {
  build: { out: { type: "string" }, "per-category": { type: "string", default: "12" }, "seeds-file": { type: "string" } },
  run: { cases: { type: "string" }, out: { type: "string" }, jobs: { type: "string", default: "1" }, timeout: { type: "string", default: "150" } },
  verify: { cases: { type: "string" } },
  compare: { cases: { type: "string" } },
};

function integer(value, name, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`--${name} must be a positive integer no greater than ${max}`);
  return n;
}

async function main([command, ...args]) {
  if (!Object.hasOwn(options, command)) throw new Error("scenarios.mjs build|run|verify|compare … (see README.md)");
  const split = command === "run" ? args.indexOf("--") : -1;
  const argv = split < 0 ? [] : args.slice(split + 1);
  const { values, positionals } = parseArgs({ args: split < 0 ? args : args.slice(0, split), options: options[command], allowPositionals: true });
  if (command === "build") {
    if (!values.out || positionals.length) throw new Error("build needs --out");
    const count = integer(values["per-category"], "per-category", 100);
    const manifest = buildCases(readSeedPool(values["seeds-file"]), count);
    write(values.out, manifest);
    console.log(`wrote ${manifest.cases.length} cases to ${values.out}`);
    return;
  }
  if (!values.cases) throw new Error(`${command} needs --cases`);
  const set = loadCaseSet(values.cases);
  if (command === "run") {
    if (!values.out || !argv.length || positionals.length) throw new Error("run needs --out and an executable after --");
    if (existsSync(values.out)) throw new Error(`result file already exists: ${values.out}`);
    const jobs = integer(values.jobs, "jobs", 8), timeoutMs = 1000 * integer(values.timeout, "timeout", 86400);
    const cases = new Array(set.cases.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, cases.length) }, async () => {
      while (next < cases.length) {
        const i = next++;
        cases[i] = await runCase(set.cases[i], argv, timeoutMs);
      }
    }));
    write(values.out, { format: RESULT_FORMAT, envVersion, caseSetSha256: set.hash, agent: redactAgentArgv(argv), cases });
    console.log(JSON.stringify(stats(cases), null, 2));
  } else if (command === "verify" && positionals.length) {
    for (const file of positionals) console.log(`${file}: OK ${verifyResults(set, file).length} cases`);
  } else if (command === "compare" && positionals.length === 2) {
    console.log(JSON.stringify(compare(set, ...positionals.map(file => verifyResults(set, file))), null, 2));
  } else {
    throw new Error(`${command} needs ${command === "compare" ? "two" : "one or more"} result files`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
