import type { NextApiRequest, NextApiResponse } from "next";
import { loadMatch, saveMatch } from "../../../lib/matches";

const API_VERSION = "2026-02-11";

function isAdminKeyValid(provided?: string) {
  if (!process.env.ADMIN_KEY) return true;
  return provided === process.env.ADMIN_KEY;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { matchId } = req.query;

  if (!matchId || Array.isArray(matchId)) {
    return res.status(400).json({ error: "Missing matchId" });
  }

  if (req.method === "GET") {
    const state = await loadMatch(matchId);
    if (!state) return res.status(404).json({ error: "Match not found" });
    return res.status(200).json({ state, meta: { version: API_VERSION } });
  }

  if (req.method === "PUT") {
    const { state, adminKey } = req.body || {};
    if (!isAdminKeyValid(adminKey)) {
      return res.status(403).json({ error: "Forbidden: invalid admin key" });
    }
    if (!state || typeof state !== "object") {
      return res.status(400).json({ error: "Missing state" });
    }
    if (state.matchId && state.matchId !== matchId) {
      return res.status(400).json({ error: "matchId mismatch" });
    }
    const nextState = { ...state, matchId, updatedAt: Date.now() };
    await saveMatch(matchId, nextState);
    return res.status(200).json({ state: nextState, meta: { version: API_VERSION } });
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}

