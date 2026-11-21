/**
 * 푸딩 탈출 벤치마크의 점수(2026-11-21 사용자 결정): 판마다 로그 정규화 점수.
 * score = 100 × (ln d − ln d_random) / (ln d_oracle − ln d_random). d 는 판 거리(m), d_random · d_oracle 은 같은 시드에서 segment 방식 기준 봇
 * `random` · `oracle` 의 거리다. 기준 봇은 결정적이라 환경이 직접 계산한다. 위아래로 자르지 않는다(무작위보다 못하면 음수, oracle 을 넘으면 100 초과).
 * 거리는 1 m 아래를 1 m 로 본다(ln 0 을 피한다). 분모가 0 이하인 시드는 점수가 없다(null). 계약: docs/kaito-web/game-benchmark.md#점수
 */
import type { BenchResult } from "./types";
import { runPuddingBaseline } from "./puddingBaselines";

/** 같은 시드의 기준 봇 거리(m). */
export interface PuddingReference { readonly random: number; readonly oracle: number }

/** 기준 봇 판 결과의 캐시(같은 프로세스 안에서 같은 판을 두 번 돌리지 않는다). 키: `이름:시드`. */
const baselineCache = new Map<string, { result: BenchResult }>();

/** segment 방식 기준 봇 판 하나(캐시). 결과는 환경 판 글자와 관계없다. */
export function puddingBaselineResult(name: "random" | "fullCharge" | "oracle", seed: number): BenchResult {
  const key = `${name}:${seed}`;
  let hit = baselineCache.get(key);
  if (!hit) { hit = { result: runPuddingBaseline(name, seed, { envVersion: "reference" }).result }; baselineCache.set(key, hit); }
  return hit.result;
}

/** 시드의 기준 거리(`random`, `oracle`, segment 방식). */
export function puddingReference(seed: number): PuddingReference {
  return { random: puddingBaselineResult("random", seed).score, oracle: puddingBaselineResult("oracle", seed).score };
}

/** 소수 셋째 자리(요약 글자를 짧고 같게 한다). */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 판 하나의 정규화 점수(소수 셋째 자리). 분모가 0 이하이면 null. */
export function puddingNormalizedScore(distance: number, ref: PuddingReference): number | null {
  const lo = Math.log(Math.max(1, ref.random)), hi = Math.log(Math.max(1, ref.oracle));
  if (!(hi - lo > 0)) return null;
  return r3(100 * (Math.log(Math.max(1, distance)) - lo) / (hi - lo));
}
