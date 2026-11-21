// 푸딩 탈출 벤치마크의 규칙 에이전트 예시(의존성 없음). JSON 줄 프로토콜로 말한다(docs/kaito-web/game-benchmark.md).
// 실행: node tools/bench/bench.mjs run --agent "node tools/bench/examples/heuristic-agent.mjs" --seeds 1-3
// 땅: 게이지를 꽉 채워 뛴다(타격 멈춤 · 비틀거림 시간을 더한다. 기준 봇 fullCharge 와 같다).
// 공중: 관찰(위치 · 속도 · 앞 지형)과 규칙 글의 물리(공중 중력 · 내리꽂기 중력 · 끌림 · 착지 각도)로 비행을 어림해,
//       누를 때 후보(안 누름, 0~1.5 초) 가운데 착지 판정이 가장 좋고 경사 방향 속력이 가장 큰 것을 고른다.
//       물리 상수는 `reset` 의 `rules.physics` 글에서 읽는다(이 파일에 값을 적지 않는다).
import { createInterface } from "node:readline";

let mode = "segment", phys = null;
const send = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);

/** 규칙 글에서 물리 상수를 읽는다(game units, 10 units = 1 m). */
function readPhysics(lines) {
  const text = lines.join("\n"), num = re => Number(re.exec(text)?.[1]);
  const p = {
    perM: num(/(\d+(?:\.\d+)?) units = 1 m/), stepS: 1 / num(/one step = 1\/(\d+) s/),
    gAir: num(/air (\d+(?:\.\d+)?), air while holding/), gDive: num(/air while holding \(dive\) (\d+(?:\.\d+)?)/),
    feverG: num(/fever air gravity x(\d+(?:\.\d+)?)/), drag: num(/vx -= vx\*(\d+(?:\.\d+)?)\*dt/),
    perfect: num(/PERFECT if d < (\d+(?:\.\d+)?)/), good: num(/GOOD if d < (\d+(?:\.\d+)?)/),
  };
  return Object.values(p).every(Number.isFinite) ? p : null;
}

/** 앞 지형 표본(2 m 마다)을 선형으로 잇는다. 범위 밖은 null. */
function ground(obs, xM) {
  const { stepM, heightM, slope } = obs.terrain, i = Math.floor(xM / stepM), k = xM / stepM - i;
  if (i < 0 || i + 1 >= heightM.length) return null;
  return { h: heightM[i] + (heightM[i + 1] - heightM[i]) * k, slope: slope[i] + (slope[i + 1] - slope[i]) * k };
}

/** `pressAt` 걸음째부터 누른다고 보고 착지까지 밟는다(m, 위가 +). 점수: 판정 × 1000 + 경사 방향 속력. */
function scoreFlight(obs, pressAt) {
  const p = phys, dt = p.stepS, toM = 1 / p.perM;
  let x = 0, y = obs.heightAboveGroundM, vx = obs.vxMps, vy = obs.vyMps, fever = obs.feverS, t = 0;
  for (let i = 0; i < 3 / dt; i++) {
    const g = (pressAt !== null && i >= pressAt ? p.gDive : p.gAir) * (fever > 0 ? p.feverG : 1) * toM;
    fever -= dt; t += dt;
    vy -= g * dt; vx -= vx * p.drag * dt;
    x += vx * dt; y += vy * dt;
    const gr = ground(obs, x);
    if (!gr) return null;
    if (y <= gr.h) {
      const d = Math.abs(Math.atan2(vy, vx) - Math.atan(gr.slope));
      const grade = d < p.perfect ? 2 : d < p.good ? 1 : 0, a = Math.atan(gr.slope);
      return grade * 1000 + vx * Math.cos(a) + vy * Math.sin(a);
    }
  }
  return null;
}

function airAction(obs) {
  if (!phys) return { pressAfterMs: null };
  let best = { pressAfterMs: null }, bestScore = scoreFlight(obs, null) ?? -Infinity;
  for (let ms = 0; ms <= 1500; ms += 25) {
    const score = scoreFlight(obs, Math.round(ms / 1000 / phys.stepS));
    if (score !== null && score > bestScore) { bestScore = score; best = { pressAfterMs: ms }; }
  }
  return best;
}

function act(obs) {
  if (mode.startsWith("interval")) return { hold: obs.grounded && !(obs.holding && obs.charge >= 1) };
  if (obs.decision === "air") return airAction(obs);
  return { waitMs: 0, holdMs: Math.round(1000 * (obs.fullHoldS + obs.freezeS + obs.stumbleS)) + 10 };
}

createInterface({ input: process.stdin }).on("line", line => {
  const msg = JSON.parse(line);
  if (msg.type === "reset") { mode = msg.actionMode; phys = readPhysics(msg.rules.physics ?? []); }
  else if (msg.type === "obs") send({ step: msg.step, action: act(msg.obs) });
  else if (msg.type === "done") process.stderr.write(`heuristic: episode ${msg.episode} ${msg.result.score} m\n`);
  else if (msg.type === "end") process.exit(0);
});
