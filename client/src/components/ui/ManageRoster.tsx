import React, { useEffect, useMemo, useState } from "react";
import type { Player, Team } from "../../types";

type Props = {
  teams: Record<string, Team>;
  initialTeamId?: string | null;
  open: boolean;
  onClose: () => void;
  onChange?: (teamId: string, updatedTeam: Team) => void;
  onSubstitute?: (
    teamId: string,
    oldId: string,
    newId: string,
  ) => Promise<void>;
  api: {
    addPlayer: (teamId: string, name: string) => Promise<Player>;
    updatePlayer: (
      teamId: string,
      playerId: string,
      payload: Partial<Player>,
    ) => Promise<Player>;
    deactivatePlayer: (teamId: string, playerId: string) => Promise<Player>;
  };
};

export default function ManageRoster({
  teams,
  initialTeamId = null,
  open,
  onClose,
  onChange,
  onSubstitute,
  api,
}: Props) {
  const allTeamIds = Object.keys(teams);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
    initialTeamId ?? allTeamIds[0] ?? null,
  );
  const team = selectedTeamId ? teams[selectedTeamId] : null;
  const [editingName, setEditingName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialTeamId) setSelectedTeamId(initialTeamId);
  }, [initialTeamId]);

  const playersArray = useMemo(() => {
    if (!team) return [];
    return (team.roster ?? []).map(
      (id) => team.players?.[id] ?? { id, name: id, active: true },
    );
  }, [team]);

  if (!open) return null;

  async function handleAdd(name: string) {
    if (!selectedTeamId || !name?.trim()) return;
    setLoading(true);
    try {
      const p = await api.addPlayer(selectedTeamId, name.trim());
      const updated: Team = {
        ...team!,
        players: { ...(team!.players ?? {}), [p.id]: p },
        roster: [...(team!.roster ?? []), p.id],
      };
      onChange?.(selectedTeamId, updated);
      setEditingName("");
    } catch (err) {
      console.error("addPlayer failed", err);
      alert("Add player failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit(id: string, name: string) {
    if (!selectedTeamId) return;
    setLoading(true);
    try {
      const p = await api.updatePlayer(selectedTeamId, id, {
        name: name.trim(),
      });
      const updatedPlayers = { ...(team!.players ?? {}), [id]: p };
      const updated: Team = { ...team!, players: updatedPlayers };
      onChange?.(selectedTeamId, updated);
      setEditingId(null);
    } catch (err) {
      console.error("updatePlayer failed", err);
      alert("Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!selectedTeamId) return;
    if (
      !confirm("Deactivate this player? This preserves historical references.")
    )
      return;
    setLoading(true);
    try {
      const p = await api.deactivatePlayer(selectedTeamId, id);
      const updatedPlayers = { ...(team!.players ?? {}), [id]: p };
      const updated: Team = { ...team!, players: updatedPlayers };
      onChange?.(selectedTeamId, updated);
    } catch (err) {
      console.error("deactivate failed", err);
      alert("Deactivate failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubstitute(oldId: string) {
    if (!selectedTeamId) return;
    const name = prompt(
      "Enter replacement player's name (or leave empty to pick existing):",
    );
    if (name === null) return;
    setLoading(true);
    try {
      let replacementId: string | null = null;
      if (name.trim()) {
        const p = await api.addPlayer(selectedTeamId, name.trim());
        replacementId = p.id;
      } else {
        const existing = prompt(
          "Enter existing player ID to substitute in (copy from roster list):",
        );
        if (!existing) {
          alert("No replacement provided");
          return;
        }
        replacementId = existing;
      }
      if (!replacementId) throw new Error("No replacement chosen");
      if (onSubstitute)
        await onSubstitute(selectedTeamId, oldId, replacementId);
      const nextPlayers = {
        ...(team!.players ?? {}),
        [replacementId]: (team!.players ?? {})[replacementId] ?? {
          id: replacementId,
          name: name.trim() || replacementId,
          active: true,
          createdAt: Date.now(),
        },
      };
      const nextRoster = team!.roster?.includes(replacementId)
        ? team!.roster
        : [...(team!.roster ?? []), replacementId];
      onChange?.(selectedTeamId, {
        ...team!,
        players: nextPlayers,
        roster: nextRoster,
      });
    } catch (err) {
      console.error("substitute failed", err);
      alert("Substitution failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <header
          className="modal-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <h3>Manage roster — {team?.name ?? "Team"}</h3>
            <select
              value={selectedTeamId ?? ""}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6 }}
            >
              {allTeamIds.map((id) => (
                <option key={id} value={id}>
                  {teams[id].name ?? id}
                </option>
              ))}
            </select>
          </div>
          <button onClick={onClose}>Close</button>
        </header>

        <section className="modal-body">
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {playersArray.map((p) => (
              <li
                key={p.id}
                style={{
                  padding: 12,
                  borderBottom: "1px solid #eee",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === p.id ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <input
                        defaultValue={p.name}
                        id={`edit-${p.id}`}
                        style={{ flex: "1 1 220px" }}
                      />
                      <button
                        onClick={() => {
                          const el = document.getElementById(
                            `edit-${p.id}`,
                          ) as HTMLInputElement;
                          handleSaveEdit(p.id, el?.value ?? p.name);
                        }}
                        disabled={loading}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <strong style={{ fontSize: 14 }}>
                          {p.name || p.id}
                        </strong>
                        {p.active === false ? (
                          <span style={{ color: "#666", fontSize: 12 }}>
                            (inactive)
                          </span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          onClick={() => setEditingId(p.id)}
                          disabled={loading}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleSubstitute(p.id)}
                          disabled={loading}
                        >
                          Substitute
                        </button>
                        <button
                          onClick={() => handleDeactivate(p.id)}
                          disabled={loading}
                        >
                          Deactivate
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div
                  className="meta"
                  style={{
                    color: "#666",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  id: {p.id}
                </div>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <input
              placeholder="New player name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
            />
            <button
              onClick={() => handleAdd(editingName)}
              disabled={loading || !editingName.trim()}
            >
              Add player
            </button>
          </div>
        </section>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 60;
        }
        .modal {
          width: 720px;
          max-width: calc(100% - 32px);
          background: white;
          border-radius: 8px;
          padding: 16px;
        }
      `}</style>
    </div>
  );
}
