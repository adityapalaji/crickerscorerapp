import type { NextApiRequest, NextApiResponse } from "next";
import { loadMatch, saveMatch } from "../../../../lib/matches"; // adjust path if lib lives elsewhere

const API_VERSION = "2026-02-11";

function makePlayerId() {
  return `pl_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`;
}

// Basic admin guard — replace with real auth in production
function isAdminKeyValid(provided?: string) {
  if (!process.env.ADMIN_KEY) return true; // allow in dev if ADMIN_KEY unset
  return provided === process.env.ADMIN_KEY;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { method } = req;
  const { teamId } = req.query;

  if (method === "GET") {
    return res.status(200).json({ ok: true, version: API_VERSION });
  }

  if (method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${method} Not Allowed`);
  }

  const { name, matchId, adminKey } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing or invalid name" });
  }
  if (!isAdminKeyValid(adminKey)) {
    return res.status(403).json({ error: "Forbidden: invalid admin key" });
  }

  try {
    const state = matchId ? (await loadMatch(matchId)) || null : null;

    // Create new player
    const id = makePlayerId();
    const player = {
      id,
      name: name.trim(),
      active: true,
      createdAt: Date.now(),
    };

    if (state) {
      if (!state.teams) state.teams = {};
      if (!state.teams[teamId as string]) {
        return res.status(404).json({ error: "Team not found" });
      }

      const team = state.teams[teamId as string];

      // Normalize players array -> players map if needed
      if (Array.isArray(team.players)) {
        const nextPlayers: Record<string, any> = {};
        (team.players as any[]).forEach((entry) => {
          if (typeof entry === "string") {
            const legacyId = entry.startsWith("pl_")
              ? entry
              : `pl_legacy_${entry}`;
            nextPlayers[legacyId] = { id: legacyId, name: entry, active: true };
          } else if (entry && entry.id) {
            nextPlayers[entry.id] = entry;
          }
        });
        team.players = nextPlayers;
      }
      if (!Array.isArray(team.roster)) team.roster = [];

      // Insert into players map and roster
      team.players = { ...(team.players || {}), [id]: player };
      team.roster = [...team.roster, id];

      // Persist updated state
      await saveMatch(matchId, state);
    }

    return res.status(201).json({ player, meta: { version: API_VERSION, statePersisted: Boolean(state) } });
  } catch (err) {
    console.error("Add player error:", err);
    return res.status(500).json({ error: "internal" });
  }
}
