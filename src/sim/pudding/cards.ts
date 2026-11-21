/**
 * 푸딩 탈출 젤리 카드와 합성(2026-11-20 사용자 결정, 순수): 해금 · 카드 수 · 고른 젤리 · 캐릭터별 변신 도감.
 * 상점에서 곰젤리 카드를 산다(`CARD_PRICE`, 1장 · 10장 묶음, 할인 없음). 같은 등급 카드 `MERGE_COST` 장이 다음 등급 카드 1장이 된다
 * (`MERGE_UP`: 기본 → 희귀 → 영웅 → 전설). 결과는 그 등급 안에서 무작위다. 난수는 페이지가 만든 시드로 `sim/rng.ts` 에서 꺼낸다.
 * 전설은 무작위 합성이 없다. 신화 메카는 정해진 조합(`MECHA_RECIPE`, 드래곤 · 해파리 · 유령 한 장씩)으로만 만든다.
 * 바로 해금(2026-11-20 사용자 결정): 잠긴 젤리는 골드(`UNLOCK_PRICE`, 등급별)로 바로 해금할 수 있다. 해금하면 그 젤리 카드 1장을 준다(합성으로 얻을 때와 같다).
 * 카드를 한 번 얻은 캐릭터는 영구 해금이다(`owned`). 카드를 합성에 써도 해금은 남는다. 곰젤리는 처음부터 해금이다. 카드는 캐릭터당 `CARD_MAX` 장까지다.
 * 도감(`dex`)은 캐릭터마다 가장 높이 오른 형태 번호다(`dexReach` 와 같은 규칙).
 * 형태 보상(2026-11-21 사용자 결정): 본 형태(젤리 × 형태 번호 n, 1..`DEX_SIZE`)마다 한 번 `formReward(n)` 골드를 받는다. 받기는 플레이어가 `FORMS` 창에서 누른다
 * (`claimForm`). 받은 형태는 `FormClaims`(젤리마다 받은 형태 번호 목록)에 남는다. 아무 차례로 받아도 된다. 0단계(처음 모양)는 보상이 없다.
 */
import { createRng, nextFloat } from "../rng";
import { DEX_SIZE, dexReach, readDexTop } from "./forms";
import { JELLY_IDS, JELLY_KINDS, type JellyId, type JellyTier, isJellyId, jellyKind } from "./jellies";

/** 곰젤리 카드 한 장의 골드 값. */
export const CARD_PRICE = 100;
/** 한 번에 사는 묶음(장). 묶음 할인은 없다. */
export const CARD_BUNDLES: readonly number[] = [1, 10];
/** 캐릭터 하나의 카드 상한. */
export const CARD_MAX = 99;
/** 합성 한 번에 쓰는 같은 등급 카드 수. */
export const MERGE_COST = 3;
/** 무작위 합성: 재료 등급 → 결과 등급. 전설 · 신화는 무작위 합성이 없다. */
export const MERGE_UP: Readonly<Partial<Record<JellyTier, JellyTier>>> = { basic: "rare", rare: "epic", epic: "legend" };
/** 바로 해금 값(골드, 등급별). 곰젤리(기본)는 처음부터 가지므로 값이 없다. 합성(운)이 평균적으로 싼 길로 남도록 합성 기대 비용의 약 2.2~3배다. */
export const UNLOCK_PRICE: Readonly<Partial<Record<JellyTier, number>>> = { rare: 2_000, epic: 8_000, legend: 25_000, mythic: 60_000 };
/** 메카(신화)의 정해진 조합: 이 셋을 한 장씩. */
export const MECHA_RECIPE: readonly JellyId[] = ["dragon", "jellyfish", "ghost"];

type JellyCounts = Readonly<Record<JellyId, number>>;
const ZERO: JellyCounts = Object.fromEntries(JELLY_IDS.map(id => [id, 0])) as Record<JellyId, number>;

/** 젤리 상태: 고른 젤리, 해금한 젤리(곰젤리 빼고 `JELLY_KINDS` 순서), 캐릭터별 카드 수, 캐릭터별 도감 최고 형태. */
export interface JellyState {
  readonly pick: JellyId;
  readonly owned: readonly JellyId[];
  readonly cards: JellyCounts;
  readonly dex: JellyCounts;
}
export const NEW_JELLIES: JellyState = { pick: "bear", owned: [], cards: ZERO, dex: ZERO };

/** 해금한 젤리인가(곰젤리는 늘). */
export const ownsJelly = (state: JellyState, id: JellyId): boolean => id === "bear" || state.owned.includes(id);
/** 해금한 젤리 목록(곰젤리 먼저, `JELLY_KINDS` 순서). */
export const ownedJellies = (state: JellyState): JellyId[] => JELLY_IDS.filter(id => ownsJelly(state, id));
/** `tier` 등급의 젤리(`JELLY_KINDS` 순서). */
export const tierJellies = (tier: JellyTier): JellyId[] => JELLY_KINDS.filter(k => k.tier === tier).map(k => k.id);
/** `tier` 등급 카드의 합. */
export const tierCards = (state: JellyState, tier: JellyTier): number => tierJellies(tier).reduce((n, id) => n + state.cards[id], 0);

const unlock = (owned: readonly JellyId[], id: JellyId): JellyId[] => JELLY_IDS.filter(k => k !== "bear" && (k === id || owned.includes(k)));
/** 카드 `n` 장을 더한다(상한 `CARD_MAX`). */
const addCards = (cards: JellyCounts, id: JellyId, n: number): JellyCounts => ({ ...cards, [id]: Math.min(CARD_MAX, cards[id] + n) });

/** 카드 `n` 장을 준다(선물 · 상한 `CARD_MAX`). 카드를 얻은 젤리는 해금된다. */
export function giveCards(state: JellyState, id: JellyId, n: number): JellyState {
  return n > 0 ? { ...state, cards: addCards(state.cards, id, n), owned: unlock(state.owned, id) } : state;
}

export type CardCheck =
  | { readonly kind: "unknown" }
  | { readonly kind: "full" }
  | { readonly kind: "ok"; readonly cost: number }
  | { readonly kind: "short"; readonly cost: number; readonly missing: number };

/** `gold` 로 곰젤리 카드 `n` 장(`CARD_BUNDLES`)을 살 수 있는가. 사면 상한을 넘으면 full. */
export function checkCards(state: JellyState, gold: number, n: number): CardCheck {
  if (!CARD_BUNDLES.includes(n)) return { kind: "unknown" };
  if (state.cards.bear + n > CARD_MAX) return { kind: "full" };
  const cost = CARD_PRICE * n;
  return gold >= cost ? { kind: "ok", cost } : { kind: "short", cost, missing: cost - gold };
}
/** 곰젤리 카드 `n` 장을 산다. 살 수 없으면 null(아무것도 바꾸지 않는다). */
export function buyCards(state: JellyState, gold: number, n: number): { readonly state: JellyState; readonly gold: number } | null {
  const check = checkCards(state, gold, n);
  if (check.kind !== "ok") return null;
  return { state: { ...state, cards: addCards(state.cards, "bear", n) }, gold: gold - check.cost };
}

export type UnlockCheck =
  | { readonly kind: "unknown" }
  | { readonly kind: "owned" }
  | { readonly kind: "ok"; readonly cost: number }
  | { readonly kind: "short"; readonly cost: number; readonly missing: number };

/** `gold` 로 젤리 `id` 를 바로 해금할 수 있는가. 모르는 젤리는 unknown, 이미 가진 젤리(곰젤리 포함)는 owned. */
export function checkUnlock(state: JellyState, gold: number, id: string): UnlockCheck {
  if (!isJellyId(id)) return { kind: "unknown" };
  if (ownsJelly(state, id)) return { kind: "owned" };
  const cost = UNLOCK_PRICE[tierOf(id)];
  if (cost === undefined) return { kind: "unknown" };
  return gold >= cost ? { kind: "ok", cost } : { kind: "short", cost, missing: cost - gold };
}

/**
 * 무작위 합성의 재료: `tier` 등급 카드 `MERGE_COST` 장. 많이 가진 카드부터 한 장씩 고른다(같으면 `JELLY_KINDS` 순서).
 * 결과 등급이 없거나(전설 · 신화) 카드가 모자라면 null.
 */
export function mergeMaterials(state: JellyState, tier: JellyTier): JellyId[] | null {
  if (!MERGE_UP[tier] || tierCards(state, tier) < MERGE_COST) return null;
  const left = { ...state.cards }, used: JellyId[] = [];
  for (let k = 0; k < MERGE_COST; k++) {
    const id = tierJellies(tier).reduce((best, cur) => left[cur] > left[best] ? cur : best);
    left[id]--; used.push(id);
  }
  return used;
}

/** 합성 결과: 새 상태, 얻은 젤리, 쓴 카드, 처음 해금했는가. */
export interface MergeResult { readonly state: JellyState; readonly got: JellyId; readonly used: readonly JellyId[]; readonly fresh: boolean }

/** 재료를 쓰고 `got` 카드 한 장을 더한다(해금). */
function settle(state: JellyState, used: readonly JellyId[], got: JellyId): MergeResult {
  let cards = state.cards;
  for (const id of used) cards = { ...cards, [id]: cards[id] - 1 };
  return { state: { ...state, cards: addCards(cards, got, 1), owned: unlock(state.owned, got) }, got, used, fresh: !ownsJelly(state, got) };
}

/** `tier` 등급 카드 3장 → 다음 등급의 무작위 카드 1장. `seed` 는 페이지가 만든 시드다(같은 시드 → 같은 결과). 못 하면 null. */
export function mergeCards(state: JellyState, tier: JellyTier, seed: number): MergeResult | null {
  const up = MERGE_UP[tier], used = mergeMaterials(state, tier);
  if (!up || !used) return null;
  const pool = tierJellies(up), roll = nextFloat(createRng(seed)).value;
  return settle(state, used, pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))]!);
}

/** 메카 조합을 만들 수 있는가(드래곤 · 해파리 · 유령 카드 한 장씩). */
export const canForgeMecha = (state: JellyState): boolean => MECHA_RECIPE.every(id => state.cards[id] > 0);
/** 드래곤 + 해파리 + 유령 카드 한 장씩 → 메카 카드 한 장. 못 하면 null. */
export function forgeMecha(state: JellyState): MergeResult | null {
  return canForgeMecha(state) ? settle(state, MECHA_RECIPE, "mecha") : null;
}

/** 지금 누를 수 있는 합성 칸: 카드가 3장 이상인 무작위 합성 등급(낮은 등급부터)과, 재료가 있으면 메카 조합(`forge`). 상점이 이 칸을 반짝이게 한다. */
export type MergeAct = "basic" | "rare" | "epic" | "forge";
export function readyMerges(state: JellyState): MergeAct[] {
  const out: MergeAct[] = (["basic", "rare", "epic"] as const).filter(t => mergeMaterials(state, t) !== null);
  if (canForgeMecha(state)) out.push("forge");
  return out;
}

/** 바로 해금 결과: 합성 결과와 같은 모양(쓴 카드 없음, 늘 처음 해금)에 남은 골드. */
export interface UnlockResult extends MergeResult { readonly gold: number }
/** 젤리 `id` 를 골드로 바로 해금한다: 값만큼 골드를 줄이고 해금 + 그 젤리 카드 1장. 못 하면 null(아무것도 바꾸지 않는다). */
export function unlockJelly(state: JellyState, gold: number, id: string): UnlockResult | null {
  const check = checkUnlock(state, gold, id);
  if (check.kind !== "ok" || !isJellyId(id)) return null;
  return { ...settle(state, [], id), gold: gold - check.cost };
}

/** 젤리를 고른다(해금한 젤리만). 못 고르면 null. */
export function pickJelly(state: JellyState, id: JellyId): JellyState | null {
  return ownsJelly(state, id) ? { ...state, pick: id } : null;
}

/** 캐릭터 `id` 의 도감 최고 형태. */
export const dexOf = (state: JellyState, id: JellyId): number => state.dex[id];
/** 캐릭터 `id` 가 이번 판 단계(`stage`)까지 오른 뒤의 상태(도감은 내려가지 않는다). */
export function reachJellyDex(state: JellyState, id: JellyId, stage: number): JellyState {
  const top = dexReach(state.dex[id], stage);
  return top === state.dex[id] ? state : { ...state, dex: { ...state.dex, [id]: top } };
}
/** 모든 캐릭터 도감 칸의 합(본 형태 수). */
export const dexTotal = (state: JellyState): number => JELLY_IDS.reduce((n, id) => n + state.dex[id], 0);

/** 형태 보상: 젤리마다 받은 형태 번호(1..`DEX_SIZE`, 작은 차례). */
export type FormClaims = Readonly<Record<JellyId, readonly number[]>>;
export const NO_FORM_CLAIMS: FormClaims = Object.fromEntries(JELLY_IDS.map(id => [id, [] as number[]])) as Record<JellyId, number[]>;
/** 형태 n 의 보상 골드(10·n). 한 젤리의 13형태를 다 받으면 910 골드다. */
export const formReward = (n: number): number => 10 * n;
/** 젤리 `id` 의 형태 `n` 을 받을 수 있는가: 본 형태(도감 번호 이하)이고 아직 받지 않았다. */
export const formClaimable = (state: JellyState, claims: FormClaims, id: JellyId, n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= state.dex[id] && !claims[id].includes(n);
/** 젤리 `id` 의 받을 수 있는 형태 번호(작은 차례). */
export const claimableForms = (state: JellyState, claims: FormClaims, id: JellyId): number[] =>
  Array.from({ length: state.dex[id] }, (_, i) => i + 1).filter(n => !claims[id].includes(n));
/** 모든 젤리의 받을 수 있는 형태 수(홈 `FORMS` 단추 배지). */
export const claimableFormCount = (state: JellyState, claims: FormClaims): number =>
  JELLY_IDS.reduce((sum, id) => sum + claimableForms(state, claims, id).length, 0);
/** 형태 보상 하나를 받는다. 받을 수 없으면 null(두 번 받지 않는다). */
export function claimForm(state: JellyState, claims: FormClaims, id: JellyId, n: number): { readonly claims: FormClaims; readonly reward: number } | null {
  if (!formClaimable(state, claims, id, n)) return null;
  return { claims: { ...claims, [id]: [...claims[id], n].sort((a, b) => a - b) }, reward: formReward(n) };
}
/** 저장 값을 형태 보상으로 읽는다. 모르는 젤리 · 1..`DEX_SIZE` 밖의 수 · 겹친 수는 버린다. 없거나 망가졌으면 아무것도 받지 않은 것이다. */
export function readFormClaims(v: unknown): FormClaims {
  const raw = typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const list = (x: unknown): number[] => Array.isArray(x)
    ? [...new Set(x.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= DEX_SIZE))].sort((a, b) => a - b) : [];
  return Object.fromEntries(JELLY_IDS.map(id => [id, list(raw[id])])) as Record<JellyId, number[]>;
}
/** 저장 모양: 받은 형태가 있는 젤리만 `JELLY_KINDS` 순서로 담는다. */
export const formClaimsJson = (claims: FormClaims): Record<string, number[]> =>
  Object.fromEntries(JELLY_IDS.filter(id => claims[id].length > 0).map(id => [id, [...claims[id]]]));

const count = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(CARD_MAX, Math.floor(v))) : 0;
const counts = (v: unknown, read: (x: unknown) => number): JellyCounts => {
  const raw = typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return Object.fromEntries(JELLY_IDS.map(id => [id, read(raw[id])])) as Record<JellyId, number>;
};

/**
 * 저장 값을 젤리 상태로 읽는다. 모르는 젤리 · 망가진 수는 버린다(카드 0..`CARD_MAX` 정수, 도감 0..13).
 * 카드가 있는 젤리는 해금으로 친다(해금 목록이 망가져도 카드가 남은 젤리는 잃지 않는다). 해금하지 않은 젤리를 골랐으면 곰젤리로 돌린다.
 */
export function readJellies(v: unknown): JellyState {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return NEW_JELLIES;
  const raw = v as { pick?: unknown; owned?: unknown; cards?: unknown; dex?: unknown };
  const cards = counts(raw.cards, count), dex = counts(raw.dex, readDexTop);
  const listed = Array.isArray(raw.owned) ? raw.owned.filter(isJellyId) : [];
  const owned = JELLY_IDS.filter(id => id !== "bear" && (listed.includes(id) || cards[id] > 0));
  const base: JellyState = { pick: "bear", owned, cards, dex };
  return { ...base, pick: isJellyId(raw.pick) && ownsJelly(base, raw.pick) ? raw.pick : "bear" };
}
/** 저장 모양: 0 이 아닌 카드 수 · 도감만 `JELLY_KINDS` 순서로 담는다. */
export function jelliesJson(state: JellyState): { pick: JellyId; owned: JellyId[]; cards: Record<string, number>; dex: Record<string, number> } {
  const nonzero = (c: JellyCounts) => Object.fromEntries(JELLY_IDS.filter(id => c[id] > 0).map(id => [id, c[id]]));
  return { pick: state.pick, owned: [...state.owned], cards: nonzero(state.cards), dex: nonzero(state.dex) };
}
/** 판 4 까지의 도감 최고 형태(`topForm`, 곰젤리 하나)를 젤리 상태로 옮긴다: 곰젤리 도감만, 해금은 곰젤리만, 카드 0. */
export const jelliesFromTopForm = (topForm: unknown): JellyState => ({ ...NEW_JELLIES, dex: { ...ZERO, bear: readDexTop(topForm) } });

/** 화면이 쓰는 등급 이름(영어). */
export const TIER_NAME: Readonly<Record<JellyTier, string>> = { basic: "BASIC", rare: "RARE", epic: "EPIC", legend: "LEGEND", mythic: "MYTHIC" };
/** 젤리의 등급. */
export const tierOf = (id: JellyId): JellyTier => jellyKind(id).tier;
