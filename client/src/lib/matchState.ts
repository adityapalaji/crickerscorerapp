// NOTE: We intentionally avoid typing this file against the minimal MatchState
// declared in `src/api/teams.ts`, because the scoring UI expects a richer
// innings shape (with id, runs, balls, overEvents, etc.).

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function createDefaultMatchState(params?: {
  matchId?: string;
  adminKey?: string;
}) {
  const matchId = params?.matchId ?? uid("match");
  const adminKey = params?.adminKey ?? uid("admin");

  return {
    version: 1,
    matchId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    setupCompleted: false,

    title: "Indoor Cricket",
    venue: "Court 1",

    teams: {
      a: { id: "a", name: "Team A", players: [] as string[] },
      b: { id: "b", name: "Team B", players: [] as string[] },
    },

    oversLimit: 16,

    inningsIndex: 0,
    innings: [
      {
        id: uid("inn"),
        battingTeamId: "a",
        bowlingTeamId: "b",
        awaitingBatsmanSelection: false,

        runs: 0,
        wickets: 0,
        balls: 0,
        deliveries: 0,

        dotBalls: 0,
        currentSkin: { grossRuns: 0, wickets: 0 },

        extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },

        striker: "",
        nonStriker: "",
        bowler: "",

        allBalls: [] as any[],
        bowlerBalls: {} as Record<string, number>,
        lastOverBowler: null as string | null,
        overEvents: [] as any[],
        lastOverSummary: [] as any[],

        skinIndex: 0,
        ballsInSkin: 0,
        completedSkins: [] as any[],
        usedBatters: [] as string[],
      },
    ],

    status: "setup",
    tossWinner: null,
    tossChoice: null,

    adminKey,
    history: { snapshots: [] as any[] },
  };
}
