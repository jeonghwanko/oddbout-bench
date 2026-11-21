import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_MAX_TOKENS, MAX_CALLS_PER_RUN, budgetRemaining, parseAction, postMessage, retryAfterMs, shouldRetryStatus, systemPrompt,
} from "../tools/bench/examples/claude-util.mjs";

describe("claude-util", () => {
  it("max_tokens 는 수백 단위다", () => {
    assert.ok(DEFAULT_MAX_TOKENS >= 100 && DEFAULT_MAX_TOKENS <= 800);
  });

  it("systemPrompt 에 rules.physics 가 들어간다", () => {
    const text = systemPrompt({
      summary: "SUM", actionSchema: "ACT", observation: "OBS", physics: ["Gravity 560", "Spoon 480"],
    });
    assert.match(text, /SUM/);
    assert.match(text, /ACT/);
    assert.match(text, /OBS/);
    assert.match(text, /Gravity 560/);
    assert.match(text, /Spoon 480/);
  });

  it("parseAction 은 첫 균형 JSON 객체만 읽고, 뒤에 붙은 중괄호는 무시한다", () => {
    assert.deepEqual(parseAction('{"waitMs":0,"holdMs":360}'), { waitMs: 0, holdMs: 360 });
    assert.deepEqual(parseAction('Here: {"pressAfterMs":null} thanks {not json}'), { pressAfterMs: null });
    assert.equal(parseAction("no object here"), null);
    assert.equal(parseAction("{"), null);
    assert.deepEqual(parseAction('{"note":"a } brace in a string","waitMs":1} trailing }'), { note: "a } brace in a string", waitMs: 1 });
  });

  it("판 예산이 끝나면 false 다", () => {
    assert.equal(budgetRemaining({ calls: 0, input: 0, output: 0 }, { calls: 2, tokens: 100 }), true);
    assert.equal(budgetRemaining({ calls: 2, input: 0, output: 0 }, { calls: 2, tokens: 100 }), false);
    assert.equal(budgetRemaining({ calls: 1, input: 60, output: 50 }, { calls: 10, tokens: 100 }), false);
  });

  it("429 와 5xx 만 다시 시도한다", () => {
    assert.equal(shouldRetryStatus(429), true);
    assert.equal(shouldRetryStatus(503), true);
    assert.equal(shouldRetryStatus(400), false);
    assert.equal(shouldRetryStatus(200), false);
  });

  it("Retry-After 초를 밀리초로 읽는다", () => {
    const res = { headers: { get: name => name === "retry-after" ? "2" : null } };
    assert.equal(retryAfterMs(res, 0), 2000);
    assert.equal(retryAfterMs(null, 0, 500), 500);
    assert.equal(retryAfterMs(null, 2, 500), 2000);
  });

  it("postMessage 는 429 뒤 성공하면 다시 시도한다", async () => {
    const usage = { calls: 0, input: 0, output: 0 };
    let cancelled = false;
    const fetchImpl = async () => {
      if (usage.calls === 1) {
        return { ok: false, status: 429, headers: { get: () => "0" }, body: { cancel: () => { cancelled = true; } } };
      }
      return new Response(JSON.stringify({ usage: { input_tokens: 15, output_tokens: 6 } }));
    };
    const res = await postMessage({ usage, fetchImpl, headers: {}, body: {}, sleep: async () => {}, retries: 3, timeoutMs: 5_000 });
    assert.equal(res.status, 200);
    assert.deepEqual(usage, { calls: 2, input: 15, output: 6 });
    assert.equal(cancelled, true);
  });

  it("마지막 호출이 실패해도 판 예산을 넘어 재시도하지 않는다", async () => {
    const usage = { calls: MAX_CALLS_PER_RUN - 1, input: 0, output: 0 };
    const fetchImpl = async () => new Response(null, { status: 503 });
    const request = { usage, fetchImpl, body: {} };
    assert.deepEqual(await postMessage(request), { body: null, status: 503 });
    assert.equal(await postMessage(request), null);
    assert.equal(usage.calls, MAX_CALLS_PER_RUN);
  });

  it("취소하면 재시도를 멈추고 시도한 호출만 센다", async () => {
    const usage = { calls: 0, input: 0, output: 0 };
    const controller = new AbortController();
    const fetchImpl = async () => {
      controller.abort();
      return new Response(null, { status: 429, headers: { "retry-after": "10" } });
    };
    await assert.rejects(postMessage({ usage, fetchImpl, signal: controller.signal, body: {} }), { name: "AbortError" });
    assert.equal(usage.calls, 1);
  });

  it("한 번의 마감 시간을 응답 본문에도 적용한다", async () => {
    const usage = { calls: 0, input: 0, output: 0 };
    const fetchImpl = async (_url, { signal }) => ({
      ok: true, status: 200, json: () => delay(1000, {}, { signal }),
    });
    await assert.rejects(postMessage({ usage, fetchImpl, body: {}, timeoutMs: 20 }), { name: "AbortError" });
    assert.equal(usage.calls, 1);
  });
});
