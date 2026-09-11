import type { GenomeInstruction } from "./codec";

export type AntDirection = 0 | 1 | 2 | 3;

export interface AntState {
  readonly x: number;
  readonly y: number;
  readonly direction: AntDirection;
}

export type GenomeAction =
  | { kind: "write"; x: number; y: number; code: number; state: AntState }
  | { kind: "move-only"; state: AntState }
  | { kind: "grow"; side: "up" | "right" | "down" | "left"; state: AntState }
  | { kind: "end"; state: AntState };

const DELTAS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const;

const turn = (direction: AntDirection, move: number): AntDirection => {
  const turnDelta = move === 0 ? 0 : move === 1 ? -1 : move === 2 ? 1 : 2;
  return ((direction + turnDelta + 4) % 4) as AntDirection;
};

export const executeGenomeInstruction = (state: AntState, instruction: GenomeInstruction): GenomeAction => {
  switch (instruction.control) {
    case "grow-up": return { kind: "grow", side: "up", state };
    case "grow-right": return { kind: "grow", side: "right", state };
    case "grow-down": return { kind: "grow", side: "down", state };
    case "grow-left": return { kind: "grow", side: "left", state };
    case "end": return { kind: "end", state };
  }
  const direction = turn(state.direction, instruction.move);
  const delta = DELTAS[direction];
  const nextState: AntState = { x: state.x + delta.x, y: state.y + delta.y, direction };
  if (instruction.control === "move-only") return { kind: "move-only", state: nextState };
  return { kind: "write", x: nextState.x, y: nextState.y, code: instruction.code, state: nextState };
};
