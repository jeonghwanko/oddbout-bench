// claude-agent.mjs 가 쓰는 순수 도움 함수(시험 가능, API 키 없음).
import { setTimeout as delay } from "node:timers/promises";

export const DEFAULT_MAX_TOKENS = 400;
export const FETCH_TIMEOUT_MS = 60_000;
export const MAX_RETRIES = 3;
export const MAX_CALLS_PER_RUN = 250;
export const MAX_TOKENS_PER_RUN = 100_000;

/** 규칙 글을 시스템 프롬프트로. 물리 상수(`rules.physics`)를 포함한다. */
export function systemPrompt(rules) {
  const r = rules ?? {};
  const physics = Array.isArray(r.physics) ? r.physics.join("\n") : "";
  return [
    "You control the jelly in the game Pudding Escape. Maximise distance before the spoon catches you.",
    r.summary, r.actionSchema, r.observation, physics,
    "Reply with one JSON object for the action only, for example {\"waitMs\":0,\"holdMs\":360} or {\"pressAfterMs\":null}. No other text.",
  ].filter(s => s != null && s !== "").join("\n\n");
}

/** 답 글에서 첫 균형 JSON 객체를 꺼낸다(뒤에 오는 설명의 중괄호는 넣지 않는다). */
export function parseAction(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === "\"") inStr = false;
      continue;
    }
    if (c === "\"") { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** 이번 판의 호출·토큰 예산이 남았는가. */
export function budgetRemaining(usage, limits = { calls: MAX_CALLS_PER_RUN, tokens: MAX_TOKENS_PER_RUN }) {
  const tokens = (usage.input ?? 0) + (usage.output ?? 0);
  return (usage.calls ?? 0) < limits.calls && tokens < limits.tokens;
}

export function retryAfterMs(res, attempt, baseMs = 500) {
  const raw = res?.headers?.get?.("retry-after");
  const sec = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(sec) && sec >= 0) return Math.min(30_000, sec * 1000);
  const date = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  return Math.min(30_000, baseMs * (2 ** attempt));
}

export function shouldRetryStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Messages API POST. 429·5xx 재시도와 본문 읽기에 같은 마감 시간을 쓴다.
 * `fetchImpl` 과 `sleep` 은 시험에서 바꾼다.
 */
export async function postMessage(options) {
  const {
    url = "https://api.anthropic.com/v1/messages",
    headers, body, timeoutMs = FETCH_TIMEOUT_MS, retries = MAX_RETRIES,
    fetchImpl = globalThis.fetch, sleep = delay, usage, signal: requestedSignal,
  } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = requestedSignal ? AbortSignal.any([timeout, requestedSignal]) : timeout;
  const requestBody = JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    if (!budgetRemaining(usage)) return null;
    usage.calls++;
    const res = await fetchImpl(url, { method: "POST", headers, body: requestBody, signal });
    if (res.ok) {
      const reply = await res.json();
      usage.input += reply.usage?.input_tokens ?? 0;
      usage.output += reply.usage?.output_tokens ?? 0;
      return { body: reply, status: res.status };
    }
    await res.body?.cancel();
    if (attempt >= retries || !shouldRetryStatus(res.status) || !budgetRemaining(usage)) return { body: null, status: res.status };
    await sleep(retryAfterMs(res, attempt), undefined, { signal });
  }
}
