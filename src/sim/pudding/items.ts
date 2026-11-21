/**
 * 푸딩 탈출 아이템(2026-11-20, 순수): 골드로 사서 쌓아 두는 소모품. 숟가락을 막거나 골드를 더 모은다.
 * `bomb`(JELLY BOMB)는 뒤로 던져 숟가락을 잠깐 기절시키고, `balloon`(BALLOON)은 잡히는 순간 한 번 구해 준다.
 * `magnet`(MAGNET, 2026-11-21)은 판 내내 지나가는 동전을 넓게 끌어 먹는다. 판 시작에 하나를 쓴다. 효과 규칙은 `run.ts` 가 소유한다.
 *
 * 결정(2026-11-20 사용자 결정): 옷장은 "성능은 바꾸지 않는다"였다. 아이템은 그 원칙을 "성능 아이템은 판당 한도 안에서만"으로 바꾼다.
 * 그래서 가진 수와 관계없이 한 판에 들고 가는 수는 `perRun` 까지다(`loadoutOf`). 쓴 것만 가진 수에서 줄인다(`spendItem`). 보관은 `ITEM_STOCK_MAX` 까지다.
 * 한 판에는 한 종류만 들고 간다(2026-11-20 사용자 결정 — 둘을 함께 들면 판이 너무 길어져 뒤 미션이 쉬워졌다). 고른 종류(`pick`)는 저장이 기억한다.
 * 값과 한도는 판 측정(`tools/pudding/measure-landings.mjs`)의 판당 골드 · 더 버틴 시간에 맞춘다.
 * 아이콘 · 설명 글은 페이지가 소유한다. 여기서는 id · 이름 · 값 · 한도만 정한다.
 */

export type ItemId = 'bomb' | 'balloon' | 'magnet';
export interface ItemDef {
  readonly id: ItemId;
  /** 화면 이름(영어). */
  readonly name: string;
  /** 골드 값(하나). */
  readonly price: number;
  /** 한 판에 들고 가는 최대 수. */
  readonly perRun: number;
}

/** 아이템(정한 순서 — 화면도 이 순서로 보인다). */
export const ITEMS: readonly ItemDef[] = [
  { id: 'bomb', name: 'JELLY BOMB', price: 40, perRun: 2 },
  { id: 'balloon', name: 'BALLOON', price: 80, perRun: 1 },
  { id: 'magnet', name: 'MAGNET', price: 100, perRun: 1 },
];
/** 아이템 하나를 쌓아 둘 수 있는 최대 수. */
export const ITEM_STOCK_MAX = 9;

/** 아이템마다 가진 수(또는 이번 판에 남은 수). */
export type ItemStock = Readonly<Record<ItemId, number>>;
/** 모든 종류의 수를 `count(id)` 로 채운 묶음(`ITEMS` 순서). 키를 손으로 적지 않는다. */
export const stockOf = (count: (id: ItemId) => number): ItemStock =>
  Object.fromEntries(ITEMS.map(item => [item.id, count(item.id)])) as Record<ItemId, number>;
export const NO_ITEMS: ItemStock = stockOf(() => 0);

export const itemDef = (id: string): ItemDef | undefined => ITEMS.find(item => item.id === id);

export type ItemCheck =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'full' }
  | { readonly kind: 'ok'; readonly cost: number }
  | { readonly kind: 'short'; readonly cost: number; readonly missing: number };

/** `gold` 로 `id` 하나를 더 살 수 있는가. 이미 `ITEM_STOCK_MAX` 개면 full. */
export function checkItem(stock: ItemStock, gold: number, id: string): ItemCheck {
  const item = itemDef(id);
  if (!item) return { kind: 'unknown' };
  if (stock[item.id] >= ITEM_STOCK_MAX) return { kind: 'full' };
  return gold >= item.price ? { kind: 'ok', cost: item.price } : { kind: 'short', cost: item.price, missing: item.price - gold };
}

/** 하나를 산다. 모르는 물건 · 가득 참 · 골드가 모자라면 null(아무것도 바꾸지 않는다). */
export function buyItem(stock: ItemStock, gold: number, id: string): { readonly stock: ItemStock; readonly gold: number } | null {
  const check = checkItem(stock, gold, id);
  if (check.kind !== 'ok') return null;
  const item = itemDef(id)!;
  return { stock: { ...stock, [item.id]: stock[item.id] + 1 }, gold: gold - check.cost };
}

/** 이번 판에 들고 가는 수: 고른 한 종류(`pick`)만 가진 수를 판당 한도로 자르고, 다른 종류는 0 이다. `pick` 이 null 이면 아무것도 들고 가지 않는다. */
export function loadoutOf(stock: ItemStock, pick: ItemId | null): ItemStock {
  const item = pick === null ? undefined : itemDef(pick);
  if (!item) return NO_ITEMS;
  return { ...NO_ITEMS, [item.id]: Math.min(stock[item.id], item.perRun) };
}

/** 실제로 들고 갈 종류: 고른 종류가 다 떨어졌고 다른 종류가 있으면 다른 종류(`ITEMS` 순서), 하나도 없으면 null. */
export function effectivePick(pick: ItemId | null, stock: ItemStock): ItemId | null {
  const chosen = pick === null ? undefined : itemDef(pick);
  if (chosen && stock[chosen.id] > 0) return chosen.id;
  return ITEMS.find(item => stock[item.id] > 0)?.id ?? null;
}

/** 저장 값을 고른 종류로 읽는다. 모르는 값은 null. */
export const readItemPick = (v: unknown): ItemId | null => typeof v === 'string' ? itemDef(v)?.id ?? null : null;

/** 하나를 썼다: 가진 수에서 하나 줄인다(0 아래로 가지 않는다). */
export function spendItem(stock: ItemStock, id: ItemId): ItemStock {
  return { ...stock, [id]: Math.max(0, stock[id] - 1) };
}

const held = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(ITEM_STOCK_MAX, Math.floor(n))) : 0;

/** 저장 값을 가진 수로 읽는다. 아이템마다 정수 0..`ITEM_STOCK_MAX` 로 자르고, 모르는 값은 0 이다. */
export function readItems(v: unknown): ItemStock {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return NO_ITEMS;
  const raw = v as Record<string, unknown>;
  return stockOf(id => held(raw[id]));
}

/** 첫 선물: 판 수가 이 값이 되는 판의 결과에서 한 번 준다. */
export const ITEM_GIFT_AT_RUNS = 3;
export const ITEM_GIFT: ItemStock = { ...NO_ITEMS, bomb: 2 };

/** 첫 선물을 줄 때인가: 판 수가 `ITEM_GIFT_AT_RUNS` 이상이고 아직 받지 않았다. */
export const itemGiftDue = (runs: number, gifted: boolean): boolean => !gifted && runs >= ITEM_GIFT_AT_RUNS;

/** 아이템을 준다(상한 `ITEM_STOCK_MAX` 을 넘기지 않는다). */
export function giveItems(stock: ItemStock, gift: ItemStock): ItemStock {
  return stockOf(id => Math.min(ITEM_STOCK_MAX, stock[id] + gift[id]));
}
