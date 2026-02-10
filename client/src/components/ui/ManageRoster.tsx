import React, { useState, useMemo } from "react";

type Player = {
  id: string;
  name: string;
  active?: boolean;
  role?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type Team = {
  id: string;
  name: string;
  players: Record<string, Player>; // map of id -> player
  roster: string[]; // ordered list of player ids
};

type Props = {
  team: Team;
  open: boolean;
  onClose: () => void;
  // callbacks (optional) to refresh parent state after server mutation
  onChange?: (updatedTeam: Team) => void;
  // function to run substitution in-match (optional)
  onSubstitute?: (oldId: string, newId: string) => Promise<void>;
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
  team,
  open,
  onClose,
  onChange,
  onSubstitute,
  api,
}: Props) {
  const [editingName, setEditingName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const playersArray = useMemo(() => {
    return team.roster.map((id) => team.players[id]).filter(Boolean);
  }, [team]);

  if (!open) return null;

  async function handleAdd(name: string) {
    if (!name || !name.trim()) return;
    setLoading(true);
    try {
      const p = await api.addPlayer(team.id, name.trim());
      // notify parent to refresh roster
      onChange?.({
        ...team,
        players: { ...team.players, [p.id]: p },
        roster: [...team.roster, p.id],
      });
      setEditingName("");
    } catch (err) {
      console.error("add player failed", err);
      // swallow - parent should show toast
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit(id: string, name: string) {
    if (!name || !name.trim()) return;
    setLoading(true);
    try {
      const p = await api.updatePlayer(team.id, id, { name: name.trim() });
      const nextPlayers = { ...team.players, [id]: p };
      onChange?.({ ...team, players: nextPlayers });
      setEditingId(null);
    } catch (err) {
      console.error("update player failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (
      !confirm("Deactivate this player? This preserves historical references.")
    )
      return;
    setLoading(true);
    try {
      const p = await api.deactivatePlayer(team.id, id);
      const nextPlayers = { ...team.players, [id]: p };
      onChange?.({ ...team, players: nextPlayers });
    } catch (err) {
      console.error("deactivate failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubstitute(oldId: string) {
    // ask for new player name or choose existing active player
    const name = prompt(
      "Enter replacement player's name (or leave empty to pick existing):",
    );
    if (name === null) return;
    setLoading(true);
    try {
      let replacementId: string | null = null;

      if (name.trim()) {
        // create new player synchronously via API
        const p = await api.addPlayer(team.id, name.trim());
        replacementId = p.id;
      } else {
        // pick existing: naive prompt for existing id
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

      // call onSubstitute to allow parent to handle match-state replacement
      if (onSubstitute) {
        await onSubstitute(oldId, replacementId);
      }

      // local update: add to roster if not present
      const nextRoster = team.roster.includes(replacementId)
        ? team.roster
        : [...team.roster, replacementId];
      onChange?.({
        ...team,
        players: {
          ...(team.players || {}),
          [replacementId]: (team.players || {})[replacementId] ?? {
            id: replacementId,
            name: name.trim(),
            active: true,
            createdAt: Date.now(),
          },
        },
        roster: nextRoster,
      });
    } catch (err) {
      console.error("substitute failed", err);
      alert("Substitution failed: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <header className="modal-header">
          <h3>Manage roster — {team.name}</h3>
          <button onClick={onClose}>Close</button>
        </header>

        <section className="modal-body">
          <ul>
            {playersArray.map((p) => (
              <li key={p.id} className="player-row">
                <div>
                  {editingId === p.id ? (
                    <>
                      <input defaultValue={p.name} id={`edit-${p.id}`} />
                      <button
                        onClick={() => {
                          const el = document.getElementById(
                            `edit-${p.id}`,
                          ) as HTMLInputElement;
                          handleSaveEdit(p.id, el?.value || p.name);
                        }}
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <strong>{p.name}</strong>
                      <span style={{ marginLeft: 8 }}>
                        {p.active === false ? " (inactive)" : ""}
                      </span>
                      <div className="player-actions">
                        <button onClick={() => setEditingId(p.id)}>Edit</button>
                        <button onClick={() => handleSubstitute(p.id)}>
                          Substitute
                        </button>
                        <button onClick={() => handleDeactivate(p.id)}>
                          Deactivate
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div className="meta">id: {p.id}</div>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 16 }}>
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
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-body {
          margin-top: 12px;
        }
        .player-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #eee;
        }
        .player-actions button {
          margin-left: 8px;
        }
      `}</style>
    </div>
  );
}
