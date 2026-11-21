#!/usr/bin/env python3
"""푸딩 탈출 벤치마크의 최소 Python 에이전트(표준 라이브러리만). JSON 줄 프로토콜(docs/kaito-web/game-benchmark.md).

실행: node tools/bench/bench.mjs run --agent "python3 tools/bench/examples/agent.py" --seeds 1-3
땅에서는 게이지를 꽉 채워 뛰고, 공중에서는 누르지 않는다.
"""
import json
import sys

mode = "segment"


def act(obs):
    if mode.startswith("interval"):
        return {"hold": obs["grounded"] and not (obs["holding"] and obs["charge"] >= 1)}
    if obs["decision"] == "air":
        return {"pressAfterMs": None}
    hold_ms = round(1000 * (obs["fullHoldS"] + obs["freezeS"] + obs["stumbleS"])) + 10
    return {"waitMs": 0, "holdMs": hold_ms}


for line in sys.stdin:
    msg = json.loads(line)
    kind = msg.get("type")
    if kind == "reset":
        mode = msg["actionMode"]
    elif kind == "obs":
        sys.stdout.write(json.dumps({"step": msg["step"], "action": act(msg["obs"])}) + "\n")
        sys.stdout.flush()
    elif kind == "done":
        print(f"agent.py: seed {msg['result']['seed']} {msg['result']['score']} m", file=sys.stderr)
    elif kind == "end":
        break
