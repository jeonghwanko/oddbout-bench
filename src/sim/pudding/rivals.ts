/**
 * 푸딩 탈출 닉네임 라이벌(2026-11-21, 순수). docs/kaito-web/pudding-escape.md#라이벌
 * 지어낸 영문 닉네임 3명의 고정 기록을 개인 최고 기록(PB) 기준으로 놓는다. 서버 · 실제 유저 기록과 관계없다.
 * - 넘을 수 있는 상대: PB 의 80~95%, 접전 상대: 103~110%, 강한 상대: 120~150%. PB 가 0 이면 150 · 300 · 600 m 사다리를 같은 비율 폭으로 흔든다.
 * - 기록은 한 번 나오면 고정한다. 판 끝에 이번 거리가 넘은 라이벌만 빠지고, 빈 자리를 새 PB 기준으로 채운다(`settleRivals`).
 * - 난수는 `sim/rng.ts` 의 시드 PRNG 다. 처음 시드는 페이지가 넘기고, 다음 시드는 상태(`seed`)에 남는다.
 * DOM · 저장 · `Date.now` · `Math.random` 을 모른다.
 */
import { createRng, nextFloat, nextInt } from '../rng';
import type { RngState } from '../types';
import { JELLY_IDS, type JellyId, isJellyId } from './jellies';

export interface Rival {
  readonly name: string;
  readonly jelly: JellyId;
  /** 고정 기록(m, 10 m 단위). */
  readonly m: number;
}
export interface RivalState {
  /** 보이는 라이벌(최대 3명, 기록 오름차순). */
  readonly list: readonly Rival[];
  /** 다음에 채울 라이벌의 난수 상태. */
  readonly seed: number;
  /** 지금까지 넘은 라이벌 수. */
  readonly beaten: number;
}

/** 보이는 라이벌 수. */
export const RIVAL_COUNT = 3;
export type RivalBand = 'easy' | 'close' | 'strong';
/** PB 대비 기록 비율 범위 [아래, 위]. */
export const RIVAL_BANDS: Readonly<Record<RivalBand, readonly [number, number]>> = {
  easy: [0.8, 0.95], close: [1.03, 1.1], strong: [1.2, 1.5],
};
/** PB 가 0 일 때의 사다리(m). 같은 비율 폭(위 − 아래)을 가운데에 두고 흔든다. */
export const RIVAL_LADDER: Readonly<Record<RivalBand, number>> = { easy: 150, close: 300, strong: 600 };
/** 접전 상대로 치는 위 끝(PB 대비). 채울 때 이 안에 상대가 없으면 접전 상대를 먼저 채운다. */
const CLOSE_TOP = 1.15;
/** 저장에서 읽는 이름 모양: 영문 · 숫자 · `_` · `.`, 3~14 글자. */
const NAME_RE = /^[A-Za-z0-9_.]{3,14}$/;

/** 닉네임 앞말 · 뒷말. 실존 인물 · 스트리머 이름, 집계 · 순위를 말하는 낱말(WORLD · GLOBAL · ONLINE · TOP · NPC 등)은 넣지 않는다. */
const FRONT = ['Mochi', 'Gummy', 'Puddin', 'Jelly', 'Sugar', 'Wobble', 'Boba', 'Caramel', 'Custard', 'Sprinkle', 'Taffy', 'Honey',
  'Fizzy', 'Choco', 'Marsh', 'Lemon', 'Peach', 'Berry', 'Minty', 'Cocoa', 'Waffle', 'Bouncy', 'Squishy', 'Toffee'] as const;
const BACK = ['Dash', 'Kai', 'Run', 'Zoom', 'Hop', 'Pop', 'Rush', 'Bolt', 'Flip', 'Byte', 'Fox', 'Cat', 'Kid', 'Ace', 'Bun',
  'Drop', 'Spin', 'Bean', 'Jet', 'Max', 'Leo', 'Mia', 'Ren', 'Nova'] as const;

const pick = <T>(rng: RngState, items: readonly T[]): { rng: RngState; value: T } => {
  const d = nextInt(rng, 0, items.length);
  return { rng: d.state, value: items[d.value]! };
};

/** 닉네임 하나: `MochiDash` · `gummy_77` · `JellyBolt9` · `bobazoom42` 꼴. */
function makeName(rng: RngState): { rng: RngState; value: string } {
  const f = pick(rng, FRONT), b = pick(f.rng, BACK), style = nextInt(b.rng, 0, 4), num = nextInt(style.state, 1, 100);
  const name = style.value === 0 ? `${f.value}${b.value}`
    : style.value === 1 ? `${f.value.toLowerCase()}_${num.value}`
      : style.value === 2 ? `${f.value}${b.value}${num.value % 10}`
        : `${f.value}${b.value}`.toLowerCase().slice(0, 11) + String(num.value);
  return { rng: num.state, value: name };
}

const floor10 = (v: number) => Math.floor(v / 10) * 10;
const ceil10 = (v: number) => Math.ceil(v / 10) * 10;
const round10 = (v: number) => Math.round(v / 10) * 10;

/** 띠 하나의 기록. 넘을 수 있는 상대는 내려서, 위 칸은 올려서 10 m 단위로 맞춘다(PB 를 넘지 않게 · PB 보다 높게). */
function bandM(rng: RngState, best: number, band: RivalBand): { rng: RngState; value: number } {
  const [lo, hi] = RIVAL_BANDS[band], d = nextFloat(rng);
  let m: number;
  if (best <= 0) {
    const w = hi - lo;
    m = round10(RIVAL_LADDER[band] * (1 - w / 2 + d.value * w));
  } else {
    const raw = best * (lo + d.value * (hi - lo));
    m = band === 'easy' ? floor10(raw) : ceil10(raw);
  }
  return { rng: d.state, value: Math.max(10, m) };
}

/** 새 라이벌 하나. 이름은 `taken` 에 없는 것을 고른다. */
function makeRival(rng: RngState, best: number, band: RivalBand, taken: Set<string>): { rng: RngState; value: Rival } {
  let r = rng, name = '';
  for (let tries = 0; tries < 40; tries++) {
    const n = makeName(r); r = n.rng;
    if (!taken.has(n.value)) { name = n.value; break; }
  }
  if (!name) { let i = 2; name = 'PuddinRun'; while (taken.has(`${name}${i}`)) i++; name = `${name}${i}`; }
  taken.add(name);
  const j = pick(r, JELLY_IDS), m = bandM(j.rng, best, band);
  return { rng: m.rng, value: { name, jelly: j.value, m: m.value } };
}

const byM = (list: readonly Rival[]) => [...list].sort((a, b) => a.m - b.m);

/** 처음 라이벌 3명(넘을 수 있는 · 접전 · 강한). `seed` 는 페이지가 넘긴다. */
export function spawnRivals(best: number, seed: number): RivalState {
  let rng = createRng(seed);
  const taken = new Set<string>(), list: Rival[] = [];
  for (const band of ['easy', 'close', 'strong'] as const) {
    const r = makeRival(rng, best, band, taken); rng = r.rng; list.push(r.value);
  }
  return { list: byM(list), seed: rng.seed, beaten: 0 };
}

/**
 * 판 끝 갱신. 이번 거리(`dist`)가 넘은(`dist > m`) 라이벌을 빼고 `beaten` 에 센다. 남은 라이벌의 기록은 그대로다.
 * 빈 자리는 새 PB(`best`) 기준으로 채운다: PB 아래 상대가 없으면 넘을 수 있는 상대 하나, 나머지는 접전 상대(접전 범위에 없을 때) → 강한 상대.
 * 넘은 라이벌이 없으면 상태를 그대로 돌려준다. 이어 달리기 뒤 다시 끝나면 판 시작의 상태로 다시 부른다(같은 판).
 */
export function settleRivals(state: RivalState, dist: number, best: number): { state: RivalState; passed: readonly Rival[] } {
  const passed = state.list.filter(r => dist > r.m);
  if (passed.length === 0 && state.list.length >= RIVAL_COUNT) return { state, passed };
  const out = state.list.filter(r => dist <= r.m);
  const taken = new Set(state.list.map(r => r.name));
  let rng = createRng(state.seed);
  const add = (band: RivalBand) => { const r = makeRival(rng, best, band, taken); rng = r.rng; out.push(r.value); };
  if (out.length < RIVAL_COUNT && !out.some(r => r.m < best)) add('easy');
  while (out.length < RIVAL_COUNT) add(out.some(r => r.m > best && r.m <= best * CLOSE_TOP) ? 'strong' : 'close');
  return { state: { list: byM(out), seed: rng.seed, beaten: state.beaten + passed.length }, passed };
}

/** 지금 거리(`m`)보다 기록이 높은 가장 가까운 라이벌과 남은 거리. 없으면 null. */
export function nextRival(list: readonly Rival[], m: number): { rival: Rival; remainM: number } | null {
  let best: Rival | null = null;
  for (const r of list) if (r.m > m && (!best || r.m < best.m)) best = r;
  return best ? { rival: best, remainM: best.m - m } : null;
}

/** 저장 모양. */
export const rivalsJson = (s: RivalState) => ({ list: s.list.map(r => ({ name: r.name, jelly: r.jelly, m: r.m })), seed: s.seed, beaten: s.beaten });

/**
 * 저장에서 읽는다(관대하게). 이름 모양 · 기록(유한 · 양수) · 젤리 id 가 맞는 줄만, 이름이 겹치지 않게 최대 3명 받는다.
 * 모양이 틀리거나 맞는 줄이 없으면 null(페이지가 PB 로 새로 만든다).
 */
export function readRivals(v: unknown): RivalState | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, rawList = o['list'], seed = o['seed'], beaten = o['beaten'];
  if (!Array.isArray(rawList) || typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  const names = new Set<string>(), list: Rival[] = [];
  for (const e of rawList) {
    if (list.length >= RIVAL_COUNT) break;
    if (typeof e !== 'object' || e === null) continue;
    const { name, jelly, m } = e as Record<string, unknown>;
    if (typeof name !== 'string' || !NAME_RE.test(name) || names.has(name)) continue;
    if (!isJellyId(jelly) || typeof m !== 'number' || !Number.isFinite(m) || m <= 0) continue;
    names.add(name); list.push({ name, jelly, m: Math.round(m) });
  }
  if (list.length === 0) return null;
  return { list: byM(list), seed: Math.trunc(seed) >>> 0, beaten: typeof beaten === 'number' && Number.isFinite(beaten) && beaten >= 0 ? Math.floor(beaten) : 0 };
}
