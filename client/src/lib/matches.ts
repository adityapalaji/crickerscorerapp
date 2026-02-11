import type { MatchState } from "../api/teams";
import { loadMatchState, saveMatchState } from "./matchStore";

// Backwards-compatible API used by existing API routes.
export async function loadMatch(matchId: string): Promise<MatchState | null> {
  return loadMatchState(matchId);
}

export async function saveMatch(
  matchId: string,
  state: MatchState,
): Promise<MatchState> {
  return saveMatchState(matchId, state);
}
