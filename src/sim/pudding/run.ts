/**
 * 푸딩 탈출 한 판의 규칙(순수): 곰젤리의 땅·공중 운동, 누르기·떼기 점프, 착지 판정(PERFECT · GOOD · SPLAT), 동전, 숟가락 추격,
 * 변신 준비, 이어 달리기 재시작. 화면·소리·저장·실제 시간을 모른다. 시간은 `dt`(초), 난수는 판의 시드 PRNG 로만 들어온다.
 *
 * 페이지는 이 상태를 읽어 그리고, 명령(`startRun`·`setHold`·`reviveRun`·`transformBurst`·`transformEnd`·`endTutorial`·`useItem`)으로만 바꾼다.
 * 한 걸음에 일어난 일은 사건 목록(append-only)으로 돌려준다. 페이지가 사건을 입자·소리·글자로 바꾼다.
 *
 * 안내 결정도 여기 있다(2026-11-19 1단계): 튜토리얼 단계와 손짓(`tutorialCue`), 첫 변신 손짓(`assistCue`),
 * 착지 예측(`predictLanding` — 실제 판정과 같은 `landingDiff`·`judgedDiff`·`gradeOf` 를 쓴다). 페이지는 그리기만 한다.
 * 판 진단 사실(2026-11-19 2단계, `s.facts` — `diagnosis.ts`)도 여기서 모은다. 결과 화면이 `diagnoseRun` 으로 팁 하나를 고른다.
 * 지형 판단 요소의 효과(2026-11-19 4단계)도 여기 있다: 캐러멜 늪 감속(땅에 있을 때만), 생크림 튕김(내려앉은 뒤), 별 길의 별 동전 자리(`placeStars`).
 * 요소는 공중 궤적을 바꾸지 않는다. 그래서 착지 예측은 요소를 몰라도 실제 판정과 같다.
 * 숟가락을 막는 아이템(2026-11-20, `items.ts`)의 효과도 여기 있다. `startRun` 이 고른 한 종류만 판당 한도로 잘라 들고 가고(`s.items`), 쓴 것만 줄인다.
 * 젤리 폭탄(`useItem`)은 `bombFlight` 초 날아가(숟가락이 `BOMB_INSTANT_GAP` 보다 가까우면 바로) 숟가락을 `BOMB_STUN_S` 초 기절시킨다. 기절한 숟가락은 서 있고(끈 `STUN_LEASH`), 내려치지 않는다.
 * 깨어나면 `SPOON_LEASH` 안에 들 때까지 곰젤리보다 `SPOON_CATCHUP` 빠르게 따라온다(순간이동하지 않는다). 열기구는 잡히는 순간 한 번 숟가락을 밀어내고 기절시킨다.
 * 아이템을 쓰지 않은 판의 숟가락은 아이템 전 식 그대로다. 아이템은 난수를 꺼내지 않고 곰젤리의 궤적 · 착지 판정 · 지형에 닿지 않는다.
 * 자석(2026-11-21)은 판 첫 걸음에 쓰이고(`magnetOn`) 그 판 내내 보통 동전을 곰젤리 앞 `MAGNET_AHEAD` · 뒤 `MAGNET_BEHIND` · 위아래 `MAGNET_REACH_Y` 안에서 끌어 먹는다.
 * 끌어 먹은 동전은 속력을 밀지 않는다. 원래 사거리(8 · 13)에 닿았을 동전은 그 걸음에 그대로 밀고 지운다. 그래서 자석 판의 궤적 · 거리 · 판 시간은 자석 없는 판과 같고 골드만 같거나 많다.
 * 젤리 캐릭터(2026-11-20, `jellies.ts`)의 특성도 여기서 읽는다(`s.traits`): 점프 · PERFECT 문턱 · 게이지 · 탄산 · 속력 상한 · 내리막 · 중력 · SPLAT 감속 ·
 * 감속 없는 SPLAT · 동전 · 숟가락. 곰젤리 특성은 모두 곱하기 1 · 더하기 0 이라 곰젤리 판은 특성 전과 같다. 특성은 난수를 꺼내지 않는다.
 * 착지 예측과 별 길의 기준 궤적도 그 판의 특성을 쓴다(예측 = 실제 판정).
 */
import { createRng, nextFloat } from "../rng";
import type { RngState } from "../types";
import { CAUGHT_AFTER_CARAMEL, CAUGHT_AFTER_SPLAT, DIVE_MIN_HOLD, type RunFacts, newFacts, splatKind } from "./diagnosis";
import { unlockAt } from "./forms";
import { type ItemId, type ItemStock, NO_ITEMS, loadoutOf } from "./items";
import { BEAR_TRAITS, type JellyId, type JellyTraits, jellyTraits } from "./jellies";
import { type Terrain, curv, featureAt, genTo, hill, segAt, slope, startTerrain, trimTerrain } from "./terrain";

/** 숟가락 한 번 내려치기의 길이(초). `ph` 는 0..1 로 돈다. */
export const SPOON_PERIOD = 0.7;
/** 고정 걸음 길이(초). 페이지 루프와 착지 예측이 같은 값을 쓴다. */
export const STEP = 1 / 120;
/** 땅에서 달릴 때 · 누를 때 · 공중 · 공중에서 누를 때(내리꽂기)의 중력. */
export const G_RUN = 600, G_HOLD = 1200, G_AIR = 560, G_DIVE = 1400;
/** 공중 끌림(초당 vx 의 몫)과 피버 동안 공중 중력 배율. */
export const AIR_DRAG = 0.015, FEVER_GRAVITY = 0.85;
/**
 * 땅에서 뗀 점프의 세기(`launchVelocity`): pop = (기본 + 게이지 몫 × 게이지) × (1 + 골짜기 × 골짜기 몫) × (1 + 단계 몫 × min(단계, 단계 상한)).
 * 속도는 경사 방향 땅 속력에 pop 을 앞(경사 몫 + 평지 몫)과 위로 나눠 더한다.
 */
export const LAUNCH_POP_BASE = 200, LAUNCH_POP_CHARGE = 190, LAUNCH_VALLEY_GAIN = 0.5, LAUNCH_STAGE_GAIN = 0.04, STAGE_GAIN_MAX = 8;
export const LAUNCH_FWD_SLOPE = 0.6, LAUNCH_FWD = 0.4, LAUNCH_UP = 0.8;
/** 골짜기 보너스(`valleyAt`): min(상한, max(0, −곡률 × v² / 나눔)). */
export const VALLEY_MAX = 0.8, VALLEY_DIV = 700;
/** 땅 속력 상한(`speedCapOf`): 기본 + 단계 몫 × min(단계, 단계 상한) + 피버 몫(피버 중) + 젤리 특성 `capAdd`. */
export const SPEED_CAP_BASE = 520, SPEED_CAP_STAGE = 35, SPEED_CAP_FEVER = 80;
/** 이 시간(초) 이상 누르면 게이지가 다 찬다. */
export const FULL_HOLD = 0.35;
/** 이보다 짧게 난 튐은 착지 판정을 하지 않는다(초). */
export const GRADED_AIR = 0.32;
/** 착지 각도 차(라디안): PERFECT 미만 · GOOD 미만 · 나머지는 SPLAT. */
export const PERFECT_ANGLE = 0.3, GOOD_ANGLE = 0.8;
/** 튜토리얼 1·2단계 동안 착지 각도 차의 상한(배우는 동안은 SPLAT 이 없다). 3단계(공중 누르기)는 그대로 판정한다. */
export const TUTORIAL_ANGLE_CAP = 0.5;
/** 튜토리얼 1단계 손짓이 나오기까지(초). */
export const TUTORIAL_FIRST_CUE = 0.8;
/** 안전장치: 2·3단계에서 손짓 없이 이만큼(초) 흐르면 튜토리얼을 끝낸다. */
export const TUTORIAL_IDLE_END = 12;
/** 안전장치: 3단계에서 PERFECT 없이 이만큼 판정 착지하면 튜토리얼을 끝낸다. */
export const LESSON3_TRIES = 3;
/** 3단계 땅 손짓: 게이지가 차도 이 속력이 될 때까지(또는 내리막이 RELEASE_SEG_LEFT 만큼만 남을 때까지) 누르고 있게 한다. 빨라야 낮고 길게 날아 경사에 맞출 수 있다. */
export const LESSON3_RELEASE_V = 340, RELEASE_SEG_LEFT = 40;
/** 3단계 공중 손짓: 지금 누르고 버티면 각도 차가 이 값 미만으로 내려앉을 때 HOLD 를 보인다(PERFECT_ANGLE 0.3 안쪽 여유). */
export const DIVE_CUE_ANGLE = 0.26;
/** 첫 변신(0 → 1단계) 도움 점프의 최소 상승 속도. 변신 조건(0.28 초 넘게 · 땅에서 30 위 · 꼭대기 근처)을 넉넉히 넘는다. */
export const ASSIST_RISE = 360;
/** 탄산 부스트(콜라병 젤리): 꽉 채워 뗀 점프에 부스터 불꽃을 이만큼(초) 켠다. 앞으로 미는 속도는 특성의 `fizz` 다. */
export const FIZZ_BOOST = 0.35;
/** 착지 예측을 내다보는 최대 시간(초). */
export const PREDICT_MAX_T = 3;
/** 동전 하나의 골드. */
export const COIN_GOLD = 10;
/**
 * 숟가락 속력(초당 x): 처음 `SPOON_V0`, 판 시간(`runT`, 튜토리얼 제외)에 따라 `SPOON_ACCEL`·t + `SPOON_ACCEL2`·t² 만큼 빨라지고 `SPOON_MAX` 에서 멈춘다.
 * 점프가 납작해져(2026-11-19 2안) 같은 시간에 더 멀리 가므로, 판 길이(초)가 전과 비슷하도록 뒤로 갈수록 더 빨라지게 했다.
 */
export const SPOON_V0 = 100, SPOON_ACCEL = 2, SPOON_ACCEL2 = 0.5, SPOON_MAX = 480;
export const spoonSpeed = (runT: number): number => Math.min(SPOON_MAX, SPOON_V0 + SPOON_ACCEL * runT + SPOON_ACCEL2 * runT * runT);
/** 숟가락과의 거리가 이 값 이하면 잡힌다. */
export const CATCH_GAP = 14;
/** 숟가락 끈: 곰젤리보다 이만큼 넘게 뒤처지면 끈처럼 따라붙는다. */
export const SPOON_LEASH = 180;
/** 아이템(2026-11-20): 기절한 숟가락의 끈(더 멀리 떨어져도 된다), 젤리 폭탄 기절 시간(초), 깨어난 숟가락이 곰젤리 속력보다 더 빠르게 따라오는 속력. */
export const STUN_LEASH = 420, BOMB_STUN_S = 0.6, SPOON_CATCHUP = 150;
/**
 * 숟가락이 이보다 가까우면 젤리 폭탄이 날지 않고 바로 맞는다(비행 0 초). 숟가락이 가장 빠르고(480) 곰젤리가 가장 느릴 때(60)
 * 0.05 초 비행이면 21 만큼 좁혀져, 가까이서 던진 폭탄이 맞기 전에 잡혔다(2026-11-20 보강).
 */
export const BOMB_INSTANT_GAP = 45;
/** 젤리 폭탄이 숟가락에 닿기까지의 시간(초): `BOMB_INSTANT_GAP` 안이면 0, 그 밖은 거리에 비례하고 0.05..0.2 로 자른다. */
export const bombFlight = (gap: number): number => gap < BOMB_INSTANT_GAP ? 0 : Math.min(0.2, Math.max(0.05, gap / 900));
/** 열기구 구출: 숟가락을 곰젤리 이만큼 뒤로 밀고, 이만큼(초) 기절시키고, 곰젤리에 이만큼(초) 부스터를 준다. */
export const BALLOON_PUSH = 60, BALLOON_STUN_S = 1.2, BALLOON_BOOST = 0.8;
/**
 * 자석(2026-11-21): 보통 동전을 끌어 먹는 범위. 곰젤리 x 앞 `MAGNET_AHEAD` · 뒤 `MAGNET_BEHIND`(숟가락 쪽은 좁게), 곰젤리 가운데(`y − 12`)에서 위아래 `MAGNET_REACH_Y`.
 * 보통 사거리는 앞뒤 8 · 위아래 13 이다. 별 동전은 끌지 않는다(별 길 규칙 그대로).
 * 동전이 촘촘해 범위를 조금만 넓혀도 골드가 크게 는다(시드 200판: 앞뒤 · 위아래 60 이면 판당 +880, 16 · 8 · 20 이면 +130).
 * 값 100골드(2026-11-21 사용자 결정)보다 조금 덜 늘도록 14 · 8 · 17 로 정했다(잘하는 정책 +80 · +85, 톡톡 +40). 그래서 자석 판의 순 골드는 자석 없는 판보다 조금 적다.
 */
export const MAGNET_AHEAD = 14, MAGNET_BEHIND = 8, MAGNET_REACH_Y = 17;
/** 숟가락이 이보다 가까우면 폭탄 손짓(`itemCue`)을 낸다. */
export const ITEM_CUE_GAP = 90;
/** 잡힌 뒤 냠(NOM) · 판 끝까지의 시간(초). */
export const NOM_AT = 0.12, EATEN_AT = 0.9;
/** 캐러멜 늪: 땅에서 늪 위에 있는 동안 속력이 초당 이 비율로 준다(`v -= CARAMEL_DRAG·v·dt`). 공중에서는 닿지 않는다. */
export const CARAMEL_DRAG = 2.4;
/** 생크림 트램펄린: 내려앉은 판정마다 위로 튕기는 속도. SPLAT 은 생크림에 파묻혀 튕기지 않는다. */
export const CREAM_POP: Readonly<Record<LandingGrade, number>> = { perfect: 400, good: 300, splat: 0 };
/** 생크림에 PERFECT 로 내려앉으면 동전 이만큼(각 `COIN_GOLD`)이 터지고 부스터가 이만큼(초) 길어진다. */
export const CREAM_PERFECT_COINS = 3, CREAM_PERFECT_BOOST = 0.9;
/**
 * 별 길: 골짜기(`Feature.x0`)에서 꽉 채워(게이지 1) 뛴 기준 궤적 위에 별 동전을 놓는다(`placeStars`).
 * 기준은 속력 `STAR_REF_V`(측정에서 골짜기까지 누르고 온 속력의 중앙값 근처) · 놓는 때의 변신 단계 · 그 골짜기의 골짜기 보너스다.
 * 뜬 뒤 `STAR_T0`..`STAR_T1` 초 사이에 `STAR_COINS` 개, 땅보다 `STAR_MIN_AIR` 넘게 높은 자리만 놓는다(낮게 달려서는 못 먹는다).
 * 별 동전은 그림이 커서 닿는 범위도 조금 넓다(`STAR_REACH_X`·`STAR_REACH_Y`, 보통 동전 8·13).
 */
export const STAR_REF_V = 520, STAR_COINS = 7, STAR_T0 = 0.35, STAR_T1 = 0.95, STAR_MIN_AIR = 40, STAR_REACH_X = 10, STAR_REACH_Y = 18;
/** 별 동전을 놓기 전에 골짜기 앞으로 이어 둘 지형 길이(기준 궤적이 `STAR_T1` 까지 가는 거리보다 길다). */
export const STAR_AHEAD = 900;

export type LandingGrade = "perfect" | "good" | "splat";
/** 튜토리얼 단계: 1 누르고 떼기, 2 내리막에서 뛰기, 3 공중에서 눌러 경사에 맞춰 내려앉기. */
export type TutorialLesson = 1 | 2 | 3;
/** 손짓: 누르라(press) · 누르고 있으라(hold) · 떼라(release). */
export type CoachCue = "none" | "press" | "hold" | "release";

/** 한 걸음에 일어난 일. 페이지가 연출로 바꾼다. */
export type PuddingEvent =
  /** 뗌: 푸딩이 튕겨 냈다. `charge` 0..1 게이지, `valley` 골짜기 보너스, `full` 게이지가 다 찼었다, `slope` 뛴 자리의 기울기,
   *  `assisted` 첫 변신 도움 점프(게이지와 관계없이 크게 뛴다). */
  | { readonly kind: "jump"; readonly charge: number; readonly valley: number; readonly full: boolean; readonly slope: number; readonly assisted: boolean }
  /** 누르는 동안 게이지가 다 찼다. */
  | { readonly kind: "charged" }
  /** 탄산 부스트(콜라병 젤리): 꽉 채워 뗀 점프가 앞으로 더 밀렸다. */
  | { readonly kind: "fizz" }
  /** 감속 없는 SPLAT(유령 젤리): 이번 SPLAT 은 속력을 잃지 않고 비틀거리지 않는다(`grade` splat 바로 뒤). */
  | { readonly kind: "phase" }
  /** 땅에 내려앉았다. `impactV` 는 땅에 수직인 속도. */
  | { readonly kind: "land"; readonly impactV: number }
  /** 착지 판정. `combo` 는 판정 뒤 콤보. */
  | { readonly kind: "grade"; readonly grade: LandingGrade; readonly combo: number }
  /** PERFECT 다섯 번 연속: 피버가 켜졌다. */
  | { readonly kind: "fever" }
  /** 부스터 순간 전진이 끝났다(짧은 멈춤). */
  | { readonly kind: "dashEnd" }
  /** 걸음을 끝까지 움직였다: `dash` 배수로 `dx` 만큼 갔다. `dashing` 은 걸음 끝에 아직 돌진 중인가. */
  | { readonly kind: "advance"; readonly dash: number; readonly dx: number; readonly dashing: boolean }
  /** 동전을 먹었다. `pulled`: 자석이 원래 사거리 밖에서 끌어 먹었다(화면이 동전 자리에서 곰젤리로 날아오게 그린다). */
  | { readonly kind: "coin"; readonly x: number; readonly y: number; readonly pulled?: boolean }
  /** 숟가락이 푸딩을 내려쳤다(한 주기마다). `cutX` 는 떠낸 자리, `wx` 는 그때 곰젤리 x, `gap` 은 곰젤리와의 거리. */
  | { readonly kind: "spoonHit"; readonly cutX: number; readonly wx: number; readonly gap: number }
  /** 다음 변신이 열렸다(`next` 번째 변신). */
  | { readonly kind: "powerReady"; readonly next: number }
  /** 큰 점프 꼭대기: 변신을 시작한다. 페이지가 연출 뒤 `transformBurst` · `transformEnd` 를 부른다. */
  | { readonly kind: "transform" }
  /** 튜토리얼 한 단계를 마쳤다(`passed` 단계). */
  | { readonly kind: "lessonPassed"; readonly passed: TutorialLesson }
  /** 튜토리얼이 끝났다. `how`: 3단계 PERFECT(`perfect`), 3단계 시도 `LESSON3_TRIES` 번 소진(`tries`), 손짓 없이 `TUTORIAL_IDLE_END` 초(`idle`). */
  | { readonly kind: "tutorialDone"; readonly how: "perfect" | "tries" | "idle" }
  /** 숟가락에 잡혔다. */
  | { readonly kind: "caught" }
  /** 잡힌 곰젤리를 숟가락이 삼켰다(냠). */
  | { readonly kind: "nom" }
  /** 판이 끝났다(잡히고 나서 EATEN_AT 뒤). */
  | { readonly kind: "eaten" }
  /** 땅에서 캐러멜 늪에 들어갔다(늪 하나에 한 번). */
  | { readonly kind: "caramel"; readonly x: number }
  /** 생크림 트램펄린에 내려앉아 다시 튕겼다(`grade` 는 그 착지 판정, SPLAT 은 튕기지 않아 나오지 않는다). */
  | { readonly kind: "bounce"; readonly grade: LandingGrade; readonly x: number }
  /** 젤리 폭탄을 뒤로 던졌다(2026-11-20). `flight` 초 뒤 숟가락에 맞는다. */
  | { readonly kind: "bombThrow"; readonly flight: number }
  /** 숟가락이 기절했다: 폭탄에 맞음(bomb) · 열기구에 밀림(balloon). `gap` 은 그때 곰젤리와의 거리. */
  | { readonly kind: "spoonStun"; readonly cause: "bomb" | "balloon"; readonly gap: number }
  /** 잡히는 순간 열기구가 구해 줬다. `x` 는 밀려난 숟가락 x. */
  | { readonly kind: "balloonSave"; readonly x: number }
  /** 기절한 숟가락이 깨어나 다시 쫓는다. */
  | { readonly kind: "spoonRecover" }
  /** 자석을 썼다(2026-11-21): 자석을 들고 간 판의 첫 걸음에 한 번. 이어 달리기는 다시 내지 않는다. */
  | { readonly kind: "magnetOn" };

export interface RunStats { perfect: number; maxCombo: number; topKmh: number; gold: number }

export interface PuddingRun {
  rng: RngState;
  terrain: Terrain;
  /** 월드 x(10 이 1 m), 발 높이 y(아래가 +). */
  wx: number; y: number;
  /** 땅에서는 경사를 따라가는 속력 `v`, 공중에서는 속도 `vx`·`vy`. */
  v: number; vx: number; vy: number;
  grounded: boolean; hold: boolean; holdT: number; full: boolean;
  airT: number; landT: number; bonkT: number; freeze: number;
  spoonX: number; gap: number; runT: number; ph: number;
  combo: number; streak: number; feverT: number; caughtT: number;
  boostT: number; dashT: number; dashPending: boolean;
  /** 지금 변신 단계(0 = 그냥 곰젤리). */
  stage: number;
  /** 다음 변신이 열려 큰 점프를 기다린다. */
  ready: boolean;
  /** 튜토리얼 판: 변신·숟가락 가속이 없다. 1·2단계 동안은 SPLAT 도 없다. */
  tutorial: boolean;
  /** 튜토리얼 단계, 튜토리얼 판에서 흐른 시간(초), 손짓 없이 흐른 시간(초), 3단계에서 PERFECT 없이 판정받은 착지 수. */
  lesson: TutorialLesson; tutorialT: number; tutorialIdle: number; lessonTries: number;
  /** 이번 비행이 시작될 때의 튜토리얼 단계(튜토리얼 밖이면 0). 3단계 비행만 그대로 판정한다. */
  flightLesson: number;
  /** 마지막으로 땅에서 들어간 캐러멜 늪의 시작 x(늪마다 사건 하나). 없으면 NaN. */
  caramelX: number;
  stats: RunStats;
  /** 판 진단 사실(결과 화면 팁). `startRun` 이 비우고 `reviveRun` 은 그대로 둔다. */
  facts: RunFacts;
  /** 아이템(2026-11-20): 이번 판에 남은 수(`reviveRun` 은 다시 채우지 않는다), 날아가는 폭탄의 남은 시간(초, 없으면 −1),
   *  숟가락 기절 남은 시간(초), 깨어난 숟가락이 끈 안으로 따라오는 중인가. */
  items: Record<ItemId, number>; bombT: number; spoonStunT: number; spoonRecover: boolean;
  /** 젤리 캐릭터(2026-11-20)와 그 특성, 이번 판에 남은 감속 없는 SPLAT 수(`reviveRun` 은 다시 채우지 않는다),
   *  동전 골드의 소수 나머지(동전 배율이 1 이 아니면 정수 골드로 나누고 남는 몫). */
  jelly: JellyId; traits: JellyTraits; softSplats: number; goldFrac: number;
}

export interface StepResult {
  readonly events: readonly PuddingEvent[];
  /** 걸음이 끝까지 돌았다(움직이고 카메라가 따라간다). 잡힘·멈춤·변신 시작·플레이 밖이면 false. */
  readonly advanced: boolean;
}

const rand = (s: PuddingRun) => () => { const d = nextFloat(s.rng); s.rng = d.state; return d.value; };

/** 시작 화면의 세상(데모 지형). */
export function createRun(seed: number): PuddingRun {
  const s: PuddingRun = {
    rng: createRng(seed), terrain: startTerrain(false),
    wx: 0, y: 100, v: 120, vx: 0, vy: 0, grounded: true, hold: false, holdT: 0, full: false,
    airT: 0, landT: 0, bonkT: 0, freeze: 0, spoonX: -90, gap: 90, runT: 0, ph: 0,
    combo: 0, streak: 0, feverT: 0, caughtT: -1, boostT: 0, dashT: 0, dashPending: false,
    stage: 0, ready: false, tutorial: false, lesson: 1, tutorialT: 0, tutorialIdle: 0, lessonTries: 0, flightLesson: 0, caramelX: NaN,
    stats: { perfect: 0, maxCombo: 0, topKmh: 0, gold: 0 }, facts: newFacts(),
    items: { ...NO_ITEMS }, bombT: -1, spoonStunT: 0, spoonRecover: false,
    jelly: "bear", traits: BEAR_TRAITS, softSplats: 0, goldFrac: 0,
  };
  extendTerrain(s, 800);
  s.y = hill(s.terrain, 0);
  return s;
}

/**
 * `x` 까지 지형을 잇고 새 별 길에 별 동전을 놓는다. `x` 안의 별 길은 궤적 아래 지형(`STAR_AHEAD`)까지 더 이어 바로 놓는다.
 * 조각은 언제 이어도 같은 차례로 같은 난수를 꺼내므로 지형은 그대로 같다.
 */
function extendTerrain(s: PuddingRun, x: number): void {
  const t = s.terrain, r = rand(s);
  genTo(t, x, r);
  for (const f of t.feats) if (f.kind === "stars" && !f.placed && f.x0 <= x) genTo(t, f.x0 + STAR_AHEAD, r);
  placeStars(t, s.stage, s.traits);
}

/**
 * 새 판. 숟가락 시계(`ph`)는 이어서 돈다. `stock` 은 가진 아이템 수, `pick` 은 이번 판에 들고 갈 한 종류다:
 * 그 종류만 판당 한도로 잘라 들고 간다(`loadoutOf`). 튜토리얼 판은 들고 가지 않는다. `jelly` 는 이번 판의 젤리 캐릭터다(특성 `jellyTraits`).
 */
export function startRun(s: PuddingRun, seed: number, tutorial: boolean, stock: ItemStock = NO_ITEMS, pick: ItemId | null = null, jelly: JellyId = "bear"): void {
  s.jelly = jelly; s.traits = jellyTraits(jelly); s.softSplats = s.traits.softSplats; s.goldFrac = 0;
  s.rng = createRng(seed);
  s.terrain = startTerrain(tutorial);
  Object.assign(s, { wx: 0, v: 120, vx: 0, vy: 0, grounded: true, hold: false, holdT: 0, full: false, landT: 0, bonkT: 0,
    airT: 0, spoonX: tutorial ? -160 : -130, gap: tutorial ? 160 : 130, runT: 0, combo: 0, streak: 0, feverT: 0, caughtT: -1,
    freeze: 0, boostT: 0, dashT: 0, dashPending: false, stage: 0, ready: false, tutorial, caramelX: NaN,
    lesson: 1, tutorialT: 0, tutorialIdle: 0, lessonTries: 0, flightLesson: 0 });
  s.stats = { perfect: 0, maxCombo: 0, topKmh: 0, gold: 0 };
  s.facts = newFacts();
  s.items = { ...(tutorial ? NO_ITEMS : loadoutOf(stock, pick)) };
  s.bombT = -1; s.spoonStunT = 0; s.spoonRecover = false;
  s.facts.bombsHeld = s.items.bomb;
  extendTerrain(s, 800);
  s.y = hill(s.terrain, 0);
}

/**
 * 이어 달리기: 같은 자리에서 숟가락을 `SPOON_LEASH` 뒤에 두고, 숟가락보다 조금(20) 빠르게 다시 달린다(변신 단계·거리·골드·진단 사실은 그대로).
 * 남은 아이템은 그대로다(다시 채우지 않는다). 날아가던 폭탄 · 숟가락 기절 · 따라오기는 비운다.
 */
export function reviveRun(s: PuddingRun): void {
  Object.assign(s, { y: hill(s.terrain, s.wx), grounded: true, caughtT: -1, spoonX: s.wx - SPOON_LEASH, gap: SPOON_LEASH,
    v: Math.max(140, Math.min(SPOON_MAX, spoonSpeedOf(s) + 20)), vx: 0, vy: 0, hold: false, holdT: 0, full: false,
    bonkT: 0, landT: 0, airT: 0, freeze: 0, boostT: 1.5, bombT: -1, spoonStunT: 0, spoonRecover: false });
}

/**
 * 아이템을 쓴다(2026-11-20). 지금은 젤리 폭탄만 손으로 쓴다(열기구는 잡히는 순간 저절로 쓰인다).
 * 튜토리얼 판이 아니고 · 잡히지 않았고 · 남은 폭탄이 있고 · 날아가는 폭탄이 없을 때만 던진다. 숟가락이 기절 중이어도 던질 수 있다(맞으면 기절을 새로 둔다).
 * 숟가락이 `BOMB_INSTANT_GAP` 보다 가까우면 바로 맞는다(`bombThrow{flight: 0}` 뒤에 `spoonStun`). 못 쓰면 빈 목록이다.
 */
export function useItem(s: PuddingRun, id: ItemId): PuddingEvent[] {
  if (id !== "bomb" || s.tutorial || s.caughtT >= 0 || s.items.bomb <= 0 || s.bombT >= 0) return [];
  s.items.bomb--;
  s.facts.bombsUsed++;
  const flight = bombFlight(s.gap);
  if (flight > 0) { s.bombT = flight; return [{ kind: "bombThrow", flight }]; }
  const events: PuddingEvent[] = [{ kind: "bombThrow", flight: 0 }];
  bombHit(s, s.gap, events);
  return events;
}

/** 젤리 폭탄이 맞았다: 숟가락 기절을 새로 둔다(쌓지 않는다). */
function bombHit(s: PuddingRun, gap: number, events: PuddingEvent[]): void {
  s.bombT = -1; s.spoonStunT = BOMB_STUN_S; s.spoonRecover = false;
  events.push({ kind: "spoonStun", cause: "bomb", gap });
}

/** 폭탄 손짓: 폭탄을 지금 던질 수 있고 숟가락이 `ITEM_CUE_GAP` 보다 가깝다(기절 중이 아니다). 그리기는 페이지가 한다. */
export function itemCue(s: PuddingRun): boolean {
  return !s.tutorial && s.caughtT < 0 && s.items.bomb > 0 && s.bombT < 0 && s.spoonStunT <= 0 && s.gap < ITEM_CUE_GAP;
}

/** 변신이 터졌다: 단계가 하나 오른다. */
export function transformBurst(s: PuddingRun): void { s.stage += 1; }

/** 변신 연출이 끝났다: 숟가락을 뒤로 밀고 짧게 부스터, 떨어지던 중이면 살짝 띄운다. */
export function transformEnd(s: PuddingRun): void {
  s.spoonX -= 90; s.boostT = 0.6;
  if (!s.grounded && s.vy > -40) s.vy = Math.min(s.vy, -80);
}

/** 튜토리얼을 바로 끝낸다(안전장치). */
export function endTutorial(s: PuddingRun): void { s.tutorial = false; s.tutorialIdle = 0; }

/** 걸음 수 거리(m). */
export const distanceM = (s: PuddingRun): number => Math.max(0, Math.floor(s.wx / 10));
export const speedOf = (s: PuddingRun): number => s.grounded ? s.v : Math.hypot(s.vx, s.vy);
/** 숟가락이 떠낸 푸딩 끝. */
export const spoonCutX = (s: PuddingRun): number => s.spoonX + 8;
/** 땅 속력 상한: 변신 단계 · 피버 · 젤리 특성으로 늘어난다. 땅 걸음, 뛰는 순간(`setHold`), 생크림 튕김에 건다. */
export const speedCapOf = (s: PuddingRun): number =>
  SPEED_CAP_BASE + SPEED_CAP_STAGE * Math.min(s.stage, STAGE_GAIN_MAX) + (s.feverT > 0 ? SPEED_CAP_FEVER : 0) + s.traits.capAdd;
/** 뛰는 속력: 땅 속력을 상한으로 자른 값. 발사와 골짜기 보너스가 함께 쓴다. */
export const launchSpeedOf = (s: PuddingRun): number => Math.min(speedCapOf(s), s.v);
/** 게이지가 다 차는 시간(초): `FULL_HOLD` × 젤리 특성 `chargeTime`. */
export const fullHoldOf = (s: PuddingRun): number => FULL_HOLD * s.traits.chargeTime;
/** 게이지 0..1. */
export const chargeOf = (s: PuddingRun): number => Math.min(1, s.holdT / fullHoldOf(s));
/** 이번 판의 숟가락 속력: `spoonSpeed` × 젤리 특성 `spoon`. */
export const spoonSpeedOf = (s: PuddingRun): number => spoonSpeed(s.runT) * s.traits.spoon;
/** 동전 하나의 골드(화면 글자): `COIN_GOLD` × 젤리 특성 `coin`, 반올림. */
export const coinGoldOf = (s: PuddingRun): number => Math.round(COIN_GOLD * s.traits.coin);
/** 동전 하나를 먹었다: `COIN_GOLD` × 젤리 특성 `coin` 을 더한다. 정수 골드만 쌓고 소수 나머지(`goldFrac`)는 다음 동전으로 넘긴다. */
function addCoin(s: PuddingRun): void {
  s.goldFrac += COIN_GOLD * s.traits.coin;
  const whole = Math.floor(s.goldFrac + 1e-9);
  s.stats.gold += whole; s.goldFrac -= whole;
}
/** 골짜기(오목)에서 빠르게 누를수록 커지는 튕김 보너스 0..0.8. */
export function valleyOf(s: PuddingRun): number { return valleyAt(s.terrain, s.wx, launchSpeedOf(s)); }
/** `wx` 자리에서 속력 `v` 로 뛸 때의 골짜기 보너스 0..0.8. */
export function valleyAt(t: Terrain, wx: number, v: number): number {
  const sl = slope(t, wx), k = curv(t, wx) / Math.pow(1 + sl * sl, 1.5);
  return Math.max(0, Math.min(VALLEY_MAX, -k * v * v / VALLEY_DIV));
}
/**
 * 땅에서 뗀 점프의 속도. 오래 누를수록(`charge` 0..1), 골짜기일수록(`valley`), 변신 단계가 높을수록 푸딩이 더 세게 튕긴다.
 * 튕김은 앞으로 0.4 · 위로 0.8 이다(2026-11-19 2안: 납작하게 길게 날아 경사에 맞춰 내려앉기 쉽게). 별 길의 기준 궤적도 이 식을 쓴다.
 * 젤리 특성 `chargePower` 가 게이지 몫(190)을, `jump` 가 튕김 전체를 곱한다(곰젤리는 둘 다 1).
 */
export function launchVelocity(v: number, sl: number, charge: number, valley: number, stage: number,
  traits: Pick<JellyTraits, "jump" | "chargePower"> = BEAR_TRAITS): { vx: number; vy: number } {
  const ang = Math.atan(sl), cs = Math.cos(ang), sn = Math.sin(ang);
  const pop = (LAUNCH_POP_BASE + LAUNCH_POP_CHARGE * charge * traits.chargePower) * (1 + valley * LAUNCH_VALLEY_GAIN)
    * (1 + LAUNCH_STAGE_GAIN * Math.min(stage, STAGE_GAIN_MAX)) * traits.jump;
  return { vx: v * cs + sn * pop * LAUNCH_FWD_SLOPE + pop * LAUNCH_FWD, vy: v * sn - pop * LAUNCH_UP };
}

/**
 * 별 길에 별 동전을 놓는다(지형을 이을 때마다 부른다). 그 골짜기에서 기준 속력으로 꽉 채워 뛴 궤적(공중 걸음과 같은 `STEP` · 중력 · 끌림)을 밟아
 * `STAR_T0`..`STAR_T1` 초 사이에 고르게 놓는다. 동전 자리는 몸 가운데(발 − 12)다. 궤적 아래 지형이 다 이어진 뒤에 놓는다.
 * 궤적에 걸리는 보통 동전은 뺀다. 별 동전은 먹어도 앞으로 밀지 않는다. 그래서 별을 먹는 동안 궤적이 기준에서 벗어나지 않는다.
 */
export function placeStars(t: Terrain, stage: number, traits: JellyTraits = BEAR_TRAITS): void {
  for (const f of t.feats) {
    if (f.kind !== "stars" || f.placed || t.segEnd < f.x0 + STAR_AHEAD) continue;
    f.placed = true;
    const y0 = hill(t, f.x0), { vx: vx0, vy: vy0 } = launchVelocity(STAR_REF_V, slope(t, f.x0), 1, valleyAt(t, f.x0, STAR_REF_V), stage, traits);
    let x = f.x0, y = y0, vx = vx0 + traits.fizz, vy = vy0, next = 0;     // 꽉 채운 점프라 탄산(콜라병)도 더한다
    const path: [number, number][] = [];
    const ga = G_AIR * traits.gravity;
    for (let i = 1; i <= Math.ceil(STAR_T1 / STEP); i++) {
      vy += ga * STEP; vx -= vx * AIR_DRAG * STEP;
      x += vx * STEP; y += vy * STEP;
      path.push([x, y - 12]);
      const at = STAR_T0 + (STAR_T1 - STAR_T0) * next / Math.max(1, STAR_COINS - 1);
      if (next >= STAR_COINS || i * STEP + 1e-9 < at) continue;
      next++;
      if (hill(t, x) - y > STAR_MIN_AIR) t.drops.push({ x, y: y - 12, star: true });
    }
    // 궤적에 걸리는 보통 동전(마루 아치)은 뺀다: 별 길이 두 번 보상하지 않고, 보통 동전이 밀어(+6) 궤적이 늘어나지 않게
    t.drops = t.drops.filter(d => d.star || !path.some(([px, py]) => Math.abs(px - d.x) < 12 && Math.abs(py - d.y) < 22));
  }
}
/** n 번째 변신이 열리는 거리에 닿았는가. */
export const reachedUnlock = (s: PuddingRun, n: number): boolean => Math.floor(s.wx / 10) >= unlockAt(n);
/** 지금 서 있는 언덕 조각이 끝나기까지 남은 x. */
export const segLeft = (s: PuddingRun): number => segAt(s.terrain, s.wx).x1 - s.wx;

/** 착지 판정(곰젤리 문턱 `PERFECT_ANGLE`). */
export function gradeOf(angleDiff: number): LandingGrade { return gradeWith(angleDiff, PERFECT_ANGLE); }
/** 착지 판정. `perfect` 는 PERFECT 문턱(젤리 특성 `perfectAngle`)이다. */
export function gradeWith(angleDiff: number, perfect: number): LandingGrade {
  return angleDiff < perfect ? "perfect" : angleDiff < GOOD_ANGLE ? "good" : "splat";
}

/** 착지 각도 차(라디안): 속도 방향과 `wx` 자리 땅 경사의 차. 실제 착지와 착지 예측이 같이 쓴다. */
export function landingDiff(t: Terrain, wx: number, vx: number, vy: number): number {
  return Math.abs(Math.atan2(vy, vx) - Math.atan(slope(t, wx)));
}
/** 판정에 쓰는 각도 차: 튜토리얼 1·2단계에서 시작한 비행은 상한(SPLAT 없음)으로 자른다. */
export function judgedDiff(s: PuddingRun, diff: number): number {
  return s.tutorial && s.flightLesson < 3 ? Math.min(diff, TUTORIAL_ANGLE_CAP) : diff;
}
/** 땅을 떠날 때(점프 · 마루에서 떠오름) 이번 비행의 튜토리얼 단계를 적는다. */
function takeOff(s: PuddingRun): void { s.grounded = false; s.airT = 0; s.flightLesson = s.tutorial ? s.lesson : 0; s.facts.airHoldT = 0; }

/** 첫 변신 도움 점프인가: 튜토리얼 밖, 0단계에서 첫 변신이 열려 큰 점프를 기다린다. */
export const assistArmed = (s: PuddingRun): boolean => !s.tutorial && s.stage === 0 && s.ready;

/** 누르기(true) · 떼기(false). 땅에서 떼면 푸딩이 튕겨 낸다. */
export function setHold(s: PuddingRun, on: boolean): PuddingEvent[] {
  const events: PuddingEvent[] = [];
  if (on === s.hold) return events;
  s.hold = on;
  if (on) { s.holdT = 0; s.full = false; return events; }
  if (s.grounded && s.caughtT < 0 && s.bonkT <= 0) {
    const full = s.holdT >= fullHoldOf(s), sl = slope(s.terrain, s.wx);
    // 땅 속력 상한은 뛸 때도 건다(발사 속력과 골짜기 보너스 둘 다, `launchSpeedOf`). PERFECT 착지는 상한을 넘는 속력을 주고 상한은 땅 걸음에서만 걸린다.
    // 타격 경직(`freeze`) 중에는 땅 걸음이 돌지 않으므로, 여기서 자르지 않으면 경직 중에 떼어 PERFECT 를 이을 때마다 속력이 끝없이 커진다(2026-11-21).
    const v = launchSpeedOf(s);
    const charge = chargeOf(s), valley = valleyOf(s), assisted = assistArmed(s);
    // 톡 떼도 뛴다(`launchVelocity`). 첫 변신 도움 점프는 게이지가 덜 찼어도 꽉 찬 세기로 뛰고, 변신 높이에 닿도록 최소 상승 속도를 준다.
    const l = launchVelocity(v, sl, assisted ? 1 : charge, valley, s.stage, s.traits);
    s.vx = l.vx; s.vy = l.vy;
    if (assisted) s.vy = Math.min(s.vy, -ASSIST_RISE);
    takeOff(s);
    if (!s.tutorial) { s.facts.jumps++; if (full) s.facts.fullJumps++; }
    events.push({ kind: "jump", charge, valley, full, slope: sl, assisted });
    // 탄산 부스트(콜라병 젤리): 꽉 채워 떼면 앞으로 더 밀고 부스터 불꽃을 켠다
    if (full && s.traits.fizz > 0) { s.vx += s.traits.fizz; s.boostT = Math.max(s.boostT, FIZZ_BOOST); events.push({ kind: "fizz" }); }
    if (s.tutorial && full) {
      if (s.lesson === 1) { s.lesson = 2; events.push({ kind: "lessonPassed", passed: 1 }); }
      else if (s.lesson === 2 && sl > 0.05) { s.lesson = 3; events.push({ kind: "lessonPassed", passed: 2 }); }
    }
  }
  return events;
}

function grade(s: PuddingRun, g: LandingGrade, tang: number, uphill: boolean, events: PuddingEvent[]): void {
  const t = s.traits;
  if (g === "perfect") {
    s.v = tang * t.perfectMul + t.perfectAdd; s.combo++; s.stats.perfect++; s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo);
    // 타격: 경직 → 부스터 순간 전진 → 짧은 멈춤
    s.freeze = 0.075; s.dashPending = true; s.boostT = 0.5;
    events.push({ kind: "grade", grade: g, combo: s.combo });
    s.streak++;
    if (s.streak >= 5 && s.feverT <= 0) { s.feverT = 6; s.streak = 0; s.facts.fevers++; events.push({ kind: "fever" }); }
  } else if (g === "good") {
    s.v = Math.max(45, tang); s.combo++; s.streak = 0; s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo);
    events.push({ kind: "grade", grade: g, combo: s.combo });
  } else if (s.softSplats > 0 && s.flightLesson === 0) {
    // 감속 없는 SPLAT(유령 젤리, 판마다 `softSplats` 번): 콤보는 끊기지만 속력을 잃지 않고 비틀거리지 않는다
    s.softSplats--;
    s.v = Math.max(60, tang); s.combo = 0; s.streak = 0;
    events.push({ kind: "grade", grade: g, combo: s.combo }, { kind: "phase" });
  } else {
    s.v = Math.max(60, tang * (uphill ? t.uphillSplatKeep : t.splatKeep)); s.combo = 0; s.streak = 0; s.bonkT = 0.3; s.freeze = 0.09; s.boostT = 0;
    events.push({ kind: "grade", grade: g, combo: s.combo });
  }
}

function land(s: PuddingRun, gy: number, events: PuddingEvent[]): void {
  const sl = slope(s.terrain, s.wx), ang = Math.atan(sl), cs = Math.cos(ang), sn = Math.sin(ang);
  const tang = s.vx * cs + s.vy * sn, diff = landingDiff(s.terrain, s.wx, s.vx, s.vy);
  s.y = gy; s.grounded = true; s.landT = 0.18; s.holdT = 0;
  events.push({ kind: "land", impactV: Math.max(0, -(s.vx * sn) + s.vy * cs) });
  if (s.airT < GRADED_AIR) { s.v = Math.max(45, tang); return; }                           // 작은 튐은 판정하지 않는다
  const g = gradeWith(judgedDiff(s, diff), s.traits.perfectAngle);
  if (s.flightLesson === 0) noteLanding(s.facts, g, sl, s.vx, s.vy);
  grade(s, g, tang, g === "splat" && splatKind(sl, s.vx, s.vy) === "uphill", events);
  if (featureAt(s.terrain, s.wx, "cream")) creamBounce(s, g, cs, sn, events);
  // 튜토리얼 3단계: 첫 PERFECT 에서 끝난다. 3단계 비행이 PERFECT 없이 LESSON3_TRIES 번 내려앉아도 끝낸다(안전장치)
  if (s.tutorial && s.lesson === 3) {
    if (g !== "perfect" && s.flightLesson === 3) s.lessonTries++;
    if (g === "perfect" || s.lessonTries >= LESSON3_TRIES) { endTutorial(s); events.push({ kind: "tutorialDone", how: g === "perfect" ? "perfect" : "tries" }); }
  }
}

/**
 * 생크림 트램펄린: 판정 뒤(속력은 판정이 정한 그대로) 경사를 따라 가던 속도에 위로 `CREAM_POP` 을 더해 다시 띄운다. SPLAT 은 파묻혀 튕기지 않는다.
 * PERFECT 면 동전 `CREAM_PERFECT_COINS` 개가 터지고 부스터가 길어진다. 판정 착지에만 튕긴다(작은 튐은 판정이 없다).
 */
function creamBounce(s: PuddingRun, g: LandingGrade, cs: number, sn: number, events: PuddingEvent[]): void {
  const pop = CREAM_POP[g];
  if (pop <= 0) return;
  // 다시 띄우는 속력에도 땅 속력 상한을 건다(뛰는 순간 `setHold` 와 같다). PERFECT 가 준 상한 넘는 속력으로 튕기지 않는다(2026-11-21).
  const v = launchSpeedOf(s);
  s.vx = v * cs; s.vy = v * sn - pop;
  takeOff(s);
  s.facts.creamBounces++;
  events.push({ kind: "bounce", grade: g, x: s.wx });
  if (g !== "perfect") return;
  s.boostT = Math.max(s.boostT, CREAM_PERFECT_BOOST);
  for (let i = 0; i < CREAM_PERFECT_COINS; i++) {
    addCoin(s);
    events.push({ kind: "coin", x: s.wx + (i - 1) * 9, y: s.y - 22 - (i % 2) * 6 });
  }
}

/** 판정 착지 하나를 진단 사실에 적는다(튜토리얼 비행은 부르지 않는다). */
function noteLanding(f: RunFacts, g: LandingGrade, sl: number, vx: number, vy: number): void {
  f[g]++;
  if (f.airHoldT > DIVE_MIN_HOLD) f.dives++;
  if (g !== "splat") return;
  const kind = splatKind(sl, vx, vy);
  if (kind === "uphill") f.splatUphill++; else if (kind === "steep") f.splatSteep++; else f.splatFlat++;
  f.lastSplat = kind; f.sinceSplat = 0;
}

/** 착지 예측 결과: 내려앉을 자리 · 그때의 속도 · 판정. */
export interface LandingForecast {
  readonly x: number; readonly y: number; readonly slope: number;
  readonly vx: number; readonly vy: number;
  /** 각도 차(판정에 쓰는 값 — 튜토리얼 1·2단계는 상한으로 자른 값). */
  readonly diff: number;
  readonly grade: LandingGrade;
  /** 판정받는 착지인가(GRADED_AIR 넘게 떠 있음). */
  readonly graded: boolean;
  /** 내려앉기까지 남은 시간(초). */
  readonly t: number;
}
/**
 * 착지 예측: 지금부터 `hold`(누름 여부)를 그대로 둔다면 어디에 어떤 판정으로 내려앉는가. 땅이거나 `maxT` 안에 내려앉지 않으면 null.
 * `stepRun` 의 공중 걸음(피버 중력 · 돌진 · 짧은 멈춤 포함)을 같은 `STEP` 으로 그대로 밟고, 판정은 실제 착지와 같은 함수다.
 * 동전(앞으로 +6)과 변신 시작은 예측하지 않는다.
 */
export function predictLanding(s: PuddingRun, hold: boolean = s.hold, maxT: number = PREDICT_MAX_T): LandingForecast | null {
  if (s.grounded || s.caughtT >= 0) return null;
  let wx = s.wx, y = s.y, vx = s.vx, vy = s.vy, airT = s.airT, fever = s.feverT, freeze = s.freeze, dashT = s.dashT;
  const steps = Math.ceil(maxT / STEP);
  for (let i = 1; i <= steps; i++) {
    fever = Math.max(0, fever - STEP);
    if (freeze > 0) { freeze -= STEP; continue; }
    const dash = dashT > 0 ? 3 : 1;
    if (dashT > 0) { dashT -= STEP; if (dashT <= 0) freeze = 0.04; }
    airT += STEP;
    const ga = (hold ? G_DIVE : G_AIR) * (fever > 0 ? FEVER_GRAVITY : 1) * s.traits.gravity;
    vy += ga * STEP; vx -= vx * AIR_DRAG * STEP;
    wx += vx * STEP * dash; y += vy * STEP;
    const gy = hill(s.terrain, wx);
    if (y >= gy) {
      const diff = judgedDiff(s, landingDiff(s.terrain, wx, vx, vy));
      return { x: wx, y: gy, slope: slope(s.terrain, wx), vx, vy, diff, grade: gradeWith(diff, s.traits.perfectAngle), graded: airT >= GRADED_AIR, t: i * STEP };
    }
  }
  return null;
}

/** 손짓의 땅 쪽: 누르기 → 게이지가 찰 때까지 버티기 → 떼기. */
const groundCue = (s: PuddingRun): CoachCue => !s.hold ? "press" : s.holdT >= fullHoldOf(s) ? "release" : "hold";
/** 3단계 공중 손짓의 문턱: `DIVE_CUE_ANGLE`, PERFECT 문턱이 좁은 젤리는 그 문턱보다 0.04 안쪽. */
const diveCueAngle = (s: PuddingRun): number => s.traits.perfectAngle < PERFECT_ANGLE ? s.traits.perfectAngle - 0.04 : DIVE_CUE_ANGLE;
/** 땅에서 손짓을 받을 수 있는가(막 내려앉음 · 비틀거림 · 잡힘이 아니다). */
const cueReady = (s: PuddingRun): boolean => s.grounded && s.landT <= 0 && s.bonkT <= 0 && s.caughtT < 0;
/** 내리막 점프 자리: 게이지가 다 찰 만큼 내리막이 남았다(누르는 중이면 남은 길이는 보지 않는다). */
const downhillSpot = (s: PuddingRun): boolean => slope(s.terrain, s.wx) > 0.05 && (s.hold || segLeft(s) > 140);

/**
 * 튜토리얼 손짓(규칙이 정한다, 화면은 그리기만 한다).
 * 1단계: 평지에서 누르기 → 버티기 → 떼기. 2단계: 내리막에서 같은 손짓.
 * 3단계: 내리막에서 누른 채 속력을 모아(`LESSON3_RELEASE_V`) 뛰고, 공중에서 지금 누르고 버티면 PERFECT 로 내려앉는 순간에
 * 누르기 → 내려앉을 때까지 버티기.
 */
export function tutorialCue(s: PuddingRun): CoachCue {
  if (!s.tutorial || s.caughtT >= 0) return "none";
  if (!s.grounded) {
    if (s.lesson !== 3 || s.flightLesson !== 3) return "none";
    if (s.hold) return "hold";
    if (s.vy < 0) return "none";                                    // 내려오기 시작한 뒤에만
    const p = predictLanding(s, true);
    return p && p.graded && p.diff < diveCueAngle(s) ? "press" : "none";
  }
  if (!cueReady(s)) return "none";
  const spot = s.lesson === 1 ? s.tutorialT > TUTORIAL_FIRST_CUE : downhillSpot(s);
  if (!spot) return "none";
  const cue = groundCue(s);
  // 3단계: 내리막에서 누른 채 속력을 모은 뒤에 뗀다
  if (cue === "release" && s.lesson === 3 && s.v < LESSON3_RELEASE_V && segLeft(s) > RELEASE_SEG_LEFT) return "hold";
  return cue;
}
/** 첫 변신 손짓: POWER UP!(0 → 1단계) 뒤 땅에서 누르기 → 버티기 → 떼기. 뗀 점프는 도움 점프다(`assistArmed`). */
export function assistCue(s: PuddingRun): CoachCue {
  return assistArmed(s) && cueReady(s) ? groundCue(s) : "none";
}
/** 지금 보일 손짓(튜토리얼이면 튜토리얼, 아니면 첫 변신). */
export const coachCue = (s: PuddingRun): CoachCue => s.tutorial ? tutorialCue(s) : assistCue(s);

/**
 * 고정 걸음 하나(`dt` 초). `playing` 이 거짓이면(시작 화면·결과 화면) 숟가락 시계·피버·잡힘만 흐른다.
 */
export function stepRun(s: PuddingRun, dt: number, playing: boolean): StepResult {
  const events: PuddingEvent[] = [];
  s.feverT = Math.max(0, s.feverT - dt);
  const prevPh = s.ph; s.ph = (s.ph + dt / SPOON_PERIOD) % 1;
  if (s.caughtT >= 0) {
    const was = s.caughtT; s.caughtT += dt;
    if (was < NOM_AT && s.caughtT >= NOM_AT) events.push({ kind: "nom" });
    if (s.caughtT > EATEN_AT && playing) events.push({ kind: "eaten" });
    return { events, advanced: false };
  }
  if (!playing) return { events, advanced: false };
  if (s.items.magnet > 0 && !s.facts.magnet) { s.facts.magnet = true; events.push({ kind: "magnetOn" }); }   // 판 시작에 쓴 것으로 친다
  if (s.ph < prevPh && s.spoonStunT <= 0) events.push({ kind: "spoonHit", cutX: spoonCutX(s), wx: s.wx, gap: s.gap });   // 기절한 숟가락은 내려치지 않는다
  if (s.freeze > 0) { s.freeze -= dt; return { events, advanced: false }; }
  if (s.dashPending) { s.dashPending = false; s.dashT = 0.11; }

  s.stats.topKmh = Math.max(s.stats.topKmh, Math.round(speedOf(s) * 0.36));
  if (!s.ready && !s.tutorial && reachedUnlock(s, s.stage + 1)) { s.ready = true; events.push({ kind: "powerReady", next: s.stage + 1 }); }
  // 변신: 열려 있으면 높이 30 이상 · 0.28 초 넘게 떠 있는 큰 점프의 꼭대기 근처에서 시작한다
  if (s.ready && !s.grounded && s.airT > 0.28 && s.vy > -70 && s.vy < 90 && hill(s.terrain, s.wx) - s.y > 30) {
    s.ready = false; s.hold = false; s.facts.transforms++;
    events.push({ kind: "transform" });
    return { events, advanced: false };
  }
  extendTerrain(s, s.wx + 700);
  trimTerrain(s.terrain, s.spoonX - 400);
  s.terrain.drops = s.terrain.drops.filter(d => d.x > spoonCutX(s));
  s.facts.readyT = s.ready ? s.facts.readyT + dt : 0;
  if (!s.tutorial) { s.runT += dt; s.facts.sinceSplat += dt; s.facts.sinceCaramel += dt; }      // 숟가락이 빨라지는 시계는 다 배운 뒤부터
  else {
    // 튜토리얼 시계와 안전장치: 2·3단계에서 손짓 없이 TUTORIAL_IDLE_END 초가 흐르면 땅에서 끝낸다
    s.tutorialT += dt;
    s.tutorialIdle = s.lesson >= 2 && tutorialCue(s) === "none" ? s.tutorialIdle + dt : 0;
    if (s.tutorialIdle > TUTORIAL_IDLE_END && s.grounded) { endTutorial(s); events.push({ kind: "tutorialDone", how: "idle" }); }
  }
  s.boostT = Math.max(0, s.boostT - dt);
  s.bonkT = Math.max(0, s.bonkT - dt);
  s.landT = Math.max(0, s.landT - dt);
  const dash = s.dashT > 0 ? 3 : 1;
  if (s.dashT > 0) { s.dashT -= dt; if (s.dashT <= 0) { s.freeze = 0.04; events.push({ kind: "dashEnd" }); } }
  const x0 = s.wx;
  const cap = speedCapOf(s);
  if (s.grounded) {
    const sl = slope(s.terrain, s.wx), ang = Math.atan(sl), cs = Math.cos(ang), sn = Math.sin(ang);
    const holding = s.hold && s.bonkT <= 0, g1 = holding ? G_HOLD : G_RUN;
    if (holding) {
      s.holdT += dt;
      if (!s.full && s.holdT >= fullHoldOf(s)) { s.full = true; events.push({ kind: "charged" }); }
    }
    s.v += g1 * sn * (sn > 0 ? s.traits.downhill : 1) * dt + (s.boostT > 0 ? 120 * dt : 0);
    s.v -= (0.04 * s.v + 0.0011 * s.v * s.v) * dt;
    // 캐러멜 늪: 땅에서 늪 위에 있는 동안 속력이 크게 준다(늪 하나에 들어갈 때 사건 하나)
    const sticky = featureAt(s.terrain, s.wx, "caramel");
    if (sticky) {
      s.v -= CARAMEL_DRAG * s.v * dt; s.facts.sinceCaramel = 0;
      if (s.caramelX !== sticky.x0) { s.caramelX = sticky.x0; s.facts.caramelHits++; events.push({ kind: "caramel", x: s.wx }); }
    }
    s.v = Math.max(60, Math.min(cap, s.v));
    const k = curv(s.terrain, s.wx) / Math.pow(1 + sl * sl, 1.5);
    if (!holding && k > 0 && s.v * s.v * k > g1 * cs * 0.5) {        // 마루를 빠르게 넘으면 떠오른다
      s.vx = s.v * cs; s.vy = s.v * sn; takeOff(s);
    } else { s.wx += s.v * cs * dt * dash; s.y = hill(s.terrain, s.wx); }
  } else {
    s.airT += dt;
    if (s.hold) s.facts.airHoldT += dt;
    const ga = (s.hold ? G_DIVE : G_AIR) * (s.feverT > 0 ? FEVER_GRAVITY : 1) * s.traits.gravity;
    s.vy += ga * dt; s.vx -= s.vx * AIR_DRAG * dt;
    s.wx += s.vx * dt * dash; s.y += s.vy * dt;
    const gy = hill(s.terrain, s.wx);
    if (s.y >= gy) land(s, gy, events);
  }
  events.push({ kind: "advance", dash, dx: s.wx - x0, dashing: s.dashT > 0 });
  const magnet = s.facts.magnet;
  for (const d of s.terrain.drops) {
    if (d.taken) continue;
    const dy = Math.abs(d.y - (s.y - 12));
    if (Math.abs(d.x - s.wx) < (d.star ? STAR_REACH_X : 8) && dy < (d.star ? STAR_REACH_Y : 13)) {
      d.taken = true;
      if (!d.star) { if (s.grounded) s.v += 6; else s.vx += 6; }      // 별 동전은 밀지 않는다(별 길 궤적이 늘어나지 않게)
      if (d.pulled) continue;                                          // 자석이 먼저 먹었다: 자석 없는 판과 같은 걸음에 밀기만 한다
      addCoin(s);
      if (d.star) s.facts.stars++;
      events.push({ kind: "coin", x: d.x, y: d.y });
    } else if (magnet && !d.star && !d.pulled && d.x - s.wx < MAGNET_AHEAD && s.wx - d.x < MAGNET_BEHIND && dy < MAGNET_REACH_Y) {
      d.pulled = true;                                                 // 끌어 먹는다: 골드만 더하고 밀지 않는다
      addCoin(s);
      s.facts.coinsPulled++;
      events.push({ kind: "coin", x: d.x, y: d.y, pulled: true });
    }
  }
  s.terrain.drops = s.terrain.drops.filter(d => !d.taken);
  // 숟가락: 시간이 갈수록 빨라진다. 너무 멀어지면 끈처럼 따라붙는다. 튜토리얼 동안은 뒤에서 입맛만 다신다(150~180 뒤, 잡지 않는다)
  if (s.tutorial) {
    s.spoonX = Math.min(s.spoonX + 100 * dt, s.wx - 150);
    s.spoonX = Math.max(s.spoonX, s.wx - SPOON_LEASH);
  } else moveSpoon(s, dt, events);
  s.gap = s.wx - s.spoonX;
  if (s.gap <= CATCH_GAP) {
    if (s.items.balloon > 0) balloonSave(s, events);
    else {
      s.caughtT = 0; s.hold = false; s.facts.caughtAfterSplat = s.facts.sinceSplat < CAUGHT_AFTER_SPLAT;
      s.facts.caughtAfterCaramel = s.facts.sinceCaramel < CAUGHT_AFTER_CARAMEL;
      s.facts.caughtWithBomb = s.items.bomb > 0;
      events.push({ kind: "caught" });
    }
  }
  return { events, advanced: true };
}

/**
 * 튜토리얼 밖 숟가락 한 걸음. 날아가는 폭탄이 닿으면 기절한다(`BOMB_STUN_S`, 쌓지 않고 새로 둔다).
 * 기절: 서 있는다(끈 `STUN_LEASH`). 깨어나면 끈(`SPOON_LEASH`) 안에 들 때까지 `max(숟가락 속력, 곰젤리 속력 + SPOON_CATCHUP)` 으로 따라온다.
 * 그 밖은 아이템 전 식 그대로다(시간에 따라 빨라지고 끈 `SPOON_LEASH`).
 */
function moveSpoon(s: PuddingRun, dt: number, events: PuddingEvent[]): void {
  if (s.bombT >= 0) {
    s.bombT -= dt;
    if (s.bombT <= 0) bombHit(s, s.wx - s.spoonX, events);
  }
  if (s.spoonStunT > 0) {
    s.spoonX = Math.max(s.spoonX, s.wx - STUN_LEASH);
    s.spoonStunT -= dt;
    if (s.spoonStunT <= 0) { s.spoonStunT = 0; s.spoonRecover = true; events.push({ kind: "spoonRecover" }); }
    return;
  }
  if (s.spoonRecover && s.wx - s.spoonX > SPOON_LEASH) {
    s.spoonX += Math.max(spoonSpeedOf(s), speedOf(s) + SPOON_CATCHUP) * dt;
    if (s.wx - s.spoonX <= SPOON_LEASH) s.spoonRecover = false;
    return;
  }
  s.spoonRecover = false;
  s.spoonX = s.spoonX + spoonSpeedOf(s) * dt;
  s.spoonX = Math.max(s.spoonX, s.wx - SPOON_LEASH);
}

/** 열기구 구출: 잡히는 대신 숟가락을 `BALLOON_PUSH` 뒤로 밀고 기절시키고, 곰젤리에 부스터를 주고 비틀거림을 푼다. */
function balloonSave(s: PuddingRun, events: PuddingEvent[]): void {
  s.items.balloon--;
  s.spoonX = s.wx - BALLOON_PUSH; s.gap = BALLOON_PUSH;
  s.spoonStunT = BALLOON_STUN_S; s.spoonRecover = false;
  s.boostT = Math.max(s.boostT, BALLOON_BOOST); s.bonkT = 0;
  s.facts.balloonSaves++;
  events.push({ kind: "balloonSave", x: s.spoonX }, { kind: "spoonStun", cause: "balloon", gap: s.gap });
}
