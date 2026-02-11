// Minimal client API wrappers for team/player management
// Replace host/path if API routes differ; these expect Next.js API routes like /api/teams/:teamId/players

// shared types for CrickerScorerApp (add or merge into your existing types file)

export type Player = {
  id: string;
  name: string;
  active?: boolean;
  role?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

export type Team = {
  id: string;
  name: string;
  // players by id
  players: Record<string, Player>;
  // roster is ordered list of player ids
  roster: string[];
  createdAt?: number;
  updatedAt?: number;
};

export type BallEvent = {
  id: string;
  ts: number;
  type: string;
  countsBall?: boolean;
  runs?: number;
  note?: string;
  payload?: any;
};

export type Innings = {
  striker?: string; // player id
  nonStriker?: string; // player id
  bowler?: string; // player id
  lastOverBowler?: string | null;
  bowlerBalls?: Record<string, number>;
  usedBatters?: string[]; // player ids
  allBalls?: BallEvent[];
  // ... other innings fields
};

export type MatchState = {
  matchId: string;
  innings: Innings[];
  inningsIndex: number;
  teams?: Record<string, Team>;
  oversLimit?: number;
  setupCompleted?: boolean;
  currentUser?: { id?: string; name?: string } | null;
  updatedAt?: number;
  // ... rest of your app state
};

export async function addPlayer(
  teamId: string,
  name: string,
  matchId: string,
  adminKey?: string,
) {
  const resp = await fetch(`/api/teams/${encodeURIComponent(teamId)}/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, matchId, adminKey }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const err = body && body.error ? body.error : `HTTP ${resp.status}`;
    throw new Error(`Add player failed: ${err}`);
  }

  const payload = await resp.json();
  // returns { player }
  return payload.player;
}

export async function updatePlayer(
  teamId: string,
  playerId: string,
  payload: any,
) {
  const res = await fetch(`/api/teams/${teamId}/players/${playerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = body && body.error ? body.error : `HTTP ${res.status}`;
    throw new Error(`Update player failed: ${err}`);
  }
  const data = await res.json();
  return data.player ?? data;
}

export async function deactivatePlayer(teamId: string, playerId: string) {
  const res = await fetch(`/api/teams/${teamId}/players/${playerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = body && body.error ? body.error : `HTTP ${res.status}`;
    throw new Error(`Deactivate player failed: ${err}`);
  }
  const data = await res.json();
  return data.player ?? data;
}
