import { spawn } from "node:child_process";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const [provider, model] = process.argv.slice(2);
const instruction = "You are evaluating one Bounce Ball scene. Use only the supplied rules and observation. Do not use tools or code. Return only the requested JSON object.";
const taskInstruction = {
  repair: 'Return {"repair":{"start":integer,"ticks":integer,"axis":integer}}. The repair axis must differ from originalAxis.',
  predict: 'Return {"predict":["label","label"]}, with one label for each probe, in order.',
};
const emit = message => console.log(JSON.stringify(message));
const toolItems = new Set(["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "webSearch"]);
const sameModel = (seen, requested) => seen === requested || (seen?.startsWith(`${requested}-`) && /^\d{8}$/.test(seen.slice(-8)));

function runProcess(cwd, env, bin, args, onLine, start) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const timer = setTimeout(() => finish(new Error("model runner deadline exceeded")), 110_000);
    let finished = false;
    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(value);
    }
    child.on("error", finish);
    child.on("close", code => finish(new Error(`model process exited with code ${code}`)));
    child.stdin.on("error", finish);
    createInterface({ input: child.stdout }).on("line", line => {
      if (finished) return;
      try { onLine(JSON.parse(line), finish); }
      catch (error) { finish(error); }
    });
    start(child.stdin);
  });
}

function codex(cwd, env, prompt) {
  const args = ["app-server", "-c", "mcp_servers={}", "-c", "web_search=\"disabled\"", "-c", "project_doc_max_bytes=0",
    "-c", "features.shell_tool=false", "-c", "features.unified_exec=false"];
  const bin = env.BENCH_CODEX_EXE || env.CODEX_APP_RUNTIME_CLI_PATH || "codex";
  let send, threadId, modelSeen, usage, answer;
  const sendRequest = (id, method, params) => send(JSON.stringify({ id, method, params }) + "\n");
  return runProcess(cwd, env, bin, args, (event, finish) => {
    const params = event.params;
    if (event.method && event.id !== undefined) return finish(new Error(`unexpected server request ${event.method}`));
    if (event.error) return finish(new Error(event.error.message));
    if (event.id === 1) {
      send(JSON.stringify({ method: "initialized" }) + "\n");
      sendRequest(2, "thread/start", { model, modelProvider: "openai", cwd, ephemeral: true, sandbox: "read-only",
        approvalPolicy: "never", baseInstructions: instruction });
    }
    if (event.id === 2) {
      modelSeen = event.result.model;
      if (!sameModel(modelSeen, model)) return finish(new Error(`model mismatch: ${String(modelSeen)}`));
      threadId = event.result.thread.id;
      sendRequest(3, "turn/start", { threadId, effort: "low", serviceTierForTurn: "default",
        input: [{ type: "text", text: prompt, textElements: [] }] });
    }
    if (params?.threadId !== threadId) return;
    if (event.method === "model/rerouted") return finish(new Error("model was rerouted"));
    if (event.method === "thread/tokenUsage/updated") usage = params.tokenUsage.last;
    if (event.method === "item/started" || event.method === "item/completed") {
      if (toolItems.has(params.item.type)) return finish(new Error(`tool invoked: ${params.item.type}`));
      if (event.method === "item/completed" && params.item.type === "agentMessage") answer = params.item.text;
    }
    if (event.method === "turn/completed") {
      if (params.turn.status !== "completed") return finish(new Error(params.turn.error?.message ?? params.turn.status));
      finish(null, { answer, usage, modelSeen });
    }
  }, stdin => {
    send = line => stdin.write(line);
    sendRequest(1, "initialize", { clientInfo: { name: "oddbout_bench", title: "ODDBOUT Bench", version: "1.0.0" } });
  });
}

function claude(cwd, env, prompt) {
  const args = ["--print", "--safe-mode", "--strict-mcp-config", "--tools", "", "--no-session-persistence",
    "--effort", "low", "--model", model, "--output-format", "stream-json", "--verbose"];
  const bin = env.BENCH_CLAUDE_EXE || "claude";
  let modelSeen;
  return runProcess(cwd, env, bin, args, (event, finish) => {
    if (event.type === "system" && event.subtype === "init") {
      if (event.tools?.length) return finish(new Error("Claude exposed tools"));
      modelSeen = event.model;
      if (!sameModel(modelSeen, model)) return finish(new Error(`model mismatch: ${String(modelSeen)}`));
    }
    if (event.type === "assistant") {
      const message = event.message;
      if (message.content?.some(part => part.type === "tool_use")) return finish(new Error("tool invoked"));
      if (message.model && message.model !== "<synthetic>" && !sameModel(message.model, model)) {
        return finish(new Error(`model mismatch: ${message.model}`));
      }
    }
    if (event.type === "result") {
      if (event.is_error) return finish(new Error(event.result ?? event.api_error ?? event.subtype));
      if (!modelSeen) return finish(new Error("missing model identity"));
      finish(null, { answer: event.result, usage: event.usage, reportedCostUsd: event.total_cost_usd, modelSeen });
    }
  }, stdin => stdin.end(prompt));
}

let rules;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type === "reset") rules = message.rules;
  else if (message.type === "obs") {
    const invoke = { codex, claude }[provider];
    if (!invoke || !model || !rules) throw new Error("usage: bounce-model-agent.mjs codex|claude <exact-model-id>");
    const cwd = mkdtempSync(path.join(tmpdir(), "oddbout-bounce-"));
    const env = { ...process.env };
    for (const name of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CODEX_THREAD_ID", "CODEX_SESSION_ID"]) delete env[name];
    try {
      const prompt = [instruction, taskInstruction[message.obs.task], JSON.stringify(rules), JSON.stringify(message.obs)].join("\n\n");
      const { answer, ...meta } = await invoke(cwd, env, prompt);
      emit({ type: "meta", provider, requestedModel: model, effort: "low", ...meta });
      let action = null;
      try { action = JSON.parse(String(answer).trim()); } catch { /* format failure */ }
      emit({ step: message.step, action });
    } catch (error) {
      const failure = error.message.replaceAll("\n", " ").slice(0, 500);
      emit({ type: "meta", provider, requestedModel: model, effort: "low", failure });
      console.error(`${model}: ${failure}`);
      process.exitCode = 1;
      break;
    } finally {
      try { rmdirSync(cwd); } catch { /* nullable CLI scratch directory */ }
    }
  } else if (message.type === "end") break;
}
