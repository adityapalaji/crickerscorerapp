export type CloudSyncStatus =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string };

type CreateMatchOptions = {
  scoreboardDisplay?: "skins" | "traditional";
};

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
