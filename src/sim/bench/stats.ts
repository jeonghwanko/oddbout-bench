/**
 * 벤치마크 요약 통계(게임과 관계없음): 시드 PRNG 부트스트랩 구간, 요약 칸, 두 요약의 짝 비교, 시드 회차 약속 글.
 * CLI(`tools/bench/bench.mjs`)의 run · verify · compare · seeds-commit 이 같은 함수를 쓴다. 계약: docs/kaito-web/game-benchmark.md#점수
 */
import { createRng, nextFloat } from "../rng";
import type { BenchResult } from "./types";

/** 부트스트랩 반복 수와 시드(같은 값은 같은 구간을 낸다). */
export const BOOTSTRAP_RESAMPLES = 2000, BOOTSTRAP_SEED = 20261121;
/** 공식 실행의 최소 시드 수. */
export const OFFICIAL_MIN_SEEDS = 50;

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
export const median = (a: readonly number[]): number => {
  const b = [...a].sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2;
};
export const mean = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const quantile = (a: readonly number[], p: number): number => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]!; };

/** 통계 `stat` 의 부트스트랩 95% 구간(시드 PRNG `sim/rng`, 시드 `BOOTSTRAP_SEED`, `BOOTSTRAP_RESAMPLES` 번). 값이 없으면 null. */
export function bootstrapCI(values: readonly number[], stat: (v: readonly number[]) => number): [number, number] | null {
  if (!values.length) return null;
  let rng = createRng(BOOTSTRAP_SEED);
  const rnd = (): number => { const d = nextFloat(rng); rng = d.state; return d.value; };
  const out: number[] = [];
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) out.push(stat(values.map(() => values[Math.floor(rnd() * values.length)]!)));
  out.sort((x, y) => x - y);
  return [out[Math.floor(0.025 * out.length)]!, out[Math.min(out.length - 1, Math.floor(0.975 * out.length))]!];
}

/** 요약 칸(판 결과와 판마다 정규화 점수, null 은 점수 없는 시드). */
export interface BenchSummaryStats {
  readonly runs: number;
  /** 주 지표: 판별 정규화 점수의 평균과 부트스트랩 95% 구간(소수 셋째 자리). */
  readonly score: number | null;
  readonly scoreCi95: readonly [number, number] | null;
  readonly scoredRuns: number;
  readonly unscoredSeeds: readonly number[];
  /** 상한까지 잡히지 않은 판 비율(%). */
  readonly escapePct: number;
  readonly perfectPct: number;
  readonly splatPct: number;
  /** 잘못된 행동 비율(% of decisions). */
  readonly invalidPct: number;
  readonly invalidActions: number;
  readonly decisionsPerRun: number;
  /** 참고: 거리(m) 중앙값 · 평균 · p90 · 중앙값 구간. */
  readonly medianDistance: number;
  readonly meanDistance: number;
  readonly p90Distance: number;
  readonly medianDistanceCi95: readonly [number, number] | null;
}

export function summarizeRuns(results: readonly BenchResult[], normalized: readonly (number | null)[]): BenchSummaryStats {
  const dist = results.map(r => r.score), st = (k: string): number => results.reduce((n, r) => n + Number(r.stats[k] ?? 0), 0);
  const landings = st("landings") || 1, decisions = results.reduce((n, r) => n + r.decisions, 0) || 1;
  const scored = normalized.filter((v): v is number => v !== null);
  const ci = bootstrapCI(scored, mean);
  return {
    runs: results.length,
    score: scored.length ? r3(mean(scored)) : null, scoreCi95: ci ? [r3(ci[0]), r3(ci[1])] : null,
    scoredRuns: scored.length, unscoredSeeds: results.filter((_, i) => normalized[i] === null).map(r => r.seed),
    escapePct: r1(100 * results.filter(r => r.stats.caught === false).length / results.length),
    perfectPct: r1(100 * st("perfect") / landings), splatPct: r1(100 * st("splat") / landings),
    invalidPct: r1(100 * results.reduce((n, r) => n + r.invalidActions, 0) / decisions),
    invalidActions: results.reduce((n, r) => n + r.invalidActions, 0), decisionsPerRun: Math.round(mean(results.map(r => r.decisions))),
    medianDistance: median(dist), meanDistance: r1(mean(dist)), p90Distance: quantile(dist, 0.9), medianDistanceCi95: bootstrapCI(dist, median),
  };
}

/** 짝 비교의 판 하나(요약의 `episodes[]` 에서 쓰는 칸). */
export interface PairedEpisode { readonly seed: number; readonly normalized: number | null }

/** 두 요약을 같은 시드끼리 짝지어 정규화 점수 차(a − b)의 평균과 부트스트랩 95% 구간을 낸다. 두 쪽 다 점수가 있는 시드만 쓴다. */
export function comparePaired(a: readonly PairedEpisode[], b: readonly PairedEpisode[]): {
  readonly pairs: number; readonly meanDiff: number | null; readonly ci95: readonly [number, number] | null;
  readonly aWins: number; readonly bWins: number; readonly ties: number; readonly onlyA: number; readonly onlyB: number;
} {
  const bySeed = new Map(b.map(e => [e.seed, e.normalized]));
  const diffs: number[] = [];
  for (const e of a) {
    const other = bySeed.get(e.seed);
    if (e.normalized !== null && other !== undefined && other !== null) diffs.push(e.normalized - other);
  }
  const aSeeds = new Set(a.map(e => e.seed)), ci = bootstrapCI(diffs, mean);
  return {
    pairs: diffs.length, meanDiff: diffs.length ? r3(mean(diffs)) : null, ci95: ci ? [r3(ci[0]), r3(ci[1])] : null,
    aWins: diffs.filter(d => d > 0).length, bWins: diffs.filter(d => d < 0).length, ties: diffs.filter(d => d === 0).length,
    onlyA: a.filter(e => !bySeed.has(e.seed)).length, onlyB: b.filter(e => !aSeeds.has(e.seed)).length,
  };
}

/** 시드 회차 약속(`seeds-commit`)의 해시 입력 글: 겹치지 않게 정렬한 시드와 회차 이름. CLI 가 이 글의 sha256 을 낸다. */
export function seedsCommitText(seeds: readonly number[], round: string | null): string {
  return JSON.stringify({ format: "oddbout-bench-seeds/1", round, seeds: [...new Set(seeds)].sort((x, y) => x - y) });
}
