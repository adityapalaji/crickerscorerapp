export async function addPlayer(teamId: string, name: string) {
  const res = await fetch(`/api/teams/${teamId}/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updatePlayer(
  teamId: string,
  playerId: string,
  payload: any,
) {
  const res = await fetch(`/api/teams/${teamId}/players/${playerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deactivatePlayer(teamId: string, playerId: string) {
  const res = await fetch(`/api/teams/${teamId}/players/${playerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
