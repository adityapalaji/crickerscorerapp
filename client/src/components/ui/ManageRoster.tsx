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

  // Substitution UI state (replaces prompt-based flow)
  const [subbingOldId, setSubbingOldId] = useState<string | null>(null);
  const [subMode, setSubMode] = useState<"existing" | "new">("existing");
  const [selectedReplacementId, setSelectedReplacementId] = useState<string>("");
  const [newReplacementName, setNewReplacementName] = useState<string>("");
  const [subError, setSubError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTeamId) setSelectedTeamId(initialTeamId);
  }, [initialTeamId]);

  // Reset substitution panel when team changes or modal closes
  useEffect(() => {
    setSubbingOldId(null);
    setSelectedReplacementId("");
    setNewReplacementName("");
    setSubError(null);
    setSubMode("existing");
  }, [selectedTeamId, open]);

  const playersArray = useMemo(() => {
    if (!team) return [];
    return (team.roster ?? []).map(
      (id) => team.players?.[id] ?? { id, name: id, active: true },
    );
  }, [team]);

  const activePlayersArray = useMemo(() => {
    if (!team) return [] as Player[];
    return (team.roster ?? [])
      .map((id) => team.players?.[id] ?? ({ id, name: id, active: true } as any))
      .filter((p: any) => p?.active !== false);
  }, [team]);

  const replacementCandidates = useMemo(() => {
    if (!subbingOldId) return activePlayersArray;
    return activePlayersArray.filter((p) => p.id !== subbingOldId);
  }, [activePlayersArray, subbingOldId]);

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
    if (!onSubstitute) {
      alert("Substitution is not available in this context.");
      return;
    }

    // Toggle panel
    if (subbingOldId === oldId) {
      setSubbingOldId(null);
      setSelectedReplacementId("");
      setNewReplacementName("");
      setSubError(null);
      return;
    }

    setSubbingOldId(oldId);
    setSelectedReplacementId("");
    setNewReplacementName("");
    setSubError(null);

    // If there are no candidates, default to adding new
    const hasCandidates = replacementCandidates.length > 0;
    setSubMode(hasCandidates ? "existing" : "new");

    // Try to keep the expanded row in view
    requestAnimationFrame(() => {
      const el = document.getElementById(`player-row-${oldId}`);
      el?.scrollIntoView?.({ block: "nearest" });
    });
  }

  async function submitExistingSubstitution(oldId: string) {
    if (!selectedTeamId || !team) return;
    if (!onSubstitute) return;

    const newId = selectedReplacementId;
    if (!newId) {
      setSubError("Select a replacement player.");
      return;
    }
    if (newId === oldId) {
      setSubError("Replacement can’t be the same player.");
      return;
    }

    setLoading(true);
    setSubError(null);
    try {
      await onSubstitute(selectedTeamId, oldId, newId);

      // Ensure replacement is present in roster/players (usually already)
      const nextRoster = team.roster?.includes(newId)
        ? team.roster
        : [...(team.roster ?? []), newId];

      const nextPlayers = {
        ...(team.players ?? {}),
        [newId]: (team.players ?? {})[newId] ?? {
          id: newId,
          name: newId,
          active: true,
          createdAt: Date.now(),
        },
      };

      onChange?.(selectedTeamId, { ...team, roster: nextRoster, players: nextPlayers });

      setSubbingOldId(null);
      setSelectedReplacementId("");
    } catch (err) {
      console.error("substitute failed", err);
      setSubError("Substitution failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPlayerSubstitution(oldId: string) {
    if (!selectedTeamId || !team) return;
    if (!onSubstitute) return;

    const name = newReplacementName.trim();
    if (!name) {
      setSubError("Enter a name for the new replacement player.");
      return;
    }

    setLoading(true);
    setSubError(null);
    try {
      // Create the player first
      const p = await api.addPlayer(selectedTeamId, name);
      const newId = p.id;

      await onSubstitute(selectedTeamId, oldId, newId);

      const nextPlayers = {
        ...(team.players ?? {}),
        [p.id]: p,
      };
      const nextRoster = team.roster?.includes(p.id)
        ? team.roster
        : [...(team.roster ?? []), p.id];

      onChange?.(selectedTeamId, { ...team, players: nextPlayers, roster: nextRoster });

      setSubbingOldId(null);
      setNewReplacementName("");
    } catch (err) {
      console.error("substitute failed", err);
      setSubError("Substitution failed. Please try again.");
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
                id={`player-row-${p.id}`}
                style={{
                  padding: 12,
                  borderBottom: "1px solid #eee",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
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
                          disabled={loading || !onSubstitute}
                          title={!onSubstitute ? "Substitution not available" : undefined}
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

                      {subbingOldId === p.id ? (
                        <div
                          style={{
                            marginTop: 10,
                            border: "1px solid #eee",
                            borderRadius: 8,
                            padding: 10,
                            background: "#fafafa",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              Substitute for: {p.name || p.id}
                            </div>
                            <button
                              onClick={() => {
                                setSubbingOldId(null);
                                setSelectedReplacementId("");
                                setNewReplacementName("");
                                setSubError(null);
                              }}
                              disabled={loading}
                            >
                              Cancel
                            </button>
                          </div>

                          <div
                            style={{
                              marginTop: 8,
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => setSubMode("existing")}
                              disabled={loading}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid #ddd",
                                background:
                                  subMode === "existing" ? "#e8f0ff" : "white",
                              }}
                            >
                              Pick from roster
                            </button>
                            <button
                              onClick={() => setSubMode("new")}
                              disabled={loading}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid #ddd",
                                background:
                                  subMode === "new" ? "#e8f0ff" : "white",
                              }}
                            >
                              Add new
                            </button>
                          </div>

                          {subMode === "existing" ? (
                            <div style={{ marginTop: 10 }}>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  flexWrap: "wrap",
                                  alignItems: "center",
                                }}
                              >
                                <select
                                  value={selectedReplacementId}
                                  onChange={(e) =>
                                    setSelectedReplacementId(e.target.value)
                                  }
                                  disabled={loading}
                                  style={{ padding: "6px 8px", borderRadius: 6 }}
                                >
                                  <option value="">
                                    {replacementCandidates.length
                                      ? "Select replacement"
                                      : "No active players available"}
                                  </option>
                                  {replacementCandidates.map((rp) => (
                                    <option key={rp.id} value={rp.id}>
                                      {(rp.name || rp.id) + ` (${rp.id})`}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => submitExistingSubstitution(p.id)}
                                  disabled={
                                    loading ||
                                    !replacementCandidates.length ||
                                    !selectedReplacementId
                                  }
                                >
                                  Confirm
                                </button>
                              </div>

                              {!replacementCandidates.length ? (
                                <div
                                  style={{
                                    marginTop: 8,
                                    fontSize: 12,
                                    color: "#666",
                                  }}
                                >
                                  No active roster players to substitute in. Use “Add new”.
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div style={{ marginTop: 10 }}>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  flexWrap: "wrap",
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  placeholder="New replacement name"
                                  value={newReplacementName}
                                  onChange={(e) =>
                                    setNewReplacementName(e.target.value)
                                  }
                                  disabled={loading}
                                  style={{ flex: "1 1 220px" }}
                                />
                                <button
                                  onClick={() => submitNewPlayerSubstitution(p.id)}
                                  disabled={loading || !newReplacementName.trim()}
                                >
                                  Add & substitute
                                </button>
                              </div>
                            </div>
                          )}

                          {subError ? (
                            <div
                              style={{
                                marginTop: 8,
                                fontSize: 12,
                                color: "#b91c1c",
                              }}
                            >
                              {subError}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
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
          max-height: calc(100vh - 32px);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .modal-header {
          position: sticky;
          top: 0;
          background: white;
          z-index: 1;
          padding-bottom: 12px;
          margin-bottom: 8px;
          border-bottom: 1px solid #eee;
        }
        .modal-body {
          overflow: auto;
          padding-right: 4px;
        }
      `}</style>
    </div>
  );
}
