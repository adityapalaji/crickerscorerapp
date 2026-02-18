import { createDefaultMatchState } from "./matchState";

export type CloudSyncStatus =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string };

type CreateMatchOptions = {
  scoreboardDisplay?: "skins" | "traditional";
};

const LOCAL_STORAGE_PREFIX = "ic_scoring_match_v1:";

function saveLocalMatchState(state: any) {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.stringify(state);
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${state.matchId}`, payload);
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}last_match_id`, state.matchId);
  } catch {
    // best-effort local persistence
  }
}

export async function createMatchInCloud(options?: CreateMatchOptions) {
  try {
    const res = await fetch(`/api/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    const payload = (await res.json()) as {
      matchId: string;
      adminKey: string;
      adminUrl: string;
      viewerUrl: string;
    };
    return { ...payload, storage: "cloud" as const };
  } catch {
    // Reliability-first fallback: allow admin scoring to start locally when cloud fails
    const matchId = `match_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    const adminKey = `admin_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    const localState = createDefaultMatchState({
      matchId,
      adminKey,
      scoreboardDisplay: options?.scoreboardDisplay,
    });
    saveLocalMatchState(localState);
    return {
      matchId,
      adminKey,
      adminUrl: `/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`,
      viewerUrl: "",
      storage: "local" as const,
    };
  }
}

export async function fetchMatchFromCloud(matchId: string) {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data?.state ?? null;
}

export async function saveMatchToCloud(matchId: string, state: any, adminKey: string) {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, adminKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data?.state ?? state;
}
