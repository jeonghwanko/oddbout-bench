# oddbout-bench

Benchmark AI agents on [ODDBOUT](https://oddbout.com) web games.
Every score is reproducible: an agent's run is stored as a list of actions, and anyone can replay it with the same rules to get the same score.

The first environment is **Pudding Escape** ([play it](https://pudding.oddbout.com)): a one-button physics runner.
A jelly slides over endless pudding hills while a spoon chases it. Hold to charge, release to jump, and land at the angle of the slope.
It tests physical prediction and timing — when to press, and when to let go.

No dependencies. Node 22.18 or newer runs the TypeScript rules directly.

## Quick start

```bash
git clone https://github.com/jeonghwanko/oddbout-bench.git
cd oddbout-bench
node tools/bench/bench.mjs baselines                       # reference scores (seeds 1-50)
node tools/bench/bench.mjs run --agent "node tools/bench/examples/heuristic-agent.mjs" --seeds 1-10 --out bench-out/heuristic
node tools/bench/bench.mjs verify bench-out/heuristic/summary.json
node tools/bench/bench.mjs compare bench-out/a/summary.json bench-out/b/summary.json   # paired comparison on the same seeds
```

Your agent is any program that reads JSON lines on stdin and writes JSON lines on stdout. Any language works.
See [`tools/bench/examples/`](tools/bench/examples): a rule agent (`heuristic-agent.mjs`), a Python agent (`agent.py`), and an LLM agent (`claude-agent.mjs`, Anthropic Messages API, needs `ANTHROPIC_API_KEY`; pass `--no-fallbacks` for an official run so every answer comes from the named model).

## How it works

- **Turn-based.** The game does not advance while your agent thinks. Model latency does not change the score.
- **Fixed conditions.** Default character, no items, no tutorial, no continues. A run ends when the spoon catches the jelly, or at 90 s of game time (an *escape*; the spoon keeps speeding up after about 25.6 s, so escapes are rare).
- **Score.** Each run gets a log-normalised score: `100 × (ln d − ln d_random) / (ln d_oracle − ln d_random)`, where `d` is the run's distance and `d_random`, `d_oracle` are the distances of the `random` and `oracle` reference bots (segment mode) on the same seed. The reference bots are deterministic, so the environment computes them itself. Scores are not clipped: below random is negative, beyond oracle is above 100. Seeds where the oracle does not beat random are left out and listed.
- **Headline** = mean normalised score over seeds with a bootstrap 95% interval. Summaries also report the escape rate, PERFECT %, invalid-action rate and median distance (for reference). `interval` runs are normalised against the same segment references.
- **Deterministic.** The same seed and the same actions always give the same result. Terrain shape and features depend only on the seed. Star coin positions also depend on the transform stage when that stretch of terrain is generated.
- **Versioned.** `envVersion` is a hash of the environment sources: the files reachable by relative imports from `src/sim/bench/index.ts` (line endings normalised). A trace from a different version is rejected.
- **Official ranking** uses `segment` mode. `interval` mode is for reference.
- **Verified.** `verify` replays every trace in a summary, reruns the reference bots and recomputes every score and statistic. Repeated traces or seeds, missing scores and paths outside the summary folder fail.

### Protocol

Environment → agent, one JSON object per line:

```json
{"type":"reset","game":"pudding-escape","episode":0,"track":"state","actionMode":"segment","envVersion":"…","rules":{"summary":"…","actionSchema":"…","observation":"…","physics":["…"]}}
{"type":"obs","step":0,"obs":{ … }}
{"type":"done","episode":0,"result":{"score":742, … }}
{"type":"end"}
```

Agent → environment: `{"step": <same step>, "action": <action>}` for every `obs`. `step` is required: lines without the current `step`, and lines that are not JSON, are ignored until the deadline (default 300 s per decision, `--timeout`).

- The agent is never told the seed (only the episode number). Traces and the summary record it.
- `rules.physics` lists the physical constants and formulas (gravity, drag, charge time, landing angles, launch, speed cap, spoon speed, units), generated from the rule code.
- An agent may send `{"type":"meta", …}` at any time (for example model name and token counts). It is stored as `agentMeta` in the summary (up to 4 KB). It is **self-reported** and not verified.
- If the agent process exits, the remaining decisions are invalid, the summary records `agentExited`, and `run` exits with code 1.

### Action modes

| Mode | Decisions per run | Action |
| --- | --- | --- |
| `segment` (default) | about 30–80 | On the ground: `{"waitMs":0..3000,"holdMs":0..1500}` — wait, hold to charge, release to jump. In the air: `{"pressAfterMs":0..3000 or null}` — dive that long after this decision (normally the liftoff) and hold through the landing, or do not press during this action. |
| `interval:K` | about 250–300 for K=8 | `{"hold":true|false}` for K steps of 1/120 s (K = 1..60). |

Malformed actions, timeouts, and crashes are recorded as invalid actions; they keep the current button state for a short time. The `rules` text in `reset` has the full schema.

### Observation (state track)

Time, distance, position and velocity, ground speed, grounded/holding, charge, spoon gap and speed, transform stage, combo, a terrain profile for the next 100 m (height and slope every 2 m), upcoming terrain features (caramel, cream, stars), and a summary of what happened during your last action. Units are metres, m/s, and seconds; up is positive.

## Reference scores

Seeds 1–50, 90 s cap, envVersion `b3b71f1fca0f` (measured 2026-11-21).

| Mode | Agent | Score | 95% CI | Escape % | PERFECT % | Median m |
| --- | --- | --- | --- | --- | --- | --- |
| segment | `random` (reference, 0 by definition) | 0 | 0–0 | 0 | 2.6 | 435.5 |
| segment | `fullCharge` (always charge fully, never dive) | 15.3 | 9.1–21.4 | 0 | 7.2 | 666.5 |
| segment | `heuristic-agent.mjs` (example; observations and `rules.physics` only) | 49.5 | 46.8–52.1 | 0 | 15.8 | 1,374 |
| segment | `oracle` (reference, 100 by definition; searches with the internal rules) | 100 | 100–100 | 0 | 84.6 | 4,684 |
| interval:8 | `random` | 11.1 | 6.2–16.2 | 0 | 5.0 | 597 |
| interval:8 | `fullCharge` | 10.6 | 4.6–16.4 | 0 | 7.2 | 568.5 |

The `oracle` clones the game state and simulates candidate actions. The spoon reaches 48 m/s about 25.6 s into a run and then keeps speeding up by 1.6 m/s every second, so even the oracle (85% PERFECT landings) is caught: 0 of 50 oracle runs escape, caught after 61 s (median; 55–68 s for the middle 80%).
An agent that survives longer than the oracle scores above 100.

## Seeds

Seeds 1–10 are public practice seeds. Official evaluation uses private seeds that are not in this repository, so results cannot be tuned to them.
Seeds are integers 0..2^32−1. An official evaluation uses at least 50 seeds and runs in rounds:

1. The evaluator publishes `node tools/bench/bench.mjs seeds-commit <seeds-file> --round <name>` (a sha256 of the sorted seeds and the round name).
2. Runs use `run --seeds-file <seeds-file> --round <name> --official`. The summary records `seedsCommit`. `--official` refuses fewer than 50 seeds.
3. After the round the seeds file is published, and anyone can check a summary with `verify <summary.json> --seeds-file <seeds-file> --official` (same seed set, same hash).

## Status

- Done: state track, segment and interval modes, replay verification, baselines, example agents.
- Not yet: vision track (agents see the game screen), human baseline page, public leaderboard, more games.

## License

MIT. Game art and the game websites are not part of this repository.
