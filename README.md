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
node tools/bench/bench.mjs baselines --seeds 1-40          # reference scores
node tools/bench/bench.mjs run --agent "node tools/bench/examples/heuristic-agent.mjs" --seeds 1-10 --out bench-out/heuristic
node tools/bench/bench.mjs verify bench-out/heuristic/summary.json
```

Your agent is any program that reads JSON lines on stdin and writes JSON lines on stdout. Any language works.
See [`tools/bench/examples/`](tools/bench/examples): a rule agent (`heuristic-agent.mjs`), a Python agent (`agent.py`), and an LLM agent (`claude-agent.mjs`, Anthropic Messages API, needs `ANTHROPIC_API_KEY`).

## How it works

- **Turn-based.** The game does not advance while your agent thinks. Model latency does not change the score.
- **Fixed conditions.** Default character, no items, no tutorial, no continues. A run ends when the spoon catches the jelly, or at 300 s of game time.
- **Score** = distance in metres. Summaries report the median over seeds with a bootstrap 95% interval.
- **Deterministic.** The same seed and the same actions always give the same result. Terrain depends only on the seed, not on your actions.
- **Versioned.** `envVersion` is a hash of the rule and environment sources. A trace from a different version is rejected.

### Protocol

Environment → agent, one JSON object per line:

```json
{"type":"reset","game":"pudding-escape","seed":1,"track":"state","actionMode":"segment","envVersion":"…","rules":{"summary":"…","actionSchema":"…","observation":"…"}}
{"type":"obs","step":0,"obs":{ … }}
{"type":"done","result":{"seed":1,"score":742, … }}
{"type":"end"}
```

Agent → environment: `{"step": <same step>, "action": <action>}` for every `obs`.

### Action modes

| Mode | Decisions per run | Action |
| --- | --- | --- |
| `segment` (default) | about 35–75 | On the ground: `{"waitMs":0..3000,"holdMs":0..1500}` — wait, hold to charge, release to jump. After liftoff: `{"pressAfterMs":0..3000 or null}` — dive after that delay and hold through the landing, or never press this flight. |
| `interval:K` | about 250–300 for K=8 | `{"hold":true|false}` for K steps of 1/120 s (K = 1..60). |

Malformed actions, timeouts, and crashes are recorded as invalid actions; they keep the current button state for a short time. The `rules` text in `reset` has the full schema.

### Observation (state track)

Time, distance, position and velocity, ground speed, grounded/holding, charge, spoon gap and speed, transform stage, combo, a terrain profile for the next 100 m (height and slope every 2 m), upcoming terrain features (caramel, cream, stars), and a summary of what happened during your last action. Units are metres, m/s, and seconds; up is positive.

## Reference scores

Seeds 1–40, envVersion printed by `node tools/bench/bench.mjs version` (measured 2026-11-21).

| Mode | Agent | Median m | 95% CI |
| --- | --- | --- | --- |
| segment | `random` | 427 | 358–564 |
| segment | `fullCharge` (always charge fully, never dive) | 756.5 | 607–856.5 |
| segment | `oracle` (searches with the internal rules; a ceiling, not a competitor) | 26,983.5 | 26,805.5–27,118 |
| interval:8 | `random` | 595 | 520.5–663.5 |
| interval:8 | `fullCharge` | 664.5 | 524–708.5 |

The `oracle` clones the game state and simulates candidate actions. With 88% PERFECT landings the jelly outruns the spoon, so most oracle runs reach the 300 s cap.
Realistic agents and humans play in the range from `random` up to a few kilometres.

## Seeds

Seeds 1–10 are public practice seeds. Official evaluation uses private seeds that are not in this repository, so results cannot be tuned to them.
`run` accepts `--seeds-file <path>` for a private list.

## Status

- Done: state track, segment and interval modes, replay verification, baselines, example agents.
- Not yet: vision track (agents see the game screen), human baseline page, public leaderboard, more games.

## License

MIT. Game art and the game websites are not part of this repository.
