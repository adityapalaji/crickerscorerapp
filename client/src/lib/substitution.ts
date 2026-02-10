/**
 * commitSubstitutionToState
 * - Replace references to old player ID with new player ID in the given innings
 * - Append a substitution event to the innings' allBalls for audit/history
 * - Uses pushHistory(state) to preserve undo / history (adjusted import path)
 */

import type { MatchState, Innings, BallEvent } from "../types"; // adjust if your types live elsewhere
// IMPORTANT: correct relative import to history helper in same folder
import { pushHistory } from "./history";

/**
 * If pushHistory is not exported from ./history, update the import above to the correct path
 * (for instance: "../lib/history" -> "./history" or the real path where pushHistory lives).
 */
export function commitSubstitutionToState(
  state: MatchState,
  innIndex: number,
  oldId: string,
  newId: string,
  actorId?: string,
): MatchState {
  // Use pushHistory if available to preserve undo history
  const withHistory =
    typeof pushHistory === "function" ? pushHistory(state) : state;

  const prevInn: Innings = withHistory.innings[innIndex];

  const nextInn: Innings = {
    ...prevInn,
    striker: prevInn.striker === oldId ? newId : prevInn.striker,
    nonStriker: prevInn.nonStriker === oldId ? newId : prevInn.nonStriker,
    bowler: prevInn.bowler === oldId ? newId : prevInn.bowler,
    usedBatters: Array.from(new Set([...(prevInn.usedBatters ?? []), newId])),
  };

  const substitutionEvent: BallEvent = {
    id: `sub_${Date.now()}`,
    ts: Date.now(),
    type: "substitution",
    countsBall: false,
    runs: 0,
    note: `Substitution ${oldId} → ${newId}`,
    payload: { from: oldId, to: newId, actor: actorId ?? "unknown" },
  };

  nextInn.allBalls = [...(prevInn.allBalls ?? []), substitutionEvent];

  const nextInnings = [...withHistory.innings];
  nextInnings[innIndex] = nextInn;

  return { ...withHistory, innings: nextInnings, updatedAt: Date.now() };
}
