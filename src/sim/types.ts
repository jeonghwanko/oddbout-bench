/**
 * 시뮬레이션 값 타입 전용 모듈.
 *
 * 이 파일을 포함한 src/sim/** 은 Phaser·DOM·Date.now()·Math.random()·localStorage 를
 * 절대 참조하지 않는다. 시간은 dtMs 인자로, 난수는 rng.ts 의 시드 PRNG 로만 들어온다.
 * 이 경계는 test/architecture.test.ts 가 강제한다.
 *
 * 2026-11-08 원더루팡 본편의 사건 목록(`SimEvent`)과 잠입 타입을 지웠다. 무투장 엔진은 기본 기하·입력·난수 타입만 쓴다.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type Facing = -1 | 1;

/** 한 프레임 분량의 플레이어 입력. 리플레이 기록 단위이기도 하다. */
export interface InputFrame {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly run: boolean;
  readonly crouch: boolean;
  /** 웅크리기 키를 새로 누른 프레임. 구르기는 홀드가 아니라 이 의도로 한 번만 시작한다. */
  readonly crouchPressed: boolean;
  readonly jump: boolean;
  /** 가변 점프 높이를 위해 점프 키를 계속 누르는지 별도로 보존한다. */
  readonly jumpHeld: boolean;
  readonly interact: boolean;
  /** E 홀드 행동은 근처에서 새로 누른 경우에만 대상을 잡는다. */
  readonly interactPressed: boolean;
  readonly hide: boolean;
  readonly whistle: boolean;
  /** 홀드다. 누르고 있는 동안 세기가 차고, 놓는 순간 날아간다. */
  readonly throw: boolean;
  readonly throwPressed: boolean;
  /** 장착한 첫 번째·두 번째 도구를 직접 고르는 엣지 입력. */
  readonly toolSlot1: boolean;
  readonly toolSlot2: boolean;
  /** 등 끄기는 홀드다. 탭 한 번에 꺼지면 '지금 어둠을 산다'는 판단이 사라진다. */
  readonly snuffHold: boolean;
  readonly snuffPressed: boolean;
  readonly drop: boolean;
  readonly thiefEye: boolean;
  readonly thiefEyePressed: boolean;
  readonly attack: boolean;
  readonly heavy: boolean;
}

export const EMPTY_INPUT: InputFrame = Object.freeze({
  moveX: 0,
  moveY: 0,
  run: false,
  crouch: false,
  crouchPressed: false,
  jump: false,
  jumpHeld: false,
  interact: false,
  interactPressed: false,
  hide: false,
  whistle: false,
  throw: false,
  throwPressed: false,
  toolSlot1: false,
  toolSlot2: false,
  snuffHold: false,
  snuffPressed: false,
  drop: false,
  thiefEye: false,
  thiefEyePressed: false,
  attack: false,
  heavy: false,
});

/** 시드 PRNG 상태. 순수 함수로만 전진시킨다. */
export interface RngState {
  readonly seed: number;
}
