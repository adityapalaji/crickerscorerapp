import type { NextApiRequest, NextApiResponse } from "next";
import { saveMatch } from "../../../lib/matches";
import { createDefaultMatchState } from "../../../lib/matchState";

const API_VERSION = "2026-02-11";

function getOrigin(req: NextApiRequest) {
  // Prefer configured public URL when available.
  const env = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (env) return env.replace(/\/$/, "");

  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}`;
}

function buildViewerLink(origin: string, matchId: string) {
  return `${origin}/match/${encodeURIComponent(matchId)}?mode=viewer`;
}

function buildAdminLink(origin: string, matchId: string, adminKey: string) {
  return `${origin}/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const state = createDefaultMatchState();
  const adminKey = (state as any).adminKey as string;
  await saveMatch((state as any).matchId, state as any);

  const origin = getOrigin(req);
  const adminUrl = buildAdminLink(origin, state.matchId, adminKey);
  const viewerUrl = buildViewerLink(origin, state.matchId);

  return res.status(200).json({
    matchId: state.matchId,
    adminKey,
    adminUrl,
    viewerUrl,
    meta: { version: API_VERSION },
  });
}
