import type { MatchState } from "../api/teams";

// We prefer Vercel KV when configured, but keep a safe local fallback for dev.
let kv: any = null;

async function getKv() {
  if (kv) return kv;
  try {
    // Lazy import so local dev without KV env doesn’t crash build/runtime.
    const mod = await import("@vercel/kv");
    kv = mod.kv;
  } catch {
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
    } catch {
      // fall back to memory
    }
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
    } catch {
      // fall back to memory
    }
  }
  memStore.set(matchId, state);
  return state;
}

