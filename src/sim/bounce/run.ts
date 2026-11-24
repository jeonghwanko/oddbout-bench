import { COLS, ROWS, STEP_SECONDS, TUNE } from "./constants";
import { type Cell, type ParsedRoom, type TileKind, isSolidKind, isSpikeKind, tileAt } from "./level";

/**
 * Bounce Ball — one attempt at one room, advanced one fixed step at a time (docs/kaito-web/bounce-ball.md#규칙).
 *
 * The ball bounces by itself. The only input is a steering axis per step: -1 left, 0 none, 1 right.
 * Pure: no clock, no randomness. The same room and the same inputs give the same result.
 */
export type Axis = -1 | 0 | 1;
export type RunStatus = "playing" | "dead" | "clear";
export type DeathCause = "spike" | "bomb" | "fall";

export type BounceEvent =
  | { readonly type: "bounce"; readonly kind: TileKind; readonly cell: Cell }
  | { readonly type: "break"; readonly cell: Cell }
  | { readonly type: "wall"; readonly kicked: boolean; readonly side: -1 | 1 }
  | { readonly type: "dash"; readonly dir: -1 | 1; readonly cell: Cell }
  | { readonly type: "door"; readonly from: Cell; readonly to: Cell }
  | { readonly type: "death"; readonly cause: DeathCause; readonly cell: Cell | null }
  | { readonly type: "clear"; readonly cell: Cell };

export interface BounceRun {
  readonly room: ParsedRoom;
  /** Ball centre and velocity, tiles and tiles per second. */
  x: number; y: number; vx: number; vy: number;
  status: RunStatus;
  steps: number;
  bounces: number;
  /** Broken breakable cells, as `y * COLS + x`, in break order. */
  broken: number[];
  /** Arrow throw direction while the ball flies straight, else 0. */
  dash: Axis;
  /** Steps left in which pressing `kickDir` kicks off the wall just touched. */
  kickWindow: number;
  kickDir: Axis;
  /** The wall side (-1 left, 1 right) of the last kick. That side cannot kick again until the ball lands: climbing takes two walls. */
  kickLock: Axis;
  /** The door the ball came out of; doors work again once it leaves that door. -1 when none. */
  doorLock: number;
  cause: DeathCause | null;
}

const EPS = 1e-6;

export function createRun(room: ParsedRoom): BounceRun {
  return {
    room, x: room.start.x + 0.5, y: room.start.y + 0.5, vx: 0, vy: 0,
    status: "playing", steps: 0, bounces: 0, broken: [], dash: 0, kickWindow: 0, kickDir: 0, kickLock: 0, doorLock: -1, cause: null,
  };
}

export function cloneRun(run: BounceRun): BounceRun {
  return { ...run, broken: [...run.broken] };
}

/** The tile now at a cell: a broken breakable is gone. */
export function kindAt(run: Pick<BounceRun, "room" | "broken">, x: number, y: number): TileKind | null {
  const kind = tileAt(run.room.rows, x, y);
  return kind === "breakable" && run.broken.includes(y * COLS + x) ? null : kind;
}

/** Solid for the ball: solid tiles, and the room's left, right and top edges. The bottom is open. */
function solidAt(run: BounceRun, x: number, y: number): boolean {
  if (x < 0 || x >= COLS || y < 0) return true;
  return isSolidKind(kindAt(run, x, y));
}

/** Cells whose span overlaps [low, high] (strictly). */
function span(low: number, high: number): [number, number] {
  return [Math.floor(low + EPS), Math.ceil(high - EPS) - 1];
}

function overlapsSolid(run: BounceRun, x: number, y: number): Cell[] {
  const r = TUNE.radius, hits: Cell[] = [];
  const [x0, x1] = span(x - r, x + r), [y0, y1] = span(y - r, y + r);
  for (let cy = y0; cy <= y1; cy += 1) {
    if (cy >= ROWS) continue;
    for (let cx = x0; cx <= x1; cx += 1) if (solidAt(run, cx, cy)) hits.push({ x: cx, y: cy });
  }
  return hits;
}

function circleHitsRect(cx: number, cy: number, radius: number, left: number, top: number, right: number, bottom: number): boolean {
  const dx = cx - Math.max(left, Math.min(cx, right)), dy = cy - Math.max(top, Math.min(cy, bottom));
  return dx * dx + dy * dy < radius * radius;
}

/** Whether the ball's hazard circle touches the dangerous part of a hazard cell. */
function hazardHit(kind: TileKind, cell: Cell, x: number, y: number): boolean {
  const rh = TUNE.radius * TUNE.hazardRadiusShare;
  if (kind === "bomb") {
    const dx = x - (cell.x + 0.5), dy = y - (cell.y + 0.5), reach = rh + 0.36;
    return dx * dx + dy * dy < reach * reach;
  }
  if (kind === "spike-up") return circleHitsRect(x, y, rh, cell.x + 0.12, cell.y + 0.45, cell.x + 0.88, cell.y + 1);
  // `]` points right from the cell's left side; `[` points left from the cell's right side.
  if (kind === "spike-right") return circleHitsRect(x, y, rh, cell.x, cell.y + 0.12, cell.x + 0.55, cell.y + 0.88);
  if (kind === "spike-left") return circleHitsRect(x, y, rh, cell.x + 0.45, cell.y + 0.12, cell.x + 1, cell.y + 0.88);
  return false;
}

const goalHit = (cell: Cell, x: number, y: number) => circleHitsRect(x, y, TUNE.radius, cell.x + 0.15, cell.y + 0.1, cell.x + 0.85, cell.y + 1);
// A door takes the ball as soon as the ball reaches into its cell. Doors sit at the end of a low tunnel or in mid-air.
const doorHit = (cell: Cell, x: number, y: number) => circleHitsRect(x, y, TUNE.radius, cell.x + 0.1, cell.y + 0.1, cell.x + 0.9, cell.y + 0.9);

const moveToward = (value: number, target: number, delta: number) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

function die(run: BounceRun, cause: DeathCause, cell: Cell | null, events: BounceEvent[]): void {
  run.status = "dead";
  run.cause = cause;
  events.push({ type: "death", cause, cell });
}

function kick(run: BounceRun, dir: -1 | 1, events: BounceEvent[]): void {
  run.vx = dir * TUNE.kickSpeedX;
  run.vy = Math.min(run.vy, -TUNE.kickSpeedY);
  run.kickWindow = 0;
  run.kickDir = 0;
  run.kickLock = dir === 1 ? -1 : 1;
  events.push({ type: "wall", kicked: true, side: run.kickLock });
}

/** The landing cell when the ball's bottom spans two cells: the one under its centre, else the first. */
function landingCell(run: BounceRun, hits: readonly Cell[]): Cell {
  const row = Math.min(...hits.map(cell => cell.y));
  const inRow = hits.filter(cell => cell.y === row);
  return inRow.find(cell => cell.x === Math.floor(run.x)) ?? inRow[0]!;
}

function land(run: BounceRun, cell: Cell, events: BounceEvent[]): void {
  const kind = kindAt(run, cell.x, cell.y) ?? "solid";
  run.y = cell.y - TUNE.radius;
  run.bounces += 1;
  run.kickLock = 0;
  if (kind === "arrow-left" || kind === "arrow-right") {
    const dir = kind === "arrow-left" ? -1 : 1;
    run.dash = dir;
    run.vx = dir * TUNE.dashSpeed;
    run.vy = 0;
    events.push({ type: "dash", dir, cell });
    return;
  }
  run.vy = -(kind === "jump" ? TUNE.jump : kind === "spring" ? TUNE.spring : TUNE.bounce);
  events.push({ type: "bounce", kind, cell });
  if (kind === "breakable") {
    run.broken.push(cell.y * COLS + cell.x);
    events.push({ type: "break", cell });
  }
}

/** Advances the run by one step with the given steering. Returns what happened in that step. */
export function stepRun(run: BounceRun, axis: Axis): BounceEvent[] {
  const events: BounceEvent[] = [];
  if (run.status !== "playing") return events;
  run.steps += 1;
  const dt = STEP_SECONDS;

  // Steering. An arrow throw flies straight until a wall or until the player pushes against it.
  if (run.dash !== 0 && axis === -run.dash) run.dash = 0;
  if (run.dash !== 0) {
    run.vx = run.dash * TUNE.dashSpeed;
    run.vy = 0;
  } else {
    const reversing = axis !== 0 && run.vx !== 0 && Math.sign(run.vx) !== axis;
    const rate = axis === 0 ? TUNE.drag : reversing ? TUNE.brake : TUNE.accel;
    run.vx = moveToward(run.vx, axis * TUNE.runSpeed, rate * dt);
    run.vy = Math.min(run.vy + TUNE.gravity * dt, TUNE.maxFall);
  }
  if (run.kickWindow > 0) {
    if (axis !== 0 && axis === run.kickDir) kick(run, axis, events);
    else run.kickWindow -= 1;
  }

  // Sideways move, then walls.
  run.x += run.vx * dt;
  const sideHits = overlapsSolid(run, run.x, run.y);
  if (sideHits.length > 0) {
    const r = TUNE.radius;
    const right = run.vx > 0;
    run.x = right ? Math.min(...sideHits.map(cell => cell.x)) - r : Math.max(...sideHits.map(cell => cell.x)) + 1 + r;
    const away: -1 | 1 = right ? -1 : 1, side: -1 | 1 = right ? 1 : -1;
    const canKick = run.kickLock !== side;
    run.dash = 0;
    if (canKick && axis === away) kick(run, away, events);
    else {
      run.vx = away * Math.abs(run.vx) * TUNE.wallKeep;
      run.kickWindow = canKick ? TUNE.kickWindowSteps : 0;
      run.kickDir = canKick ? away : 0;
      events.push({ type: "wall", kicked: false, side });
    }
  }

  // Up and down, then floors and ceilings.
  run.y += run.vy * dt;
  const hits = overlapsSolid(run, run.x, run.y);
  if (hits.length > 0) {
    if (run.vy > 0) land(run, landingCell(run, hits), events);
    else {
      run.y = Math.max(...hits.map(cell => cell.y)) + 1 + TUNE.radius;
      run.vy = TUNE.ceilingBounce;
    }
  }

  // Hazards, goal, doors, falling out.
  const [x0, x1] = span(run.x - 1, run.x + 1), [y0, y1] = span(run.y - 1, run.y + 1);
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      const kind = kindAt(run, cx, cy);
      if (kind !== null && (kind === "bomb" || isSpikeKind(kind)) && hazardHit(kind, { x: cx, y: cy }, run.x, run.y)) {
        die(run, kind === "bomb" ? "bomb" : "spike", { x: cx, y: cy }, events);
        return events;
      }
    }
  }
  if (goalHit(run.room.goal, run.x, run.y)) {
    run.status = "clear";
    events.push({ type: "clear", cell: run.room.goal });
    return events;
  }
  const doors = run.room.doors;
  if (doors) {
    if (run.doorLock >= 0 && !doorHit(doors[run.doorLock]!, run.x, run.y)) run.doorLock = -1;
    const entered = doors.findIndex((door, index) => index !== run.doorLock && doorHit(door, run.x, run.y));
    if (entered >= 0) {
      const exit = 1 - entered, to = doors[exit]!;
      run.x = to.x + 0.5;
      run.y = to.y + 0.5;
      run.doorLock = exit;
      run.dash = 0;
      events.push({ type: "door", from: doors[entered]!, to });
    }
  }
  if (run.y - TUNE.radius > ROWS) die(run, "fall", null, events);
  return events;
}
