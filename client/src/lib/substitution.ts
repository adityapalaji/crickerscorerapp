import type { MatchState, Innings, BallEvent } from "../types"; // adapt import to your types
import { pushHistory } from "../lib/history"; // adapt to your pushHistory helper if available

export function commitSubstitutionToState(
  state: MatchState,
  innIndex: number,
  oldId: string,
  newId: string,
): MatchState {
  const withHistory = pushHistory(state);
  const prevInn = withHistory.innings[innIndex];

  const replaceIfMatches = (field: keyof Innings) => {
    // @ts-ignore
    return prevInn[field] === oldId ? newId : prevInn[field];
  };

  const nextInn: Innings = {
    ...prevInn,
    striker: replaceIfMatches("striker"),
    nonStriker: replaceIfMatches("nonStriker"),
    bowler: replaceIfMatches("bowler"),
    usedBatters: Array.from(new Set([...(prevInn.usedBatters ?? []), newId])),
    // allBalls unchanged here — substitution is a metadata event. We will append a substitution event.
  };

  const substitutionEvent: BallEvent = {
    id: `sub_${Date.now()}`,
    ts: Date.now(),
    type: "substitution",
    countsBall: false,
    runs: 0,
    note: `Substitution ${oldId} -> ${newId}`,
    // custom payload
    payload: { from: oldId, to: newId },
  };

  const updatedAllBalls = [...(prevInn.allBalls ?? []), substitutionEvent];
  nextInn.allBalls = updatedAllBalls;

  const nextInnings = [...withHistory.innings];
  nextInnings[innIndex] = nextInn;

  return { ...withHistory, innings: nextInnings, updatedAt: Date.now() };
}
