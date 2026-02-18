import type { MatchState } from "../api/teams";

/**
 * Postgres adapter for match state storage.
 * Mirrors the Vercel KV interface with failover to in-memory store in development.
 * Uses the `postgres` npm package for connection pooling.
 */

let pgClient: any = null;
let pgInitialized = false;
let pgError: Error | null = null;

const isProd =
  process.env.NODE_ENV === "production" ||
  (process.env.NODE_ENV !== "development" && process.env.DATABASE_URL);

/**
 * Initialize and return Postgres client.
 * In production: throws if DATABASE_URL is not available.
 * In development: returns null to use in-memory fallback.
 */
async function getPgClient() {
  // In development, always use in-memory store
  if (process.env.NODE_ENV === "development") {
    return null;
  }

  // Cached result
  if (pgInitialized) {
    if (pgError) throw pgError;
    return pgClient;
  }

  try {
    // Verify environment variables exist before importing
    const hasDatabaseUrl = !!process.env.DATABASE_URL;

    if (!hasDatabaseUrl) {
      throw new Error(
        "DATABASE_URL environment variable is required in production",
      );
    }

    // Import postgres library
    const postgres = (await import("postgres")).default;

    // Create connection with proper error handling
    pgClient = postgres(process.env.DATABASE_URL, {
      max: 5, // Connection pool size
      idle_timeout: 20, // seconds
      connect_timeout: 10, // seconds
    });

    // Test the connection
    await pgClient`SELECT 1`;

    // Initialize schema if needed
    await initializeSchema(pgClient);

    pgInitialized = true;
    return pgClient;
  } catch (err) {
    pgError = err as Error;
    pgInitialized = true;

    // In production, MUST NOT fallback silently
    if (isProd) {
      throw new Error(
        `Postgres initialization failed (required in production): ${pgError.message}`,
      );
    }

    // In non-production, allow null return for in-memory fallback
    return null;
  }
}

/**
 * Initialize the matches table if it doesn't exist.
 */
async function initializeSchema(client: any) {
  try {
    // Create table with JSON storage for match state
    await client`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index on updated_at for efficient queries
    await client`
      CREATE INDEX IF NOT EXISTS idx_matches_updated_at 
      ON matches(updated_at DESC)
    `;
  } catch (err) {
    console.error("Failed to initialize Postgres schema:", err);
    throw err;
  }
}

// Development-only in-memory store
const memStore = new Map<string, MatchState>();

/**
 * Load match state from Postgres (production) or memory (development).
 * In production, throws if Postgres is unavailable.
 */
export async function loadMatchState(
  matchId: string,
): Promise<MatchState | null> {
  const pgClientInstance = await getPgClient();

  // Postgres is available (production with DATABASE_URL, or development initialized)
  if (pgClientInstance) {
    try {
      const rows = await pgClientInstance`
        SELECT state FROM matches WHERE id = ${matchId}
      `;

      if (rows.length === 0) {
        return null;
      }

      return (rows[0].state as MatchState) ?? null;
    } catch (err) {
      // In production, Postgres errors are critical
      if (isProd) {
        throw new Error(`Postgres read failed for match ${matchId}: ${err}`);
      }
      // In non-production, fall back to memory
    }
  }

  // Development-only fallback
  return memStore.get(matchId) ?? null;
}

/**
 * Save match state to Postgres (production) or memory (development).
 * In production, throws if Postgres is unavailable.
 */
export async function saveMatchState(
  matchId: string,
  state: MatchState,
): Promise<MatchState> {
  const pgClientInstance = await getPgClient();

  // Postgres is available (production with DATABASE_URL, or development initialized)
  if (pgClientInstance) {
    try {
      await pgClientInstance`
        INSERT INTO matches (id, state, updated_at, created_at)
        VALUES (${matchId}, ${state}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE
        SET state = ${state}, updated_at = CURRENT_TIMESTAMP
      `;

      return state;
    } catch (err) {
      // In production, Postgres errors are critical
      if (isProd) {
        throw new Error(`Postgres write failed for match ${matchId}: ${err}`);
      }
      // In non-production, fall back to memory
    }
  }

  // Development-only fallback
  memStore.set(matchId, state);
  return state;
}

/**
 * Health check: verify Postgres connectivity
 */
export async function checkPgHealth(): Promise<boolean> {
  try {
    const pgClientInstance = await getPgClient();
    if (!pgClientInstance) {
      // Development mode with no Postgres
      return true;
    }

    await pgClientInstance`SELECT 1`;
    return true;
  } catch (err) {
    console.error("Postgres health check failed:", err);
    return false;
  }
}
