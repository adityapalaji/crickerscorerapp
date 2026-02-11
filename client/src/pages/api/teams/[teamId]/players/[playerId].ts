import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;
  const { playerId } = req.query;

  if (method !== "PATCH") {
    res.setHeader("Allow", ["PATCH"]);
    return res.status(405).end(`Method ${method} Not Allowed`);
  }

  if (!playerId || Array.isArray(playerId)) {
    return res.status(400).json({ error: "Missing playerId" });
  }

  const payload = req.body || {};
  const player = { id: playerId, ...payload, updatedAt: Date.now() };
  return res.status(200).json(player);
}

