/**
 * 푸딩 탈출 상점 학습 흐름(2026-11-20 사용자 결정, 순수): 글 없이 손가락으로 한 번만 보인다.
 * 2번째 판이 끝날 때 곰젤리 카드를 선물하고(`cardGiftDue` · `giftCards`), 결과 화면 `HOME` → 홈 `SHOP` → 상점 `BUY ×1` → `MERGE` → 공개 연출 → `USE`
 * 순서로 손가락이 가리킨다. 골드가 카드 한 장 값(`CARD_PRICE`)보다 적으면 3장을 주고 `BUY` 단계를 건너뛴다.
 * 단계(`ShopLesson`)는 저장에 남는다. 창을 닫거나 결과 화면 단추를 눌러도 강제하지 않고, 다음에 홈 · 상점에 오면 이어 간다.
 * 이 파일은 무엇을 가리킬지(`lessonTarget`)와 단계 전이(`lessonAfter`)만 정한다. 손가락 그림과 자리는 페이지(`src/pudding/coach.ts`)가 맡는다.
 * docs/kaito-web/pudding-escape.md#상점-학습-흐름
 */
import { CARD_PRICE, type JellyState, MERGE_COST, giveCards, ownsJelly, tierCards } from "./cards";
import { JELLY_IDS, type JellyId } from "./jellies";

/** 학습 단계: 아직(`none`), 상점으로(`shop`), 카드 사기(`buy`), 합성(`merge`), 젤리 고르기(`use`), 끝(`done`). */
export type ShopLesson = "none" | "shop" | "buy" | "merge" | "use" | "done";
export const SHOP_LESSONS: readonly ShopLesson[] = ["none", "shop", "buy", "merge", "use", "done"];
/** 카드 선물을 주는 판 수(그 판이 끝날 때). 3번째 판의 폭탄 선물(`ITEM_GIFT_AT_RUNS`)보다 한 판 앞이다. */
export const CARD_GIFT_AT_RUNS = 2;
/** 선물하는 곰젤리 카드 수. 골드가 `CARD_PRICE` 보다 적으면 `CARD_GIFT_SHORT` 장(바로 합성할 수 있다). */
export const CARD_GIFT = 2;
export const CARD_GIFT_SHORT = MERGE_COST;

/** 카드 선물을 줄 때인가: 판 수가 `CARD_GIFT_AT_RUNS` 이상이고 아직 받지 않았다. */
export const cardGiftDue = (runs: number, gifted: boolean): boolean => !gifted && runs >= CARD_GIFT_AT_RUNS;
/** 선물 장수: 골드(판 골드를 더한 뒤)가 카드 한 장 값보다 적으면 3장, 아니면 2장. */
export const cardGiftCount = (gold: number): number => gold < CARD_PRICE ? CARD_GIFT_SHORT : CARD_GIFT;

/**
 * 곰젤리 카드를 선물한다. 이미 곰젤리 말고 다른 젤리를 가졌으면 합성을 안다고 보고 학습은 바로 끝(`done`)이다. 아니면 `shop` 부터.
 */
export function giftCards(jellies: JellyState, gold: number): { readonly jellies: JellyState; readonly count: number; readonly lesson: ShopLesson } {
  const count = cardGiftCount(gold);
  return { jellies: giveCards(jellies, "bear", count), count, lesson: jellies.owned.length > 0 ? "done" : "shop" };
}

/** 학습이 진행 중인가(`shop` ~ `use`). */
export const lessonActive = (step: ShopLesson): boolean => step === "shop" || step === "buy" || step === "merge" || step === "use";

/** 학습을 움직이는 행동: 상점을 열었다, 곰젤리 카드를 샀다, 합성했다(메카 조합 포함), 곰젤리가 아닌 젤리를 골랐다. */
export type LessonAction = "openShop" | "buy" | "merge" | "use";
/** 행동 뒤의 단계. 진행 중이 아니면 그대로다. 합성과 고르기는 앞 단계를 건너뛰어도 받는다(먼저 해 버려도 막히지 않는다). */
export function lessonAfter(step: ShopLesson, action: LessonAction, jellies: JellyState): ShopLesson {
  if (!lessonActive(step)) return step;
  switch (action) {
    case "openShop": return step === "shop" ? (tierCards(jellies, "basic") >= MERGE_COST ? "merge" : "buy") : step;
    case "buy": return step === "shop" || step === "buy" ? (tierCards(jellies, "basic") >= MERGE_COST ? "merge" : "buy") : step;
    case "merge": return step === "use" ? step : "use";
    case "use": return jellies.pick !== "bear" ? "done" : step;
  }
}

/** 손가락이 가리킬 것: 결과 화면 `HOME`, 홈 `SHOP`, 상점의 `BUY ×1` · 기본 `MERGE` · `USE`. 없으면 null. */
export type LessonTarget = "home" | "shop" | "buy" | "merge" | "use";
/** 지금 화면(`result` · `home` · `shop`)에서 손가락이 가리킬 것. 상점에서는 카드 수 · 골드로 다음 할 일을 다시 고른다. */
export function lessonTarget(step: ShopLesson, screen: "result" | "home" | "shop", jellies: JellyState, gold: number): LessonTarget | null {
  if (!lessonActive(step)) return null;
  if (screen === "result") return "home";
  if (screen === "home") return "shop";
  if (step === "use") return useCandidate(jellies) === null ? null : "use";
  if (tierCards(jellies, "basic") >= MERGE_COST) return "merge";
  return gold >= CARD_PRICE ? "buy" : null;
}
/** `USE` 단계에서 고를 젤리: 가진 젤리 중 곰젤리가 아니고 지금 고르지 않은 첫 젤리(`JELLY_KINDS` 순서). 없으면 null. */
export function useCandidate(jellies: JellyState): JellyId | null {
  return JELLY_IDS.find(id => id !== "bear" && id !== jellies.pick && ownsJelly(jellies, id)) ?? null;
}

/** 저장 값을 단계로 읽는다. 모르는 값은 `none`. */
export const readShopLesson = (v: unknown): ShopLesson => SHOP_LESSONS.includes(v as ShopLesson) ? v as ShopLesson : "none";
