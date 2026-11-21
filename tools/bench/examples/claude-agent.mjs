// 푸딩 탈출 벤치마크의 LLM 에이전트 예시(의존성 없음, Node 18+ fetch). Anthropic Messages API 를 결정마다 한 번 부른다.
// 실행: ANTHROPIC_API_KEY=… node tools/bench/bench.mjs run --agent "node tools/bench/examples/claude-agent.mjs [--model claude-opus-5-5] [--effort low]" --seeds 1-3
// 결정마다 규칙 + 지금 관찰을 글로 보내고 JSON 행동 하나를 받는다. 글에서 JSON 을 읽지 못하면 null 을 낸다(환경이 잘못된 행동으로 센다).
// 대화 기록은 보내지 않는다(결정마다 새 요청). 토큰 사용량은 stderr 에 적는다. 한 판에 결정이 수백 번이라 비용 · 시간이 크다.
// 거절(stop_reason "refusal")에 대비해 서버 쪽 대체(`fallbacks: "default"`, 베타 server-side-fallback-2026-07-01)를 켠다.
import { createInterface } from "node:readline";

const argv = process.argv.slice(2), opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const MODEL = opt("model") ?? "claude-opus-5-5", EFFORT = opt("effort") ?? "low";
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { process.stderr.write("claude-agent: ANTHROPIC_API_KEY is not set\n"); process.exit(1); }

let reset = null;
const usage = { input: 0, output: 0, calls: 0 };

function system() {
  const r = reset.rules;
  return [
    "You control the jelly in the game Pudding Escape. Maximise distance before the spoon catches you.",
    r.summary, r.actionSchema, r.observation,
    "Reply with one JSON object for the action only, for example {\"waitMs\":0,\"holdMs\":360} or {\"pressAfterMs\":null}. No other text.",
  ].join("\n\n");
}

/** 답 글에서 첫 JSON 객체를 꺼낸다. */
function parseAction(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function decide(obs) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 16000, system: system(), output_config: { effort: EFFORT }, fallbacks: "default",
      messages: [{ role: "user", content: `Decision: ${obs.decision ?? "interval"}\nObservation JSON:\n${JSON.stringify(obs)}` }],
    }),
  });
  if (!res.ok) { process.stderr.write(`claude-agent: HTTP ${res.status} ${await res.text()}\n`); return null; }
  const body = await res.json();
  usage.calls++; usage.input += body.usage?.input_tokens ?? 0; usage.output += body.usage?.output_tokens ?? 0;
  if (body.stop_reason === "refusal") { process.stderr.write("claude-agent: refusal\n"); return null; }
  const text = (body.content ?? []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return parseAction(text);
}

// 결정을 차례로 처리한다(줄이 들어오는 동안 요청이 겹치지 않게 사슬로 잇는다)
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on("line", line => {
  const msg = JSON.parse(line);
  chain = chain.then(async () => {
    if (msg.type === "reset") reset = msg;
    else if (msg.type === "obs") {
      const action = await decide(msg.obs).catch(error => { process.stderr.write(`claude-agent: ${error}\n`); return null; });
      process.stdout.write(`${JSON.stringify({ step: msg.step, action })}\n`);
    } else if (msg.type === "done") {
      process.stderr.write(`claude-agent: seed ${msg.result.seed} ${msg.result.score} m; tokens in ${usage.input} out ${usage.output} over ${usage.calls} calls\n`);
    } else if (msg.type === "end") process.exit(0);
  });
});
