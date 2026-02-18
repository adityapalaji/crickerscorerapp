/**
 * Match store adapter abstraction.
 * Delegates to Postgres storage (production) with in-memory fallback (development).
 */

export { loadMatchState, saveMatchState, checkPgHealth } from "./postgresStore";
