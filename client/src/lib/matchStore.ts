import type { MatchState } from "../api/teams";

// We prefer Vercel KV when configured, but keep a safe local fallback for dev.
let kv: any = null;

const isProd = process.env.NODE_ENV === "production";

async function getKv() {
  // If running locally, skip KV completely
  if (process.env.NODE_ENV === "development") {
    return null;
  }

  if (kv) return kv;

  try {
    const mod = await import("@vercel/kv");
    kv = mod.kv;
  } catch (err) {
    console.warn("KV not available, falling back to memory store.");
    kv = null;
  }

  return kv;
}


const memStore = new Map<string, MatchState>();

function keyFor(matchId: string) {
  return `match:${matchId}`;
}

export async function loadMatchState(matchId: string): Promise<MatchState | null> {
  const kvClient = await getKv();
  if (!kvClient) {
    try {
      const v = await kvClient.get(keyFor(matchId));
      return (v as MatchState) ?? null;
    } catch (err) {
      if (isProd) throw err;
      // fall back to memory
    }
  } else if (isProd) {
    throw new Error(
      "Vercel KV is required in production, but the KV client is unavailable. Ensure KV env vars are configured.",
    );
  }
  return memStore.get(matchId) ?? null;
}

export async function saveMatchState(
  matchId: string,
  state: MatchState,
): Promise<MatchState> {
  const kvClient = await getKv();
  if (!kvClient) {
    try {
      await kvClient.set(keyFor(matchId), state);
      return state;
    } catch (err) {
      if (isProd) throw err;
      // fall back to memory
    }
  } else if (isProd) {
    throw new Error(
      "Vercel KV is required in production, but the KV client is unavailable. Ensure KV env vars are configured.",
    );
  }
  memStore.set(matchId, state);
  return state;
}
