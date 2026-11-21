import { spawn } from "node:child_process";
import { redactAgentPayload } from "./redact.mjs";

/** 에이전트가 보낸 자가 보고(`meta`)를 요약에 남기는 크기 상한(JSON 바이트). */
const AGENT_META_MAX = 4096;
const AGENT_LINE_MAX = 64 * 1024;
/**
 * 에이전트 프로세스와 JSON 줄로 말한다. 줄마다 하나의 JSON 객체다.
 * `{"type":"meta", …}` 줄은 행동이 아니라 자가 보고다. 아무 때나 와도 되고 `meta` 에 겹쳐 쌓는다(뒤 값이 이긴다).
 */
export class AgentProcess {
  constructor(command, argv) {
    const options = { stdio: ["pipe", "pipe", "inherit"], cwd: process.cwd() };
    this.child = argv.length ? spawn(argv[0], argv.slice(1), options) : spawn(command, { ...options, shell: true });
    this.pending = null; this.closed = false; this.transportFailed = false;
    this.meta = {}; this.metaTruncated = false;
    let line = "";
    this.child.stdout.setEncoding("utf8").on("data", chunk => {
      const parts = chunk.split("\n");
      for (const [index, part] of parts.entries()) {
        if (line !== null) line = line.length + part.length <= AGENT_LINE_MAX ? line + part : null;
        if (index === parts.length - 1) break;
        this.takeLine(line);
        line = "";
      }
    });
    this.child.stdout.on("end", () => { this.takeLine(line); this.failTransport(); });
    this.child.on("close", () => {
      this.closed = true;
      this.failTransport();
    });
    this.child.on("error", error => console.error(`agent process: ${error.code ?? error.name}`));
    this.child.stdin.on("error", () => this.failTransport());
  }
  failTransport() {
    this.transportFailed = true;
    this.pending?.finish({ action: null, timeout: false, exited: true });
  }
  takeLine(line) {
    if (!line || Buffer.byteLength(line) > AGENT_LINE_MAX) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    if (msg.type === "meta") {
      const { type: _type, ...fields } = msg;
      try {
        const next = JSON.stringify({ ...this.meta, ...fields });
        if (Buffer.byteLength(next) <= AGENT_META_MAX) {
          this.meta = redactAgentPayload(JSON.parse(next));
          return;
        }
      } catch { /* 직렬화할 수 없는 갱신도 버린다. */ }
      this.metaTruncated = true;
    } else if (this.pending && msg.step === this.pending.step && performance.now() < this.pending.deadline) {
      this.pending.finish({ action: redactAgentPayload(msg.action ?? null), timeout: false, exited: false });
    }
  }
  send(msg) {
    if (this.closed || this.transportFailed) return;
    if (!this.child.stdin.writable || this.child.stdin.writableNeedDrain) {
      this.failTransport();
      this.child.kill();
      this.child.stdin.destroy();
      return;
    }
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }
  /** 지금 보낸 관찰에 대한 답만 받는다. */
  readAction(step, obs, timeoutMs) {
    if (this.closed || this.transportFailed) return Promise.resolve({ action: null, timeout: false, exited: true });
    return new Promise(resolve => {
      const finish = result => { clearTimeout(timer); this.pending = null; resolve(result); };
      const timer = setTimeout(() => finish({ action: null, timeout: true, exited: false }), timeoutMs);
      this.pending = { step, deadline: performance.now() + timeoutMs, finish };
      this.send({ type: "obs", step, obs });
    });
  }
  async stop() {
    this.send({ type: "end" });
    if (this.child.stdin.writable) this.child.stdin.end();
    if (this.closed) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        this.child.stdout.destroy();
        this.child.stdin.destroy();
        resolve();
      }, 2000);
      this.child.once("close", () => { clearTimeout(timer); resolve(); });
    });
  }
}
