import "./register-ts.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { AgentProcess } from "./agent-process.mjs";
import { redactAgentArgv } from "./redact.mjs";
import { benchEnvVersion } from "./sources.mjs";
const { bootstrapCI, mean, median } = await import("../../src/sim/bench/stats.ts");
const {
  BOUNCE_ACTION_MODE, BOUNCE_CASE_FORMAT, BOUNCE_GAME, BOUNCE_MECHANICS, bounceEdits, bounceRepairRules,
  prepareBounceCase, readBounceCase, replayBounceEdit, scoreBounceReply,
} = await import("../../src/sim/bench/bounce.ts");

const root = fileURLToPath(new URL("../..", import.meta.url));
const envVersion = benchEnvVersion(root, "src/sim/bench/bounce.ts");
const defaultCases = fileURLToPath(new URL("./fixtures/bounce-state-pilot.json", import.meta.url));
const RESULT_FORMAT = "oddbout-bounce-scenario-results/1";
const round = number => Math.round(number * 1000) / 1000 || 0;
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

function loadSet(file) {
  const raw = readFileSync(file);
  const doc = JSON.parse(raw);
  if (doc?.format !== BOUNCE_CASE_FORMAT || doc.track !== "state" || doc.actionMode !== BOUNCE_ACTION_MODE
    || !Array.isArray(doc.cases) || !doc.cases.length || !doc.rooms) throw new Error("invalid Bounce Ball case set");
  const ids = new Set(), pairs = new Map();
  const entries = doc.cases.map(rawCase => {
    if (!rawCase || !Object.hasOwn(doc.rooms, rawCase.pair)) throw new Error("missing room for Bounce Ball case");
    const room = doc.rooms[rawCase.pair];
    const item = readBounceCase({ ...rawCase, rows: room?.rows, target: room?.target });
    if (ids.has(item.id)) throw new Error(`duplicate case ${item.id}`);
    ids.add(item.id);
    const entry = prepareBounceCase(item);
    const members = pairs.get(item.pair) ?? [];
    members.push(entry);
    pairs.set(item.pair, members);
    return entry;
  });
  for (const [pair, entries] of pairs) {
    if (entries.length !== 2 || entries[0].item.mechanic !== entries[1].item.mechanic) {
      throw new Error(`${pair}: each pair must have exactly two scenes using the same mechanic`);
    }
  }
  return { hash: createHash("sha256").update(raw).digest("hex"), entries, pairs };
}

function tolerant(entry, edit) {
  const { run, item } = entry;
  const nearby = [{ ...edit, start: edit.start + 1 }, { ...edit, ticks: edit.ticks - 1 }, { ...edit, ticks: edit.ticks + 1 }];
  if (edit.start > 0) nearby.push({ ...edit, start: edit.start - 1 });
  return nearby.every(candidate => replayBounceEdit(run, item, candidate).reachedTarget);
}

function audit(set) {
  const byPair = [];
  for (const [pair, [a, b]] of set.pairs) {
    const cases = [a, b];
    const d = Math.hypot(a.run.x - b.run.x, a.run.y - b.run.y);
    const distinctMotion = Math.abs(a.run.vx - b.run.vx) >= 0.75 || Math.abs(a.run.vy - b.run.vy) >= 3
      || Math.abs(a.run.kickWindow - b.run.kickWindow) >= 3 || a.run.doorLock !== b.run.doorLock;
    if (d > 1.05 || !distinctMotion || a.item.originalAxis !== b.item.originalAxis) {
      throw new Error(`${pair}: paired scenes must have nearby positions, different motion, and the same original input`);
    }
    const successes = cases.map(entry => {
      const edits = bounceEdits(entry.item.originalAxis);
      const winning = edits.filter(edit => replayBounceEdit(entry.run, entry.item, edit).reachedTarget);
      if (winning.length < 2 || winning.length > edits.length / 3 || !winning.some(edit => tolerant(entry, edit))) {
        throw new Error(`${entry.item.id}: need 2–16 solutions and at least one that tolerates a one-tick adjustment`);
      }
      return winning;
    });
    if (successes[0].some(edit => successes[1].some(other => isDeepStrictEqual(edit, other)))) {
      throw new Error(`${pair}: found a repair that works in both scenes`);
    }
    byPair.push({ pair, mechanic: a.item.mechanic, positionGap: round(d), successfulEdits: successes.map(edits => edits.length) });
  }
  return { envVersion, caseSetSha256: set.hash, cases: set.entries.length, byPair };
}

function baseline(set) {
  const rows = set.entries.map(entry => {
    const { run, item } = entry;
    const options = bounceEdits(item.originalAxis);
    const towards = Math.sign(item.target.x + 0.5 - run.x);
    const preferred = run.dash ? -run.dash : run.kickWindow ? run.kickDir : towards;
    const axes = [...new Set([preferred, towards, 0, -1, 1])].filter(axis => axis !== item.originalAxis);
    const rule = { axis: axes[0], start: 0, ticks: 16 };
    const limited = [0, 12, 24, 8].flatMap(start => [8, 16].map(ticks => ({ axis: axes[0], start, ticks })));
    const succeeds = edit => replayBounceEdit(run, item, edit).reachedTarget;
    return { id: item.id, unchanged: Number(succeeds(null)), random: options.filter(succeeds).length / options.length,
      rule: Number(succeeds(rule)), limited: Number(limited.some(succeeds)), exhaustive: Number(options.some(succeeds)) };
  });
  const rates = Object.fromEntries(["unchanged", "random", "rule", "limited", "exhaustive"]
    .map(key => [key, round(100 * mean(rows.map(row => row[key])))]));
  return { ratesPct: rates, rows };
}

async function ask(entry, task, argv, timeoutMs) {
  const agent = new AgentProcess(undefined, argv);
  let response, elapsedMs;
  try {
    const { actionSchema, objective, prediction, ...common } = bounceRepairRules;
    const rules = task === "repair"
      ? { ...common, objective, actionSchema: { repair: actionSchema.repair } }
      : { ...common, objective: prediction, actionSchema: { predict: actionSchema.predict } };
    const { probes, ...state } = entry.obs;
    const obs = task === "repair" ? { task, ...state } : { task, ...state, probes };
    agent.send({ type: "reset", game: BOUNCE_GAME, episode: 0, track: "state", actionMode: BOUNCE_ACTION_MODE,
      envVersion, rules });
    const start = performance.now();
    response = await agent.readAction(0, obs, timeoutMs);
    elapsedMs = Math.round(performance.now() - start);
  } finally {
    await agent.stop();
  }
  return { action: response.action, transport: response.timeout ? "timeout" : response.exited ? "exited" : "received",
    elapsedMs, agentMeta: agent.meta };
}

function evaluate(entry, repair, predict) {
  return scoreBounceReply(entry, { repair: repair.action?.repair, predict: predict.action?.predict });
}

async function runScene(entry, argv, timeoutMs) {
  const repair = await ask(entry, "repair", argv, timeoutMs);
  const predict = await ask(entry, "predict", argv, timeoutMs);
  const outcome = evaluate(entry, repair, predict);
  console.error(`${entry.item.id}: repair ${repair.transport}/${outcome.reachedTarget ? "recovered" : "missed"}, prediction ${predict.transport}/${outcome.predictionCorrect} of 2`);
  return { id: entry.item.id, repair, predict, outcome };
}

async function run(set, argv, timeoutMs, jobs, out) {
  const rows = new Array(set.entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, rows.length) }, async () => {
    while (next < rows.length) {
      const i = next++;
      rows[i] = await runScene(set.entries[i], argv, timeoutMs);
    }
  }));
  write(out, { format: RESULT_FORMAT, game: BOUNCE_GAME, track: "state", actionMode: BOUNCE_ACTION_MODE,
    envVersion, caseSetSha256: set.hash, agent: redactAgentArgv(argv), cases: rows });
  return rows;
}

function verify(set, file) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (doc?.format !== RESULT_FORMAT || doc.game !== BOUNCE_GAME || doc.track !== "state" || doc.actionMode !== BOUNCE_ACTION_MODE
    || doc.envVersion !== envVersion || doc.caseSetSha256 !== set.hash || !Array.isArray(doc.cases)
    || doc.cases.length !== set.entries.length) throw new Error(`${file}: case set, environment, or format mismatch`);
  for (const [i, entry] of set.entries.entries()) {
    const row = doc.cases[i];
    if (row?.id !== entry.item.id || !row.repair || !row.predict) throw new Error(`${file}: missing case ${entry.item.id}`);
    for (const step of [row.repair, row.predict]) {
      if (!Object.hasOwn(step, "action") || !["received", "timeout", "exited"].includes(step.transport)
        || (step.transport !== "received" && step.action !== null)
        || !Number.isSafeInteger(step.elapsedMs) || step.elapsedMs < 0) throw new Error(`${file}: invalid response record for ${row.id}`);
    }
    if (!isDeepStrictEqual(evaluate(entry, row.repair, row.predict), row.outcome)) throw new Error(`${file}: replay mismatch for ${row.id}`);
  }
  return doc.cases;
}

function stats(set, rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const recovered = entries => entries.filter(({ item }) => byId.get(item.id).outcome.reachedTarget).length;
  const responses = task => rows.filter(row => row[task].transport === "received");
  const transport = (task, valid) => {
    const eligible = responses(task);
    return { responded: eligible.length, invalid: eligible.filter(row => !row.outcome[valid]).length,
      timeout: rows.filter(row => row[task].transport === "timeout").length,
      exited: rows.filter(row => row[task].transport === "exited").length,
      medianWallMs: eligible.length ? median(eligible.map(row => row[task].elapsedMs)) : null };
  };
  return {
    recovered: recovered(set.entries), cases: rows.length,
    bothScenesRecovered: [...set.pairs.values()].filter(entries => recovered(entries) === 2).length, pairs: set.pairs.size,
    predicted: rows.reduce((sum, row) => sum + row.outcome.predictionCorrect, 0), probes: rows.length * 2,
    byMechanic: Object.fromEntries(BOUNCE_MECHANICS.map(mechanic => [mechanic, recovered(set.entries.filter(entry => entry.item.mechanic === mechanic))])),
    repairResponses: transport("repair", "repairValid"), predictionResponses: transport("predict", "predictionValid"),
  };
}

function compare(set, a, b) {
  const indexById = new Map(set.entries.map((entry, i) => [entry.item.id, i]));
  const aStats = stats(set, a), bStats = stats(set, b);
  if (aStats.repairResponses.responded !== aStats.cases || bStats.repairResponses.responded !== bStats.cases) {
    return { a: aStats, b: bStats, matchedDiff: null };
  }
  const differences = [...set.pairs.values()].map(entries => mean(entries.map(({ item }) => {
    const i = indexById.get(item.id);
    return 100 * (Number(a[i].outcome.reachedTarget) - Number(b[i].outcome.reachedTarget));
  })));
  return { a: aStats, b: bStats, matchedDiff: { recoveryDeltaPp: round(mean(differences)), pairCount: differences.length,
    ci95Pp: differences.length > 1 ? bootstrapCI(differences, mean).map(round) : null } };
}

const options = {
  cases: { type: "string", default: defaultCases }, out: { type: "string" },
  jobs: { type: "string", default: "1" }, timeout: { type: "string", default: "120" },
};
function positive(value, max, flag) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`--${flag} must be an integer from 1 to ${max}`);
  return n;
}

async function main([command, ...args]) {
  const split = command === "run" ? args.indexOf("--") : -1;
  const argv = split < 0 ? [] : args.slice(split + 1);
  const { values, positionals } = parseArgs({ args: split < 0 ? args : args.slice(0, split), options, allowPositionals: true });
  if (command === "version") { console.log(envVersion); return; }
  const set = loadSet(values.cases);
  let result;
  switch (command) {
    case "audit": result = audit(set); break;
    case "baselines": audit(set); result = baseline(set); break;
    case "run":
      if (!values.out || !argv.length) throw new Error("run needs --out and an agent command after --");
      audit(set);
      result = stats(set, await run(set, argv, 1000 * positive(values.timeout, 3600, "timeout"), positive(values.jobs, 16, "jobs"), values.out));
      break;
    case "verify":
      if (!positionals.length) throw new Error("verify needs one or more result files");
      result = Object.fromEntries(positionals.map(file => [file, stats(set, verify(set, file))]));
      break;
    case "compare":
      if (positionals.length !== 2) throw new Error("compare needs two result files");
      result = compare(set, ...positionals.map(file => verify(set, file)));
      break;
    default: throw new Error("bounce-scenarios.mjs version|audit|baselines|run|verify|compare (see README.md)");
  }
  console.log(JSON.stringify(result, null, 2));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
