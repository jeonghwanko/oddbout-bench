/**
 * 푸딩 탈출 판 진단(2026-11-19 재제출 2단계, 순수): 한 판에서 일어난 일을 작은 사실 묶음(`RunFacts`)으로 모으고,
 * 정한 순서로 주된 원인 하나와 다음 판 팁 하나(`TipId`)를 고른다. 결과 화면이 팁을 그림 + 짧은 글로 보인다.
 *
 * 사실은 `startRun` 이 비우고 `reviveRun`(이어 달리기)은 그대로 둔다. 튜토리얼 판의 튜토리얼 비행·점프는 세지 않는다.
 * 화면 글자는 페이지(`src/pudding/result.ts`)가 소유한다. 여기서는 id 만 정한다.
 */

/** SPLAT 의 자리: 오르막에 내려앉음 · 경사보다 가파르게 떨어짐 · 경사보다 납작하게 날아듦. */
export type SplatKind = "uphill" | "steep" | "flat";

/**
 * 다음 판 팁(원인 하나에 팁 하나). `fever` 만 잘한 판의 칭찬이다.
 * uphill · steep · flat: SPLAT 자리, caramel: 캐러멜 늪을 달려 지나다 잡힘(2026-11-19 4단계), transform: POWER UP! 뒤 변신 못 함,
 * dive: 공중 누르기를 안 씀, charge: 게이지를 덜 채우고 뗌, fever: PERFECT 를 잘 냄,
 * bomb: 젤리 폭탄을 들고도 하나도 던지지 않고 잡힘(2026-11-20 아이템), speed: 그 밖(숟가락이 따라잡음).
 */
export const TIP_IDS = ["uphill", "steep", "flat", "caramel", "transform", "dive", "charge", "fever", "bomb", "speed"] as const;
export type TipId = (typeof TIP_IDS)[number];

/** 이 기울기보다 더 올라가는 자리(기울기 < −값)에 내려앉은 SPLAT 은 오르막 SPLAT 이다. */
export const UPHILL_SLOPE = 0.03;
/** 공중에서 이만큼(초) 넘게 누른 비행은 내리꽂은(dive) 비행이다. */
export const DIVE_MIN_HOLD = 0.05;
/** 마지막 SPLAT 뒤 이 시간(초) 안에 잡히면 그 SPLAT 이 판을 끝낸 원인이다. */
export const CAUGHT_AFTER_SPLAT = 2.5;
/** 땅에서 캐러멜 늪을 벗어난 뒤 이 시간(초) 안에 잡히면(늪 위에서 잡혀도) 늪이 판을 끝낸 원인이다. */
export const CAUGHT_AFTER_CARAMEL = 2.5;
/** POWER UP! 뒤 이만큼(초) 넘게 변신하지 못한 채 판이 끝나면 변신을 놓친 판이다. */
export const READY_MISS_T = 4;
/** 판정 착지가 이만큼 넘게 있어야 공중 누르기를 안 쓴 판으로 본다. */
export const DIVE_MIN_FLIGHTS = 4;
/** 점프가 이만큼 넘게 있어야 게이지를 덜 채운 판으로 본다. */
export const CHARGE_MIN_JUMPS = 4;
/** PERFECT 가 이만큼 이상이면 잘한 판이다. */
export const GOOD_RUN_PERFECTS = 3;

export interface RunFacts {
  /** 판정 착지 수(튜토리얼 비행 제외). */
  perfect: number; good: number; splat: number;
  /** SPLAT 자리별 수. */
  splatUphill: number; splatSteep: number; splatFlat: number;
  /** 공중에서 누른(내리꽂은) 판정 비행 수. */
  dives: number;
  /** 땅에서 뗀 점프 수, 그중 게이지를 다 채운 점프 수(튜토리얼 동안 제외). */
  jumps: number; fullJumps: number;
  /** 이번 판에 시작한 변신 수, 켜진 피버 수. */
  transforms: number; fevers: number;
  /** 지금 POWER UP! 이 켜진 채 흐른 시간(초). 꺼져 있으면 0. */
  readyT: number;
  /** 마지막 SPLAT 의 자리와 그 뒤 흐른 시간(초, 없으면 큰 값). */
  lastSplat: SplatKind | null; sinceSplat: number;
  /** 잡힌 순간: 마지막 SPLAT 뒤 `CAUGHT_AFTER_SPLAT` 초 안이었는가. 이어 달리면 다음 잡힘이 다시 적는다. */
  caughtAfterSplat: boolean;
  /** 이번 비행에서 공중에서 누른 시간(초). 땅을 떠날 때 0 이 된다. */
  airHoldT: number;
  /** 지형 판단 요소(2026-11-19 4단계): 땅에서 들어간 캐러멜 늪 수, 땅에서 늪 위에 마지막으로 있던 뒤 흐른 시간(초, 없으면 큰 값),
   *  잡힌 순간이 늪 뒤 `CAUGHT_AFTER_CARAMEL` 초 안이었는가, 생크림에서 튕긴 수, 먹은 별 동전 수. */
  caramelHits: number; sinceCaramel: number; caughtAfterCaramel: boolean; creamBounces: number; stars: number;
  /** 아이템(2026-11-20): 판 시작 때 들고 간 폭탄 수(`startRun` 이 적는다), 던진 폭탄 수, 열기구가 구해 준 수,
   *  잡힌 순간 아직 던지지 않은 폭탄이 있었는가(이어 달리면 다음 잡힘이 다시 적는다). 팁 `bomb` 이 앞 둘을 쓴다. */
  bombsHeld: number; bombsUsed: number; balloonSaves: number; caughtWithBomb: boolean;
  /** 자석(2026-11-21): 이 판에 자석을 썼는가(판 첫 걸음에 참, `magnetOn` 사건), 자석이 끌어 먹은 동전 수(원래 사거리에 닿기 전에 먹은 동전 포함). */
  magnet: boolean; coinsPulled: number;
}

/** 빈 사실 묶음(새 판). */
export function newFacts(): RunFacts {
  return { perfect: 0, good: 0, splat: 0, splatUphill: 0, splatSteep: 0, splatFlat: 0, dives: 0, jumps: 0, fullJumps: 0,
    transforms: 0, fevers: 0, readyT: 0, lastSplat: null, sinceSplat: 999, caughtAfterSplat: false, airHoldT: 0,
    caramelHits: 0, sinceCaramel: 999, caughtAfterCaramel: false, creamBounces: 0, stars: 0,
    bombsHeld: 0, bombsUsed: 0, balloonSaves: 0, caughtWithBomb: false, magnet: false, coinsPulled: 0 };
}

/**
 * SPLAT 자리 나누기. `slope` 는 내려앉은 자리의 기울기(+ 내리막), `vx`·`vy` 는 내려앉는 속도(아래가 +).
 * 오르막(기울기 < −UPHILL_SLOPE)이면 uphill. 아니면 날아든 각도가 경사보다 아래로 크면 steep, 위로 크면(납작) flat.
 */
export function splatKind(slope: number, vx: number, vy: number): SplatKind {
  if (slope < -UPHILL_SLOPE) return "uphill";
  return Math.atan2(vy, vx) > Math.atan(slope) ? "steep" : "flat";
}

/** 가장 많은 SPLAT 자리(같으면 uphill → steep → flat 순). */
function topSplat(f: RunFacts): SplatKind {
  const by: [SplatKind, number][] = [["uphill", f.splatUphill], ["steep", f.splatSteep], ["flat", f.splatFlat]];
  let best = by[0]!;
  for (const e of by) if (e[1] > best[1]) best = e;
  return best[0];
}

/**
 * 주된 원인 하나 → 팁 id. 순서(앞이 먼저):
 * 1. SPLAT 뒤 곧 잡혔다 → 그 SPLAT 자리(uphill · steep · flat).
 * 1a. 캐러멜 늪을 달려 지난 뒤 곧 잡혔다 → caramel(2026-11-19 4단계. 앞 원인들의 순서는 그대로다).
 * 2. POWER UP! 뒤 `READY_MISS_T` 초 넘게 변신 못 하고 끝났다 → transform.
 * 3. SPLAT 이 2번 이상이고 PERFECT + GOOD 이상이다 → 가장 많은 SPLAT 자리.
 * 4. 판정 비행이 `DIVE_MIN_FLIGHTS` 이상인데 공중 누르기가 없다 → dive.
 * 5. 점프가 `CHARGE_MIN_JUMPS` 이상인데 반 넘게 게이지를 덜 채웠다 → charge.
 * 6. PERFECT 가 `GOOD_RUN_PERFECTS` 이상이다 → fever(칭찬: 다섯 번 이어 피버).
 * 7. 젤리 폭탄을 들고 잡혔는데 한 번도 던지지 않았다 → bomb(2026-11-20).
 * 8. 그 밖 → speed.
 */
export function diagnoseRun(f: RunFacts): TipId {
  if (f.caughtAfterSplat && f.lastSplat) return f.lastSplat;
  if (f.caughtAfterCaramel) return "caramel";
  if (f.readyT > READY_MISS_T) return "transform";
  if (f.splat >= 2 && f.splat >= f.perfect + f.good) return topSplat(f);
  if (f.perfect + f.good + f.splat >= DIVE_MIN_FLIGHTS && f.dives === 0) return "dive";
  if (f.jumps >= CHARGE_MIN_JUMPS && f.fullJumps * 2 < f.jumps) return "charge";
  if (f.perfect >= GOOD_RUN_PERFECTS) return "fever";
  if (f.caughtWithBomb && f.bombsUsed === 0) return "bomb";
  return "speed";
}
