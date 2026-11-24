import { COLS, ROWS, STEPS_PER_SECOND, TUNE } from "../bounce/constants";
import { type Cell, parseRoom } from "../bounce/level";
import { type Axis, type BounceRun, cloneRun, createRun, stepRun } from "../bounce/run";

export const BOUNCE_GAME = "bounce-ball";
export const BOUNCE_ACTION_MODE = "one-edit";
export const BOUNCE_CASE_FORMAT = "oddbout-bounce-scenarios/1";
export const BOUNCE_STARTS = [0, 4, 8, 12, 16, 20, 24, 28] as const;
export const BOUNCE_LENGTHS = [4, 8, 16] as const;
export const BOUNCE_AXES = [-1, 0, 1] as const;
export const BOUNCE_MECHANICS = ["wall", "arrow", "crumble", "door"] as const;
export const BOUNCE_CONTACTS = ["land:0", "land:3", "land:6", "land:9", "land:12", "land:15", "death", "none"] as const;

export type BounceMechanic = typeof BOUNCE_MECHANICS[number];
type Contact = typeof BOUNCE_CONTACTS[number];
export interface BounceEdit { readonly start: number; readonly ticks: number; readonly axis: Axis }
export interface BounceRepairCase {
  readonly id: string;
  readonly pair: string;
  readonly mechanic: BounceMechanic;
  readonly rows: readonly string[];
  readonly prefix: readonly (readonly [axis: Axis, ticks: number])[];
  readonly target: Cell;
  readonly originalAxis: Axis;
  readonly horizonTicks: number;
  readonly probes: readonly [BounceEdit, BounceEdit];
}

export const bounceRepairRules = {
  summary: "Bounce Ball, one edit before a fatal input. The ball bounces automatically; steer left (-1), release (0), or steer right (1).",
  objective: "Use repair to replace one contiguous interval of the original input. The engine replays both from the observed state. Success means landing on the specified target tile without dying before or on that tick. Nothing else in the original input changes. Repairs start at tick 0 or later; tick 0 is the first input after the observation.",
  actionSchema: { repair: { start: BOUNCE_STARTS, ticks: BOUNCE_LENGTHS, axis: BOUNCE_AXES }, predict: BOUNCE_CONTACTS },
  prediction: "Independently predict the first downward landing, death, or no event for each of the two listed probes, in order. A landing on an arrow counts; side and ceiling collisions do not. Return land: followed by the lower column of the landing tile's three-column band (0, 3, 6, 9, 12, 15), death if death comes first, or none if neither happens before the horizon.",
  observation: "Coordinates are tile units (+x right, +y down), velocities tiles/second. Map rows start at row 0. The player position is the ball center. Broken cells cannot be landed on. kickWindow is the number of ticks remaining to press kickDir; kickLock is the wall side already kicked (-1 left, 1 right, 0 neither). doorLock is the locked door index in row order (-1 neither).",
  tiles: ". empty, # ground, 2 jump pad, s spring, x breakable, < > arrow pads, ! mine, ^ [ ] spikes, T paired doors, G flag, P original spawn",
  physics: {
    ticksPerSecond: STEPS_PER_SECOND, ...TUNE,
    update: "Apply axis to vx, then gravity to vy, then move and collide horizontally, then vertically. Holding against vx brakes; releasing drags. A wall away press inside kickWindow sets vx away and raises vy to at least the upward kick speed. A downward landing sets vy upward; arrows set horizontal dash and zero vertical motion. Opposite axis cancels a dash before motion that tick. Walls also cancel a dash. A door sends the ball to the other cell center with velocity intact. Its doorway is inset by 0.1 tile and the exit stays locked until the ball leaves it. The room is closed on left/right/top and open below.",
  },
} as const;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const axis = (value: unknown): value is Axis => value === -1 || value === 0 || value === 1;
const oneOf = <T>(values: readonly T[], value: unknown): value is T => values.some(item => item === value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const name = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value);

export function isBounceEdit(edit: unknown, originalAxis: Axis, horizon = Number.POSITIVE_INFINITY): edit is BounceEdit {
  return object(edit) && Object.keys(edit).length === 3 && oneOf(BOUNCE_STARTS, edit.start)
    && oneOf(BOUNCE_LENGTHS, edit.ticks) && axis(edit.axis) && edit.axis !== originalAxis
    && edit.start + edit.ticks <= horizon;
}

export function bounceEdits(originalAxis: Axis): BounceEdit[] {
  return BOUNCE_AXES.filter(axis => axis !== originalAxis).flatMap(axis =>
    BOUNCE_STARTS.flatMap(start => BOUNCE_LENGTHS.map(ticks => ({ start, ticks, axis }))));
}

export function readBounceCase(raw: unknown): BounceRepairCase {
  if (!object(raw) || !name(raw.id) || !name(raw.pair) || !oneOf(BOUNCE_MECHANICS, raw.mechanic)
    || !Array.isArray(raw.rows) || !raw.rows.every(row => typeof row === "string") || !axis(raw.originalAxis)
    || !integer(raw.horizonTicks, 44, 360) || !object(raw.target)
    || !integer(raw.target.x, 0, COLS - 1) || !integer(raw.target.y, 0, ROWS - 1)
    || !Array.isArray(raw.prefix) || raw.prefix.length > 128
    || !raw.prefix.every(segment => Array.isArray(segment) && segment.length === 2 && axis(segment[0]) && integer(segment[1], 1, 360))
    || !Array.isArray(raw.probes) || raw.probes.length !== 2) throw new Error("invalid Bounce Ball case");
  const originalAxis = raw.originalAxis, horizon = raw.horizonTicks;
  if (!raw.probes.every(probe => isBounceEdit(probe, originalAxis, horizon))) throw new Error(`${raw.id}: invalid probes`);
  if (raw.rows[raw.target.y]?.[raw.target.x] !== "#") throw new Error(`${raw.id}: target must be a ground tile`);
  return raw as unknown as BounceRepairCase;
}

export function bounceCaseStart(item: BounceRepairCase): BounceRun {
  const run = createRun(parseRoom(item.rows));
  for (const [axis, ticks] of item.prefix) {
    for (let tick = 0; tick < ticks; tick++) {
      stepRun(run, axis);
      if (run.status !== "playing") throw new Error(`${item.id}: prefix reached a terminal state`);
    }
  }
  return run;
}

/** Counterfactuals always replay the same state and original inputs outside the edit. */
export function replayBounceEdit(
  run: BounceRun, item: Pick<BounceRepairCase, "originalAxis" | "target" | "horizonTicks">, edit: BounceEdit | null,
) {
  const branch = cloneRun(run);
  let contact: Contact = "none";
  let reachedTarget = false;
  let ticks = 0;
  while (ticks < item.horizonTicks && branch.status === "playing") {
    const input = edit && ticks >= edit.start && ticks < edit.start + edit.ticks ? edit.axis : item.originalAxis;
    const events = stepRun(branch, input);
    ticks++;
    const land = events.find(event => event.type === "bounce" || event.type === "dash");
    if (contact === "none") {
      if (land) contact = `land:${Math.floor(land.cell.x / 3) * 3}` as Contact;
      else if (branch.cause) contact = "death";
    }
    if (branch.cause) break;
    if (land?.type === "bounce" && land.cell.x === item.target.x && land.cell.y === item.target.y) {
      reachedTarget = true;
      break;
    }
  }
  return { reachedTarget, contact, ticks, cause: branch.cause, status: branch.status };
}

export function prepareBounceCase(item: BounceRepairCase) {
  const run = bounceCaseStart(item);
  const original = replayBounceEdit(run, item, null);
  if (original.status !== "dead") throw new Error(`${item.id}: original input must be fatal before reaching the target`);
  const probeAnswers = item.probes.map(edit => replayBounceEdit(run, item, edit).contact);
  if (probeAnswers[0] === probeAnswers[1]) throw new Error(`${item.id}: probes must have different landing outcomes`);
  const { x, y, vx, vy, broken, dash, kickWindow, kickDir, kickLock, doorLock } = run;
  const obs = {
    rows: item.rows, target: item.target,
    ball: { x, y, vx, vy }, dash, kickWindow, kickDir, kickLock, doorLock,
    broken: broken.map(index => ({ x: index % COLS, y: Math.floor(index / COLS) })),
    originalAxis: item.originalAxis, originalDeath: { cause: original.cause, afterTicks: original.ticks },
    horizonTicks: item.horizonTicks, probes: item.probes,
  };
  return { item, run, obs, probeAnswers };
}

export function scoreBounceReply(entry: ReturnType<typeof prepareBounceCase>, action: unknown) {
  const reply = object(action) ? action : {};
  const repairValid = isBounceEdit(reply.repair, entry.item.originalAxis, entry.item.horizonTicks);
  const edit = repairValid ? reply.repair as BounceEdit : null;
  const predictionValid = Array.isArray(reply.predict) && reply.predict.length === 2
    && reply.predict.every(value => oneOf(BOUNCE_CONTACTS, value));
  const predicted = predictionValid ? reply.predict as readonly Contact[] : [];
  return {
    repairValid, predictionValid,
    predictionCorrect: predicted.filter((contact, index) => contact === entry.probeAnswers[index]).length,
    ...replayBounceEdit(entry.run, entry.item, edit),
  };
}
