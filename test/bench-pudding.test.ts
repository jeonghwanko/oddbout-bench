import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  type BenchTrace, OFFICIAL_MIN_SEEDS, PUDDING_CAP_S, PUDDING_PRACTICE_SEEDS, PUDDING_SEED_MAX, PUDDING_SEED_MIN,
  PUDDING_SEED_ZERO_ALIAS, PuddingBenchEnv, type PuddingObs, comparePaired, puddingBaselineResult, puddingNormalizedScore,
  puddingPhysics, puddingReference, puddingRules, replay, runPuddingBaseline, seedsCommitText, summarizeRuns,
} from "../src/sim/bench";
import { BEAR_TRAITS } from "../src/sim/pudding/jellies";
import { launchVelocity, valleyAt } from "../src/sim/pudding/run";
import { startTerrain } from "../src/sim/pudding/terrain";

/** 벤치마크 환경(docs/kaito-web/game-benchmark.md): 결정론 · 다시 돌리기 · 행동 방식 · 관찰. 규칙 값은 보지 않는다. */
const V = "test";
const env = (actionMode?: string) => new PuddingBenchEnv({ envVersion: V, actionMode });
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const closeTo = (a: number, b: number, digits = 2): void => {
  assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} not close to ${b} (digits ${digits})`);
};

/** 관찰 안의 수가 모두 유한한가(중첩 배열 · 객체 포함). */
function allFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === "object") return Object.values(v).every(allFinite);
  return true;
}

describe("푸딩 탈출 벤치마크 환경", () => {
  it("공개 연습 시드는 1..10 이다", () => {
    assert.deepEqual(PUDDING_PRACTICE_SEEDS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("같은 시드와 같은 기록은 두 번 다 같은 결과를 낸다", () => {
    const { trace } = runPuddingBaseline("random", 3, { envVersion: V });
    assert.deepEqual(replay(env(), json(trace)), replay(env(), json(trace)));
  });

  for (const name of ["random", "fullCharge", "oracle"] as const) {
    it(`${name} 의 실제 판과 기록 다시 돌리기가 같다`, { timeout: 120_000 }, () => {
      const { result, trace } = runPuddingBaseline(name, 2, { envVersion: V });
      assert.equal(trace.actions.length, result.decisions);
      assert.deepEqual(replay(env(), json(trace)), result);
    });
  }

  it("기록에는 점수가 없다", () => {
    const { trace } = runPuddingBaseline("fullCharge", 1, { envVersion: V });
    assert.deepEqual(Object.keys(trace).sort(), ["actionMode", "actions", "envVersion", "format", "game", "seed", "track"]);
  });

  it("땅 행동은 뛴다(다음 결정은 공중)", () => {
    const e = env();
    assert.equal(e.reset(1).decision, "ground");
    const step = e.step({ waitMs: 0, holdMs: 360 });
    assert.equal(step.info.invalid, false);
    assert.equal(step.obs.lastSegment.jumps.length, 1);
    assert.equal(step.obs.lastSegment.jumps[0]!.full, true);
    assert.equal(step.obs.decision, "air");
    assert.equal(step.obs.grounded, false);
  });

  it("잘못된 행동은 세고 기록에 그대로 두며 다시 돌려도 같다", () => {
    const e = env();
    e.reset(4);
    const bad: unknown[] = [null, { waitMs: "x", holdMs: 1 }, [1, 2], { pressAfterMs: 100 }];
    for (const a of bad) assert.equal(e.step(a).info.invalid, true);
    const fixed = (o: PuddingObs) => o.decision === "air" ? { pressAfterMs: null } : { waitMs: 0, holdMs: 360 };
    let obs = e.observe();
    while (!e.isDone()) obs = e.step(fixed(obs)).obs;
    const result = e.result();
    assert.equal(result.invalidActions, 4);
    const trace = e.trace();
    assert.deepEqual(trace.actions.slice(0, 4), bad);
    assert.deepEqual(replay(env(), json(trace)), result);
  });

  it("누르고 있으면 waitMs 는 0 이어야 한다", () => {
    const e = env();
    let obs = e.reset(6);
    for (let i = 0; i < 200 && !e.isDone() && !(obs.decision === "ground" && obs.holding); i++) {
      obs = e.step(obs.decision === "air" ? { pressAfterMs: 0 } : { waitMs: 0, holdMs: 360 }).obs;
    }
    assert.equal(Boolean(obs.holding && obs.decision === "ground"), true);
    assert.equal(e.clone().step({ waitMs: 100, holdMs: 100 }).info.invalid, true);
    assert.equal(e.clone().step({ waitMs: 0, holdMs: 100 }).info.invalid, false);
  });

  it("판 상한은 90 초다(규칙 글에도 같은 값)", () => {
    assert.equal(PUDDING_CAP_S, 90);
    assert.ok(puddingRules({ kind: "segment" }).summary.includes(`at ${PUDDING_CAP_S} s game time`));
  });

  it("판은 잡히면 끝나고, 아니면 판 상한에서 끝난다", { timeout: 120_000 }, () => {
    const { result } = runPuddingBaseline("fullCharge", 1, { envVersion: V });
    assert.equal(result.stats.caught, true);
    assert.ok((result.stats.timeS as number) < PUDDING_CAP_S);
    const oracle = runPuddingBaseline("oracle", 2, { envVersion: V }).result;
    assert.equal(oracle.stats.caught === true || oracle.stats.timeS === PUDDING_CAP_S, true);
    assert.ok((oracle.stats.timeS as number) <= PUDDING_CAP_S);
  });

  it("관찰의 수는 모두 유한하고 앞 지형은 51 점이다", () => {
    const e = env();
    let obs = e.reset(7);
    for (let i = 0; i < 60 && !e.isDone(); i++) {
      assert.equal(allFinite(obs), true);
      assert.equal(obs.terrain.heightM.length, 51);
      assert.equal(obs.terrain.slope.length, 51);
      obs = e.step(obs.decision === "air" ? { pressAfterMs: 250 } : { waitMs: 50, holdMs: 300 }).obs;
    }
    assert.equal(allFinite(e.result()), true);
  });

  it("interval 방식: 행동 방식이 기록에 남고 다시 돌려도 같다", () => {
    for (const name of ["random", "fullCharge"] as const) {
      const { result, trace } = runPuddingBaseline(name, 5, { envVersion: V, actionMode: "interval:8" });
      assert.equal(trace.actionMode, "interval:8");
      assert.ok(result.score > 0);
      assert.deepEqual(replay(env("interval:8"), json(trace)), result);
    }
    const e = env("interval:4");
    const obs = e.reset(1);
    assert.equal(obs.decision, null);
    closeTo(e.step({ hold: true }).obs.t, 4 / 120, 2);
    assert.throws(() => env("interval:0"));
  });

  it("시드는 1..2^32-1 이다(0 은 0x9e3779b9 와 같은 판이라 거부한다)", () => {
    assert.equal(PUDDING_SEED_MIN, 1);
    assert.doesNotThrow(() => env().reset(PUDDING_SEED_MAX));
    assert.doesNotThrow(() => env().reset(1));
    assert.doesNotThrow(() => env().reset(PUDDING_SEED_ZERO_ALIAS));
    assert.throws(() => env().reset(0));
    assert.throws(() => env().reset(PUDDING_SEED_MAX + 1));
    assert.throws(() => env().reset(-1));
  });

  it("규칙 글의 발사 · 골짜기 식은 규칙 코드와 같은 값을 낸다", () => {
    const lines = puddingPhysics();
    const n = "(-?\\d+(?:\\.\\d+)?)";
    const launch = new RegExp(`^Launch: v = min\\(cap, groundSpeed\\); a = atan\\(slope\\); pop = \\(${n} \\+ ${n}\\*charge\\) \\* \\(1 \\+ ${n}\\*valley\\) \\* \\(1 \\+ ${n}\\*min\\(stage, ${n}\\)\\); `
      + `vx = v\\*cos\\(a\\) \\+ pop\\*\\(${n}\\*sin\\(a\\) \\+ ${n}\\); vy = v\\*sin\\(a\\) - ${n}\\*pop\\.$`);
    const m = lines.map(l => launch.exec(l)).find(Boolean);
    assert.ok(m);
    const [base, chg, vg, sg, smax, fwdS, fwd, up] = m!.slice(1).map(Number) as [number, number, number, number, number, number, number, number];
    const valleyLine = new RegExp(`^Valley bonus: valley = min\\(${n}, max\\(0, -k\\*v\\^2/${n}\\)\\)`);
    const vm = lines.map(l => valleyLine.exec(l)).find(Boolean);
    assert.ok(vm);
    const [vmax, vdiv] = vm!.slice(1).map(Number) as [number, number];
    for (const [v, sl, charge, valley, stage] of [[300, 0.2, 0, 0, 0], [520, -0.4, 1, 0.8, 3], [610, 0.05, 0.37, 0.21, 11], [140, -1.2, 0.9, 0.5, 8]] as const) {
      const a = Math.atan(sl);
      const pop = (base + chg * charge) * (1 + vg * valley) * (1 + sg * Math.min(stage, smax));
      const want = launchVelocity(v, sl, charge, valley, stage, BEAR_TRAITS);
      closeTo(v * Math.cos(a) + pop * (fwdS * Math.sin(a) + fwd), want.vx, 9);
      closeTo(v * Math.sin(a) - up * pop, want.vy, 9);
    }
    const t = startTerrain(false);
    for (const [x, v] of [[290, 520], [250, 300], [299, 700]] as const) {
      const s0 = t.segs[1]!, w = s0.x1 - s0.x0, k01 = (x - s0.x0) / w;
      const sl = (s0.y1 - s0.y0) * Math.PI / (2 * w) * Math.sin(Math.PI * k01);
      const ypp = (s0.y1 - s0.y0) * Math.PI * Math.PI / (2 * w * w) * Math.cos(Math.PI * k01);
      const k = ypp / Math.pow(1 + sl * sl, 1.5);
      closeTo(Math.min(vmax, Math.max(0, -k * v * v / vdiv)), valleyAt(t, x, v), 12);
    }
  });

  it("정규화 점수: 100 × (ln d − ln d_random) / (ln d_oracle − ln d_random), 자르지 않고 분모 0 이하는 null", () => {
    const ref = { random: 400, oracle: 20000 };
    assert.equal(puddingNormalizedScore(400, ref), 0);
    assert.equal(puddingNormalizedScore(20000, ref), 100);
    closeTo(puddingNormalizedScore(2000, ref)!, 100 * (Math.log(2000) - Math.log(400)) / (Math.log(20000) - Math.log(400)), 3);
    assert.ok(puddingNormalizedScore(100, ref)! < 0);
    assert.ok(puddingNormalizedScore(40000, ref)! > 100);
    assert.equal(puddingNormalizedScore(0, ref), puddingNormalizedScore(1, ref));
    assert.equal(puddingNormalizedScore(500, { random: 600, oracle: 600 }), null);
    assert.equal(puddingNormalizedScore(500, { random: 700, oracle: 600 }), null);
  });

  it("기준 거리는 segment 방식 random · oracle 판이고 캐시는 같은 결과를 준다", { timeout: 120_000 }, () => {
    const ref = puddingReference(1);
    assert.equal(ref.random, runPuddingBaseline("random", 1, { envVersion: V }).result.score);
    assert.equal(puddingBaselineResult("oracle", 1), puddingBaselineResult("oracle", 1));
    assert.equal(ref.oracle, puddingBaselineResult("oracle", 1).score);
    assert.ok(ref.oracle > ref.random);
  });

  it("요약: 주 지표는 판별 정규화 점수의 평균, 점수 없는 시드는 빼고 센다", () => {
    const results = [1, 2, 3].map(seed => runPuddingBaseline("fullCharge", seed, { envVersion: V }).result);
    const s = summarizeRuns(results, [10, null, 30]);
    assert.equal(s.score, 20);
    assert.equal(s.scoredRuns, 2);
    assert.deepEqual(s.unscoredSeeds, [2]);
    assert.equal(s.escapePct, 0);
    assert.ok(s.scoreCi95![0] <= 20);
    assert.ok(s.scoreCi95![1] >= 20);
    assert.deepEqual(summarizeRuns(results, [10, null, 30]), s);
  });

  it("compare: 같은 시드끼리 짝지어 차의 평균과 구간을 낸다", () => {
    const a = [{ seed: 1, normalized: 50 }, { seed: 2, normalized: 40 }, { seed: 3, normalized: 30 }, { seed: 9, normalized: 99 }];
    const b = [{ seed: 3, normalized: 35 }, { seed: 1, normalized: 20 }, { seed: 2, normalized: null }];
    const c = comparePaired(a, b);
    assert.equal(c.pairs, 2);
    assert.equal(c.meanDiff, 12.5);
    assert.deepEqual([c.aWins, c.bWins, c.ties, c.onlyA, c.onlyB], [1, 1, 0, 1, 0]);
    assert.equal(comparePaired(a, []).pairs, 0);
  });

  it("seeds-commit: 차례 · 겹침과 관계없이 같은 시드 집합과 회차는 같은 글(해시 입력)이다", () => {
    assert.equal(seedsCommitText([3, 1, 2, 2], "r1"), seedsCommitText([1, 2, 3], "r1"));
    assert.notEqual(seedsCommitText([1, 2, 3], "r1"), seedsCommitText([1, 2, 3], "r2"));
    assert.notEqual(seedsCommitText([1, 2, 3], null), seedsCommitText([1, 2, 4], null));
    assert.match(createHash("sha256").update(seedsCommitText([1, 2, 3], null)).digest("hex"), /^[0-9a-f]{64}$/);
    assert.equal(OFFICIAL_MIN_SEEDS, 50);
  });

  it("행동 방식 · 환경 판이 다르거나 행동이 모자라면 다시 돌리기를 멈춘다", () => {
    const { trace } = runPuddingBaseline("fullCharge", 1, { envVersion: V });
    assert.throws(() => replay(new PuddingBenchEnv({ envVersion: "other" }), trace));
    assert.throws(() => replay(env("interval:8"), trace));
    const short: BenchTrace = { ...trace, actions: trace.actions.slice(0, -1) };
    assert.throws(() => replay(env(), short));
    const long: BenchTrace = { ...trace, actions: [...trace.actions, null] };
    assert.throws(() => replay(env(), long));
  });
});
