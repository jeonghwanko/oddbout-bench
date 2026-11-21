// 푸딩 탈출 벤치마크의 규칙 에이전트 예시(의존성 없음). JSON 줄 프로토콜로 말한다(docs/kaito-web/game-benchmark.md).
// 실행: node tools/bench/bench.mjs run --agent "node tools/bench/examples/heuristic-agent.mjs" --seeds 1-3
// 땅: 게이지를 꽉 채워 뛴다(타격 멈춤 · 비틀거림 시간을 더한다). 공중: 앞 10~30 m 땅이 내리막이면 0.2 초 뒤에 눌러 내리꽂는다.
import { createInterface } from "node:readline";

let mode = "segment";
const send = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);

function act(obs) {
  if (mode.startsWith("interval")) return { hold: obs.grounded && !(obs.holding && obs.charge >= 1) };
  if (obs.decision === "air") {
    const ahead = obs.terrain.slope.slice(5, 16);
    const downhill = ahead.reduce((a, b) => a + b, 0) / ahead.length < -0.15;
    return { pressAfterMs: downhill ? 200 : null };
  }
  return { waitMs: 0, holdMs: Math.round(1000 * (obs.fullHoldS + obs.freezeS + obs.stumbleS)) + 10 };
}

createInterface({ input: process.stdin }).on("line", line => {
  const msg = JSON.parse(line);
  if (msg.type === "reset") mode = msg.actionMode;
  else if (msg.type === "obs") send({ step: msg.step, action: act(msg.obs) });
  else if (msg.type === "done") process.stderr.write(`heuristic: seed ${msg.result.seed} ${msg.result.score} m\n`);
  else if (msg.type === "end") process.exit(0);
});
