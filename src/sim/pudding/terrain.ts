/**
 * 푸딩 언덕: 코사인 반 물결을 이어 붙인다(기울기·곡률을 식으로 바로 안다).
 * 높은 마루와 낮은 골을 번갈아 놓고, 멀리 갈수록 짧고 가파르게 만든다. 황금 동전 자리도 여기서 정한다.
 * 지형 판단 요소(2026-11-19 재제출 4단계)도 여기서 놓는다: 캐러멜 늪 · 생크림 트램펄린 · 별 길. 거리마다 하나씩 처음 혼자 나오고(표지판), 그 뒤 섞인다.
 * 요소의 효과(감속 · 튕김)와 별 동전 자리는 물리가 필요해 `run.ts` 가 맡는다.
 * 난수는 부르는 쪽이 넘긴다(`rand` — 판의 시드 PRNG). 요소의 난수는 `FEATURE_START_X` 뒤에서만 꺼낸다(그 앞 지형은 요소가 없던 때와 같다).
 */
export interface Seg { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }
/** 황금 동전. `star` 는 별 길의 별 동전, `taken` 은 이번 걸음에 먹었다는 표시다(걸음 끝에 목록에서 뺀다). */
/** 동전 하나. `taken`: 먹어서 지운다. `pulled`: 자석이 먼저 끌어 먹었다(골드는 이미 셌고 그리지 않는다, 원래 사거리에 닿으면 속력만 밀고 지운다). */
export interface Drop { readonly x: number; readonly y: number; readonly star?: boolean; taken?: boolean; pulled?: boolean }

/** 지형 판단 요소: 캐러멜 늪(골짜기 바닥) · 생크림 트램펄린(마루 꼭대기) · 별 길(골짜기에서 꽉 채워 뛰면 닿는 높은 별 아치). */
export type FeatureKind = "caramel" | "cream" | "stars";
export interface Feature {
  readonly kind: FeatureKind;
  /** 효과 구간(월드 x). caramel 은 골짜기 바닥의 늪, cream 은 마루 꼭대기의 생크림, stars 는 뛸 골짜기 한 점(x0 = x1). */
  readonly x0: number; readonly x1: number;
  /** 이번 판에 이 종류가 처음 나왔다(앞에 표지판을 세운다). */
  readonly intro: boolean;
  /** stars: 별 동전을 놓았다(`run.ts` 의 `placeStars`). */
  placed?: boolean;
}

/**
 * `lows` 는 지금까지 이은 내리막(마루에서 골로 가는 조각) 수다(동전 줄을 몇 번째 내리막마다 놓을지 센다).
 * `feats` 는 판단 요소, `featGap` 은 다음 요소까지 비워 둘 조각 수, `seen` 은 이번 판에 소개한 종류다.
 */
export interface Terrain {
  segs: Seg[]; segEnd: number; lastHigh: boolean; lows: number; drops: Drop[];
  feats: Feature[]; featGap: number; seen: FeatureKind[];
}

/**
 * 땅을 타고 먹는 동전 줄은 내리막 이 수마다 하나 놓는다(마루 위 아치는 늘 놓는다).
 * 점프가 납작해져(2026-11-19 2안) 같은 시간에 더 멀리 가므로, 판당 골드가 전과 비슷하도록 줄을 넷에 하나로 줄였다.
 */
export const COIN_LINE_EVERY = 4;

/** 판단 요소를 소개하는 차례. */
export const FEATURE_KINDS: readonly FeatureKind[] = ["caramel", "cream", "stars"];
/**
 * 요소가 처음 나오는 거리(m). 이 거리를 지난 첫 알맞은 조각에 혼자(표지판과 함께) 나온다.
 * 판 거리 중앙값(약 400~1,200 m)에 맞춰, 서툰 판도 하나는 보고 보통 판은 둘~셋을 본다. 튜토리얼(약 190 m)과 첫 변신(100 m) 뒤다.
 */
export const FEATURE_AT_M: Readonly<Record<FeatureKind, number>> = { caramel: 250, cream: 420, stars: 600 };
/** 이 x 앞에서는 요소를 놓지 않고 요소 난수도 꺼내지 않는다. */
export const FEATURE_START_X = Math.min(...Object.values(FEATURE_AT_M)) * 10;
/** 처음 나온 요소 뒤 · 다른 요소 뒤에 비워 두는 조각 수. */
export const INTRO_GAP = 3, FEATURE_GAP = 2;
/** 소개한 종류가 맞는 빈 조각에 요소가 나올 확률. */
export const FEATURE_CHANCE = 0.5;
/**
 * 캐러멜 늪은 골짜기 바닥에 고인다: 골짜기 앞(내리막 끝) `CARAMEL_BEFORE` 부터 골짜기 뒤(오르막 시작) `CARAMEL_AFTER` 까지. 지형 모양은 바꾸지 않는다.
 * (마루 위에 평지를 끼운 안은 늪 감속이 없어도 잘하는 판의 시간이 26 → 21 초로 줄어 버렸다.)
 */
export const CARAMEL_BEFORE = 60, CARAMEL_AFTER = 50;
/**
 * 생크림은 오르막 윗부분부터 마루 너머 조금까지 얹는다: 오르막 폭의 `CREAM_FROM` 비율 자리부터 마루 뒤 `CREAM_OVER` 까지.
 * 측정에서 판정 착지의 대부분이 오르막 윗부분(마루 근처)이었다. 그래서 겨냥할 만한 자리에 둔다.
 */
export const CREAM_FROM = 0.55, CREAM_OVER = 24;
/** 별 길 골짜기 뒤 오르막의 최소 폭. 꽉 채운 골짜기 점프가 짧고 가파른 오르막에 바로 꽂히지 않게 한다(난수는 그대로 꺼낸다). */
export const STAR_UPHILL_W = 330;

/**
 * 튜토리얼 판의 앞길(2026-11-19 1단계). 평지(1단계 누르기·떼기) → 길고 곧은 내리막(2단계 내리막 점프) → 오르막 →
 * 큰 내리막(3단계: 누른 채 속력을 모아 뛴다) → 짧은 오르막과 마루 → 마루 뒤 내리막(3단계: 공중에서 눌러 이 경사에 맞춰 내려앉는다).
 * 3단계 모양은 손짓을 따르는 플레이어(손짓 뒤 0~0.12 초 늦게 누르고 0~0.1 초 늦게 뗌)가 첫 시도에 PERFECT 를 받도록 골랐다(2026-11-19 2안 점프로 다시 골랐다).
 */
export const TUTORIAL_SEGS: readonly Seg[] = [
  { x0: -600, x1: 160, y0: 96, y1: 96 },
  { x0: 160, x1: 820, y0: 96, y1: 150 },
  { x0: 820, x1: 1040, y0: 150, y1: 66 },
  { x0: 1040, x1: 1520, y0: 66, y1: 150 },
  { x0: 1520, x1: 1640, y0: 150, y1: 100 },
  { x0: 1640, x1: 1900, y0: 100, y1: 150 },
];

/** 지형의 첫 모양. 시작 화면·판은 평지 뒤 짧은 내리막, 튜토리얼 판은 `TUTORIAL_SEGS`. */
export function startTerrain(tutorial: boolean): Terrain {
  const segs: Seg[] = tutorial
    ? TUTORIAL_SEGS.map(seg => ({ ...seg }))
    : [{ x0: -600, x1: 0, y0: 96, y1: 96 }, { x0: 0, x1: 300, y0: 96, y1: 140 }];
  return { segs, segEnd: segs[segs.length - 1]!.x1, lastHigh: false, lows: 0, drops: [], feats: [], featGap: 0, seen: [] };
}

/**
 * 새 조각 `s`(오르막이면 `high`)에 놓을 요소. 생크림은 오르막(끝의 마루), 캐러멜 · 별 길은 내리막(끝의 골짜기)에 맞는다.
 * 1. 거리가 된 종류 중 아직 소개하지 않은 것이 있으면, 그 종류에 맞는 첫 빈 조각에 혼자 놓는다(`INTRO_GAP` 조각을 비운다).
 * 2. 아니면 소개한 종류 중 이 조각에 맞는 것을 `FEATURE_CHANCE` 확률로 고른다(`FEATURE_GAP` 조각을 비운다).
 */
function pickFeature(t: Terrain, s: Seg, high: boolean, rand: () => number): { kind: FeatureKind; intro: boolean } | null {
  if (s.x0 < FEATURE_START_X) return null;
  if (t.featGap > 0) { t.featGap--; return null; }
  const fits = (k: FeatureKind) => (k === "cream") === high;
  const due = FEATURE_KINDS.find(k => !t.seen.includes(k) && s.x0 >= FEATURE_AT_M[k] * 10);
  if (due) {
    if (!fits(due)) return null;
    t.seen.push(due); t.featGap = INTRO_GAP;
    return { kind: due, intro: true };
  }
  const pool = t.seen.filter(fits);
  if (!pool.length || rand() >= FEATURE_CHANCE) return null;
  t.featGap = FEATURE_GAP;
  return { kind: pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!, intro: false };
}

/** `x` 까지 언덕을 잇는다. 마루 위에는 늘 동전 아치(날아야 먹는다), 내리막 `COIN_LINE_EVERY` 개마다 땅을 타고 내려가며 먹는 줄. */
export function genTo(t: Terrain, x: number, rand: () => number): void {
  while (t.segEnd < x) {
    const d = Math.min(1, t.segEnd / 12000);          // 멀리 갈수록 짧고 가파른 언덕
    const high = !t.lastHigh, last = t.feats[t.feats.length - 1];
    let w = 190 + rand() * 230 - d * 70;
    if (high && last?.kind === "stars" && last.x0 === t.segEnd) w = Math.max(w, STAR_UPHILL_W);
    const y1 = high ? 70 + rand() * 24 - d * 18 : 128 + rand() * 18 + d * 8;
    const s: Seg = { x0: t.segEnd, x1: t.segEnd + w, y0: t.segs[t.segs.length - 1]!.y1, y1 };
    t.segs.push(s); t.segEnd += w; t.lastHigh = high;
    const f = pickFeature(t, s, high, rand);
    if (high) {
      if (f) t.feats.push({ kind: "cream", x0: s.x0 + w * CREAM_FROM, x1: s.x1 + CREAM_OVER, intro: f.intro });
      for (let i = -3; i <= 3; i++) t.drops.push({ x: s.x1 + i * 14, y: y1 - 44 - (9 - i * i) * 3.2 });
    } else {
      if (f?.kind === "caramel") t.feats.push({ kind: "caramel", x0: s.x1 - CARAMEL_BEFORE, x1: s.x1 + CARAMEL_AFTER, intro: f.intro });
      else if (f?.kind === "stars") t.feats.push({ kind: "stars", x0: s.x1, x1: s.x1, intro: f.intro });
      if (t.lows++ % COIN_LINE_EVERY === 0) for (let k = 0.18; k <= 0.82; k += 0.13) { const dx = s.x0 + w * k; t.drops.push({ x: dx, y: s.y0 + (s.y1 - s.y0) * (1 - Math.cos(Math.PI * k)) / 2 - 11 }); }
    }
  }
}

/** 숟가락이 지나간 지 오래된 언덕과 요소를 버린다(앞의 셋은 남긴다). */
export function trimTerrain(t: Terrain, behindX: number): void {
  while (t.segs.length > 3 && t.segs[1]!.x1 < behindX) t.segs.shift();
  if (t.feats.length && t.feats[0]!.x1 < behindX - 200) t.feats = t.feats.filter(f => f.x1 >= behindX - 200);
}

/** `wx` 가 든 `kind` 요소(없으면 undefined). */
export function featureAt(t: Terrain, wx: number, kind: FeatureKind): Feature | undefined {
  return t.feats.find(f => f.kind === kind && wx >= f.x0 && wx <= f.x1);
}

export function segAt(t: Terrain, wx: number): Seg {
  for (let i = t.segs.length - 1; i >= 0; i--) if (wx >= t.segs[i]!.x0) return t.segs[i]!;
  return t.segs[0]!;
}
/** 땅 높이(아래가 +). */
export function hill(t: Terrain, wx: number): number {
  const s = segAt(t, wx), k = Math.min(1, (wx - s.x0) / (s.x1 - s.x0));
  return s.y0 + (s.y1 - s.y0) * (1 - Math.cos(Math.PI * k)) / 2;
}
/** 기울기 dy/dx(+ 는 내리막). */
export function slope(t: Terrain, wx: number): number {
  const s = segAt(t, wx), w = s.x1 - s.x0, k = Math.min(1, (wx - s.x0) / w);
  return (s.y1 - s.y0) * Math.PI / (2 * w) * Math.sin(Math.PI * k);
}
/** 곡률 d²y/dx²(+ 는 마루, - 는 골짜기). */
export function curv(t: Terrain, wx: number): number {
  const s = segAt(t, wx), w = s.x1 - s.x0, k = Math.min(1, (wx - s.x0) / w);
  return (s.y1 - s.y0) * Math.PI * Math.PI / (2 * w * w) * Math.cos(Math.PI * k);
}
