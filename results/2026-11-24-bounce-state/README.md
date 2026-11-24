# Bounce Ball State pilot results

On November 24, 2026, GPT-6.2 Astra and GPT-6.2 Sol each completed 16 scenes across eight rooms. Each scene asks for one edit to an input that would kill the ball. In a separate fresh session, the model predicts the first contact for two fixed input edits. Each call uses low reasoning effort and the same State observation. The repair prompt omits the prediction probes.

| Model | Repair score | Recovered scenes | Both scenes recovered | Contact predictions |
| --- | ---: | ---: | ---: | ---: |
| GPT-6.2 Astra | 81.25 | 13/16 | 6/8 | 28/32 |
| GPT-6.2 Sol | 68.75 | 11/16 | 5/8 | 24/32 |
| Claude Opus 5.5 | Unmeasured | | | |

The repair score is the percentage of scenes recovered. Both models completed all 32 calls with zero malformed responses and zero timeouts. Usage is recorded in the replay results and summarized in [the comparison](comparison.json). Opus 5.5 was unavailable because the provider returned a weekly usage limit.

Both repair differences came from the door scenes. Astra recovered three of four and Sol one of four. The room-paired repair difference was +12.5 percentage points for Astra, with a 95% room-paired bootstrap interval of 0 to 31.25 points. The pilot uses eight authored rooms.

Keeping the original input recovered 0%. The expected recovery rate for a uniformly random legal edit was 10.29%. The rule baseline recovered 37.50%, and the eight-candidate search recovered 75.00%. Exhaustive search recovered all scenes as part of case validation.

## Replay

The [case set](../../tools/bench/fixtures/bounce-state-pilot.json) and environment version `9b0a13a8aa67` are recorded in both result files. Replay verification computes the scores from the saved inputs.

```bash
npm run bounce -- verify results/2026-11-24-bounce-state/gpt-6.2-astra.json results/2026-11-24-bounce-state/gpt-6.2-sol.json
npm run bounce -- compare results/2026-11-24-bounce-state/gpt-6.2-astra.json results/2026-11-24-bounce-state/gpt-6.2-sol.json
```
