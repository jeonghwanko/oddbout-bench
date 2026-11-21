/**
 * 게임 벤치마크 환경의 공통 형(게임과 관계없음). 푸딩 탈출이 1호 환경이고, 바운스 볼 · 전설의 대장장이도 같은 형으로 붙인다.
 * 환경은 차례제다: `step` 을 부르기 전에는 게임 시간이 흐르지 않는다. 시간은 게임의 고정 걸음으로, 난수는 시드 PRNG 로만 들어온다.
 * 기록(`BenchTrace`)에는 점수를 넣지 않는다. 점수는 기록을 다시 돌려(`replay`) 얻은 값만 쓴다.
 * 계약 문서: docs/kaito-web/game-benchmark.md
 */

/** 기록 형식 이름. 형식을 바꾸면 숫자를 올린다. */
export const BENCH_TRACE_FORMAT = "oddbout-bench/1";

/** 관찰 트랙: `state` 는 게임 상태를 JSON 수로 준다. `vision` 은 화면 그림을 준다(자리만 잡았고 만들지 않았다). */
export type BenchTrack = "state" | "vision";

/** 한 판의 기록. 같은 환경 판(`envVersion`) · 시드 · 행동 방식 · 행동 목록이면 같은 결과가 다시 나온다. */
export interface BenchTrace {
  readonly format: typeof BENCH_TRACE_FORMAT;
  readonly game: string;
  readonly envVersion: string;
  readonly seed: number;
  readonly track: BenchTrack;
  /** 행동 방식(게임마다 정한다, 예: 푸딩 `segment` · `interval:8`). */
  readonly actionMode: string;
  /** 에이전트가 낸 행동을 받은 그대로(잘못된 행동 포함) 차례대로 둔다. */
  readonly actions: readonly unknown[];
}

/** 한 판의 결과. `score` 가 순위에 쓰는 값이고 `stats` 는 게임마다 다른 보조 수치다. */
export interface BenchResult {
  readonly game: string;
  readonly seed: number;
  readonly score: number;
  /** 점수의 뜻(예: "distanceM"). */
  readonly scoreName: string;
  readonly decisions: number;
  readonly invalidActions: number;
  readonly stats: Readonly<Record<string, number | boolean | string>>;
}

/** 한 결정의 결과. */
export interface BenchStep<Obs> {
  readonly obs: Obs;
  readonly done: boolean;
  readonly info: { readonly invalid: boolean; readonly reason?: string };
}

/** 벤치마크 환경. 한 객체가 한 번에 한 판을 돈다. */
export interface BenchEnv<Obs, Action> {
  readonly game: string;
  readonly track: BenchTrack;
  readonly actionMode: string;
  readonly envVersion: string;
  /** 새 판을 시작하고 첫 관찰을 돌려준다. */
  reset(seed: number): Obs;
  observe(): Obs;
  /** 행동 하나를 다음 결정 자리까지 실행한다. 판이 끝난 뒤에는 부르지 않는다. */
  step(action: Action | unknown): BenchStep<Obs>;
  isDone(): boolean;
  result(): BenchResult;
  trace(): BenchTrace;
}

/** 기록을 다시 돌리다 멈춘 까닭. */
export class BenchReplayError extends Error {}

/**
 * 기록을 같은 환경에서 다시 돌려 결과를 얻는다. 행동이 모자라거나(판이 끝나지 않음) 남으면(판이 먼저 끝남) `BenchReplayError` 를 던진다.
 * 판 확인(게임 · 환경 판 · 행동 방식)은 환경을 만든 쪽이 맞춘다. 여기서는 다르면 던진다.
 */
export function replay<Obs, Action>(env: BenchEnv<Obs, Action>, trace: BenchTrace): BenchResult {
  if (trace.format !== BENCH_TRACE_FORMAT) throw new BenchReplayError(`format ${String(trace.format)} is not ${BENCH_TRACE_FORMAT}`);
  if (trace.game !== env.game) throw new BenchReplayError(`game ${trace.game} is not ${env.game}`);
  if (trace.actionMode !== env.actionMode) throw new BenchReplayError(`actionMode ${trace.actionMode} is not ${env.actionMode}`);
  if (trace.envVersion !== env.envVersion) throw new BenchReplayError(`envVersion ${trace.envVersion} is not ${env.envVersion}`);
  if (!Array.isArray(trace.actions)) throw new BenchReplayError("actions is not an array");
  env.reset(trace.seed);
  let i = 0;
  while (!env.isDone()) {
    if (i >= trace.actions.length) throw new BenchReplayError(`trace ends after ${i} actions before the episode ends`);
    env.step(trace.actions[i++]);
  }
  if (i !== trace.actions.length) throw new BenchReplayError(`episode ends after ${i} actions, trace has ${trace.actions.length}`);
  return env.result();
}
