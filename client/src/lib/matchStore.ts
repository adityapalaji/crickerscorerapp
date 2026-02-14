import type { MatchState } from "../api/teams";

// We prefer Vercel KV when configured, but keep a safe local fallback for dev.
let kv: any = null;

const isProd = process.env.NODE_ENV === "production";

async function getKv() {
  if (kv) return kv;
  try {
    // Lazy import so local dev without KV env doesn’t crash build/runtime.
    const mod = await import("@vercel/kv");
    kv = mod.kv;
  } catch (err) {
    if (isProd) {
      throw new Error(
        "Vercel KV is required in production, but @vercel/kv failed to load. Ensure KV env vars are configured.",
        { cause: err as any },
      );
    }
    kv = null;
  }
  return kv;
}

const memStore = new Map<string, MatchState>();

function keyFor(matchId: string) {
  return `match:${matchId}`;
}

export async function loadMatchState(matchId: string): Promise<MatchState | null> {
  const client = await getKv();
  if (client) {
    try {
      const v = await client.get(keyFor(matchId));
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
  const client = await getKv();
  if (client) {
    try {
      await client.set(keyFor(matchId), state);
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
