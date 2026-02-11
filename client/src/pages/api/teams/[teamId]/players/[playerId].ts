import type { NextApiRequest, NextApiResponse } from "next";
import { loadMatch, saveMatch } from "../../../../../lib/matches";

const API_VERSION = "2026-02-11";

// Basic admin guard — replace with real auth in production
function isAdminKeyValid(provided?: string) {
  if (!process.env.ADMIN_KEY) return true; // allow in dev if ADMIN_KEY unset
  return provided === process.env.ADMIN_KEY;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;
  const { teamId, playerId } = req.query;

  if (method !== "PATCH") {
    res.setHeader("Allow", ["PATCH"]);
    return res.status(405).end(`Method ${method} Not Allowed`);
  }

  if (!teamId || Array.isArray(teamId)) {
    return res.status(400).json({ error: "Missing teamId" });
  }

  if (!playerId || Array.isArray(playerId)) {
    return res.status(400).json({ error: "Missing playerId" });
  }

  const body = req.body || {};
  const { matchId, adminKey, ...patch } = body;

  if (!isAdminKeyValid(adminKey)) {
    return res.status(403).json({ error: "Forbidden: invalid admin key" });
  }

  // disallow overwriting these fields
  delete (patch as any).id;
  delete (patch as any).createdAt;

  try {
    const state = matchId ? (await loadMatch(matchId)) || null : null;

    // If a matchId is supplied, persist the patch into match state.
    if (state) {
      if (!state.teams) state.teams = {};
      const team = state.teams[teamId];
      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      // Normalize players array -> players map if needed (legacy)
      if (Array.isArray((team as any).players)) {
        const nextPlayers: Record<string, any> = {};
        ((team as any).players as any[]).forEach((entry) => {
          if (typeof entry === "string") {
            const legacyId = entry.startsWith("pl_")
              ? entry
              : `pl_legacy_${entry}`;
            nextPlayers[legacyId] = { id: legacyId, name: entry, active: true };
          } else if (entry && (entry as any).id) {
            nextPlayers[(entry as any).id] = entry;
          }
        });
        (team as any).players = nextPlayers;
      }

      const players = ((team as any).players ?? {}) as Record<string, any>;
      const existing = players[playerId];
      if (!existing) {
        return res.status(404).json({ error: "Player not found" });
      }

      const updatedPlayer = {
        ...existing,
        ...patch,
        id: playerId,
        updatedAt: Date.now(),
      };

      (team as any).players = { ...players, [playerId]: updatedPlayer };
      (state as any).updatedAt = Date.now();

      await saveMatch(matchId, state);

      return res
        .status(200)
        .json({
          player: updatedPlayer,
          meta: { version: API_VERSION, statePersisted: true },
        });
    }

    // Fallback: non-persisted patch (useful in dev/demo)
    const player = { id: playerId, ...patch, updatedAt: Date.now() };
    return res
      .status(200)
      .json({ player, meta: { version: API_VERSION, statePersisted: false } });
  } catch (err) {
    console.error("Update player error:", err);
    return res.status(500).json({ error: "internal" });
  }
}
