import type { MatchState } from "../api/teams";

// Simple in-memory store for API routes; replace with real persistence if needed.
const matchStore = new Map<string, MatchState>();

export function loadMatch(matchId: string): MatchState | null {
  return matchStore.get(matchId) ?? null;
}

export function saveMatch(matchId: string, state: MatchState): MatchState {
  matchStore.set(matchId, state);
  return state;
}

