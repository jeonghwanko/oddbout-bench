import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BOUNCE_MECHANICS, bounceEdits, prepareBounceCase, readBounceCase, replayBounceEdit, scoreBounceReply,
} from "../src/sim/bench/bounce.ts";

const fixtures = JSON.parse(readFileSync(new URL("../tools/bench/fixtures/bounce-state-pilot.json", import.meta.url), "utf8"));
const entries = fixtures.cases.map(item => prepareBounceCase(readBounceCase({ ...item, ...fixtures.rooms[item.pair] })));

test("pilot audits two distinct, repairable pairs per mechanic", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["tools/bench/bounce-scenarios.mjs", "audit"], { encoding: "utf8" }));
  assert.equal(result.cases, 16);
  assert.equal(new Set(Object.values(fixtures.rooms).map(room => room.rows.join("\n"))).size, 8);
  for (const mechanic of BOUNCE_MECHANICS) {
    assert.equal(result.byPair.filter(pair => pair.mechanic === mechanic).length, 2);
  }
});

test("a repair replays from the same state and predictions have their own score", () => {
  for (const entry of entries) {
    const original = replayBounceEdit(entry.run, entry.item, null);
    assert.equal(original.status, "dead");
    const repair = bounceEdits(entry.item.originalAxis)
      .find(edit => replayBounceEdit(entry.run, entry.item, edit).reachedTarget);
    assert.ok(repair);
    const reply = { repair, predict: entry.probeAnswers };
    assert.deepEqual(scoreBounceReply(entry, reply), scoreBounceReply(entry, reply));
    assert.equal(scoreBounceReply(entry, reply).predictionCorrect, 2);
    assert.equal(scoreBounceReply(entry, { ...reply, predict: ["bogus"] }).reachedTarget, true);
    const bad = scoreBounceReply(entry, { ...reply, repair: { ...repair, start: -1 } });
    assert.equal(bad.repairValid, false);
    assert.equal(bad.reachedTarget, false);
    assert.equal(bad.predictionCorrect, 2);
    assert.deepEqual(replayBounceEdit(entry.run, entry.item, null), original);
  }
});
