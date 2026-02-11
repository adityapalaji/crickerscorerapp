/**
 * commitSubstitutionToState (fallback)
 * - Temporarily NOT importing pushHistory to avoid build-time resolution errors.
 * - This will still update the innings and append a substitution event.
 * - Replace the fallback with the real pushHistory import when you locate it.
 */

import type { MatchState, Innings, BallEvent } from "../api/teams";

export function commitSubstitutionToState(
  state: MatchState,
  innIndex: number,
  oldId: string,
  newId: string,
  actorId?: string,
): MatchState {
  // FALLBACK: do not call pushHistory here if import path is unknown.
  // When you find pushHistory, replace the next line with: const withHistory = pushHistory(state);
  const withHistory = state;

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
