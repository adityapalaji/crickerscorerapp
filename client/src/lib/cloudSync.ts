export type CloudSyncStatus =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string };

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

