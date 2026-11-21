/**
 * 푸딩 탈출 벤치마크의 기준 에이전트. 모두 에이전트와 같은 행동 API(`PuddingBenchEnv.step`)로만 움직인다.
 * - `random`: 시드 PRNG(`sim/rng`)로 아무렇게나 고른다.
 * - `fullCharge`: 땅에서 게이지를 꽉 채워 뛰고 공중에서는 누르지 않는다.
 * - `oracle`: 내부 규칙을 쓰는 강한 기준(위쪽 참고값)이다. 환경을 복제해 후보 행동을 앞질러 돌려 보고, 공중에서는 착지 예보(`predictLanding`)로 누를 때를 고른다.
 *   관찰만 받는 에이전트와 공정한 경쟁자가 아니다. segment 방식에서만 쓴다.
 */
import { createRng, mixSeed, nextFloat } from "../rng";
import type { RngState } from "../types";
import { type LandingForecast, type PuddingRun, STEP, predictLanding, setHold, stepRun, transformBurst, transformEnd } from "../pudding/run";
import { slope } from "../pudding/terrain";
import { type PuddingObs, PuddingBenchEnv, STEPS_PER_S } from "./pudding";
import type { BenchResult, BenchTrace } from "./types";

export type PuddingBaselineName = "random" | "fullCharge" | "oracle";
export const PUDDING_BASELINES: readonly PuddingBaselineName[] = ["random", "fullCharge", "oracle"];

/** 에이전트: 관찰을 받아 행동 하나를 낸다. `env` 는 oracle 만 읽는다. */
export interface PuddingAgent {
  readonly name: string;
  act(obs: PuddingObs, env: PuddingBenchEnv): unknown;
}

/**
 * 꽉 채우는 누름 시간(ms): 게이지가 차는 시간 + 타격 멈춤 + 비틀거림(이 동안은 게이지가 차지 않는다) + 한 걸음 남짓(10 ms).
 * `tools/pudding/measure-landings.mjs` 의 fullCharge(게이지가 찰 때까지 누른다)와 거의 같은 때에 뗀다.
 */
const fullHoldMs = (obs: PuddingObs): number => Math.round(1000 * (obs.fullHoldS + obs.freezeS + obs.stumbleS)) + 10;

function seededRandom(seed: number): () => number {
  let rng: RngState = createRng(mixSeed(seed, 0, 0x85ebca6b) || 1);
  return () => { const d = nextFloat(rng); rng = d.state; return d.value; };
}

function randomAgent(seed: number, interval: boolean): PuddingAgent {
  const rnd = seededRandom(seed);
  return {
    name: "random",
    act: obs => {
      if (interval) return { hold: rnd() < 0.4 };
      if (obs.decision === "air") return { pressAfterMs: rnd() < 0.5 ? null : Math.round(rnd() * 1200) };
      return { waitMs: obs.holding ? 0 : Math.round(rnd() * 600), holdMs: Math.round(rnd() * 600) };
    },
  };
}

function fullChargeAgent(interval: boolean): PuddingAgent {
  return {
    name: "fullCharge",
    act: obs => {
      if (interval) return { hold: obs.grounded && !(obs.holding && obs.charge >= 1) };
      if (obs.decision === "air") return { pressAfterMs: null };
      return { waitMs: 0, holdMs: fullHoldMs(obs) };
    },
  };
}

/** 걸음 하나(변신은 바로 끝낸다). */
function stepClone(c: PuddingRun): void {
  if (stepRun(c, STEP, true).events.some(e => e.kind === "transform")) { transformBurst(c); transformEnd(c); }
}

/** 착지 예보의 점수: 판정(PERFECT 2 · GOOD 1 · SPLAT 0, 판정 없는 작은 튐 1) × 1000 + 경사를 따라가는 속도. */
function forecastScore(p: LandingForecast | null): number {
  if (!p) return 0;
  const ang = Math.atan(p.slope), tang = p.vx * Math.cos(ang) + p.vy * Math.sin(ang);
  const g = !p.graded ? 1 : p.grade === "perfect" ? 2 : p.grade === "good" ? 1 : 0;
  return g * 1000 + tang;
}

/**
 * 공중에서 언제 누를지: 복제한 판을 떼고 한 걸음씩 밟으며 걸음마다 "지금 누르고 버티면"의 착지 예보를 매기고, 끝까지 누르지 않는 경우와 견준다.
 * 가장 좋은 걸음 수(없으면 null)를 돌려준다. `stride` 걸음마다 매긴다.
 */
function bestPressSteps(run: PuddingRun, stride: number): number | null {
  const c = structuredClone(run);
  if (c.hold) setHold(c, false);
  let bestScore = forecastScore(predictLanding(c, false)), best: number | null = null;
  for (let i = 0; i <= 3 * STEPS_PER_S && !c.grounded && c.caughtT < 0; i++) {
    if (i % stride === 0) {
      const score = forecastScore(predictLanding(c, true));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    stepClone(c);
  }
  return best;
}

const stepsToMs = (steps: number | null): number | null => steps === null ? null : steps * 1000 / STEPS_PER_S;

/** 땅 후보(ms). 누르고 있으면 기다림은 0 만 된다. */
const ORACLE_WAITS = [0, 100, 250, 500, 800], ORACLE_HOLDS = [0, 120, 250, 360, 600, 900];
/** 땅 후보를 견주는 시간(초): 이 시간 뒤의 x 를 내려앉은 뒤 속력으로 어림한다. */
const ORACLE_HORIZON_S = 3;

/** 땅 후보 하나의 점수: 복제한 환경에서 땅 행동 → 공중은 `bestPressSteps` 로, 내려앉을 때까지 돌리고 시계 끝의 x 를 어림한다. 잡히면 −∞. */
function groundScore(env: PuddingBenchEnv, waitMs: number, holdMs: number): number {
  const e = env.clone(), t0 = e.observe().t, until = t0 + ORACLE_HORIZON_S;
  e.stepRaw({ waitMs, holdMs });
  let guard = 0;
  while (!e.isDone() && e.decision() === "air" && guard++ < 8) e.stepRaw({ pressAfterMs: stepsToMs(bestPressSteps(e.internalRun(), 3)) });
  const r = e.internalRun();
  if (r.caughtT >= 0) return -Infinity;
  const t = e.result().stats.timeS as number, left = Math.max(0, until - t);
  const vx = r.grounded ? r.v * Math.cos(Math.atan(slope(r.terrain, r.wx))) : r.vx;
  return r.wx + vx * left;
}

function oracleAgent(): PuddingAgent {
  return {
    name: "oracle",
    act: (obs, env) => {
      if (obs.decision === "air") return { pressAfterMs: stepsToMs(bestPressSteps(env.internalRun(), 1)) };
      let best = { waitMs: 0, holdMs: fullHoldMs(obs) }, bestScore = -Infinity;
      for (const waitMs of obs.holding ? [0] : ORACLE_WAITS) {
        for (const holdMs of ORACLE_HOLDS) {
          const score = groundScore(env, waitMs, holdMs);
          if (score > bestScore) { bestScore = score; best = { waitMs, holdMs }; }
        }
      }
      return best;
    },
  };
}

/** 기준 에이전트를 만든다. oracle 은 segment 방식에서만 된다. */
export function createPuddingBaseline(name: PuddingBaselineName, seed: number, env: PuddingBenchEnv): PuddingAgent {
  const interval = env.mode.kind === "interval";
  if (name === "random") return randomAgent(seed, interval);
  if (name === "fullCharge") return fullChargeAgent(interval);
  if (interval) throw new Error("oracle supports segment mode only");
  return oracleAgent();
}

/** 에이전트로 한 판을 끝까지 돈다. */
export function playPudding(env: PuddingBenchEnv, agent: PuddingAgent, seed: number): { result: BenchResult; trace: BenchTrace } {
  let obs = env.reset(seed);
  while (!env.isDone()) obs = env.step(agent.act(obs, env)).obs;
  return { result: env.result(), trace: env.trace() };
}

/** 기준 에이전트로 한 판. */
export function runPuddingBaseline(name: PuddingBaselineName, seed: number, options: { envVersion: string; actionMode?: string }): { result: BenchResult; trace: BenchTrace } {
  const env = new PuddingBenchEnv(options);
  return playPudding(env, createPuddingBaseline(name, seed, env), seed);
}
