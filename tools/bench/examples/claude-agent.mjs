// 푸딩 탈출 벤치마크의 LLM 에이전트 예시(의존성 없음, Node 18+ fetch). Anthropic Messages API 를 결정마다 한 번 부른다.
// 실행: ANTHROPIC_API_KEY=… node tools/bench/bench.mjs run --agent "node tools/bench/examples/claude-agent.mjs [--model claude-opus-5-5] [--effort low] [--no-fallbacks]" --seeds 1-3
// 결정마다 규칙(물리 포함) + 지금 관찰을 글로 보내고 JSON 행동 하나를 받는다. 글에서 JSON 을 읽지 못하면 null 을 낸다(환경이 잘못된 행동으로 센다).
// 대화 기록은 보내지 않는다(결정마다 새 요청). 토큰 사용량은 stderr 에 적는다. 한 판에 결정이 수백 번이라 비용 · 시간이 크다.
// 거절(stop_reason "refusal")에 대비해 서버 쪽 대체(`fallbacks: "default"`, 베타 server-side-fallback-2026-07-01)를 기본으로 켠다.
// 대체는 다른 모델로 답할 수 있다. 공식 실행에서 한 모델만 재려면 `--no-fallbacks` 를 준다.
// 요청은 AbortSignal 타임아웃과 429·5xx 재시도를 쓰고, 판마다 호출·토큰 예산을 넘기면 그 결정은 null 이다.
// 시작할 때 자가 보고 `{"type":"meta"}`(model · effort · fallbacks)를, 판이 끝날 때마다 누적 토큰을 meta 로 보낸다. 요약의 `agentMeta` 에 남는다(자가 보고).
// API 키는 환경 변수로만 읽는다. `--agent` 명령 문자열에 키를 넣지 말 것(요약 파일에 남을 수 있다).
import { createInterface } from "node:readline";
import {
  DEFAULT_MAX_TOKENS, FETCH_TIMEOUT_MS, budgetRemaining, parseAction, postMessage, systemPrompt,
} from "./claude-util.mjs";

const argv = process.argv.slice(2), opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const MODEL = opt("model") ?? "claude-opus-5-5", EFFORT = opt("effort") ?? "low", FALLBACKS = !argv.includes("--no-fallbacks");
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { process.stderr.write("claude-agent: ANTHROPIC_API_KEY is not set\n"); process.exit(1); }

let reset = null;
const usage = { input: 0, output: 0, calls: 0 };
let runUsage = { input: 0, output: 0, calls: 0 };
const models = new Set();
process.stdout.write(`${JSON.stringify({ type: "meta", model: MODEL, effort: EFFORT, fallbacks: FALLBACKS ? "default" : "off" })}\n`);

async function decide(obs) {
  if (!budgetRemaining(runUsage)) {
    process.stderr.write("claude-agent: per-run budget exhausted\n");
    return null;
  }
  const res = await postMessage({
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01",
      ...(FALLBACKS ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
    body: {
      model: MODEL, max_tokens: DEFAULT_MAX_TOKENS, system: systemPrompt(reset.rules), output_config: { effort: EFFORT },
      ...(FALLBACKS ? { fallbacks: "default" } : {}),
      messages: [{ role: "user", content: `Decision: ${obs.decision ?? "interval"}\nObservation JSON:\n${JSON.stringify(obs)}` }],
    },
  });
  if (!res.ok) { process.stderr.write(`claude-agent: HTTP ${res.status} ${await res.text()}\n`); return null; }
  const body = await res.json();
  usage.calls++; usage.input += body.usage?.input_tokens ?? 0; usage.output += body.usage?.output_tokens ?? 0;
  runUsage.calls++; runUsage.input += body.usage?.input_tokens ?? 0; runUsage.output += body.usage?.output_tokens ?? 0;
  if (typeof body.model === "string") models.add(body.model);      // 대체가 답하면 다른 모델 이름이 온다
  if (body.stop_reason === "refusal") { process.stderr.write("claude-agent: refusal\n"); return null; }
  const text = (body.content ?? []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return parseAction(text);
}

// 결정을 차례로 처리한다(줄이 들어오는 동안 요청이 겹치지 않게 사슬로 잇는다)
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on("line", line => {
  const msg = JSON.parse(line);
  chain = chain.then(async () => {
    if (msg.type === "reset") { reset = msg; runUsage = { input: 0, output: 0, calls: 0 }; }
    else if (msg.type === "obs") {
      const action = await decide(msg.obs).catch(error => { process.stderr.write(`claude-agent: ${error}\n`); return null; });
      process.stdout.write(`${JSON.stringify({ step: msg.step, action })}\n`);
    } else if (msg.type === "done") {
      process.stderr.write(`claude-agent: episode ${msg.episode} ${msg.result.score} m; tokens in ${usage.input} out ${usage.output} over ${usage.calls} calls\n`);
      process.stdout.write(`${JSON.stringify({ type: "meta", inputTokens: usage.input, outputTokens: usage.output, calls: usage.calls, modelsSeen: [...models] })}\n`);
    } else if (msg.type === "end") process.exit(0);
  });
});
