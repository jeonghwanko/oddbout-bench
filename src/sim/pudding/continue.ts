/**
 * 푸딩 탈출 이어 달리기 규칙(2026-11-19, docs/kaito-web/pudding-escape.md).
 * 한 판에 최대 MAX_CONTINUES 번 이어 달린다. oddbout.com 은 보상형 광고로, CrazyGames 패키지는 모은 골드로 이어 간다.
 * 골드 값은 이미 쓴 횟수로 정한다: 100 → 200 → 400.
 */
export const MAX_CONTINUES = 3;
export const CONTINUE_GOLD_COSTS: readonly number[] = [100, 200, 400];

/** `used` 번 이어 달린 뒤 다음 이어 달리기의 골드 값. 더 이을 수 없으면 null. */
export function continueGoldCost(used: number): number | null {
  if (!Number.isInteger(used) || used < 0 || used >= MAX_CONTINUES) return null;
  return CONTINUE_GOLD_COSTS[used] ?? null;
}

export type GoldContinueCheck =
  | { readonly kind: "ok"; readonly cost: number }
  | { readonly kind: "short"; readonly cost: number; readonly missing: number }
  | { readonly kind: "spent" };

/** 모아 둔 골드(`banked`)로 다음 이어 달리기를 낼 수 있는가. */
export function checkGoldContinue(used: number, banked: number): GoldContinueCheck {
  const cost = continueGoldCost(used);
  if (cost === null) return { kind: "spent" };
  return banked >= cost ? { kind: "ok", cost } : { kind: "short", cost, missing: cost - banked };
}

/** 골드를 내고 이어 달린 뒤의 값. 낼 수 없으면 null(아무것도 바꾸지 않는다). */
export function payGoldContinue(used: number, banked: number): { readonly used: number; readonly gold: number } | null {
  const check = checkGoldContinue(used, banked);
  return check.kind === "ok" ? { used: used + 1, gold: banked - check.cost } : null;
}
