import { chargeOf } from "./sim/pudding/run.js";
import { PuddingBenchEnv, STEPS_PER_S, PER_M } from "./sim/bench/pudding.js";
import { createPuddingBaseline } from "./sim/bench/puddingBaselines.js";
import archive from "./replay-data.js";

export const horizon = archive.horizonS;
export const framesPerSecond = STEPS_PER_S;
export const unitsPerMetre = PER_M;
export const models = ["GPT-6.2 Astra", "Claude Opus 5.5"];
export const recordUrl = `https://github.com/jeonghwanko/oddbout-bench/tree/${archive.commit}/results/${archive.date}-public`;
export const samples = new Map(archive.rounds.map(sample => [sample.id, sample]));

function frame(run, caught, firstAction) {
  return {
    x: run.wx, y: run.y, gap: run.gap, grounded: run.grounded,
    holding: run.hold, charge: run.grounded ? chargeOf(run) : 0,
    stage: run.stage, caught, firstAction,
    motionY: run.vy, bonk: run.bonkT,
    terrain: { segs: run.terrain.segs.slice(), feats: run.terrain.feats.slice() },
    coins: run.terrain.drops.filter(drop => !drop.taken && Math.abs(drop.x - run.wx) < 800),
  };
}

export function restore(sample) {
  const env = new PuddingBenchEnv({ envVersion: archive.envVersion });
  env.reset(sample.seed);
  for (const action of sample.prefix) {
    if (env.stepRaw(action).invalid || env.isDone()) throw new Error(`Invalid prefix for ${sample.id}`);
  }
  return { env, obs: env.observe() };
}

export function simulate(sample, start, action) {
  const branch = start.env.clone(horizon * framesPerSecond);
  const startRun = start.env.internalRun();
  const frames = [frame(startRun, false, true)];
  const marks = [];
  let firstAction = true;
  let caught = false;
  const originalAdvance = branch.advance;

  // The pinned benchmark executes several physics ticks per action.
  // Observe those ticks for display while leaving its actions and physics intact.
  branch.advance = function (log) {
    const events = originalAdvance.call(this, log);
    const run = this.internalRun();
    const visible = events.filter(event => ["grade", "caught", "transform", "bounce"].includes(event.kind));
    caught ||= visible.some(event => event.kind === "caught");
    for (const event of visible) marks.push({
      ...event, tick: frames.length, firstAction,
    });
    frames.push(frame(run, caught, firstAction));
    return events;
  };

  const first = branch.step(action);
  firstAction = false;
  const continuation = createPuddingBaseline(archive.continuation, sample.seed, branch);
  let obs = first.obs;
  while (!branch.isDone()) obs = branch.step(continuation.act(obs, branch)).obs;
  const round = value => Math.round(value * 1000) / 1000;
  const outcome = {
    invalid: first.info.invalid,
    firstGrades: first.obs.lastSegment.grades,
    survived: !branch.result().stats.caught,
    distanceM: round((branch.internalRun().wx - startRun.wx) / PER_M),
    elapsedS: round(obs.t - start.obs.t),
  };
  return { frames, outcome, marks };
}

export function winner(first, second) {
  if (first.survived !== second.survived) return first.survived ? 0 : 1;
  const millimetres = Math.round(first.distanceM * 1000) - Math.round(second.distanceM * 1000);
  if (Math.abs(millimetres) < 1000) return null;
  return millimetres > 0 ? 0 : 1;
}

export function actionLabel(action) {
  if (Object.hasOwn(action, "pressAfterMs")) {
    if (action.pressAfterMs === null) return ["활공 유지", "공중에서 버튼을 누르지 않음"];
    if (action.pressAfterMs === 0) return ["즉시 다이브", "지금 버튼을 눌러 아래로 가속"];
    return ["늦게 다이브", `${action.pressAfterMs}ms 뒤에 버튼 누르기`];
  }
  return [
    action.waitMs === 0 ? "바로 충전" : "기다렸다 충전",
    `대기 ${action.waitMs}ms · 누름 ${action.holdMs}ms`,
  ];
}

export function createDeck(firstGame, random = Math.random) {
  if (firstGame) return ["air-11", "ground-01", "chase-08"];
  const pick = options => options[Math.floor(random() * options.length)];
  return [
    pick(["air-04", "air-12"]),
    pick(["ground-06", "ground-10"]),
    pick(["chase-01", "recovery-06"]),
  ];
}
