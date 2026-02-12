import type { MatchState } from "../api/teams";

// Server/client shared match state factory.
// Keep this in sync with what `ScoringApp` expects.

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function createDefaultMatchState(params?: {
  matchId?: string;
  adminKey?: string;
}): MatchState {
  const matchId = params?.matchId ?? uid("match");
  const adminKey = params?.adminKey ?? uid("admin");

  return {
    matchId,
    inningsIndex: 0,
    innings: [
      {
        striker: "",
        nonStriker: "",
        bowler: "",
        lastOverBowler: null,
        bowlerBalls: {},
        usedBatters: [],
        allBalls: [],
      },
    ],
    teams: {
      a: { id: "a", name: "Team A", players: {}, roster: [] },
      b: { id: "b", name: "Team B", players: {}, roster: [] },
    },
    oversLimit: 16,
    setupCompleted: false,
    updatedAt: Date.now(),

    // This key is used client-side to decide admin vs viewer.
    adminKey,
  } as MatchState;
}
