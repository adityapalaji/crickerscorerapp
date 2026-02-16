import type { MatchState } from "../api/teams";

// PRODUCTION REQUIREMENT: Vercel KV must be available in production.
// Development mode only uses in-memory store.
let kv: any = null;
let kvInitialized = false;
let kvError: Error | null = null;

const isProd = process.env.NODE_ENV === "production";

/**
 * Initialize and return Vercel KV client.
 * In production: throws if KV is not available.
 * In development: returns null to use in-memory fallback.
 */
async function getKv() {
  // In development, always use in-memory store
  if (process.env.NODE_ENV === "development") {
    return null;
  }

  // Cached result
  if (kvInitialized) {
    if (kvError) throw kvError;
    return kv;
  }

  try {
    // Verify environment variables exist before importing
    const hasKvUrl = !!process.env.KV_REST_API_URL;
    const hasKvToken = !!process.env.KV_REST_API_TOKEN;

    if (!hasKvUrl || !hasKvToken) {
      throw new Error(
        "KV_REST_API_URL and KV_REST_API_TOKEN environment variables are required in production",
      );
    }

    const mod = await import("@vercel/kv");
    kv = mod.kv;
    kvInitialized = true;
    return kv;
  } catch (err) {
    kvError = err as Error;
    kvInitialized = true;

    // In production, MUST NOT fallback silently
    if (isProd) {
      throw new Error(
        `Vercel KV initialization failed (required in production): ${kvError.message}`,
      );
    }

    // In development, allow null return for in-memory fallback
    return null;
  }
}

// Development-only in-memory store
const memStore = new Map<string, MatchState>();

function keyFor(matchId: string) {
  return `match:${matchId}`;
}

/**
 * Load match state from Vercel KV (production) or memory (development).
 * In production, throws if KV is unavailable.
 */
export async function loadMatchState(matchId: string): Promise<MatchState | null> {
  const kvClient = await getKv();

  // KV is available (production with KV, or development initialized)
  if (kvClient) {
    try {
      const v = await kvClient.get(keyFor(matchId));
      return (v as MatchState) ?? null;
    } catch (err) {
      // In production, KV errors are critical
      if (isProd) {
        throw new Error(`KV read failed for match ${matchId}: ${err}`);
      }
      // In development, fall back to memory
    }
  }

  // Development-only fallback
  return memStore.get(matchId) ?? null;
}

/**
 * Save match state to Vercel KV (production) or memory (development).
 * In production, throws if KV is unavailable.
 */
export async function saveMatchState(
  matchId: string,
  state: MatchState,
): Promise<MatchState> {
  const kvClient = await getKv();

  // KV is available (production with KV, or development initialized)
  if (kvClient) {
    try {
      await kvClient.set(keyFor(matchId), state);
      return state;
    } catch (err) {
      // In production, KV errors are critical
      if (isProd) {
        throw new Error(`KV write failed for match ${matchId}: ${err}`);
      }
      // In development, fall back to memory
    }
  }

  // Development-only fallback
  memStore.set(matchId, state);
  return state;
}
