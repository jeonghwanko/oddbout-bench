# 게임 벤치마크

이 문서는 웹게임을 AI 모델 벤치마크 환경으로 돌리는 계약을 소유한다. 1호 환경은 푸딩 탈출이다.
새 게임이 처음부터 만족할 조건은 게임 저장소의 벤치마크 계약(`docs/kaito-web/game-sites.md`)이 소유한다.
푸딩 탈출의 규칙과 작업 진입점은 게임 저장소의 푸딩 탈출·도메인 문서가 소유한다.

## 목적과 구조

벤치마크 환경은 게임 규칙 위에 얹은 어댑터다. 규칙 코드(`src/sim/pudding/`)는 바꾸지 않는다.
에이전트는 관찰을 받고 행동 하나를 낸다. 환경은 그 행동을 다음 결정 자리까지 실행한다.
환경은 차례제다. `step`을 부르지 않으면 게임 시간이 흐르지 않는다. 그래서 모델의 생각 시간은 점수에 들어가지 않는다.
점수는 기록(행동 목록)을 다시 돌려 얻은 값만 쓴다. 기록 안에는 점수를 넣지 않는다.

SysML v1.6 기반 설명용 요약(`ibd` 벤치마크 실행). 화살표는 전달 방향이다.

```text
ibd [블록] 벤치마크 실행
  agent:에이전트 프로세스 --(행동 JSON 한 줄)--> cli:bench.mjs
  cli:bench.mjs --(reset · obs · done · end JSON 한 줄)--> agent:에이전트 프로세스
  cli:bench.mjs --(행동)--> env:PuddingBenchEnv --(setHold · stepRun)--> rules:sim/pudding
  env:PuddingBenchEnv --(관찰 · 결과 · 기록)--> cli:bench.mjs --(trace-seed-N.json · summary.json)--> out:출력 폴더
```

| 블록 | 소유 파일 |
| --- | --- |
| 공통 형(`BenchEnv`, `BenchTrace`, `BenchResult`)과 다시 돌리기(`replay`) | `src/sim/bench/types.ts` |
| 요약 통계(`summarizeRuns`, `bootstrapCI`, `comparePaired`, `seedsCommitText`, `OFFICIAL_MIN_SEEDS`) | `src/sim/bench/stats.ts` |
| 정규화 점수와 기준 거리(`puddingNormalizedScore`, `puddingReference`, `puddingBaselineResult`) | `src/sim/bench/puddingScore.ts` |
| 푸딩 환경(`PuddingBenchEnv`, `puddingRules`, `PUDDING_PRACTICE_SEEDS`) | `src/sim/bench/pudding.ts` |
| 기준 에이전트(`runPuddingBaseline`, `createPuddingBaseline`) | `src/sim/bench/puddingBaselines.ts` |
| CLI(기준 점수 · 에이전트 실행 · 검증) | `tools/bench/bench.mjs` |
| 환경 소스 목록과 환경 판(`benchSources`, `benchEnvVersion`) | `tools/bench/sources.mjs` |
| 에이전트 예시 | `tools/bench/examples/` |
| 시험 | `test/bench-pudding.test.ts` |

`src/sim/bench/`는 `src/sim/**` 경계를 지킨다. 난수는 `sim/rng.ts`의 시드 PRNG로만 쓴다(`test/architecture.test.ts`).

## 푸딩 탈출 고정 조건

- 판은 `createRun(seed)` 뒤 `startRun(s, seed, false)`로 시작한다. 곰젤리, 아이템 없음, 튜토리얼 없음, 이어 달리기 없음이다.
- 변신 사건(`transform`)이 나오면 환경이 그 걸음에 `transformBurst`와 `transformEnd`를 부른다. 연출 시간은 없다.
  판 측정 도구(`tools/pudding/measure-landings.mjs`)와 같은 처리다.
- 판은 숟가락에 잡힌 걸음(`caught`)에서 끝난다. `caught` 뒤 `eaten`까지는 화면 연출이라 돌리지 않는다.
- 잡히지 않으면 게임 시간 90초(`PUDDING_CAP_S`, 10,800걸음)에서 끝난다. 잡히지 않고 상한에 닿은 판을 탈출한 판이라 한다.
- 걸음은 규칙의 고정 걸음 `STEP`(1/120초)이다.
- 시드는 1..2^32−1(`PUDDING_SEED_MIN`..`PUDDING_SEED_MAX`)이다. 규칙의 시드 PRNG가 32비트라 이 범위 밖의 시드는 다른 시드와 같은 판이 된다. 0은 받지 않는다. `createRng(0)`이 `createRng(0x9e3779b9)`와 같은 상태를 내기 때문이다. `createRng`의 매핑은 그대로 두어, 유효한 시드의 점수는 바꾸지 않는다. 환경과 CLI가 범위 밖의 시드와 0을 거부한다.
- 지형 모양과 판단 요소(캐러멜 · 생크림 · 별 길)는 시드로만 정해진다. 별 동전 자리는 다르다. 별 동전은 별 길 지형을 이을 때의 변신 단계(`placeStars(t, s.stage, …)`)로 놓는다. 그래서 같은 시드에서도 플레이에 따라 자리가 바뀐다.

## 트랙

| 트랙 | 관찰 | 상태 |
| --- | --- | --- |
| `state` | 게임 상태를 JSON 수로 준다 | 만들었다 |
| `vision` | 게임 화면 그림을 준다(안내 표시 끔) | 미구현. 형(`BenchTrack`)에 자리만 있다 |

## 행동 방식

행동 방식은 `reset` 메시지와 기록의 `actionMode`에 남는다. ms 값은 범위로 자른 뒤 `Math.round(ms × 120 / 1000)`걸음으로 바꾼다(`msToSteps`).
범위 밖의 유한한 수는 범위 끝으로 자르고 잘못된 행동으로 세지 않는다.

### segment(기본)

결정 자리는 둘이다. 관찰의 `decision`이 종류를 알린다.

| 결정 | 생기는 때 | 행동 | 범위 |
| --- | --- | --- | --- |
| `ground` | 땅에 있다(판 시작, 내려앉음, 뛰지 못한 뒤) | `{ "waitMs": n, "holdMs": n }` | `waitMs` 0..3000, `holdMs` 0..1500 |
| `air` | 땅을 떠났다(점프, 마루에서 떠오름, 생크림 튕김). 공중에서 잘못된 행동의 빈 행동이 끝난 뒤에도 생긴다 | `{ "pressAfterMs": n }` 또는 `{ "pressAfterMs": null }` | 0..3000 |

- 땅 행동은 `waitMs` 동안 떼고 있다가 `holdMs` 동안 누르고 뗀다. 땅에서 떼면 뛴다.
- `holding`이 참이면(공중에서 누른 채 내려앉음) `waitMs`는 0걸음이어야 한다. 누름은 `holdMs` 더 이어진 뒤 뗀다.
  0이 아니면 잘못된 행동이다.
- 공중 행동은 이 결정 시각부터 `pressAfterMs` 뒤에 누르고(내리꽂기) 내려앉을 때까지 버틴다. 보통 결정 시각은 뜬 순간이다.
  공중에서 빈 행동이 끝난 뒤의 결정이면 그 시각부터 센다. 다음 땅 결정은 `holding: true`를 본다.
  `null`이면 이번 행동 동안 누르지 않는다. 변신이 누름을 풀면 다음 걸음에 다시 누른다.
- 새 결정 자리가 오면 행동은 일찍 끝난다. 예: 기다리는 동안 마루에서 떠오름, 내려앉음, 판 끝.
- 비틀거림(`stumbleS` > 0) 동안 떼면 뛰지 않는다. 이때 환경은 한 걸음을 돌고 다시 땅 결정을 묻는다. 걸음 없는 결정이 끝없이 이어지지 않게 한다.

### interval

행동 `{ "hold": true | false }`를 k걸음 동안 지킨다. k는 1..60이고 기본 8(약 67 ms)이다. 기록에는 `interval:8`처럼 남는다.
관찰의 `decision`은 `null`이다.

### 잘못된 행동

다음은 잘못된 행동이다. 객체가 아님, 필요한 칸이 없거나 수·`null`·참거짓이 아님, 결정 종류와 맞지 않는 행동, 누르는 중의 `waitMs` > 0.
CLI에서는 시간 초과와 프로세스 종료도 `null` 행동이 된다.

1. 환경은 받은 행동을 JSON 값으로 복사해 기록에 그대로 둔다.
2. 잘못된 행동 수(`invalidActions`)를 하나 올린다.
3. 빈 행동을 돈다. 누름 상태를 바꾸지 않는다. segment는 250 ms(30걸음) 또는 다음 결정 자리까지, interval은 한 간격이다.

검사는 기록에 둔 복사본으로 한다. 그래서 기록을 다시 돌리면 같은 판정과 같은 빈 행동이 나온다.

## 관찰(state 트랙)

길이는 m, 속도는 m/s, 시간은 s다. 높이와 기울기는 위가 +다. 모든 수는 유한하고 소수 셋째 자리로 반올림한다(`PuddingObs`).

| 칸 | 뜻 |
| --- | --- |
| `t`, `distanceM`, `xM` | 판 시간, 거리(점수와 같은 값), 발의 x |
| `heightAboveGroundM` | 발 밑 땅에서 발까지 높이(땅에서는 0) |
| `vxMps`, `vyMps`, `groundSpeedMps` | 속도(땅에서는 경사 방향), 땅 속력 |
| `grounded`, `holding`, `holdS`, `charge`, `fullHoldS` | 땅 여부, 누름, 땅에서 누른 시간, 게이지 0..1, 게이지가 차는 시간 |
| `stumbleS`, `freezeS` | SPLAT 비틀거림 남은 시간, 타격 멈춤 남은 시간. 이 동안 게이지가 차지 않는다 |
| `boostS`, `feverS` | 부스터, 피버 남은 시간 |
| `spoonGapM`, `spoonSpeedMps` | 숟가락까지 거리(1.4 m 이하면 잡힘), 숟가락 속력 |
| `stage`, `transformReady`, `combo` | 변신 단계, 다음 변신 대기, 콤보 |
| `decision` | `ground`·`air`·`null` |
| `terrain` | 0, 2, …, 100 m 앞 51점의 땅 높이(발 기준)와 기울기(오르막 +) |
| `features` | 100 m 안의 캐러멜·생크림·별 길. 곰젤리 기준 `startM`·`endM` |
| `lastSegment` | 지난 행동 동안의 걸음 수, 점프(게이지 · 꽉 참 · 도움 점프), 착지 판정 목록, 동전·캐러멜·튕김·변신 수, 잘못된 행동 여부 |

착지 예보(`predictLanding`)와 내부 난수는 주지 않는다. 대신 `reset`의 규칙 글(`rules.physics`, `puddingPhysics`)이 물리 상수와 식을 준다.
걸음 길이, 중력(땅 · 누름 · 공중 · 내리꽂기, 피버 배율), 공중 끌림, 게이지 시간, PERFECT · GOOD 각도, 속력 상한 식, 발사 식, 골짜기 보너스 식,
숟가락 속력 식, 단위 변환(10 = 1 m)이다. 글의 숫자는 규칙(`run.ts`)의 export 상수에서 만든다.
`test/bench-pudding.test.ts`가 글의 발사 식과 골짜기 식을 읽어 `launchVelocity` · `valleyAt`와 같은 값을 내는지 본다.
판의 지형은 곰젤리 앞 70 m까지만 이어져 있다. 환경은 지형과 난수 상태를 얕게 복사해 100 m 너머까지 이어 관찰을 만든다.
지형은 언제 이어도 같은 난수를 같은 차례로 꺼낸다. 그래서 관찰의 앞 지형은 판이 나중에 이을 지형과 같고, 판의 상태는 바뀌지 않는다.

## 프로토콜

CLI는 `--` 뒤에 지정한 실행 파일과 인수를 직접 실행하고 표준 입출력으로 JSON 객체를 한 줄에 하나씩 주고받는다. 기존 `--agent "<명령>"`은 신뢰하는 로컬 명령을 셸로 실행하는 방식이다. 에이전트는 실행한 사용자의 권한으로 동작하며, 표준 오류는 터미널에 나온다.

| 방향 | 메시지 |
| --- | --- |
| 환경 → 에이전트 | `{"type":"reset","game","episode","track","actionMode","envVersion","rules":{"summary","actionSchema","observation","physics"}}` |
| 환경 → 에이전트 | `{"type":"obs","step":n,"obs":{…}}` |
| 에이전트 → 환경 | `{"step":n,"action":{…}}`. `step`은 필수다 |
| 에이전트 → 환경 | 아무 때나 `{"type":"meta",…}`(자가 보고, 선택) |
| 환경 → 에이전트 | 판마다 `{"type":"done","episode","result":{…}}`(시드 없음), 끝에 `{"type":"end"}` |

- 에이전트는 시드를 받지 않는다. `episode`는 이번 실행 안의 판 번호(0부터)다. 기록 파일과 요약에는 시드가 남는다.
- 결정마다 시간 제한이 있다(기본 300초, `--timeout`에 초 단위로 지정). 넘으면 `null` 행동이 된다.
- `step`은 실행 전체에서 0부터 증가한다. 현재 관찰의 `step`과 일치하는 JSON 답만 받고, 64 KiB를 넘는 줄은 버린다.
- 결정 중 에이전트 연결이 끊기면 남은 결정은 모두 `null` 행동이 된다. 요약의 `agentExited`에 처음 감지한 판 번호와 결정 번호가 남고, CLI 종료 코드는 1이다.
- `meta` 줄은 행동이 아니다. 칸을 겹쳐 쌓아(뒤 값이 이긴다) 요약의 `agentMeta`에 남긴다. JSON 4 KB를 넘는 갱신은 버리고 `agentMetaTruncated: true`를 남긴다.
  `agentMeta`는 에이전트의 자가 보고(self-reported)다. CLI는 내용을 확인하지 않는다. 예: `claude-agent.mjs`는 시작에 모델 · effort · 대체(fallbacks) 여부를, 판 끝마다 누적 토큰과 답한 모델 이름을 보낸다.
- 요약에는 실행한 Node 판(`nodeVersion`)도 남는다.
- 저장하는 명령, 에이전트 메타데이터, 행동 문자열에 알려진 자격 증명 필드나 키 패턴이 있으면 가린다. API 키는 환경 변수로 전달한다.

## 기록과 환경 판

기록(`BenchTrace`) 형식은 `oddbout-bench/1`이다.

```json
{ "format": "oddbout-bench/1", "game": "pudding-escape", "envVersion": "4fedac9d39ad", "seed": 1,
  "track": "state", "actionMode": "segment", "actions": [{ "waitMs": 0, "holdMs": 360 }, { "pressAfterMs": null }] }
```

- 다시 돌리기(`replay`)는 형식·게임·행동 방식·환경 판이 다르면 멈춘다. 행동이 모자라거나 남아도 멈춘다.
- 환경 판(`envVersion`)은 CLI가 만든다(`tools/bench/sources.mjs`). `src/sim/bench/index.ts`에서 시작해 상대 import를 따라간 .ts 파일의 닫힘(`benchSources`)을
  경로 차례로 놓고, 파일마다 상대 경로와 내용(줄 끝 `\r\n`을 `\n`으로 바꾼 글)을 sha256에 넣은 값의 앞 12글자다. 순수 환경은 이 값을 인자로 받는다.
- 벤치가 import 하지 않는 파일(미션 · 상점 · 라이벌 · 카드 등)은 판에 들어가지 않는다. 줄 끝을 바꾸므로 Windows(CRLF) 체크아웃도 같은 판을 낸다.
- 닫힘 안의 규칙이나 환경 소스를 바꾸면 환경 판이 바뀐다. 옛 기록은 검증에서 실패한다. 점수표는 같은 환경 판끼리만 비교한다.

## 점수

2026-11-21 사용자 결정이다(아래 결정 기록).

- 공식 순위는 segment 방식만 쓴다. interval 방식은 같은 기준으로 계산한 참고 값이다. `run --official`과 `verify --official`은 segment가 아니면 거절한다.
- 판 거리는 m(`distanceM`)다. 결과(`BenchResult`)에는 판 시간, 잡힘 여부, 판정 착지 수, PERFECT·GOOD·SPLAT 수, 최고 콤보, 변신 단계, 골드, 결정 수, 잘못된 행동 수가 함께 있다.
- 판 점수는 로그 정규화 점수다(`puddingNormalizedScore`).

  ```text
  score = 100 × (ln d − ln d_random) / (ln d_oracle − ln d_random)
  ```

  - `d`는 판 거리다. `d_random`·`d_oracle`은 같은 시드에서 segment 방식 기준 봇 `random`·`oracle`의 거리다(`puddingReference`).
    기준 봇은 결정적이라 환경이 직접 계산한다. interval 방식 실행도 같은 segment 기준 거리로 정규화한다.
  - 위아래로 자르지 않는다. 무작위보다 못하면 음수, `oracle`보다 멀리 가면 100을 넘는다. 거리는 1 m 아래를 1 m로 본다(ln 0을 피한다).
  - 분모가 0 이하인 시드(`oracle`이 `random`보다 멀리 가지 못함)는 점수가 없다. 그 시드는 평균에서 빼고 요약의 `unscoredSeeds`에 남긴다.
  - 소수 셋째 자리로 반올림한다.
- 주 지표(`score`)는 판별 정규화 점수의 평균이다. `scoreCi95`는 시드 단위 부트스트랩 95% 구간이다.
- 함께 싣는 값: 탈출률(`escapePct`, 상한까지 잡히지 않은 판 %), PERFECT %(`perfectPct`), 잘못된 행동 비율(`invalidPct`, 결정 대비 %), 거리 중앙값(`medianDistance`, 참고)과 그 구간.
- 부트스트랩은 2,000번이고 시드 PRNG(`sim/rng.ts`의 mulberry32, 시드 20261121)를 쓴다. 그래서 같은 결과는 같은 구간을 낸다.
- 기준 봇 판은 같은 프로세스 안에서 캐시한다(`puddingBaselineResult`). `oracle`은 판 하나에 약 0.6초가 든다.
- 두 에이전트는 같은 시드에서 짝 비교한다(`compare`). 같은 시드끼리 정규화 점수 차(a − b)의 평균과 부트스트랩 95% 구간, 이긴 시드 수를 낸다.
  두 쪽 다 점수가 있는 시드만 쓴다. `compare`는 이 체크아웃으로 두 요약을 먼저 `verify`하고, 둘 다 통과한 뒤에만 짝 비교한다.

## 기준 점수

2026-11-21에 시드 1~50, 판 상한 90초로 `npm run bench -- baselines`를 돌린 값이다. 환경 판은 `f6a7f66a6884`다(2026-11-22, `reset`이 시드 0을 거부하면서 해시가 바뀌었다. 물리와 유효 시드의 점수는 같다). 규칙이나 환경을 바꾸면 다시 잰다.
그 전 판 `52f6ef79b672`·`b3b71f1fca0f`의 표 값도 이 점수와 같다(이어 달리기 · 메카 젤리 조정은 벤치 판에 쓰지 않고, 시드 0 거부는 점수 계산에 쓰지 않는 범위 검사만 바꾼다).

| 방식 | 기준 | 점수 | 점수 95% 구간 | 탈출 % | PERFECT % | SPLAT % | 잘못된 행동 % | 거리 중앙값 m | 결정/판 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| segment | `random` | 0 | 0..0 | 0 | 2.6 | 59.3 | 0 | 435.5 | 81 |
| segment | `fullCharge` | 15.284 | 9.124..21.449 | 0 | 7.2 | 53.3 | 0 | 666.5 | 31 |
| segment | `heuristic-agent.mjs`(예시) | 49.464 | 46.787..52.102 | 0 | 15.8 | 3.3 | 0 | 1374 | 36 |
| segment | `oracle` | 100 | 100..100 | 0 | 84.6 | 0 | 0 | 4684 | 147 |
| interval:8 | `random` | 11.099 | 6.166..16.22 | 0 | 5.0 | 33.6 | 0 | 597 | 263 |
| interval:8 | `fullCharge` | 10.568 | 4.587..16.43 | 0 | 7.2 | 57.1 | 0 | 568.5 | 278 |

- `random`·`oracle`은 정규화의 기준이라 segment 방식에서 0과 100이다. 50시드 모두 점수가 있다(`unscoredSeeds` 없음).
- `random`은 시드 PRNG로 아무렇게나 고른다. `fullCharge`는 게이지가 찰 때까지(타격 멈춤 · 비틀거림 시간 포함) 눌러 뛰고 공중에서 누르지 않는다.
- `oracle`은 내부 규칙을 쓰는 위쪽 참고값이다. 공정한 경쟁자가 아니다. 환경을 복제해 땅 후보 30개(기다림 5 × 누름 6)를 3초 앞까지 돌려 보고,
  공중에서는 걸음마다 착지 예보(`predictLanding`)로 누를 때를 고른다. segment 방식에서만 쓴다.
- `heuristic-agent.mjs`는 관찰과 규칙 글만 쓰는 예시다. `run --seeds 1-50`으로 잰 값이다(`baselines` 표에는 없다).
- 기준 봇(`random`·`oracle`) 50판에 벽시계 약 18초가 든다.

## 천장

푸딩 탈출은 게임 저장소의 벤치마크 계약 조건 10(강한 봇도 만점이 아니다)을 통과한다.

- 숟가락 속력은 `min(480, 100 + 2t + 0.5t²) + 16·max(0, t − T0)`이다. T0(`SPOON_MAX_T`)는 앞 식이 480(48 m/s)에 닿는 시각(약 25.64초)이다.
  그 뒤에도 초당 16(`SPOON_ACCEL_LATE`)씩 계속 빨라진다(게임 저장소의 푸딩 탈출 규칙(동전과 숟가락)).
- 젤리의 땅 속력 상한은 최대 880(520 + 35×8 + 피버 80)이다. 숟가락은 약 50초 뒤 이 값을 넘는다. 그래서 PERFECT를 이어 속력을 지켜도 결국 잡힌다.
- 판 상한 90초에서 `oracle`은 50판 모두 잡힌다(탈출 0%). 잡히는 시각 중앙값은 61.4초(p10 54.8초, p90 68.3초)다. 판 상한은 거리를 정하지 않는다.
- 정규화 점수는 `oracle`을 100으로 둔다. 관찰만 쓰는 에이전트가 `oracle`보다 오래 버티면 100을 넘는다.

## 명령

저장소 루트에서 실행한다. Node 22.18 이상이 필요하다(TypeScript 형 지우기).

```bash
npm run bench -- baselines                                  # 기준 점수 표(segment, 기본 시드 1-50, random · fullCharge · oracle)
npm run bench -- baselines --mode interval:8                # interval 방식(random · fullCharge, 참고)
npm run bench -- baselines --agents random,fullCharge --json out.json
npm run bench -- run --seeds 1-10 --out bench-out/heuristic -- node tools/bench/examples/heuristic-agent.mjs
npm run bench -- seeds-commit ~/private-seeds.txt --round 2026-12   # 시드 회차 약속(sha256)을 미리 공개한다
npm run bench -- run --seeds-file ~/private-seeds.txt --round 2026-12 --official --out out/py -- python3 tools/bench/examples/agent.py
npm run bench -- verify bench-out/heuristic/summary.json    # 기록과 기준 봇을 다시 돌려 점수 · 통계와 비교
npm run bench -- verify out/py/summary.json --seeds-file ~/private-seeds.txt --official   # 시드 집합과 회차 약속까지 확인
npm run bench -- compare out/a/summary.json out/b/summary.json   # 먼저 verify한 뒤 같은 시드 짝 비교(정규화 점수 차)
npm run bench -- version                                    # 지금 체크아웃의 환경 판
```

- `run`의 기본 시드는 공개 연습 시드 1~10이다. 같은 시드를 두 번 줄 수 없다. 출력은 시드마다 `trace-seed-N.json`과 `summary.json`이다.
  요약(`oddbout-bench-summary/2`)에는 위 점수 칸, `capS`, `official`, `seedsCommit`, 판마다 거리 · 정규화 점수(`normalized`) · 기준 거리(`reference`) · 결과가 있다.
- `--official`(공식 실행)은 `--seeds-file`과 시드 50개(`OFFICIAL_MIN_SEEDS`) 이상이 필요하다. 모자라면 실행하지 않는다.
- `--seeds-file`로 돌리면 요약에 `seedsCommit`(회차 이름 `--round`, 시드 수, sha256)를 남긴다.
- `verify`는 기록이나 요약을 받는다. 다시 돌린 결과를 출력한다. 다음 중 하나면 종료 코드 1이다.
  - 기록: 형식 · 게임 · 환경 판 · 시드 · 트랙 · 행동 방식이 틀리거나 다시 돌리기가 멈춘다.
  - 요약: 게임 · 환경 판 · 트랙 · 행동 방식 · 부트스트랩 설정이 이 체크아웃과 다르다. 판이 하나도 없다. 기록 경로가 요약 폴더 안의 일반 파일로 해석되지 않는다. 절대 경로와 `..`도 거절한다.
    같은 기록이나 같은 시드가 두 번 나온다. 판의 `seed` · 행동 방식이 기록과 다르다. `score`가 없거나, 판의 `score` · `result`가 다시 돌린 결과와 다르다.
    판의 `normalized` · `reference`가 기준 봇을 다시 돌려 계산한 값과 다르다. `capS`가 이 체크아웃의 판 상한과 다르다.
    다시 돌린 결과로 계산한 요약 칸(`summarizeRuns`의 모든 칸: 점수 · 구간 · 탈출률 · PERFECT · SPLAT · 잘못된 행동 · 거리 통계)이 요약과 다르다.
  - 요약에 `seedsCommit`가 있으면 리플레이한 고유 시드 수와 회차 이름으로 계산한 SHA-256이 기록과 일치해야 한다. `--seeds-file`을 주면 요약의 시드 집합을 파일과 대조한다. 단일 기록은 시드가 파일에 들어 있는지 확인한다.
  - 공식 요약(`official: true`)은 segment 방식, 고유 시드 50개 이상, `seedsCommit`가 필요하다. `verify --official`은 공식 요약과 대조할 시드 파일을 모두 요구한다.
- `verify`는 `timeouts`, `agentExited`, `agentMeta`, `nodeVersion`을 확인하지 않는다. 실행 정보와 자가 보고다.
- 예시 에이전트:
  - `heuristic-agent.mjs`(의존성 없음): 땅에서는 `fullCharge`와 같다. 공중에서는 규칙 글의 물리로 비행을 어림해 누를 때를 고른다.
  - `agent.py`(Python 표준 라이브러리): `fullCharge`와 같은 논리다.
  - `claude-agent.mjs`: Anthropic Messages API를 `fetch`로 결정마다 부른다. `ANTHROPIC_API_KEY`가 필요하다. 기본 모델은 `claude-opus-5-5`이고 `--model`·`--effort`로 바꾼다.
    거절에 대비한 서버 쪽 대체(`fallbacks`)를 기본으로 켠다. 대체는 다른 모델로 답할 수 있으므로 공식 실행에서는 `--no-fallbacks`를 준다. 토큰 사용량을 표준 오류와 `meta`에 적는다.
  한 결정의 API 시간 제한은 응답 읽기와 429·5xx 재시도를 합해 60초다. 판마다 재시도 포함 HTTP 요청을 최대 250회 보낸다. 보고된 입출력 토큰 합계가 100,000에 도달하면 다음 요청을 보내지 않는다. 마지막 요청이 기준을 넘길 수 있고, 응답을 받기 전에 취소한 요청의 사용량은 집계에서 빠질 수 있다.

## 비공개 평가 시드

공개 연습 시드는 1~10이다(`PUDDING_PRACTICE_SEEDS`). 비공개 평가 시드는 저장소에 두지 않는다.
평가하는 쪽이 시드 파일(JSON 배열이나 쉼표 · 공백 · 줄로 나눈 정수)을 따로 두고 `--seeds-file`로 준다. 공식 평가는 시드 50개 이상이다.

평가는 회차제다.

1. 평가하는 쪽이 회차마다 시드 파일을 만들고 `seeds-commit <시드 파일> --round <회차>`의 sha256을 먼저 공개한다.
   해시 입력은 겹치지 않게 정렬한 시드와 회차 이름이다(`seedsCommitText`).
2. 그 파일로 `run --official --round <회차>`를 돌린다. 요약에 `seedsCommit`가 남는다.
3. 회차가 끝나면 시드 파일을 공개한다. 누구나 `verify --seeds-file <파일> --official`로 시드 집합과 해시를 대조한다.
출력 기록에는 시드가 들어간다. 비공개 평가의 출력 폴더는 공개하지 않는다.

## 공개 저장소

[`jeonghwanko/oddbout-bench`](https://github.com/jeonghwanko/oddbout-bench)는 게임 규칙에 필요한 코드, 벤치 CLI, 예제 에이전트와 테스트를 MIT 라이선스로 공개한다. 평가 시드와 결과는 평가 운영자가 별도로 관리한다.

## 아직 만들지 않은 것

- `vision` 트랙(헤드리스 화면 캡처, 안내 표시 끔).
- 사람 기준 점수를 모으는 페이지.
- 점수표(리더보드)와 제출 검증 서버.
- 바운스 볼 · 전설의 대장장이 환경. 같은 `BenchEnv` 형으로 더한다.

## 검증

- 환경을 바꾸면 `npm test`, `npm run lint`, `npm run typecheck`를 돌린다.
- 규칙이나 환경을 바꾸면 기준 점수를 다시 재고 위 표와 환경 판을 고친다.

## 결정 기록

| 날짜 | 결정 | 이유 | 커밋 |
| --- | --- | --- | --- |
| 2026-11-22 | 공개 저장소에 시험·계약 문서·린트·CI를 넣고, 시드 0을 거부하며, `--official`은 segment만, `compare`는 먼저 verify, LLM 예시는 물리 글·짧은 max_tokens·타임아웃·재시도·판 예산을 쓴다. `createRng`는 그대로 둔다 | 코드 리뷰: 시드 0과 2,654,435,769가 같은 판이고, 공개본에 시험/CI가 없고, 공식 실행이 interval을 받을 수 있고, `compare`가 미검증 요약을 믿었다. LLM 예시는 물리 규칙을 안 넣고 비용 가드가 없었다 | 이 줄을 더한 커밋 |
| 2026-11-21 | 규칙의 이어 달리기 · 메카 젤리 조정으로 환경 판이 `52f6ef79b672`로 바뀐다. 기준 점수는 다시 재어 같다(벤치 판은 곰젤리, 이어 달리기 없음) | 사용자 결정 "후보로 진행"(게임 저장소의 푸딩 탈출 결정 기록) | 이 줄을 더한 커밋 |
| 2026-11-21 | 천장을 규칙에서 푼다(푸딩 탈출 "lin 16": 숟가락이 최고 속력 뒤에도 초당 16씩 빨라진다). 환경 판 `b3b71f1fca0f`로 기준 점수를 다시 잰다 | 사용자 결정 2026-11-21. 90초 상한에서 `oracle`이 50판 모두 탈출해 거리가 판 상한에 묶였다(조건 10 미통과). 바꾼 뒤 `oracle` 탈출 0%, 잡히는 시각 중앙값 61.4초. 규칙 쪽 측정과 젤리 조정은 게임 저장소의 푸딩 탈출 결정 기록 | 이 줄을 더한 커밋 |
| 2026-11-21 | 점수 지표 · 판 상한 · 평가 시드를 정한다. 판마다 로그 정규화 점수(같은 시드의 segment 방식 `random` 0, `oracle` 100, 자르지 않음)의 평균과 부트스트랩 95% 구간을 주 지표로 하고 탈출률 · PERFECT % · 잘못된 행동 비율 · 거리 중앙값을 함께 싣는다. 판 상한을 300초에서 90초로 줄인다. 공식 평가는 시드 50개 이상의 회차제(`seeds-commit`)이고, `baselines` 기본 시드는 1-50이다. 같은 시드 짝 비교 `compare`를 더한다 | 사용자 결정 2026-11-21: 외부 설계 리뷰(Fable) 제안대로 로그 정규화, 상한 90초, 평가 시드 50개 이상. 거리는 시드마다 크기가 달라 평균이 긴 판에 끌려가고, `oracle`이 300초 상한에 닿아 천장이 생겼다. 정규화는 시드 사이 크기 차이를 지우고, 90초 상한은 판 시간과 기준 봇 비용을 줄인다. 시드가 적으면 구간이 넓다 | 이 줄을 더한 커밋 |
| 2026-11-21 | 벤치 코드 리뷰와 설계 리뷰를 반영한다. 요약 검증(통계 다시 계산 · 중복 · 경로 · 시드 집합), 답의 `step` 필수, 에이전트 종료 기록, 시드 범위, 환경 판은 벤치 import 닫힘만 줄 끝을 맞춰 해시, 에이전트에게 시드를 보내지 않음, 자가 보고 `meta`, 규칙 글에 물리 상수, 공식 순위는 segment만 | 리뷰가 찾은 결함: 같은 기록을 여러 번 넣은 요약과 판이 없는 요약이 검증을 통과했고, `step` 없는 늦은 답 하나가 그 뒤 모든 결정을 한 칸씩 밀었다(591 → 285 m). 시드를 알면 비공개 시드를 외울 수 있다. 미션 글만 고쳐도 옛 기록이 무효가 됐다 | 이 줄을 더한 커밋 |
| 2026-11-21 | 벤치 도구만 공개 저장소 `oddbout-bench`(MIT)로 공개한다. 내보내기 도구가 정한 파일만 넣는다 | 사용자 결정: "oddbout-bench 만 공개하자". 남이 점수를 재현하려면 규칙과 검증기가 공개되어야 한다. 규칙은 이미 게임 JS로 배포된다. 평가 시드는 외워 맞추지 못하게 비공개로 둔다. 라이선스는 `oddbout-starter`와 같은 MIT다 | 이 줄을 더한 커밋 |
| 2026-11-21 | 푸딩 탈출을 첫 벤치마크 환경으로 만든다. 규칙 위 어댑터(`src/sim/bench/`), JSON 줄 프로토콜 CLI, 점수 없는 기록과 다시 돌리기 검증, 기준 에이전트 셋을 둔다. 판은 `caught`에서 끝낸다. 측정 중 찾은 속력 상한 빈틈은 규칙에서 고쳤다(게임 저장소의 푸딩 탈출 결정 기록) | 사용자 결정: 앞으로 만드는 웹게임은 벤치마크용으로 만들고 푸딩이 1호 환경이다. 어댑터는 규칙을 바꾸지 않는다 | 이 줄을 더한 커밋 |
