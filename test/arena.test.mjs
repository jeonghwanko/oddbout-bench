import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { buildArena } from "../tools/arena/build.mjs";

const output = mkdtempSync(join(tmpdir(), "oddbout-arena-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
buildArena(output);

const { createDeck, framesPerSecond, restore, samples, simulate, winner } =
  await import(pathToFileURL(join(output, "arena-core.js")));

test("the arena build has the browser entry point and latest artwork", () => {
  const page = readFileSync(join(output, "index.html"), "utf8");
  assert.match(page, /src="\.\/arena\.js"/);
  for (const name of ["custard-horizon.webp", "gummy-bear.webp"]) {
    assert.equal(readFileSync(join(output, "art", name)).toString("ascii", 8, 12), "WEBP");
  }
});

test("all nine public replay pairs match their archived outcomes from identical starting states", () => {
  assert.equal(samples.size, 9);
  for (const sample of samples.values()) {
    const start = restore(sample);
    const initialX = start.env.internalRun().wx;
    for (const model of sample.models) {
      const replay = simulate(sample, start, model.action);
      assert.deepEqual(replay.outcome, model.outcome, sample.id);
      assert.equal(replay.frames[0].x, initialX);
      assert.equal(replay.frames.at(-1).caught, !model.outcome.survived);
      assert.ok(replay.frames.length <= framesPerSecond * 3 + 1);
    }
    assert.equal(start.env.internalRun().wx, initialX);
  }
});

test("the same manually selected action matches the model replay", () => {
  const sample = samples.get("air-11");
  const run = simulate(sample, restore(sample), { pressAfterMs: 0 });
  assert.equal(run.outcome.distanceM, 133.373);
  assert.ok(run.marks.some(({ kind, grade }) => kind === "grade" && grade === "good"));
  assert.equal(run.frames.length, 361);
});

test("prediction scoring prioritizes survival and applies the 1 m tie threshold", () => {
  const outcome = (distanceM, survived = true) => ({ distanceM, survived });
  assert.equal(winner(outcome(30), outcome(100, false)), 0);
  assert.equal(winner(outcome(30, false), outcome(31, false)), 1);
  assert.equal(winner(outcome(31.004), outcome(30.005)), null);
  assert.equal(winner(outcome(31.004), outcome(30.004)), 0);
  assert.equal(winner(outcome(30.004), outcome(31.004)), 1);
});

test("each game draws three distinct scenarios from the public replay set", () => {
  for (const deck of [createDeck(true), createDeck(false, () => 0), createDeck(false, () => 0.9)]) {
    assert.equal(new Set(deck).size, 3);
    assert.ok(deck.every(id => samples.has(id)));
  }
});
