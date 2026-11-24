import { COLS, ROWS } from "./constants";

/**
 * Bounce Ball — the tile alphabet and the room parser (docs/kaito-web/bounce-ball.md#타일).
 *
 * A room is 28 strings of 18 characters. Exactly one `P` (start) and one `G` (goal); zero or two `T` (a door pair).
 */
export type TileKind =
  | "solid" | "jump" | "breakable" | "spring" | "arrow-left" | "arrow-right"
  | "bomb" | "spike-up" | "spike-left" | "spike-right" | "door" | "goal";

export const TILE_CHARS: Readonly<Record<string, TileKind>> = Object.freeze({
  "#": "solid",
  "2": "jump",
  x: "breakable",
  s: "spring",
  "<": "arrow-left",
  ">": "arrow-right",
  "!": "bomb",
  "^": "spike-up",
  "[": "spike-left",
  "]": "spike-right",
  T: "door",
  G: "goal",
});

/** Tiles the ball bounces on and cannot pass. */
export const isSolidKind = (kind: TileKind | null): boolean =>
  kind === "solid" || kind === "jump" || kind === "breakable" || kind === "spring" || kind === "arrow-left" || kind === "arrow-right";

export const isSpikeKind = (kind: TileKind | null): boolean => kind === "spike-up" || kind === "spike-left" || kind === "spike-right";

export interface Cell { readonly x: number; readonly y: number }

export interface ParsedRoom {
  /** The room's rows; `P` is already replaced by `.`. */
  readonly rows: readonly string[];
  readonly start: Cell;
  readonly goal: Cell;
  /** The door pair, or null. */
  readonly doors: readonly [Cell, Cell] | null;
  readonly breakables: number;
}

/** Problems with a room, empty when it is valid. */
export function roomProblems(rows: readonly string[]): string[] {
  const problems: string[] = [];
  if (rows.length !== ROWS) problems.push(`expected ${ROWS} rows, got ${rows.length}`);
  let starts = 0, goals = 0, doors = 0;
  rows.forEach((row, y) => {
    if (row.length !== COLS) problems.push(`row ${y}: expected ${COLS} columns, got ${row.length}`);
    for (const char of row) {
      if (char === "P") starts += 1;
      else if (char === "G") goals += 1;
      else if (char === "T") doors += 1;
      if (char !== "." && char !== "P" && !(char in TILE_CHARS)) problems.push(`row ${y}: unknown tile "${char}"`);
    }
  });
  if (starts !== 1) problems.push(`expected one P, got ${starts}`);
  if (goals !== 1) problems.push(`expected one G, got ${goals}`);
  if (doors !== 0 && doors !== 2) problems.push(`expected zero or two T, got ${doors}`);
  return problems;
}

/** Parses a room. Throws with every problem when the room is not valid. */
export function parseRoom(rows: readonly string[]): ParsedRoom {
  const problems = roomProblems(rows);
  if (problems.length > 0) throw new Error(`Invalid Bounce Ball room: ${problems.join("; ")}`);
  let start: Cell = { x: 0, y: 0 }, goal: Cell = { x: 0, y: 0 };
  const doors: Cell[] = [];
  let breakables = 0;
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (char === "P") start = { x, y };
      else if (char === "G") goal = { x, y };
      else if (char === "T") doors.push({ x, y });
      else if (char === "x") breakables += 1;
    });
  });
  return {
    rows: rows.map(row => row.replace("P", ".")),
    start, goal, breakables,
    doors: doors.length === 2 ? [doors[0]!, doors[1]!] : null,
  };
}

/** The kind of tile at a cell of the original rows, or null for empty and outside. */
export function tileAt(rows: readonly string[], x: number, y: number): TileKind | null {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
  return TILE_CHARS[rows[y]![x]!] ?? null;
}
