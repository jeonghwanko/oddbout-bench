# Pudding Escape benchmark results

These public runs measure how far an agent can move a one-button jelly while a spoon closes in. Agents receive the physics rules and a numerical observation. They choose how long to wait and hold before a jump, or when to dive in the air. The simulator advances when the action arrives.

## Full-run demonstration on public seed 1

Each model played one episode of the state track in segment mode. The Codex and Claude Code runs used their subscription clients, low reasoning effort, a fresh conversation per episode, and no tool actions. Conversation history remained available within each episode. The score uses the random and oracle bots on the same seed as its 0 and 100 references.

| Model | Score | Distance | PERFECT landings | Decisions | Invalid actions | Replay |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| GPT-6.2 Astra | 86.113 | 3,226 m | 52.9% | 88 | 0 | [Summary](full-run/gpt-6.2-astra/summary.json) |
| Claude Fable 5.2 | 75.490 | 2,445 m | 45.5% | 68 | 0 | [Summary](full-run/claude-fable-5-2/summary.json) |
| Claude Opus 5.5 | 67.810 | 2,001 m | 18.2% | 71 | 0 | [Summary](full-run/claude-opus-5-5/summary.json) |
| Grok (web Expert) | 41.382 | 1,004 m | 14.3% | 30 | 0 | [Summary](full-run/grok-expert/summary.json) |
| GPT-6.2 Sol | 22.537 | 614 m | 25.0% | 20 | 1 | [Summary](full-run/gpt-6.2-sol/summary.json) |

One public seed provides a replayable example. A comparison across multiple held-out seeds is needed to estimate how consistently the models differ. The historical runs did not record token usage. Grok played through the web client with Expert selected and the same public seed and decision protocol. The interface did not expose an exact model ID or a token count.

### Replay the archived runs

The historical results use environment version 52f6ef79b672. Use the corresponding source checkout and open the summary from a working copy that contains this results bundle.

```sh
git worktree add --detach ../oddbout-bench-52f6 2009b9e
node ../oddbout-bench-52f6/tools/bench/bench.mjs verify \
  results/2026-11-22-public/full-run/claude-opus-5-5/summary.json
```

Replace the model directory to replay another row. The summary points to the action trace stored beside it.

## Paired decisions from 48 identical states

Astra and Opus each chose one action from the same 48 public states. After that choice the full-charge bot took control. Each case ended upon capture or after exactly three seconds of game time. We report the mean progress from the case's starting state and count failures separately.

| Situation | Cases | Astra | Opus | Astra minus Opus |
| --- | ---: | ---: | ---: | ---: |
| Ground timing | 12 | 156.353 m | 155.967 m | +0.386 m |
| Airborne timing | 12 | 136.990 m | 126.141 m | +10.850 m |
| SPLAT recovery | 12 | 45.665 m | 46.891 m | −1.226 m |
| Close pursuit | 12 | 54.619 m | 41.276 m | +13.343 m |
| **All cases** | **48** | **98.407 m** | **92.568 m** | **+5.838 m** |

The overall paired 95% bootstrap interval was **−0.222 m to +12.723 m**. Astra survived 35 cases, Opus 33, and the heuristic baseline 34. The heuristic averaged 98.842 m. Astra recorded two timeouts and Opus one invalid action. Each defaults to the simulator's no-op.

In airborne case 11, Astra dived immediately and landed GOOD, gaining 133.373 m. Opus kept gliding and landed SPLAT, gaining 65.812 m. In the first ground case, Opus waited 400 ms before charging and progressed 27.465 m farther than Astra.

Reported token usage was equivalent to **$4.86 for Astra across 46 metered cases** and **$1.97 for Opus across 48 metered cases** at API list rates. The models ran through subscriptions. The estimates include each client's prompt and cache behavior. [OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

[Per-case actions, outcomes, and cost totals](scenarios/comparison.json)

```sh
npm run scenarios -- verify --cases results/2026-11-22-public/scenarios/cases.json \
  results/2026-11-22-public/scenarios/gpt-6.2-astra.json \
  results/2026-11-22-public/scenarios/claude-opus-5-5.json \
  results/2026-11-22-public/scenarios/heuristic.json

npm run scenarios -- compare --cases results/2026-11-22-public/scenarios/cases.json \
  results/2026-11-22-public/scenarios/gpt-6.2-astra.json \
  results/2026-11-22-public/scenarios/claude-opus-5-5.json
```

The case files use environment version 24d7a48ffc6c. [Benchmark protocol](../../docs/kaito-web/game-benchmark.md) · [English development log](https://oddbout.itch.io/pudding-escape-super-jelly/devlog/1796560/same-hill-different-dive-testing-ai-in-pudding-escape)
