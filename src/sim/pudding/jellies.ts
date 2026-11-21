/**
 * 푸딩 탈출 젤리 캐릭터(2026-11-20, 순수): id · 등급 · 이름 · 0단계 몸 팔레트. DOM · 그림 코드 · 저장을 모른다.
 * 몸 그림(몸 설계 `BodyPlan`)은 페이지(`src/pudding/jellies.ts`)가 id 로 짝짓는다.
 * 변신(1형태~)은 몸 그림을 바꾸지 않고 형태 팔레트 · 머리칼 · 변신 눈을 같은 층으로 얹는다(`forms.ts`).
 */
import { BASE_BODY, type BodyPalette, bodyPal } from './forms';

export type JellyId = 'bear' | 'bunny' | 'worm' | 'penguin' | 'frog' | 'cola' | 'ninjacat' | 'dragon' | 'jellyfish' | 'ghost' | 'mecha';
export type JellyTier = 'basic' | 'rare' | 'epic' | 'legend' | 'mythic';
export interface JellyKind {
  readonly id: JellyId;
  readonly tier: JellyTier;
  readonly name: { readonly ko: string; readonly en: string };
  /** 0단계(변신 전) 몸 팔레트. */
  readonly body: BodyPalette;
}

/** 복숭아 · 연분홍. */
const PEACH = bodyPal('#5a1a2a', '#e0707a', '#ffad9e', '#ffe2d8', '#fff0dc', '#fffaf6', '#2a0a12', '#ffc2b2', '#ff5f8a');
/** 사워 주황 바탕 + 노랑 띠(띠 마디는 속빛 g 로 칠한다 — 손으로 고른 노랑). */
const SOUR = bodyPal('#5a1f00', '#d9581a', '#ff8f2a', '#ffd9a0', '#fff6b0', '#fffcf0', '#2a1200', '#ffb060', '#ff5f6f', undefined, undefined, { g: '#ffd83a' });
/** 초록. */
const FROG = bodyPal('#0f3a14', '#2f9a32', '#72d84e', '#d0f8a8', '#f0ffc0', '#f8fff2', '#14200a', '#9ae878', '#ff8ab0');
/** 청록(형태 팔레트에 없는 색이라 전설이 겹치지 않는다). */
const TEAL = bodyPal('#06302e', '#14907f', '#2fd3b8', '#b4fff0', '#eaffd8', '#f4fffc', '#1a0a2a', '#7ae8d6', '#ff8ab8');

/** 남색 몸(흰 배 · 얼굴은 w · h 키). 흰 칸은 `#fefeff` 다 — 팔레트 SSOT 의 흰색 리터럴과 겹치지 않는 젤리 흰빛(`test/palette.test.ts`). */
const PENGUIN = bodyPal('#0c1230', '#22306a', '#3d548f', '#8aa2dc', '#c8d6ff', '#fefeff', '#0a0a1a', '#5a72b0', '#ff8ab0');
/** 콜라 갈색 바탕(아래 층) + 캐러멜 속빛 g(위 투명 층 — 손으로 고른 값). */
const COLA = bodyPal('#2a0e04', '#5a2208', '#8a3a12', '#d88a4a', '#ffe3a0', '#fff6e6', '#1a0800', '#a85a2a', '#ff8a7a', undefined, undefined, { g: '#f0a83a' });
/** 회청 몸, 두건은 눈 색 e(짙은 남색). */
const NINJA = bodyPal('#151a30', '#4a5578', '#8a96b8', '#d0d8ee', '#eef2ff', '#fefeff', '#0e1022', '#a8b2d0', '#ff8ab8');
/** 연보라 우산 + 하늘빛 속(g 손으로 고른 값). */
const JELLYFISH = bodyPal('#2a2058', '#7a6ad0', '#b6a8ff', '#e6e0ff', '#eafcff', '#fbfaff', '#1a1030', '#cabfff', '#ff8ac8', undefined, undefined, { g: '#9fdcff' });
/** 흰 · 민트(옅은 테 o, 민트 속빛 g). */
const GHOST = bodyPal('#3f8f7c', '#9ad8c6', '#e8fff6', '#fefeff', '#fefeff', '#fefeff', '#14302a', '#d0f5ea', '#ff9ac0', undefined, undefined, { g: '#b6ffe2' });
/** 은 수트 + 하늘빛 젤리(g 손으로 고른 값). 빨강 · 금 조합은 쓰지 않는다(원작 IP 회피). */
const MECHA = bodyPal('#16233d', '#5f7896', '#b9cbe0', '#eef5ff', '#fefeff', '#fefeff', '#14102a', '#8fd4ff', '#ff8ab8', undefined, undefined, { g: '#7fd3ff' });

/** 등급 순서: 기본 → 희귀 → 영웅 → 전설 → 신화. */
export const JELLY_KINDS: readonly JellyKind[] = [
  { id: 'bear', tier: 'basic', name: { ko: '곰젤리', en: 'GUMMY BEAR' }, body: BASE_BODY },
  { id: 'bunny', tier: 'rare', name: { ko: '토끼젤리', en: 'GUMMY BUNNY' }, body: PEACH },
  { id: 'worm', tier: 'rare', name: { ko: '지렁이젤리', en: 'GUMMY WORM' }, body: SOUR },
  { id: 'penguin', tier: 'rare', name: { ko: '펭귄젤리', en: 'PENGUIN' }, body: PENGUIN },
  { id: 'frog', tier: 'epic', name: { ko: '개구리젤리', en: 'GUMMY FROG' }, body: FROG },
  { id: 'cola', tier: 'epic', name: { ko: '콜라병젤리', en: 'COLA BOTTLE' }, body: COLA },
  { id: 'ninjacat', tier: 'epic', name: { ko: '닌자고양이', en: 'NINJA CAT' }, body: NINJA },
  { id: 'dragon', tier: 'legend', name: { ko: '드래곤젤리', en: 'GUMMY DRAGON' }, body: TEAL },
  { id: 'jellyfish', tier: 'legend', name: { ko: '해파리젤리', en: 'JELLYFISH' }, body: JELLYFISH },
  { id: 'ghost', tier: 'legend', name: { ko: '유령젤리', en: 'GHOST JELLY' }, body: GHOST },
  { id: 'mecha', tier: 'mythic', name: { ko: '메카젤리', en: 'MECHA JELLY' }, body: MECHA },
];

export const JELLY_IDS: readonly JellyId[] = JELLY_KINDS.map(k => k.id);
/** id 의 캐릭터. 모르는 id 면 곰젤리. */
export const jellyKind = (id: string): JellyKind => JELLY_KINDS.find(k => k.id === id) ?? JELLY_KINDS[0]!;
/** 아는 캐릭터 id 인가. */
export const isJellyId = (v: unknown): v is JellyId => typeof v === 'string' && JELLY_KINDS.some(k => k.id === v);

/**
 * 젤리 특성(2026-11-20 사용자 결정): 장점 하나와 단점 하나의 맞바꿈(사이드그레이드). 곰젤리(`BEAR_TRAITS`)는 지금 규칙 그대로다 — 모든 값이
 * 곱하기 1 · 더하기 0 이라 곰젤리 판은 특성 전과 같은 거리 · 상태 · 사건을 낸다(`test/pudding-items.test.ts` 기준 표본).
 * 값은 판 측정(`tools/pudding/measure-landings.mjs`, 정책 셋 × 시드 200판)에서 판 시간 · 판당 골드 중앙값이 곰젤리의 ±10% 안이 되게 골랐다
 * (docs/Plan/2026-11-20-pudding-jelly-roster/README.md#측정). 효과는 `run.ts` 가 읽는다.
 */
export interface JellyTraits {
  /** 점프 튕김(`launchVelocity` 의 pop) 배율. */
  readonly jump: number;
  /** PERFECT 각도 문턱(라디안, 곰젤리는 `PERFECT_ANGLE` 0.3). */
  readonly perfectAngle: number;
  /** PERFECT 착지 속력 `접선 속력 · perfectMul + perfectAdd`(곰젤리 1.08 · 25). */
  readonly perfectMul: number; readonly perfectAdd: number;
  /** 꾹 게이지가 다 차는 시간의 배율(`FULL_HOLD` ×). */
  readonly chargeTime: number;
  /** 게이지 힘(pop 의 게이지 몫 190) 배율. */
  readonly chargePower: number;
  /** 게이지를 꽉 채워 떼면 앞으로 더하는 탄산 속도(0 이면 없음). */
  readonly fizz: number;
  /** 땅 속력 상한에 더하는 값. */
  readonly capAdd: number;
  /** 땅 내리막 경사 가속 배율(오르막은 그대로). */
  readonly downhill: number;
  /** 공중 중력(`G_AIR` · `G_DIVE`) 배율. */
  readonly gravity: number;
  /** SPLAT 뒤 남는 접선 속력 비율: 평지 · 가파른 착지(곰젤리 0.7), 오르막 착지(곰젤리 0.7). */
  readonly splatKeep: number; readonly uphillSplatKeep: number;
  /** 판마다 감속 없이 지나가는 SPLAT 수(유령). */
  readonly softSplats: number;
  /** 동전 골드 배율. */
  readonly coin: number;
  /** 숟가락 속력 배율. */
  readonly spoon: number;
}
export const BEAR_TRAITS: JellyTraits = {
  jump: 1, perfectAngle: 0.3, perfectMul: 1.08, perfectAdd: 25, chargeTime: 1, chargePower: 1, fizz: 0, capAdd: 0, downhill: 1, gravity: 1,
  splatKeep: 0.7, uphillSplatKeep: 0.7, softSplats: 0, coin: 1, spoon: 1,
};
const trait = (t: Partial<JellyTraits>): JellyTraits => ({ ...BEAR_TRAITS, ...t });
/** 캐릭터마다 특성(장점 · 단점). 화면의 한 줄 설명은 페이지가 소유한다. */
export const JELLY_TRAITS: Readonly<Record<JellyId, JellyTraits>> = {
  bear: BEAR_TRAITS,
  /** 점프가 높다 / PERFECT 각도 폭이 좁다. */
  bunny: trait({ jump: 1.12, perfectAngle: 0.24 }),
  /** 오르막 SPLAT 감속이 적다 / 최고 속력이 낮다. */
  worm: trait({ uphillSplatKeep: 0.82, capAdd: -50 }),
  /** 내리막 가속이 크다 / 점프가 낮다. */
  penguin: trait({ downhill: 1.4, jump: 0.98 }),
  /** 꾹 게이지가 빨리 찬다 / 게이지 최대 힘이 낮다. */
  frog: trait({ chargeTime: 0.6, chargePower: 0.95 }),
  /** 꽉 채워 떼면 짧은 탄산 부스트 / 게이지가 느리게 찬다. */
  cola: trait({ fizz: 25, chargeTime: 1.5 }),
  /** PERFECT 각도 폭이 넓다 / PERFECT 보너스 속력이 작다. */
  ninjacat: trait({ perfectAngle: 0.36, perfectMul: 1.0, perfectAdd: 10 }),
  /** 동전 +15% / 숟가락이 조금 빠르다(측정에서 +20% 는 판당 골드가 곰젤리의 +10% 를 넘었다). */
  dragon: trait({ coin: 1.15, spoon: 1.12 }),
  /** 체공이 길다(중력이 낮다) / 최고 속력이 낮다. */
  jellyfish: trait({ gravity: 0.85, capAdd: -20 }),
  /** 판의 첫 SPLAT 한 번은 감속이 없다 / 동전 −10%(측정에서 −15% 는 판당 골드가 곰젤리의 −10% 아래였다). */
  ghost: trait({ softSplats: 1, coin: 0.9 }),
  /** 땅 속력 상한이 높다 / SPLAT 감속이 크다(무겁다). */
  mecha: trait({ capAdd: 130, splatKeep: 0.69, uphillSplatKeep: 0.69 }),
};
/** id 의 특성. 모르는 id 면 곰젤리. */
export const jellyTraits = (id: string): JellyTraits => isJellyId(id) ? JELLY_TRAITS[id] : BEAR_TRAITS;
