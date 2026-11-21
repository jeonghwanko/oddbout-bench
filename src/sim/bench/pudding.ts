/**
 * 푸딩 탈출 벤치마크 환경(1호 환경). 규칙(`sim/pudding`)을 바꾸지 않고 그 위에 얹은 어댑터다.
 *
 * 고정 조건: `createRun(seed)` 뒤 `startRun(s, seed, false)` — 곰젤리, 아이템 없음, 튜토리얼 없음, 이어 달리기 없음.
 * 변신 사건(`transform`)이 나오면 그 자리에서 `transformBurst` · `transformEnd` 를 부른다(연출 시간 없음, `tools/pudding/measure-landings.mjs` 와 같다).
 * 판은 숟가락에 잡히는 걸음(`caught`)에서 끝나거나 게임 시간 `PUDDING_CAP_S` 초에서 끝난다. `caught` 뒤 `eaten` 까지는 화면 연출이라 돌리지 않는다.
 * 환경은 차례제다: `step` 을 부르지 않으면 게임 시간이 흐르지 않는다.
 *
 * 행동 방식은 둘이다.
 * - `segment`(기본): 땅에 있을 때(ground)와 땅을 떠났을 때(air)만 결정한다. 행동 하나가 다음 결정 자리까지 걸음을 돈다.
 * - `interval:k`: k 걸음(기본 8, 1..60)마다 누름 여부 하나를 정한다.
 * 잘못된 행동은 받은 그대로 기록에 두고, 정한 빈 행동(지금 누름 상태를 그대로 둔다)을 돈다. 그래서 기록을 다시 돌리면 같은 결과가 나온다.
 * 계약 문서: docs/kaito-web/game-benchmark.md
 */
import { nextFloat } from "../rng";
import {
  AIR_DRAG, CATCH_GAP, FEVER_GRAVITY, FULL_HOLD, GOOD_ANGLE, GRADED_AIR, G_AIR, G_DIVE, G_HOLD, G_RUN, LAUNCH_FWD, LAUNCH_FWD_SLOPE,
  LAUNCH_POP_BASE, LAUNCH_POP_CHARGE, LAUNCH_STAGE_GAIN, LAUNCH_UP, LAUNCH_VALLEY_GAIN, type LandingGrade, PERFECT_ANGLE, type PuddingEvent,
  type PuddingRun, SPEED_CAP_BASE, SPEED_CAP_FEVER, SPEED_CAP_STAGE, SPOON_ACCEL, SPOON_ACCEL2, SPOON_ACCEL_LATE, SPOON_LEASH, SPOON_MAX, SPOON_MAX_T, SPOON_V0, STAGE_GAIN_MAX,
  STEP, VALLEY_DIV, VALLEY_MAX, chargeOf, createRun, distanceM, fullHoldOf, setHold, spoonSpeedOf, startRun, stepRun, transformBurst, transformEnd,
} from "../pudding/run";
import { type FeatureKind, type Terrain, genTo, hill, slope } from "../pudding/terrain";
import { BENCH_TRACE_FORMAT, type BenchEnv, type BenchResult, type BenchStep, type BenchTrace } from "./types";

/** 게임 이름(기록의 `game`). */
export const PUDDING_GAME = "pudding-escape";
/** 공개 연습 시드. 비공개 평가 시드는 저장소에 두지 않는다(CLI 가 파일에서 읽는다). */
export const PUDDING_PRACTICE_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** 1 초의 걸음 수(`STEP` = 1/120 초). */
export const STEPS_PER_S = Math.round(1 / STEP);
/** 판의 게임 시간 상한(초)과 걸음 수. */
export const PUDDING_CAP_S = 90;
export const PUDDING_CAP_STEPS = PUDDING_CAP_S * STEPS_PER_S;
/** 행동 값의 범위(ms). 범위 밖의 유한한 수는 범위 끝으로 자른다. */
export const WAIT_MAX_MS = 3000, HOLD_MAX_MS = 1500, PRESS_MAX_MS = 3000;
/** 잘못된 행동의 빈 행동 길이(segment 방식, ms). interval 방식은 한 간격이다. */
export const NOOP_MS = 250;
/** interval 방식의 기본 간격과 범위(걸음). */
export const INTERVAL_DEFAULT = 8, INTERVAL_MIN = 1, INTERVAL_MAX = 60;
/** 관찰의 앞 지형: `LOOKAHEAD_M` m 앞까지 `SAMPLE_M` m 마다. */
export const LOOKAHEAD_M = 100, SAMPLE_M = 2;
/** 월드 x 10 이 1 m 다. */
export const PER_M = 10;
/** 시드 범위: 규칙의 시드 PRNG 가 32비트라 이 범위 밖의 시드는 다른 시드와 같은 판이 된다. */
export const PUDDING_SEED_MAX = 2 ** 32 - 1;

/** ms 를 걸음 수로: 범위로 자른 뒤 `Math.round(ms × 120 / 1000)`(반 걸음은 위로). */
export function msToSteps(ms: number, maxMs: number): number {
  return Math.round(Math.min(maxMs, Math.max(0, ms)) * STEPS_PER_S / 1000);
}

export interface PuddingGroundAction { readonly waitMs: number; readonly holdMs: number }
export interface PuddingAirAction { readonly pressAfterMs: number | null }
export interface PuddingIntervalAction { readonly hold: boolean }
export type PuddingAction = PuddingGroundAction | PuddingAirAction | PuddingIntervalAction;
export type PuddingDecision = "ground" | "air";

export type PuddingActionMode = { readonly kind: "segment" } | { readonly kind: "interval"; readonly k: number };

/** 행동 방식 글자(`segment` · `interval` · `interval:k`)를 읽는다. 틀리면 null. */
export function parsePuddingActionMode(mode: string): PuddingActionMode | null {
  if (mode === "segment") return { kind: "segment" };
  if (mode === "interval") return { kind: "interval", k: INTERVAL_DEFAULT };
  const m = /^interval:(\d{1,2})$/.exec(mode);
  const k = m ? Number(m[1]) : NaN;
  return Number.isInteger(k) && k >= INTERVAL_MIN && k <= INTERVAL_MAX ? { kind: "interval", k } : null;
}
/** 행동 방식의 기록 글자(interval 은 늘 `interval:k`). */
export const actionModeName = (m: PuddingActionMode): string => m.kind === "segment" ? "segment" : `interval:${m.k}`;

/** 앞의 지형 요소. 거리는 곰젤리 기준 m(지나는 중이면 `startM` 이 음수). */
export interface PuddingFeatureAhead { readonly kind: FeatureKind; readonly startM: number; readonly endM: number }

/** 지난 행동 하나(segment) · 간격 하나(interval) 동안 일어난 일. */
export interface PuddingSegmentSummary {
  readonly steps: number;
  readonly jumps: readonly { readonly charge: number; readonly full: boolean; readonly assisted: boolean }[];
  readonly grades: readonly LandingGrade[];
  readonly coins: number;
  readonly caramel: number;
  readonly bounces: number;
  readonly transforms: number;
  readonly invalid: boolean;
}

/**
 * state 트랙 관찰. 모든 수는 유한하다. 길이 m, 속도 m/s, 시간 s. 높이와 기울기는 위가 +(게임 안의 y 는 아래가 +).
 * 착지 예보(`predictLanding`)와 내부 난수는 주지 않는다.
 */
export interface PuddingObs {
  readonly t: number;
  readonly distanceM: number;
  /** 곰젤리 발의 x(m). */
  readonly xM: number;
  /** 발 밑 땅에서 발까지 높이(m, 땅에 있으면 0). */
  readonly heightAboveGroundM: number;
  readonly vxMps: number;
  /** 위가 +. */
  readonly vyMps: number;
  /** 땅에서 경사를 따라가는 속력(m/s). 공중에서는 마지막 땅 속력이다. */
  readonly groundSpeedMps: number;
  readonly grounded: boolean;
  readonly holding: boolean;
  /** 땅에서 누른 시간(s, 공중 · 막 내려앉음에서는 0), 게이지 0..1, 게이지가 다 차는 시간(s). */
  readonly holdS: number;
  readonly charge: number;
  readonly fullHoldS: number;
  /** SPLAT 뒤 비틀거림 남은 시간(s). 이 동안 떼어도 뛰지 않고 눌러도 게이지가 차지 않는다. */
  readonly stumbleS: number;
  /** 타격 멈춤(PERFECT · SPLAT 뒤 짧게) 남은 시간(s). 이 동안 게임이 멈춰 게이지도 차지 않는다. */
  readonly freezeS: number;
  readonly boostS: number;
  readonly feverS: number;
  /** 숟가락까지 거리(m, 1.4 m 이하면 잡힌다)와 숟가락 속력(m/s). */
  readonly spoonGapM: number;
  readonly spoonSpeedMps: number;
  readonly stage: number;
  /** 다음 변신이 열려 큰 점프를 기다린다. */
  readonly transformReady: boolean;
  readonly combo: number;
  /** segment 방식의 결정 종류. interval 방식과 판이 끝난 뒤는 null. */
  readonly decision: PuddingDecision | null;
  /** 앞 지형: `x = 0, 2, …, 100` m 자리의 땅 높이(발 기준 m, 위가 +)와 기울기(오르막이 +). */
  readonly terrain: { readonly stepM: number; readonly heightM: readonly number[]; readonly slope: readonly number[] };
  readonly features: readonly PuddingFeatureAhead[];
  readonly lastSegment: PuddingSegmentSummary;
}

/** 소수 셋째 자리로(관찰 글자를 짧게 한다). */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

const EMPTY_SEGMENT: PuddingSegmentSummary = { steps: 0, jumps: [], grades: [], coins: 0, caramel: 0, bounces: 0, transforms: 0, invalid: false };

/** 받은 행동을 JSON 값으로 복사한다(기록에 둘 값). JSON 이 될 수 없으면 null. 검사도 이 복사본으로 한다(다시 돌리기와 같게). */
function jsonCopy(action: unknown): unknown {
  if (action === undefined) return null;
  try {
    const text = JSON.stringify(action);
    return text === undefined ? null : JSON.parse(text) as unknown;
  } catch { return null; }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 검사한 행동: 돌 계획(걸음 수) 또는 잘못된 까닭. */
type Plan =
  | { readonly kind: "ground"; readonly wait: number; readonly hold: number }
  | { readonly kind: "air"; readonly pressAt: number | null }
  | { readonly kind: "interval"; readonly hold: boolean }
  | { readonly kind: "invalid"; readonly reason: string };

/** 사건 묶음 안에 새 결정 자리가 있는가: 땅 ↔ 공중이 바뀌었거나, 생크림에 내려앉아 바로 다시 떴다. */
const crossed = (wasGrounded: boolean, s: PuddingRun, events: readonly PuddingEvent[]): boolean =>
  s.grounded !== wasGrounded || events.some(e => e.kind === "bounce");

export interface PuddingEnvOptions {
  /** 환경 판(CLI 가 규칙 · 환경 소스의 sha256 으로 만든다). */
  readonly envVersion: string;
  /** 행동 방식 글자. 기본 `segment`. */
  readonly actionMode?: string;
}

/** 복제(`clone`)에 쓰는 내부 상태. */
interface EnvState {
  run: PuddingRun; seed: number; steps: number; done: boolean; caught: boolean;
  decisions: number; invalid: number; actions: unknown[]; seg: PuddingSegmentSummary;
}

export class PuddingBenchEnv implements BenchEnv<PuddingObs, unknown> {
  readonly game = PUDDING_GAME;
  readonly track = "state" as const;
  readonly actionMode: string;
  readonly envVersion: string;
  readonly mode: PuddingActionMode;
  private st: EnvState | null = null;

  constructor(options: PuddingEnvOptions) {
    const mode = parsePuddingActionMode(options.actionMode ?? "segment");
    if (!mode) throw new Error(`unknown pudding action mode: ${options.actionMode}`);
    this.mode = mode;
    this.actionMode = actionModeName(mode);
    this.envVersion = options.envVersion;
  }

  private get s(): EnvState {
    if (!this.st) throw new Error("call reset(seed) first");
    return this.st;
  }

  reset(seed: number): PuddingObs {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > PUDDING_SEED_MAX) throw new Error(`seed must be an integer 0..${PUDDING_SEED_MAX}: ${seed}`);
    const run = createRun(seed);
    startRun(run, seed, false);
    this.st = { run, seed, steps: 0, done: false, caught: false, decisions: 0, invalid: 0, actions: [], seg: EMPTY_SEGMENT };
    return this.observe();
  }

  /** 지금 결정 종류(segment 방식). */
  decision(): PuddingDecision | null {
    const st = this.s;
    if (st.done || this.mode.kind !== "segment") return null;
    return st.run.grounded ? "ground" : "air";
  }

  isDone(): boolean { return this.s.done; }

  /** 내부 규칙 상태. 강한 기준 에이전트(oracle)만 쓴다. 프로토콜로는 내보내지 않는다. */
  internalRun(): PuddingRun { return this.s.run; }

  /** 같은 상태의 복제(앞을 내다보는 탐색용). 기록도 함께 복제한다. */
  clone(): PuddingBenchEnv {
    const env = new PuddingBenchEnv({ envVersion: this.envVersion, actionMode: this.actionMode });
    env.st = structuredClone(this.s);
    return env;
  }

  step(action: unknown): BenchStep<PuddingObs> {
    const r = this.stepRaw(action);
    return { obs: this.observe(), done: this.s.done, info: r.invalid ? { invalid: true, reason: r.reason } : { invalid: false } };
  }

  /** 관찰을 만들지 않고 행동 하나를 돈다(탐색용). */
  stepRaw(action: unknown): { invalid: boolean; reason?: string } {
    const st = this.s;
    if (st.done) throw new Error("episode is done");
    const stored = jsonCopy(action);
    st.actions.push(stored);
    st.decisions++;
    const plan = this.check(stored);
    const log: PuddingEvent[] = [];
    const before = st.steps;
    if (plan.kind === "invalid") { st.invalid++; this.noop(log); }
    else if (plan.kind === "ground") this.runGround(plan.wait, plan.hold, log);
    else if (plan.kind === "air") this.runAir(plan.pressAt, log);
    else this.runInterval(plan.hold, this.mode.kind === "interval" ? this.mode.k : INTERVAL_DEFAULT, log);
    st.seg = summarize(log, st.steps - before, plan.kind === "invalid");
    return plan.kind === "invalid" ? { invalid: true, reason: plan.reason } : { invalid: false };
  }

  /** 행동을 검사해 계획으로 바꾼다. */
  private check(a: unknown): Plan {
    if (!isRecord(a)) return { kind: "invalid", reason: "action is not an object" };
    if (this.mode.kind === "interval") {
      return typeof a.hold === "boolean" ? { kind: "interval", hold: a.hold } : { kind: "invalid", reason: "hold must be a boolean" };
    }
    const run = this.s.run;
    if (run.grounded) {
      if (!isFiniteNumber(a.waitMs) || !isFiniteNumber(a.holdMs)) return { kind: "invalid", reason: "ground action needs finite waitMs and holdMs" };
      const wait = msToSteps(a.waitMs, WAIT_MAX_MS), hold = msToSteps(a.holdMs, HOLD_MAX_MS);
      if (run.hold && wait > 0) return { kind: "invalid", reason: "already holding: waitMs must be 0" };
      return { kind: "ground", wait, hold };
    }
    if (!("pressAfterMs" in a)) return { kind: "invalid", reason: "air action needs pressAfterMs (number or null)" };
    if (a.pressAfterMs === null) return { kind: "air", pressAt: null };
    if (!isFiniteNumber(a.pressAfterMs)) return { kind: "invalid", reason: "pressAfterMs must be a finite number or null" };
    return { kind: "air", pressAt: msToSteps(a.pressAfterMs, PRESS_MAX_MS) };
  }

  /** 걸음 하나. 변신은 바로 터뜨리고 끝낸다. 잡히거나 상한에 닿으면 판을 끝낸다. */
  private advance(log: PuddingEvent[]): readonly PuddingEvent[] {
    const st = this.s;
    const events = stepRun(st.run, STEP, true).events;
    st.steps++;
    for (const e of events) if (e.kind !== "advance") log.push(e);
    if (events.some(e => e.kind === "transform")) { transformBurst(st.run); transformEnd(st.run); }
    if (events.some(e => e.kind === "caught")) { st.done = true; st.caught = true; }
    if (st.steps >= PUDDING_CAP_STEPS) st.done = true;
    return events;
  }

  /** 걸음 하나를 돌고 결정 자리를 넘었는가. */
  private advanceCrossed(log: PuddingEvent[]): boolean {
    const was = this.s.run.grounded;
    const events = this.advance(log);
    return crossed(was, this.s.run, events);
  }

  private press(on: boolean, log: PuddingEvent[]): void {
    const run = this.s.run;
    if (run.hold !== on) log.push(...setHold(run, on));
  }

  /** 땅 행동: 떼고 `wait` 걸음 → 누르고 `hold` 걸음 → 뗀다(땅에서 떼면 뛴다). 이미 누르고 있으면 `hold` 걸음 더 누른 뒤 뗀다. */
  private runGround(wait: number, hold: number, log: PuddingEvent[]): void {
    const st = this.s;
    if (!st.run.hold) {
      for (let i = 0; i < wait; i++) if (this.advanceCrossed(log) || st.done) return;
      this.press(true, log);
    }
    for (let i = 0; i < hold; i++) if (this.advanceCrossed(log) || st.done) return;
    this.press(false, log);
    // 뛰지 못했으면(비틀거림) 한 걸음은 돈다: 걸음 없는 결정이 끝없이 이어지지 않게
    if (st.run.grounded) this.advance(log);
  }

  /** 공중 행동: 이 결정 시각(보통 뜬 순간)에서 `pressAt` 걸음째부터 누르고 내려앉을 때까지 버틴다. null 이면 이번 결정 동안 누르지 않는다. */
  private runAir(pressAt: number | null, log: PuddingEvent[]): void {
    const st = this.s;
    for (let i = 0; !st.done; i++) {
      this.press(pressAt !== null && i >= pressAt, log);
      if (this.advanceCrossed(log)) return;
    }
  }

  /** interval 행동: k 걸음 동안 누름 여부를 지킨다(변신이 누름을 풀면 다음 걸음에 다시 누른다). */
  private runInterval(hold: boolean, k: number, log: PuddingEvent[]): void {
    for (let i = 0; i < k && !this.s.done; i++) {
      this.press(hold, log);
      this.advance(log);
    }
  }

  /** 빈 행동: 누름 상태를 바꾸지 않고 segment 는 `NOOP_MS`(또는 다음 결정 자리까지), interval 은 한 간격을 돈다. */
  private noop(log: PuddingEvent[]): void {
    const st = this.s;
    if (this.mode.kind === "interval") {
      for (let i = 0; i < this.mode.k && !st.done; i++) this.advance(log);
      return;
    }
    const n = msToSteps(NOOP_MS, NOOP_MS);
    for (let i = 0; i < n && !st.done; i++) if (this.advanceCrossed(log)) return;
  }

  observe(): PuddingObs {
    const st = this.s, s = st.run;
    const t = lookahead(s);
    const heightM: number[] = [], slopes: number[] = [];
    for (let m = 0; m <= LOOKAHEAD_M; m += SAMPLE_M) {
      const x = s.wx + m * PER_M;
      heightM.push(r3((s.y - hill(t, x)) / PER_M));
      slopes.push(r3(-slope(t, x)));
    }
    const end = s.wx + LOOKAHEAD_M * PER_M;
    const features = t.feats.filter(f => f.x1 >= s.wx && f.x0 <= end)
      .map(f => ({ kind: f.kind, startM: r3((f.x0 - s.wx) / PER_M), endM: r3((f.x1 - s.wx) / PER_M) }));
    return {
      t: r3(st.steps * STEP), distanceM: distanceM(s), xM: r3(s.wx / PER_M),
      heightAboveGroundM: s.grounded ? 0 : r3((hill(s.terrain, s.wx) - s.y) / PER_M),
      vxMps: r3((s.grounded ? s.v * Math.cos(Math.atan(slope(s.terrain, s.wx))) : s.vx) / PER_M),
      vyMps: r3(-(s.grounded ? s.v * Math.sin(Math.atan(slope(s.terrain, s.wx))) : s.vy) / PER_M),
      groundSpeedMps: r3(s.v / PER_M), grounded: s.grounded, holding: s.hold,
      holdS: r3(s.grounded ? s.holdT : 0), charge: r3(s.grounded ? chargeOf(s) : 0), fullHoldS: r3(fullHoldOf(s)),
      stumbleS: r3(s.bonkT), freezeS: r3(Math.max(0, s.freeze)), boostS: r3(s.boostT), feverS: r3(s.feverT),
      spoonGapM: r3(s.gap / PER_M), spoonSpeedMps: r3(spoonSpeedOf(s) / PER_M),
      stage: s.stage, transformReady: s.ready, combo: s.combo, decision: this.decision(),
      terrain: { stepM: SAMPLE_M, heightM, slope: slopes }, features, lastSegment: st.seg,
    };
  }

  result(): BenchResult {
    const st = this.s, s = st.run, f = s.facts;
    const distance = distanceM(s);
    return {
      game: PUDDING_GAME, seed: st.seed, score: distance, scoreName: "distanceM", decisions: st.decisions, invalidActions: st.invalid,
      stats: {
        distanceM: distance, timeS: r3(st.steps * STEP), caught: st.caught, landings: f.perfect + f.good + f.splat,
        perfect: f.perfect, good: f.good, splat: f.splat, maxCombo: s.stats.maxCombo, stage: s.stage, gold: s.stats.gold,
      },
    };
  }

  trace(): BenchTrace {
    const st = this.s;
    return { format: BENCH_TRACE_FORMAT, game: PUDDING_GAME, envVersion: this.envVersion, seed: st.seed, track: "state",
      actionMode: this.actionMode, actions: st.actions.slice() };
  }
}

/** 사건 목록을 지난 행동 요약으로. */
function summarize(log: readonly PuddingEvent[], steps: number, invalid: boolean): PuddingSegmentSummary {
  const jumps: { charge: number; full: boolean; assisted: boolean }[] = [], grades: LandingGrade[] = [];
  let coins = 0, caramel = 0, bounces = 0, transforms = 0;
  for (const e of log) {
    if (e.kind === "jump") jumps.push({ charge: r3(e.charge), full: e.full, assisted: e.assisted });
    else if (e.kind === "grade") grades.push(e.grade);
    else if (e.kind === "coin") coins++;
    else if (e.kind === "caramel") caramel++;
    else if (e.kind === "bounce") bounces++;
    else if (e.kind === "transform") transforms++;
  }
  return { steps, jumps, grades, coins, caramel, bounces, transforms, invalid };
}

/**
 * 관찰용 앞 지형. 판의 지형은 곰젤리 앞 70 m 까지만 이어져 있다. 그래서 지형과 난수 상태를 얕게 복사해 `LOOKAHEAD_M` 너머까지 잇는다.
 * 지형 조각은 언제 이어도 같은 차례로 같은 난수를 꺼내므로 판이 나중에 이을 지형과 같다. 판의 상태(난수 · 별 동전)는 건드리지 않는다.
 */
function lookahead(s: PuddingRun): Terrain {
  const need = s.wx + LOOKAHEAD_M * PER_M + 20, src = s.terrain;
  if (src.segEnd >= need) return src;
  const t: Terrain = { segs: src.segs.slice(), segEnd: src.segEnd, lastHigh: src.lastHigh, lows: src.lows, drops: [],
    feats: src.feats.map(f => ({ ...f })), featGap: src.featGap, seen: src.seen.slice() };
  let rng = s.rng;
  genTo(t, need, () => { const d = nextFloat(rng); rng = d.state; return d.value; });
  return t;
}

/** 새 환경을 만들고 기록을 다시 돌린다(판 확인은 `replay` 가 한다). */
export function puddingEnvFor(trace: Pick<BenchTrace, "actionMode">, envVersion: string): PuddingBenchEnv {
  return new PuddingBenchEnv({ envVersion, actionMode: trace.actionMode });
}

/**
 * 규칙 글의 물리 상수와 식(`puddingRules().physics`). 숫자는 규칙(`sim/pudding/run.ts`)의 export 상수에서 만든다. 값을 여기 다시 적지 않는다.
 * 줄마다 하나의 식이다. `test/bench-pudding.test.ts` 가 발사 식 줄을 읽어 `launchVelocity` 와 같은지 본다.
 */
export function puddingPhysics(): readonly string[] {
  return [
    `Units: the rules run in game units, ${PER_M} units = 1 m, game y points DOWN, one step = 1/${STEPS_PER_S} s (fixed). Here slope = dy/dx with y down = -obs.terrain.slope (a ratio, same in m). Observations convert to m, m/s and up-positive.`,
    `Gravity (units/s^2, down): ground ${G_RUN}, ground while holding ${G_HOLD}, air ${G_AIR}, air while holding (dive) ${G_DIVE}; during fever air gravity x${FEVER_GRAVITY}.`,
    `Air motion each step (dt = one step): vy += g*dt; vx -= vx*${AIR_DRAG}*dt; x += vx*dt; y += vy*dt; it lands when y reaches the ground.`,
    `Charge: full after ${FULL_HOLD} s of holding on the ground (charge = min(1, holdS/fullHoldS)); time in hit-stop or stumble does not count.`,
    `Landing grade: d = |atan2(vy, vx) - atan(slope)| (game units, y down). PERFECT if d < ${PERFECT_ANGLE}, GOOD if d < ${GOOD_ANGLE}, else SPLAT. Flights shorter than ${GRADED_AIR} s are not graded.`,
    `Speed cap (units/s): cap = ${SPEED_CAP_BASE} + ${SPEED_CAP_STAGE}*min(stage, ${STAGE_GAIN_MAX}) + (fever ? ${SPEED_CAP_FEVER} : 0). Ground speed is clamped to cap every ground step and when jumping.`,
    `Launch: v = min(cap, groundSpeed); a = atan(slope); pop = (${LAUNCH_POP_BASE} + ${LAUNCH_POP_CHARGE}*charge) * (1 + ${LAUNCH_VALLEY_GAIN}*valley) * (1 + ${LAUNCH_STAGE_GAIN}*min(stage, ${STAGE_GAIN_MAX})); `
      + `vx = v*cos(a) + pop*(${LAUNCH_FWD_SLOPE}*sin(a) + ${LAUNCH_FWD}); vy = v*sin(a) - ${LAUNCH_UP}*pop.`,
    `Valley bonus: valley = min(${VALLEY_MAX}, max(0, -k*v^2/${VALLEY_DIV})), k = y''/(1 + slope^2)^1.5 (negative in a valley bottom).`,
    `Spoon speed (units/s): min(${SPOON_MAX}, ${SPOON_V0} + ${SPOON_ACCEL}*t + ${SPOON_ACCEL2}*t^2) + ${SPOON_ACCEL_LATE}*max(0, t - T0), t = run time in s, T0 = ${r3(SPOON_MAX_T)} s (when it reaches ${SPOON_MAX}; it keeps speeding up after that); it never falls more than ${SPOON_LEASH} units behind; caught when the gap <= ${CATCH_GAP} units.`,
  ];
}

/** 에이전트에게 보내는 짧은 규칙 글(프로토콜 `reset` 의 `rules`). */
export function puddingRules(mode: PuddingActionMode): {
  readonly summary: string; readonly actionSchema: string; readonly observation: string; readonly physics: readonly string[];
} {
  return {
    summary: `Pudding Escape: a jelly slides over endless pudding hills while a spoon chases it. A run ends when the spoon catches it or at ${PUDDING_CAP_S} s game time. `
      + "Each run is scored by its distance (m), normalised per seed between the random and oracle reference bots on a log scale (see the benchmark docs). "
      + "Hold on the ground to charge (full charge after fullHoldS), release on the ground to jump. Land matching the slope angle: PERFECT (<0.3 rad) gives speed and combo, "
      + "GOOD (<0.8 rad) keeps speed, SPLAT loses speed and stumbles (stumbleS: releasing does not jump). Holding in the air dives (stronger gravity). "
      + "Caramel slows you on the ground, cream re-launches a PERFECT/GOOD landing, stars reward a full-charge jump from a valley. Jumping high when transformReady transforms (faster).",
    actionSchema: mode.kind === "segment"
      ? "segment mode. When obs.decision is \"ground\": {\"waitMs\":0..3000,\"holdMs\":0..1500} = stay released waitMs, press holdMs, release (jump). "
        + "If obs.holding is true, waitMs must be 0 (holding continues holdMs more, then release). When obs.decision is \"air\": {\"pressAfterMs\":0..3000 or null} = "
        + "press (dive) pressAfterMs after this decision (normally the liftoff) and keep holding through landing, or null = do not press during this action. "
        + "A segment ends early at the next decision point. Out-of-range numbers are clamped; ms round to 1/120 s steps. Invalid actions count and keep the current hold for 250 ms."
      : `interval mode (k=${mode.k} steps of 1/120 s). Action {"hold":true|false} is applied for k steps. Invalid actions count and keep the current hold for k steps.`,
    observation: "Lengths m, speeds m/s, times s. Heights and slopes: up is positive. terrain.heightM[i]/slope[i] are at i*stepM metres ahead, height relative to the jelly's feet. "
      + "features: kind with startM/endM relative to the jelly. lastSegment summarises what happened during your previous action.",
    physics: puddingPhysics(),
  };
}
