/**
 * 푸딩 탈출 미션(2026-11-19 재제출 3단계, 순수): 늘 세 개가 걸려 있는 짧은 한 판 목표.
 * 받기(2026-11-21 사용자 결정): 판 끝에 이룬 미션은 그 칸에 `cleared` 로 남는다(`settleMissions`). 플레이어가 미션 창에서 누르면(`claimMission`)
 * 골드를 받고 그 칸에 다음 미션이 걸린다. 받기 전까지 그 칸은 다시 세지 않고 바뀌지 않는다.
 * 미션은 정한 차례(`MISSIONS`)로 나온다. 난수가 없다. 끝까지 가면 `MISSION_REPEAT_FROM` 부터 다시 돈다.
 * 판정은 한 판의 값(`MissionFacts` — 거리 · 단계 · PERFECT · 최고 콤보 · 골드 · 공중 누르기)으로만 한다. 이어 달리기(두 방식)는 같은 판으로 센다.
 * 판 중간(이어 달리기 전 결과 화면)에 새로 걸린 미션은 다음 판부터 센다(`settleMissions` 의 `eligible`). 이미 넘긴 값으로 바로 이루지 않게 한다.
 * 판 중의 진행 알림(`missionStep`)도 판 끝과 같은 값(`missionFactsOf`)과 같은 판정(`missionValue`)을 읽는다.
 * 화면 글자는 페이지(`src/pudding/missionView.ts`)가 소유한다. 여기서는 종류 · 목표 · 보상만 정한다.
 */
import { distanceM, type PuddingRun } from './run';

/** distance 거리(m) · dives 공중 누르기 판정 비행 · form 오른 단계 · perfect PERFECT 착지 · gold 이번 판 골드 · combo 최고 콤보. */
export type MissionKind = 'distance' | 'dives' | 'form' | 'perfect' | 'gold' | 'combo';
export interface Mission { readonly id: string; readonly kind: MissionKind; readonly target: number; readonly reward: number }

const mission = (kind: MissionKind, target: number, reward: number): Mission => ({ id: `${kind}-${target}`, kind, target, reward });

/**
 * 미션 차례. 앞은 쉽고 뒤로 갈수록 어렵다. 목표는 측정(정책별 시드 40판, `tools/pudding/measure-landings.mjs`)의 판당 값에 맞췄다.
 * 2026-11-19 2안(납작한 점프) 뒤 값: 거리 중앙값 460~1210 m, 단계 1~3, 공중 누르기 0~13, PERFECT 0~2, 최고 콤보 3~9, 골드 170~270.
 * 그래서 거리 목표를 300 · 600 · 1000 · 1500 → 400 · 900 · 1400 · 1800, PERFECT 를 1 · 3 → 2 · 5, 콤보를 3 · 5 → 6 · 10 으로 올렸다.
 * 자리마다 한 판에 이루는 비율이 2안 전과 비슷하다(PERFECT · 콤보는 잘 내려앉는 판일수록 더 쉽다).
 * 새 목표는 옛 id(`LEGACY_MISSION_IDS` · `V4_MISSION_IDS`)와 겹치지 않게 골랐다. 같은 id 는 늘 같은 미션이다.
 * 2026-11-20 아이템(젤리 폭탄 · 열기구): 뒤 미션은 아이템을 들고 간 판의 달성률이 장비 없는 판보다 +15%p 넘게 오르지 않게 한다.
 * 시드 200판 측정에서 거리 1400 은 열기구 판이 +17%p 라 13번째 거리 목표를 1400 → 1600 으로 올렸다(보상 150 그대로).
 * 1500 은 옛 id(`distance-1500` → `distance-1800`)라 쓰지 않는다.
 */
export const MISSIONS: readonly Mission[] = [
  mission('distance', 400, 40),
  mission('dives', 5, 40),
  mission('form', 2, 60),
  mission('perfect', 2, 60),
  mission('gold', 200, 50),
  mission('combo', 6, 50),
  mission('distance', 900, 80),
  mission('dives', 12, 70),
  mission('form', 3, 100),
  mission('combo', 10, 100),
  mission('gold', 400, 100),
  mission('perfect', 5, 150),
  mission('distance', 1600, 150),
  mission('form', 4, 200),
  mission('distance', 1800, 250),
];
/**
 * 2안 전 미션 id → 같은 차례 자리의 새 미션 id. 저장 판 2 → 3 이관(`upgradeMissionIds`)이 걸린 미션(`missions.active`)을 바꾼다.
 * 차례 자리(`next`)와 보상은 그대로라 바꾸기만 하면 된다. 여기 있는 `distance-1400` 은 판 3 → 4 이관이 다시 `distance-1600` 으로 바꾼다.
 */
export const LEGACY_MISSION_IDS: Readonly<Record<string, string>> = {
  'distance-300': 'distance-400', 'perfect-1': 'perfect-2', 'combo-3': 'combo-6', 'distance-600': 'distance-900',
  'combo-5': 'combo-10', 'perfect-3': 'perfect-5', 'distance-1000': 'distance-1400', 'distance-1500': 'distance-1800',
};
/**
 * 저장 판 3 미션 id → 판 4 미션 id(2026-11-20 아이템). 아이템 판의 달성률 증가 기준(+15%p)에 맞춰 13번째 거리 목표를 올렸다.
 * 저장 판 3 → 4 이관(`upgradeMissionIdsV4`)이 걸린 미션을 바꾼다. 차례 자리와 보상은 그대로다. `LEGACY_MISSION_IDS` 와 섞지 않는다(판마다 한 표).
 */
export const V4_MISSION_IDS: Readonly<Record<string, string>> = { 'distance-1400': 'distance-1600' };
/** 늘 걸려 있는 미션 수. */
export const MISSION_SLOTS = 3;
/** 차례를 다 돌면 이 자리부터 다시 돈다(쉬운 앞 여섯은 한 번만). */
export const MISSION_REPEAT_FROM = 6;

/** 걸린 미션(칸 순서), 다음에 꺼낼 차례 번호, 지금까지 받은 수, 이뤘지만 아직 받지 않은 미션(걸린 미션 중, 칸 순서). */
export interface MissionState { readonly active: readonly string[]; readonly next: number; readonly done: number; readonly cleared: readonly string[] }

/** `k` 번째로 꺼내는 미션. */
export function missionAt(k: number): Mission {
  const n = MISSIONS.length, loop = n - MISSION_REPEAT_FROM;
  const i = k < n ? Math.max(0, Math.floor(k)) : MISSION_REPEAT_FROM + ((Math.floor(k) - n) % loop);
  return MISSIONS[i]!;
}
export const missionById = (id: string): Mission | undefined => MISSIONS.find(m => m.id === id);

/** 처음 걸리는 미션: 차례의 앞 세 개. */
export function initialMissions(): MissionState {
  return { active: MISSIONS.slice(0, MISSION_SLOTS).map(m => m.id), next: MISSION_SLOTS, done: 0, cleared: [] };
}

/** 미션이 읽는 한 판의 값. 이어 달리기는 같은 판이라 값이 이어진다. */
export interface MissionFacts {
  readonly distM: number; readonly stage: number; readonly perfect: number;
  readonly combo: number; readonly gold: number; readonly dives: number;
}
export function missionFactsOf(s: PuddingRun): MissionFacts {
  return { distM: distanceM(s), stage: s.stage, perfect: s.stats.perfect, combo: s.stats.maxCombo, gold: s.stats.gold, dives: s.facts.dives };
}

/** 미션 하나의 지금 값(목표와 견준다). */
export function missionValue(m: Mission, f: MissionFacts): number {
  switch (m.kind) {
    case 'distance': return f.distM;
    case 'dives': return f.dives;
    case 'form': return f.stage;
    case 'perfect': return f.perfect;
    case 'gold': return f.gold;
    case 'combo': return f.combo;
  }
}
export const missionDone = (m: Mission, f: MissionFacts): boolean => missionValue(m, f) >= m.target;

/** 다음 차례에서 지금 걸려 있지 않은 미션 하나를 꺼낸다. */
function deal(active: readonly string[], next: number): { readonly id: string; readonly next: number } {
  for (let k = next; k < next + MISSIONS.length * 2; k++) {
    const id = missionAt(k).id;
    if (!active.includes(id)) return { id, next: k + 1 };
  }
  return { id: missionAt(next).id, next: next + 1 };
}

/**
 * 판 끝(이어 달리기 전 결과 화면 포함)의 미션 판정. `eligible` 은 이번 판이 시작할 때 걸려 있던 미션이다.
 * 걸려 있고 `eligible` 에 들고 아직 받기를 기다리지 않는 미션 중 이룬 것을 `cleared` 에 더한다. 골드는 주지 않는다(받기는 `claimMission`).
 * `cleared`(돌려주는 값)는 이번에 새로 이룬 미션이다(칸 순서).
 */
export function settleMissions(state: MissionState, facts: MissionFacts, eligible: readonly string[])
  : { readonly state: MissionState; readonly cleared: readonly string[] } {
  const fresh = state.active.filter(id => {
    const m = missionById(id);
    return !!m && eligible.includes(id) && !state.cleared.includes(id) && missionDone(m, facts);
  });
  if (fresh.length === 0) return { state, cleared: [] };
  const cleared = state.active.filter(id => state.cleared.includes(id) || fresh.includes(id));
  return { state: { ...state, cleared }, cleared: fresh };
}

/** 받기를 기다리는 미션인가. */
export const missionCleared = (state: MissionState, id: string): boolean => state.cleared.includes(id);

/**
 * 이룬 미션 하나를 받는다: 보상(`reward`)을 돌려주고, 그 칸을 다음 차례 미션으로 채우고, 받은 수를 하나 올린다.
 * 받기를 기다리는 미션이 아니면 null 이다(두 번 받지 않는다).
 */
export function claimMission(state: MissionState, id: string): { readonly state: MissionState; readonly reward: number; readonly slot: number } | null {
  const slot = state.active.indexOf(id), m = missionById(id);
  if (slot < 0 || !m || !state.cleared.includes(id)) return null;
  const active = [...state.active], dealt = deal(active, state.next);
  active[slot] = dealt.id;
  return { state: { active, next: dealt.next, done: state.done + 1, cleared: state.cleared.filter(c => c !== id) }, reward: m.reward, slot };
}

/**
 * 판 중의 진행 단계(진행 알림을 언제 띄울지). 목표의 절반 아래면 0 이다. 셀 수 있는 미션(공중 누르기 · PERFECT · 콤보 · 단계)은 값이 하나 오를 때마다
 * 단계가 오르고(그 값), 거리 · 골드는 50% · 75% · 90% 를 넘을 때만 오른다(1 · 2 · 3). 이룬 값이면 `MISSION_STEP_DONE` 이다.
 * 페이지는 단계가 오를 때만 알림을 띄운다. 같은 값으로 두 번 띄우지 않는다.
 */
export const MISSION_STEP_DONE = 1_000_000;
export function missionStep(m: Mission, value: number): number {
  if (value >= m.target) return MISSION_STEP_DONE;
  const ratio = value / m.target;
  if (ratio < 0.5) return 0;
  if (m.kind === 'distance' || m.kind === 'gold') return ratio >= 0.9 ? 3 : ratio >= 0.75 ? 2 : 1;
  return Math.floor(value);
}

/** 미션 칸에서 걸린 미션의 id 를 `table` 로 바꾼다. 모양이 다르면 그대로 둔다(읽기가 거른다). */
function renameMissions(v: unknown, table: Readonly<Record<string, string>>): unknown {
  if (typeof v !== 'object' || v === null || !Array.isArray((v as { active?: unknown }).active)) return v;
  const raw = v as { active: unknown[] };
  return { ...raw, active: raw.active.map(id => typeof id === 'string' ? table[id] ?? id : id) };
}
/** 저장 판 2 의 미션 칸에서 걸린 미션의 옛 id 를 새 id 로 바꾼다(저장 판 2 → 3 이관). */
export const upgradeMissionIds = (v: unknown): unknown => renameMissions(v, LEGACY_MISSION_IDS);
/** 저장 판 3 의 미션 칸에서 걸린 미션의 id 를 판 4 id 로 바꾼다(저장 판 3 → 4 이관, `V4_MISSION_IDS`). */
export const upgradeMissionIdsV4 = (v: unknown): unknown => renameMissions(v, V4_MISSION_IDS);

/**
 * 저장 값을 미션 상태로 읽는다. 걸린 미션이 셋이 아니거나 모르는 · 겹친 미션이 있으면 처음 미션으로 돌린다(받은 수는 지킨다).
 * 받기를 기다리는 미션(`cleared`, 2026-11-21)은 걸린 미션에 든 id 만 칸 순서로 읽는다. 없거나 망가졌으면 없음이다(저장 판은 그대로 6 —
 * 옛 판 6 저장에는 이 칸이 없다).
 */
export function readMissions(v: unknown): MissionState {
  const count = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
  if (typeof v !== 'object' || v === null) return initialMissions();
  const raw = v as { active?: unknown; next?: unknown; done?: unknown; cleared?: unknown };
  const active: unknown[] = Array.isArray(raw.active) ? raw.active : [];
  const valid = active.length === MISSION_SLOTS && new Set(active).size === MISSION_SLOTS
    && active.every(id => typeof id === 'string' && missionById(id) !== undefined);
  if (!valid) return { ...initialMissions(), done: count(raw.done) };
  const ids = active as string[], marked: unknown[] = Array.isArray(raw.cleared) ? raw.cleared : [];
  return { active: ids, next: Math.max(MISSION_SLOTS, count(raw.next)), done: count(raw.done), cleared: ids.filter(id => marked.includes(id)) };
}
