import React, { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useLocation, useRoute } from "wouter";
import { motion } from "framer-motion";
// near other imports
import ManageRoster from "../components/ui/ManageRoster"; // adjust path if needed
import * as teamApi from "../api/teams";
import { commitSubstitutionToState } from "../lib/substitution";
import type { Team } from "../types";
import {
  ArrowLeft,
  Copy,
  Crown,
  Eye,
  RotateCcw,
  Share2,
  Shield,
  Trophy,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fetchMatchFromCloud, saveMatchToCloud, createMatchInCloud } from "../lib/cloudSync";

type Role = "admin" | "viewer";

type BallEventType =
  | "dot"
  | "run"
  | "wicket"
  | "wide"
  | "noball"
  | "bye"
  | "legbye";

type BallEvent = {
  id: string;
  ts: number;
  type: BallEventType;
  runs: number;
  countsBall: boolean;
  isWicket?: boolean;
  note?: string;
};
type SkinScore = {
  skin: number;
  grossRuns: number;
  wickets: number;
  netRuns: number;
  batters?: string[]; // <-- finishing pair (striker, non-striker) at skin
};

type Innings = {
  id: string;
  battingTeamId: string;
  bowlingTeamId: string;
  awaitingBatsmanSelection: boolean;

  runs: number;
  wickets: number;
  balls: number;
  deliveries: number; // total deliveries (legal + illegal)

  dotBalls: number;
  currentSkin: {
    grossRuns: number;
    wickets: number;
  };

  extras: {
    wide: number;
    noball: number;
    bye: number;
    legbye: number;
  };

  striker: string;
  nonStriker: string;
  bowler: string;
  allBalls: BallEvent[];

  bowlerBalls: Record<string, number>;
  lastOverBowler: string | null;
  overEvents: BallEvent[];
  lastOverSummary: BallEvent[];

  skinIndex: number;
  ballsInSkin: number;

  completedSkins: SkinScore[];

  // 👇 THESE THREE LINES ARE WHAT “Extend Innings” MEANS
  usedBatters: string[];
};

type SkinResult = {
  skin: number;
  teamId: "a" | "b";
  grossRuns: number;
  wickets: number;
  netRuns: number;
};

type MatchState = {
  version: number;
  matchId: string;
  createdAt: number;
  updatedAt: number;
  setupCompleted: boolean; // 👈 ADD THIS

  title: string;
  venue: string;

  teams: {
    a: { id: "a"; name: string; players: string[] };
    b: { id: "b"; name: string; players: string[] };
  };

  oversLimit: number;

  inningsIndex: number;
  innings: Innings[];

  status: "setup" | "live" | "innings_break" | "completed";

  // NEW: toss info
  tossWinner?: "a" | "b" | null;
  tossChoice?: "bat" | "bowl" | null;

  adminKey: string; // used only to gate UI locally + share link
  history: { snapshots: MatchState[] };
};

const STORAGE_PREFIX = "ic_scoring_match_v1:";
const MAX_BOWLER_BALLS = 12;
const TOTAL_SKINS = 4;

const WICKET_PENALTY = 5;

function computeInningsNet(inn?: Innings | null): number {
  if (!inn) return 0;
  const wickets = typeof inn.wickets === "number" ? inn.wickets : 0;
  const runs = typeof inn.runs === "number" ? inn.runs : 0;
  return runs - wickets * WICKET_PENALTY;
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatOvers(balls: number, oversLimit = 16) {
  const maxBalls = oversLimit * 6;
  const displayBalls = Math.min(balls, maxBalls);

  const o = Math.floor(displayBalls / 6);
  const b = displayBalls % 6;
  return `${o}.${b}`;
}

function computeSkinNet(
  innings: Innings | undefined,
  skinIndex: number,
): number | null {
  if (!innings) return null;

  const SKIN_BALLS = 24;
  const start = skinIndex * SKIN_BALLS;
  const end = start + SKIN_BALLS;

  // Build a FULL chronological ball list
  const allBalls: BallEvent[] = [
    ...innings.lastOverSummary,
    ...innings.overEvents,
  ];

  let net = 0;

  allBalls.slice(start, end).forEach((ev) => {
    net += ev.runs;
  });

  return net;
}

function getEventRuns(ev: any): number {
  return typeof ev.runs === "number" ? ev.runs : -5;
}

function totalExtras(extras: Innings["extras"]) {
  return extras.wide + extras.noball + extras.bye + extras.legbye;
}

function getLocalKey(matchId: string) {
  return `${STORAGE_PREFIX}${matchId}`;
}

function saveMatch(state: MatchState) {
  try {
    localStorage.setItem(getLocalKey(state.matchId), JSON.stringify(state));
  } catch {
    // ignore
  }
}

function loadMatch(matchId: string): MatchState | null {
  try {
    const raw = localStorage.getItem(getLocalKey(matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MatchState;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function defaultMatch(matchId?: string): MatchState {
  const id = matchId ?? uid("match");
  const adminKey = uid("admin");

  const baseInnings: Innings = {
    id: uid("inn"),
    battingTeamId: "a",
    bowlingTeamId: "b",
    bowlerBalls: {},
    runs: 0,
    dotBalls: 0,
    wickets: 0,
    balls: 0,
    deliveries: 0,
    extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },
    striker: "",
    nonStriker: "",
    bowler: "",
    overEvents: [],
    lastOverSummary: [],
    skinIndex: 0,
    ballsInSkin: 0,
    lastOverBowler: null,
    usedBatters: [],
    completedSkins: [],
    awaitingBatsmanSelection: false,

    allBalls: [],
    currentSkin: {
      grossRuns: 0,
      wickets: 0,
    },
  };

  const state: MatchState = {
    version: 1,
    matchId: id,
    createdAt: Date.now(),
    updatedAt: Date.now(),

    title: "Indoor Cricket",
    venue: "Court 1",

    teams: {
      a: { id: "a", name: "Team A", players: [] },
      b: { id: "b", name: "Team B", players: [] },
    },

    oversLimit: 16,

    inningsIndex: 0,
    innings: [baseInnings],

    // NEW: initial toss state
    tossWinner: null,
    tossChoice: null,

    status: "setup",
    setupCompleted: false,

    adminKey,
    history: { snapshots: [] },
  };

  return state;
}

function pushHistory(state: MatchState) {
  const snap = structuredClone(state);
  snap.history = { snapshots: [] };
  const next: MatchState = {
    ...state,
    history: {
      snapshots: [snap, ...state.history.snapshots].slice(0, 60),
    },
  };
  return next;
}

// --- ADD: helper (place after type definitions, top-level) ---
// Helper: return true if the last extra of `type` has a wicket recorded after it.
// This looks forward from the last extra and returns true if any later event is a wicket.
// (This is permissive — it treats a wicket appearing after the extra as "wicket on extra".)
function isExtraMarkedWicket(
  inn: Innings,
  type: "wide" | "noball" | "bye" | "legbye",
): boolean {
  const all = inn.allBalls ?? [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].type === type) {
      // If the extra event itself was marked as wicket (merged), show badge
      if (all[i].isWicket) return true;
      // Backwards-compatible: if the next event immediately after the extra was a wicket,
      // show badge too (handles older behavior where wicket was appended).
      if (all[i + 1]?.isWicket) return true;
      return false;
    }
  }
  return false;
}
// --- END helper ---

function applyBallEvent(inn: Innings, ev: BallEvent): Innings {
  const updatedCurrentSkin = {
    grossRuns: inn.currentSkin.grossRuns + ev.runs,
    wickets: inn.currentSkin.wickets + (ev.isWicket ? 1 : 0),
  };

  const next: Innings = {
    ...inn,
    runs: inn.runs + ev.runs,
    allBalls: [...inn.allBalls, ev],
    wickets: inn.wickets + (ev.isWicket ? 1 : 0),
    balls: inn.balls + (ev.countsBall ? 1 : 0),
    deliveries: inn.deliveries + 1,
    ballsInSkin: inn.ballsInSkin + (ev.countsBall ? 1 : 0),
    currentSkin: updatedCurrentSkin, // ✅ ADD THIS
    overEvents: [...inn.overEvents, ev],
    dotBalls: ev.type === "dot" ? inn.dotBalls + 1 : 0,
  };

  // Skin ends after 4 overs (24 balls)
  // Skin ends after 4 overs (24 balls)
  // Skin ends after 4 overs (24 balls)
  if (next.ballsInSkin === 24) {
    const completed = next.completedSkins ?? [];

    const skinNet =
      updatedCurrentSkin.grossRuns - updatedCurrentSkin.wickets * 5;

    // Capture finishing pair from the previous inn state (inn.striker / inn.nonStriker)
    const finishingPair = [inn.striker, inn.nonStriker].filter(
      Boolean,
    ) as string[];

    next.completedSkins = [
      ...completed,
      {
        skin: next.skinIndex + 1,
        grossRuns: updatedCurrentSkin.grossRuns,
        wickets: updatedCurrentSkin.wickets,
        netRuns: skinNet,
        batters: finishingPair, // <-- store finishing pair here
      },
    ];

    next.skinIndex += 1;
    next.ballsInSkin = 0;

    // ✅ RESET current skin for next skin
    next.currentSkin = { grossRuns: 0, wickets: 0 };
    // 🔴 FORCE skin break
    next.striker = "";
    next.nonStriker = "";

    // 🔒 lock previous batters
    next.usedBatters = [
      ...(next.usedBatters ?? []),
      inn.striker,
      inn.nonStriker,
    ].filter((b): b is string => Boolean(b));
  }

  if (ev.type === "wide")
    next.extras = { ...next.extras, wide: next.extras.wide + ev.runs };
  if (ev.type === "noball")
    next.extras = { ...next.extras, noball: next.extras.noball + ev.runs };
  if (ev.type === "bye")
    next.extras = { ...next.extras, bye: next.extras.bye + ev.runs };
  if (ev.type === "legbye")
    next.extras = { ...next.extras, legbye: next.extras.legbye + ev.runs };

  // Only mark the over as completed when a legal delivery has just
  // advanced the balls count to a multiple of 6. This avoids treating
  // wides/noballs (non-counting) that occur at the start of a new over
  // as the *last* over.
  const prevBalls = inn.balls;
  if (
    ev.countsBall && // this event counted as a legal ball
    prevBalls % 6 !== 0 && // previous balls were not already at a boundary
    next.balls % 6 === 0 && // now we've reached a multiple of 6 → over complete
    next.overEvents.length
  ) {
    next.lastOverSummary = next.overEvents;
    next.overEvents = [];

    // ✅ REQUIRED
    next.lastOverBowler = next.bowler;
  }

  // Track bowler balls (only legal balls)
  if (ev.countsBall) {
    const bowler = inn.bowler;
    const current = next.bowlerBalls[bowler] ?? 0;

    next.bowlerBalls = {
      ...next.bowlerBalls,
      [bowler]: current + 1,
    };
  }

  return next;
}

function eventLabel(ev: BallEvent) {
  if (ev.type === "wicket") return "W";
  if (ev.type === "dot") return "•";
  if (ev.type === "wide") return `Wd+${ev.runs}`;
  if (ev.type === "noball") return `Nb+${ev.runs}`;
  if (ev.type === "bye") return `B+${ev.runs}`;
  if (ev.type === "legbye") return `Lb+${ev.runs}`;
  return `${ev.runs}`;
}

function pillTone(ev: BallEvent) {
  if (ev.type === "wicket") return "bg-destructive text-destructive-foreground";
  if (ev.type === "wide" || ev.type === "noball")
    return "bg-accent text-accent-foreground";
  if (ev.type === "dot") return "bg-secondary text-secondary-foreground";
  if (ev.runs >= 4) return "bg-primary text-primary-foreground";
  return "bg-card text-foreground border";
}

function getQueryParam(search: string, key: string) {
  const params = new URLSearchParams(
    search.startsWith("?") ? search : `?${search}`,
  );
  return params.get(key);
}

function setQueryParam(search: string, key: string, value: string | null) {
  const params = new URLSearchParams(
    search.startsWith("?") ? search : `?${search}`,
  );
  if (value === null) params.delete(key);
  else params.set(key, value);
  const next = params.toString();
  return next ? `?${next}` : "";
}

function getOrigin() {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

function buildViewerLink(matchId: string) {
  // use the same route this page is mounted on
  return `${getOrigin()}/match/${encodeURIComponent(matchId)}?mode=viewer`;
}

function buildAdminLink(matchId: string, adminKey: string) {
  return `${getOrigin()}/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`;
}

// Helper: returns true if, after assigning `candidateBowlerId` to the current upcoming over,
// the remaining overs can be scheduled given max 2 overs per player and no-consecutive rule.
function canCompleteRemainingOvers(
  inn: Innings,
  bowlingPlayers: string[],
  candidateBowlerId: string,
  oversLimit: number,
): boolean {
  if (!inn) return true;

  const completedOvers = Math.floor((inn.balls ?? 0) / 6);
  const remainingOversTotal = Math.max(0, oversLimit - completedOvers);

  // If there are no remaining overs or only one (the current), always OK
  if (remainingOversTotal <= 1) return true;

  // Build capacities: how many overs each player can still bowl (2 - oversAlready)
  const caps: Record<string, number> = {};
  for (const p of bowlingPlayers) {
    const balls = inn.bowlerBalls?.[p] ?? 0;
    const oversBowled = Math.floor(balls / 6);
    caps[p] = Math.max(0, 2 - oversBowled);
  }

  // Ensure candidate present in caps map
  if (!(candidateBowlerId in caps)) caps[candidateBowlerId] = 0;

  // Assign candidate for the current over => decrement their capacity
  caps[candidateBowlerId] = Math.max(0, caps[candidateBowlerId] - 1);

  // Determine the bowler of the most recent completed over (lastOverBowler) if available.
  // This is the bowler who bowled the last finished over before the upcoming one.
  let prevUsed: string | null = inn.lastOverBowler ?? null;

  // After we assign candidate to the *current* over, the "previous" for the next slot becomes candidate.
  prevUsed = candidateBowlerId;

  // We need to schedule the remainingOversTotal - 1 further overs (after the current one)
  let slots = remainingOversTotal - 1;

  // Greedy simulation: at each slot pick any player with cap>0 and != prevUsed.
  // This is sufficient for feasibility check for small counts (and typical cricket constraints).
  const capMap: Record<string, number> = { ...caps };

  for (let s = 0; s < slots; s++) {
    let chosen: string | null = null;
    let bestCap = 0;
    for (const p of bowlingPlayers) {
      const c = capMap[p] ?? 0;
      if (p === prevUsed) continue; // cannot bowl consecutive overs
      if (c > bestCap) {
        bestCap = c;
        chosen = p;
      }
    }

    if (!chosen || bestCap <= 0) {
      // no eligible player to fill this slot → infeasible
      return false;
    }

    // consume one capacity and mark chosen as last used
    capMap[chosen] = capMap[chosen] - 1;
    prevUsed = chosen;
  }

  // All remaining slots filled → feasible
  return true;
}

function ScoringApp() {
  console.log("🚀 ScoringApp rendered");
  const { toast } = useToast();
  const [, params] = useRoute<{ matchId: string }>("/match/:matchId");
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"controls" | "players" | "match">(
    "controls",
  );

  const matchIdFromRoute = params ? params.matchId : null;
  const url = useMemo(() => {
    if (typeof window === "undefined") {
      return new URL(`http://localhost${location ?? ""}`);
    }
    return new URL(window.location.href);
  }, [location]);

  const [isRosterOpen, setRosterOpen] = useState(false);

  const roleFromUrl =
    (getQueryParam(url.search, "mode") as Role | null) ?? "admin";
  // Keep the admin key from the URL stable across renders.
  // (In some cases wouter's location updates can cause search parsing to momentarily drop values.)
  const [keyFromUrl] = useState<string | null>(() => getQueryParam(url.search, "key"));
  const isExplicitAdminRequest = roleFromUrl === "admin";

  const [state, setState] = useState<MatchState>(() => {
    const matchId = matchIdFromRoute ?? "default";
    const stored = loadMatch(matchId);
    const seed =
      stored ?? defaultMatch(matchId === "default" ? undefined : matchId);
    return seed;
  });

  // Resolve role/isAdmin early so effects can depend on it
  // IMPORTANT: the URL `key` is the match adminKey. We verify it against the loaded state.
  const role: Role = useMemo(() => {
    if (roleFromUrl === "viewer") return "viewer";
    if (!keyFromUrl) return "viewer";
    return keyFromUrl === state.adminKey ? "admin" : "viewer";
  }, [roleFromUrl, keyFromUrl, state.adminKey]);
  const isAdmin = role === "admin";
  const needsAdminLink = isExplicitAdminRequest && !isAdmin;

  // For cloud operations, use the URL key when present (admin link).
  // This is the only key the server can validate. Falling back to state.adminKey
  // supports freshly-created local matches before we navigate.
  const adminKeyForCloud = keyFromUrl ?? state.adminKey;

  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >(matchIdFromRoute ? "loading" : "idle");
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const lastCloudSavedAtRef = useRef<number>(0);
  const cloudSaveTimerRef = useRef<any>(null);

  // Load from cloud once when opening a match link (device handoff)
  useEffect(() => {
    if (!matchIdFromRoute) return;
    let cancelled = false;

    (async () => {
      try {
        setCloudSyncStatus("loading");
        setCloudSyncError(null);

        const cloud = await fetchMatchFromCloud(matchIdFromRoute);
        if (cancelled) return;

        if (cloud) {
          // Prefer cloud version for handoff. Also persist locally.
          setState(cloud as any);
          try {
            saveMatch(cloud as any);
          } catch {
            // ignore
          }
          setCloudSyncStatus("saved");
          lastCloudSavedAtRef.current = Date.now();
        } else {
          // No cloud state yet; keep local seed.
          setCloudSyncStatus("idle");
        }
      } catch (e: any) {
        if (cancelled) return;
        setCloudSyncStatus("error");
        setCloudSyncError(e?.message ?? "Cloud load failed");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIdFromRoute]);

  // Always-on cloud save for admins (debounced)
  useEffect(() => {
    if (!matchIdFromRoute) return;

    // Only admins should push changes to cloud.
    if (!isAdmin) return;

    if (!state?.matchId) return;

    // Don’t attempt cloud save before we’ve resolved initial load.
    if (cloudSyncStatus === "loading") return;

    if (cloudSaveTimerRef.current) {
      clearTimeout(cloudSaveTimerRef.current);
    }

    cloudSaveTimerRef.current = setTimeout(async () => {
      try {
        setCloudSyncStatus("saving");
        setCloudSyncError(null);

        const saved = await saveMatchToCloud(matchIdFromRoute, state, adminKeyForCloud);

        // Keep local state aligned with server-touched fields (updatedAt)
        setState(saved as any);
        setCloudSyncStatus("saved");
        lastCloudSavedAtRef.current = Date.now();
      } catch (e: any) {
        setCloudSyncStatus("error");
        setCloudSyncError(e?.message ?? "Cloud save failed");
      }
    }, 1200);

    return () => {
      if (cloudSaveTimerRef.current) {
        clearTimeout(cloudSaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, matchIdFromRoute, isAdmin, adminKeyForCloud, cloudSyncStatus]);

  // Near-realtime viewer updates: poll cloud state every 2s and apply if newer
  useEffect(() => {
    if (!matchIdFromRoute) return;
    if (isAdmin) return; // admins are the source of truth; don’t pull while editing

    // Don’t poll while the initial load is in flight
    if (cloudSyncStatus === "loading") return;

    let cancelled = false;
    const intervalMs = 2000;

    const tick = async () => {
      try {
        const cloud = await fetchMatchFromCloud(matchIdFromRoute);
        if (cancelled || !cloud) return;

        const cloudUpdatedAt = typeof (cloud as any).updatedAt === "number" ? (cloud as any).updatedAt : 0;
        const localUpdatedAt = typeof (state as any).updatedAt === "number" ? (state as any).updatedAt : 0;

        // Only apply when cloud is strictly newer
        if (cloudUpdatedAt > localUpdatedAt) {
          setState(cloud as any);
          try {
            saveMatch(cloud as any);
          } catch {
            // ignore
          }
        }
      } catch {
        // best-effort: ignore polling errors
      }
    };

    // run once immediately, then poll
    tick();
    const id = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIdFromRoute, isAdmin, cloudSyncStatus, state.updatedAt]);

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const wicketLockRef = useRef(false);

  // now derive the currently batting team id and team object AFTER `state` is declared
  const currentInn = state.innings?.[state.inningsIndex];
  const currentBattingTeamId =
    currentInn?.battingTeamId ??
    (currentInn as any)?.battingTeam ??
    (currentInn as any)?.batting; // legacy keys

  const teamObj = useMemo(() => {
    if (!currentBattingTeamId) return null;
    // adjust to your actual team storage — likely under state.teams or state.teamsMap
    const teamsStore = (state as any).teams ?? (state as any).teamsMap ?? {};
    const t = teamsStore[currentBattingTeamId];
    if (!t) return null;

    return {
      id: t.id ?? currentBattingTeamId,
      name: t.name ?? t.displayName ?? `Team ${currentBattingTeamId}`,
      roster: t.roster ?? Object.keys(t.players ?? {}),
      players: t.players ?? {},
    };
  }, [state, currentBattingTeamId]);
  // Toss UI local state (place immediately after your `state` useState)
  const [tossWinnerSel, setTossWinnerSel] = useState<"a" | "b" | "">(
    state.tossWinner ?? "",
  );
  const [tossChoiceSel, setTossChoiceSel] = useState<"bat" | "bowl" | "">(
    state.tossChoice ?? "",
  );

  // Keep local selects in sync when state is loaded/restored
  useEffect(() => {
    setTossWinnerSel(state.tossWinner ?? "");
    setTossChoiceSel(state.tossChoice ?? "");
  }, [state.tossWinner, state.tossChoice]);

  function applyToss() {
    if (!tossWinnerSel || !tossChoiceSel) {
      toast({
        title: "Select toss and choice",
        description:
          "Pick who won the toss and whether they choose to bat or bowl.",
        variant: "destructive",
      });
      return;
    }

    const winner = tossWinnerSel as "a" | "b";
    const choice = tossChoiceSel as "bat" | "bowl";

    // Determine which team bats first
    const battingTeamId =
      choice === "bat" ? winner : winner === "a" ? "b" : "a";
    const bowlingTeamId = battingTeamId === "a" ? "b" : "a";

    // Update only the team IDs for the current innings (do NOT preselect players)
    const innings = [...state.innings];
    const inn = { ...innings[state.inningsIndex] };

    inn.battingTeamId = battingTeamId;
    inn.bowlingTeamId = bowlingTeamId;

    // Do not change inn.striker / inn.nonStriker / inn.bowler here.
    // Leave player selection to the scorer on the Players tab.

    innings[state.inningsIndex] = inn;

    safeSet(
      pushHistory({
        ...state,
        innings,
        tossWinner: winner,
        tossChoice: choice,
      }),
    );

    toast({
      title: "Toss applied",
      description: `${state.teams[winner].name} won the toss and chose to ${choice}.`,
    });
  }
  // add inside ScoringApp component, after `const [state, setState] = useState(...)`
  useEffect(() => {
    (window as any).__appState = state;
    return () => {
      delete (window as any).__appState;
    };
  }, [state]);

  const currentInnings = state.innings[state.inningsIndex];
  // DEBUG: log last events and expose current innings to the page console.
  // Remove this after debugging.

  // DEBUG (temporary): expose current innings & last events to window for investigation.
  // Paste this immediately after `const currentInnings = state.innings[state.inningsIndex];`
  useEffect(() => {
    (window as any).__CURRENT_INNINGS__ = currentInnings;
    (window as any).__ALLBALLS__ = currentInnings.allBalls;
    console.log(
      "DEBUG: exposed __CURRENT_INNINGS__ and __ALLBALLS__ (remove after debugging)",
    );
  }, [currentInnings.allBalls?.length]);
  useEffect(() => {
    console.log("DEBUG allBalls (last 6):", currentInnings.allBalls?.slice(-6));
    // expose for interactive inspection in DevTools:
    (window as any).__CURRENT_INNINGS__ = currentInnings;
    (window as any).__ALLBALLS__ = currentInnings.allBalls;
  }, [currentInnings.allBalls?.length]);
  const isEndOfOver =
    currentInnings.balls > 0 && currentInnings.balls % 6 === 0;
  const isAtOverBreak =
    currentInnings.balls > 0 &&
    currentInnings.balls % 6 === 0 &&
    currentInnings.overEvents.length === 0;

  const needsBowlerSelection =
    currentInnings.balls > 0 &&
    currentInnings.balls % 6 === 0 &&
    !currentInnings.bowler;

  // Track balls bowled per bowler (current innings)
  const bowlerBalls: Record<string, number> = useMemo(() => {
    const inn = state.innings[state.inningsIndex];
    return inn.bowlerBalls ?? {};
  }, [state.innings, state.inningsIndex]);

  // derive current batting team id (already present earlier as currentBattingTeamId)
  const currentTeam = state.teams?.[currentBattingTeamId];
  // resilient battingPlayers
  const battingPlayers: string[] = useMemo(() => {
    if (!currentInnings) return [];

    const battingTeamId = currentInnings.battingTeamId;
    if (!battingTeamId) return [];

    const team = state.teams?.[battingTeamId];
    if (!team) return [];

    // 1) if roster exists and is an array, use it (ordered)
    if (Array.isArray(team.roster) && team.roster.length) return team.roster;

    // 2) if players is an array (legacy shape), use it as roster
    if (Array.isArray(team.players) && team.players.length) return team.players;

    // 3) if players is an object/map, prefer roster if present else keys of map
    if (
      team.players &&
      !Array.isArray(team.players) &&
      typeof team.players === "object"
    ) {
      const playersMap = team.players as Record<string, any>;
      return team.roster && team.roster.length
        ? team.roster
        : Object.keys(playersMap);
    }

    return [];
  }, [currentInnings?.battingTeamId, state.teams]);

  // resilient bowlingPlayers
  const bowlingPlayers: string[] = useMemo(() => {
    if (!currentInnings) return [];

    const bowlingTeamId = currentInnings.bowlingTeamId;
    if (!bowlingTeamId) return [];

    const team = state.teams?.[bowlingTeamId];
    if (!team) return [];

    if (Array.isArray(team.roster) && team.roster.length) return team.roster;
    if (Array.isArray(team.players) && team.players.length) return team.players;
    if (
      team.players &&
      !Array.isArray(team.players) &&
      typeof team.players === "object"
    ) {
      const playersMap = team.players as Record<string, any>;
      return team.roster && team.roster.length
        ? team.roster
        : Object.keys(playersMap);
    }

    return [];
  }, [currentInnings?.bowlingTeamId, state.teams]);
  const usedBatters = new Set<string>(currentInnings.usedBatters ?? []);

  const bowlerOvers = currentInnings.bowlerBalls ?? {};

  const isSkinLocked = currentInnings.ballsInSkin > 0;
  const isMatchCompleted = state.status === "completed";

  // ✅ Find bowlers who can still legally bowl (less than 2 overs)
  const availableBowlers = bowlingPlayers.filter((p) => {
    const balls = bowlerBalls[p] ?? 0;
    const overs = Math.floor(balls / 6);
    return overs < 2;
  });

  // ✅ If more than 1 available, we must enforce "no consecutive overs"
  const hasAlternativeBowler = availableBowlers.length > 1;

  // 🚦 Over break: over completed but new bowler not selected
  const isOverBreak =
    currentInnings.balls > 0 &&
    currentInnings.balls % 6 === 0 &&
    !currentInnings.bowler;

  // 🚦 Skin break: 4 overs completed, new batters not selected yet
  const isSkinBreak =
    currentInnings.completedSkins.length > 0 &&
    (!currentInnings.striker || !currentInnings.nonStriker);

  useEffect(() => {
    if (isSkinBreak) {
      setActiveTab("controls");
    }
  }, [isSkinBreak]);

  // 🔒 Batter selection allowed only at skin start
  const isBatterSelectionLocked = currentInnings.ballsInSkin > 0;

  // 🔒 Bowler selection locked during middle of over
  const isBowlerSelectionLocked =
    currentInnings.balls > 0 && currentInnings.balls % 6 !== 0;

  const matchCompleted =
    state.status === "completed" ||
    (state.inningsIndex === 1 &&
      state.innings[1]?.balls >= state.oversLimit * 6);

  const matchEnded =
    state.status === "completed" ||
    (state.inningsIndex === 1 &&
      currentInnings.completedSkins.length === TOTAL_SKINS);
  const controlsDisabled = matchEnded || state.status === "completed";

  const isReadyToScore =
    !!currentInnings.striker &&
    !!currentInnings.nonStriker &&
    !!currentInnings.bowler &&
    !isOverBreak &&
    !isSkinBreak &&
    state.status === "live" &&
    !controlsDisabled;

  const startResumeDisabled =
    !isAdmin || // only admin can start/resume
    controlsDisabled || // block after match end
    !state.setupCompleted || // cannot start before setup
    (state.status === "live" && !isReadyToScore);

  const nextInningsDisabled =
    !isAdmin ||
    controlsDisabled || // prevents next innings after match end
    !state.setupCompleted ||
    isOverBreak ||
    isSkinBreak ||
    matchCompleted;

  // Compute net totals per team (safely handle variable innings order)
  const teamNetTotals = useMemo(() => {
    const totals: { a: number; b: number } = { a: 0, b: 0 };

    for (const inn of state.innings) {
      if (!inn) continue;
      // use the same net calculation you use elsewhere (runs - wickets*penalty)
      const net = inn.runs - (inn.wickets ?? 0) * WICKET_PENALTY;
      if (inn.battingTeamId === "a") totals.a += net;
      else if (inn.battingTeamId === "b") totals.b += net;
    }

    return totals;
  }, [state.innings]);

  let matchResult = "";

  // Only show a result when the match has ended
  if (matchEnded) {
    if (teamNetTotals.a > teamNetTotals.b) {
      matchResult = `${state.teams.a.name} won`;
    } else if (teamNetTotals.b > teamNetTotals.a) {
      matchResult = `${state.teams.b.name} won`;
    } else {
      matchResult = "Match tied";
    }
  }

  const isNewOver = currentInnings.balls > 0 && currentInnings.balls % 6 === 0;

  const targetText = useMemo(() => {
    if (state.inningsIndex === 1) {
      const first = state.innings[0];
      return `Target: ${first.runs + 1}`;
    }
    return "";
  }, [state.inningsIndex, state.innings]);

  // --- locate the existing matchStatusText useMemo and replace it with this improved mapping ---
  const matchStatusText = useMemo(() => {
    // Setup not completed yet → “Not started”
    if (state.status === "setup") {
      // if setupCompleted is a flag in your state that indicates the match has been configured,
      // show a slightly different message once setup has been completed.
      return state.setupCompleted ? "Ready to start" : "Not started";
    }
    if (state.status === "live") return "Live";
    if (state.status === "innings_break") return "Innings break";
    return "Match completed";
  }, [state.status, state.setupCompleted]);

  // --- later in JSX, replace the match summary text block with this single line ---
  // (Find the current location that shows "Match completed" / "Match in progress". Replace it)
  useEffect(() => {
    const next: MatchState = { ...state, updatedAt: Date.now() };
    saveMatch(next);
  }, [state]);

  useEffect(() => {
    if (!matchIdFromRoute) {
      const next = `/match/${encodeURIComponent(state.matchId)}${url.search}`;
      setLocation(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIdFromRoute, state.matchId]);

  function safeSet(next: MatchState) {
    setState({ ...next, updatedAt: Date.now() });
  }

  function startMatch() {
    safeSet({ ...pushHistory(state), status: "live" });
  }

  function resetMatch() {
    const base = state.innings[0];

    const resetInnings: Innings = {
      ...base,
      runs: 0,
      wickets: 0,
      balls: 0,
      dotBalls: 0,
      extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },
      overEvents: [],
      lastOverSummary: [],
      skinIndex: 0,
      ballsInSkin: 0,
      lastOverBowler: null,
      awaitingBatsmanSelection: false,

      bowlerBalls: {},
      allBalls: [],
      currentSkin: {
        grossRuns: 0,
        wickets: 0,
      },
      completedSkins: [],
    };

    safeSet(
      pushHistory({
        ...state,
        inningsIndex: 0,
        innings: [resetInnings],
        status: "setup",
        setupCompleted: true, // 🔒 KEEP LOCKED
      }),
    );

    toast({
      title: "Score reset",
      description: "Match restarted with same teams and players.",
    });
  }

  function confirmMatchSetup() {
    safeSet(
      pushHistory({
        ...state,
        setupCompleted: true,
      }),
    );

    toast({
      title: "Match setup confirmed",
      description: "Teams and players saved. You can start scoring.",
    });
  }

  function startNewMatch() {
    (async () => {
      try {
        const created = await createMatchInCloud();
        // Navigate using a relative path so wouter manages it.
        const nextPath = created.adminUrl.replace(window.location.origin, "");
        setLocation(nextPath, { replace: true });
        toast({
          title: "New match created",
          description: "Share the viewer link for spectators.",
        });
      } catch (e: any) {
        toast({
          title: "Couldn’t create match",
          description: e?.message || "Please try again.",
          variant: "destructive",
        } as any);
      }
    })();
  }

  function undo() {
    const [latest, ...rest] = state.history.snapshots;
    if (!latest) return;

    // 🔒 Do NOT allow undoing match setup confirmation
    if (state.setupCompleted && !latest.setupCompleted) {
      toast({
        title: "Undo not allowed",
        description: "Match setup is locked after confirmation.",
        variant: "destructive",
      });
      return;
    }

    safeSet({
      ...latest,
      history: { snapshots: rest },
      updatedAt: Date.now(),
    });
  }

    function setTeams(a: string, b: string) {
    safeSet(
      pushHistory({
        ...state,
        teams: {
          a: { id: "a", name: a, players: state.teams.a.players },
          b: { id: "b", name: b, players: state.teams.b.players },
        },
      }),
    );
    }

  function setMeta(title: string, venue: string) {
    safeSet(pushHistory({ ...state, title, venue }));
  }

  function setPlayers(
    strikerId: string | "",
    nonStrikerId: string | "",
    bowlerId: string | "",
  ) {
    const inn = state.innings[state.inningsIndex];
    const updated: Innings = {
      ...inn,
      striker: strikerId || undefined,
      nonStriker: nonStrikerId || undefined,
      bowler: bowlerId || undefined,
    };
    const innings = [...state.innings];
    innings[state.inningsIndex] = updated;
    safeSet({ ...state, innings });
  }

  function swapBatters() {
    const inn = state.innings[state.inningsIndex];
    setPlayers(inn.nonStriker, inn.striker, inn.bowler);
  }

  function toggleTeamsForNextInnings() {
    // DEFENSIVE: block this action if the match has already ended/completed
    if (controlsDisabled || state.status === "completed" || matchEnded) {
      toast({
        title: "Action blocked",
        description: "Cannot start next innings after the match is finished.",
        variant: "destructive",
      });
      return;
    }

    const prev = state.innings[state.inningsIndex];

    // Safety guard: only allow transition when innings has actually completed
    const oversLimit = clamp(state.oversLimit ?? 16, 1, 50);
    const oversCompleted = Math.floor(prev.balls / 6) >= oversLimit;
    const skinsCompleted = (prev.completedSkins?.length ?? 0) >= TOTAL_SKINS;

    if (!oversCompleted && !skinsCompleted) {
      toast({
        title: "Cannot start next innings",
        description:
          "Current innings has not yet reached the overs limit or completed all skins.",
        variant: "destructive",
      });
      return;
    }

    const nextInnings: Innings = {
      id: uid("inn"),

      // 🔁 SWAP TEAMS
      battingTeamId: prev.bowlingTeamId,
      bowlingTeamId: prev.battingTeamId,

      runs: 0,
      wickets: 0,
      balls: 0,
      dotBalls: 0,
      awaitingBatsmanSelection: false,

      extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },

      striker: "",
      nonStriker: "",
      bowler: "",
      deliveries: 0,
      usedBatters: [],

      overEvents: [],
      lastOverSummary: [],
      allBalls: [], // ✅ REQUIRED

      // 🔁 RESET SKIN STATE
      skinIndex: 0,
      ballsInSkin: 0,
      currentSkin: {
        grossRuns: 0,
        wickets: 0,
      },
      completedSkins: [],

      // 🔁 RESET BOWLING STATE
      bowlerBalls: {},
      lastOverBowler: null,
    };

    safeSet(
      pushHistory({
        ...state,
        innings: [...state.innings, nextInnings],
        inningsIndex: state.inningsIndex + 1,
        status: "live",
      }),
    );
  }

  function endInnings() {
    const inn = state.innings[state.inningsIndex];

    // Safety guard: only allow ending innings when it has completed the overs or all skins
    const oversLimit = clamp(state.oversLimit ?? 16, 1, 50);
    const oversCompleted = Math.floor(inn.balls / 6) >= oversLimit;
    const skinsCompleted = (inn.completedSkins?.length ?? 0) >= TOTAL_SKINS;

    if (!oversCompleted && !skinsCompleted) {
      toast({
        title: "Cannot end innings",
        description:
          "Current innings has not reached the overs limit or completed all skins. Finish the final legal delivery (or complete all skins) before ending the innings.",
        variant: "destructive",
      });
      return;
    }

    safeSet(pushHistory({ ...state, status: "innings_break" }));
  }

  function addEvent(ev: BallEvent) {
    const currentInn = state.innings[state.inningsIndex];

    if (!isReadyToScore) {
      toast({
        title: "Select players first",
        description:
          "Please select striker, non-striker, and bowler before scoring.",
        variant: "destructive",
      });
      return;
    }

    // 🚫 Require bowler selection at start of every new over
    const isStartOfNewOver = currentInn.balls > 0 && currentInn.balls % 6 === 0;

    if (isStartOfNewOver && !currentInn.bowler) {
      toast({
        title: "Select bowler",
        description: "Please select a bowler to continue the next over.",
        variant: "destructive",
      });
      return;
    }

    // 🚫 Prevent same bowler bowling consecutive overs
    if (
      isStartOfNewOver &&
      currentInn.lastOverBowler &&
      currentInn.bowler === currentInn.lastOverBowler &&
      hasAlternativeBowler
    ) {
      toast({
        title: "Invalid bowler",
        description:
          "Same bowler cannot bowl consecutive overs. Please select a different bowler.",
        variant: "destructive",
      });
      return;
    }

    // 🚫 Block scoring if batters not selected
    if (!currentInn.striker || !currentInn.nonStriker) {
      toast({
        title: "Select batters",
        description: "Please select striker and non-striker to continue.",
        variant: "destructive",
      });
      return;
    }
    // 🚫 BLOCK scoring if bowler not selected
    if (!currentInn.bowler) {
      toast({
        title: "Select bowler",
        description: "Please select a bowler to continue scoring.",
        variant: "destructive",
      });
      return;
    }
    // Bowling validation (already working)

    if (ev.countsBall) {
      const bowler = currentInn.bowler;
      const ballsBowled = currentInn.bowlerBalls[bowler] ?? 0;

      if (ballsBowled >= 12) {
        toast({
          title: "Bowling limit reached",
          description: `${bowler} has already bowled 2 overs.`,
          variant: "destructive",
        });
        return;
      }
    }
    // 🚫 Skin transition check (4 overs = 24 balls)
    const isSkinComplete =
      currentInn.ballsInSkin === 0 &&
      currentInn.skinIndex > 0 &&
      !currentInn.striker &&
      !currentInn.nonStriker;

    if (isSkinComplete) {
      toast({
        title: "Select batters",
        description: "Choose striker and non-striker for the new skin.",
        variant: "destructive",
      });
      return;
    }

    const withHistory = pushHistory(state);
    const historyInn = withHistory.innings[withHistory.inningsIndex];

    const updatedInn = applyBallEvent(historyInn, ev);

    // 🏁 END OF MATCH (2nd innings completed)
    if (
      state.inningsIndex === 1 &&
      updatedInn.completedSkins.length === TOTAL_SKINS
    ) {
      const innings = [...withHistory.innings];
      innings[withHistory.inningsIndex] = updatedInn;

      safeSet({
        ...withHistory,
        innings,
        status: "completed",
      });

      toast({
        title: "Match completed",
        description: "All skins completed. Result finalized.",
      });

      return;
    }

    // 🏁 End innings AFTER final skin is completed

    if (
      updatedInn.completedSkins.length === TOTAL_SKINS &&
      state.inningsIndex === 0
    ) {
      toast({
        title: "Innings completed",
        description: "All skins completed. Switching teams.",
      });

      // Apply updatedInn into the history state and atomically create the next innings
      const innings = [...withHistory.innings];
      innings[withHistory.inningsIndex] = updatedInn;

      const prev = updatedInn;
      const nextInnings: Innings = {
        id: uid("inn"),

        // 🔁 SWAP TEAMS
        battingTeamId: prev.bowlingTeamId,
        bowlingTeamId: prev.battingTeamId,

        runs: 0,
        wickets: 0,
        balls: 0,
        dotBalls: 0,
        awaitingBatsmanSelection: false,

        extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },

        striker: "",
        nonStriker: "",
        bowler: "",
        deliveries: 0,
        usedBatters: [],

        overEvents: [],
        lastOverSummary: [],
        allBalls: [],

        // 🔁 RESET SKIN STATE
        skinIndex: 0,
        ballsInSkin: 0,
        currentSkin: {
          grossRuns: 0,
          wickets: 0,
        },
        completedSkins: [],

        // 🔁 RESET BOWLING STATE
        bowlerBalls: {},
        lastOverBowler: null,
      };

      safeSet(
        pushHistory({
          ...withHistory,
          innings: [...innings, nextInnings],
          inningsIndex: withHistory.inningsIndex + 1,
          status: "live",
        }),
      );

      return;
    }

    // ✅ Detect end of over
    const isEndOfOver = ev.countsBall && updatedInn.balls % 6 === 0;

    const finalInn: Innings = {
      ...updatedInn,

      // 🔒 PRESERVE used batters across state rebuilds
      usedBatters: updatedInn.usedBatters ?? historyInn.usedBatters ?? [],

      lastOverBowler: isEndOfOver
        ? historyInn.bowler
        : historyInn.lastOverBowler,

      bowler: isEndOfOver ? "" : updatedInn.bowler,
    };

    const innings = [...withHistory.innings];
    innings[withHistory.inningsIndex] = finalInn;

    safeSet({ ...withHistory, innings, status: "live" });
  }

  function addRun(runs: number) {
    if (!isReadyToScore) {
      toast({
        title: "Select players first",
        description:
          "Please select striker, non-striker, and bowler before scoring.",
        variant: "destructive",
      });
      return;
    }

    const inn = state.innings[state.inningsIndex];

    if (runs === 0) {
      const nextDotCount = inn.dotBalls + 1;

      if (nextDotCount === 3) {
        addEvent({
          id: uid("ball"),
          ts: Date.now(),
          type: "wicket",
          runs: 0,
          countsBall: true,
          isWicket: true,
          note: "Auto OUT (3 dot balls)",
        });
        return;
      }

      addEvent({
        id: uid("ball"),
        ts: Date.now(),
        type: "dot",
        runs: 0,
        countsBall: true,
      });
      return;
    }

    addEvent({
      id: uid("ball"),
      ts: Date.now(),
      type: "run",
      runs,
      countsBall: true,
    });
  }

  // --- REPLACE: addWicket() ---
  // --- REPLACE / ADD: addWicket() ---
  // Paste this function inside the ScoringApp component where your current addWicket()
  // implementation lives (it uses `state`, `pushHistory`, `addEvent`, `uid`, `toast` and a
  // state setter - try `setState` or `safeSet` depending on your codebase).
  //
  // If your component uses a different state setter name, replace `setState`/`safeSet` with
  // the correct one (e.g. `setMatchState`, `setAppState`, etc.).
  // --- ADD / REPLACE inside ScoringApp component ---
  // 1) Merge wicket into the last extra of the given type (used by the inline W on extra cards)
  // inside ScoringApp: merge wicket into last extra (no appends)
  function addWicketOnExtra(type: "wide" | "noball" | "bye" | "legbye") {
    if (wicketLockRef.current) return;
    wicketLockRef.current = true;
    setTimeout(() => (wicketLockRef.current = false), 350);

    if (!isAdmin || !state.setupCompleted) {
      toast({
        title: "Cannot record wicket",
        description: "Make sure scoreboard is ready and you are the scorer.",
        variant: "destructive",
      });
      return;
    }

    const innIndex = state.inningsIndex;
    const inn = state.innings[innIndex];
    const all = inn.allBalls ?? [];
    const last = all[all.length - 1];

    if (!last) {
      toast({
        title: "No delivery",
        description: "No events recorded to attach wicket to.",
        variant: "destructive",
      });
      return;
    }

    const extraMatches =
      last.type === type || (type === "bye" && last.type === "legbye");
    if (!extraMatches) {
      toast({
        title: "Cannot attach wicket",
        description: `The last event is not a ${type}. Use the W button on that extra immediately after recording it.`,
        variant: "destructive",
      });
      return;
    }

    if (last.isWicket || last.type === "wicket") {
      toast({
        title: "Wicket already present",
        description: "This delivery already has a wicket.",
        variant: "destructive",
      });
      return;
    }

    // MERGE: mark the existing extra event as wicket but DO NOT change runs.
    const mergedEvent: BallEvent = {
      ...last,
      isWicket: true,
      note: last.note ? `${last.note} • Wicket on extra` : "Wicket on extra",
      id: last.id,
    };

    // --- REPLACE the previous updatedInn construction with this robust version ---
    // (use this in addWicketOnExtra and addWicketToLastByeOrLegbye)

    const withHistory = pushHistory(state);
    const prevInn = withHistory.innings[innIndex];

    // Decide which array contained the last event and replace it there
    const prevOverEvents = prevInn.overEvents ?? [];
    const prevLastOverSummary = prevInn.lastOverSummary ?? [];

    // helper to find by id
    const findIndexById = (arr: BallEvent[], id: string) =>
      arr ? arr.findIndex((ev) => ev.id === id) : -1;

    const idxInOver = findIndexById(prevOverEvents, last.id);
    const idxInLastOver = findIndexById(prevLastOverSummary, last.id);

    let newOverEvents: BallEvent[] = [...prevOverEvents];
    let newLastOverSummary: BallEvent[] = [...prevLastOverSummary];

    // Replace in the correct container
    if (idxInOver >= 0) {
      // last event was in current overEvents
      newOverEvents = [
        ...prevOverEvents.slice(0, idxInOver),
        mergedEvent,
        ...prevOverEvents.slice(idxInOver + 1),
      ];
    } else if (idxInLastOver >= 0) {
      // last event was in lastOverSummary (previously completed over)
      newLastOverSummary = [
        ...prevLastOverSummary.slice(0, idxInLastOver),
        mergedEvent,
        ...prevLastOverSummary.slice(idxInLastOver + 1),
      ];
    } else {
      // fallback: replace the last item of overEvents (previous behavior)
      newOverEvents = [...prevOverEvents.slice(0, -1), mergedEvent];
    }

    // Recompute runs/wickets/currentSkin consistently (mergedEvent.runs equals last.runs for extra merge)
    const updatedInn: Innings = {
      ...prevInn,
      allBalls: [...(prevInn.allBalls ?? []).slice(0, -1), mergedEvent],
      runs: prevInn.runs + (mergedEvent.runs ?? 0) - (last.runs ?? 0),
      wickets: prevInn.wickets + 1,
      currentSkin: {
        ...prevInn.currentSkin,
        wickets: prevInn.currentSkin.wickets + 1,
        grossRuns:
          prevInn.currentSkin.grossRuns +
          (mergedEvent.runs ?? 0) -
          (last.runs ?? 0),
      },
      overEvents: newOverEvents,
      lastOverSummary: newLastOverSummary,
      dotBalls: mergedEvent.type === "dot" ? prevInn.dotBalls + 1 : 0,
    };

    const nextInnings = [...withHistory.innings];
    nextInnings[innIndex] = updatedInn;
    safeSet({ ...withHistory, innings: nextInnings, updatedAt: Date.now() });

    toast({
      title: "Wicket on extra",
      description: `${type} recorded with wicket (same delivery).`,
    });
  }

  // Attach wicket to last extra if it's a bye or legbye
  // Attach wicket to last Bye or Leg-bye (used by inline W on Bye/LB card).
  // PLACE this inside the ScoringApp component (where your other helpers live).
  function addWicketToLastByeOrLegbye() {
    if (wicketLockRef.current) return;
    wicketLockRef.current = true;
    setTimeout(() => (wicketLockRef.current = false), 350);

    if (!isAdmin || !state.setupCompleted) {
      toast({
        title: "Cannot record wicket",
        description: "Make sure scoreboard is ready and you are the scorer.",
        variant: "destructive",
      });
      return;
    }

    const innIndex = state.inningsIndex;
    const inn = state.innings[innIndex];
    const all = inn.allBalls ?? [];
    const last = all[all.length - 1];

    if (!last) {
      toast({
        title: "No delivery",
        description: "No events recorded to attach wicket to.",
        variant: "destructive",
      });
      return;
    }

    if (last.type !== "bye" && last.type !== "legbye") {
      toast({
        title: "Cannot attach wicket",
        description: "The last event is not a Bye or Leg-bye.",
        variant: "destructive",
      });
      return;
    }

    if (last.isWicket) {
      toast({
        title: "Wicket already present",
        description: "This delivery already has a wicket.",
        variant: "destructive",
      });
      return;
    }

    const mergedEvent: BallEvent = {
      ...last,
      isWicket: true,
      note: last.note ? `${last.note} • Wicket on extra` : "Wicket on extra",
      id: last.id,
    };

    // --- REPLACE the previous updatedInn construction with this robust version ---
    // (use this in addWicketOnExtra and addWicketToLastByeOrLegbye)

    const withHistory = pushHistory(state);
    const prevInn = withHistory.innings[innIndex];

    // Decide which array contained the last event and replace it there
    const prevOverEvents = prevInn.overEvents ?? [];
    const prevLastOverSummary = prevInn.lastOverSummary ?? [];

    // helper to find by id
    const findIndexById = (arr: BallEvent[], id: string) =>
      arr ? arr.findIndex((ev) => ev.id === id) : -1;

    const idxInOver = findIndexById(prevOverEvents, last.id);
    const idxInLastOver = findIndexById(prevLastOverSummary, last.id);

    let newOverEvents: BallEvent[] = [...prevOverEvents];
    let newLastOverSummary: BallEvent[] = [...prevLastOverSummary];

    // Replace in the correct container
    if (idxInOver >= 0) {
      // last event was in current overEvents
      newOverEvents = [
        ...prevOverEvents.slice(0, idxInOver),
        mergedEvent,
        ...prevOverEvents.slice(idxInOver + 1),
      ];
    } else if (idxInLastOver >= 0) {
      // last event was in lastOverSummary (previously completed over)
      newLastOverSummary = [
        ...prevLastOverSummary.slice(0, idxInLastOver),
        mergedEvent,
        ...prevLastOverSummary.slice(idxInLastOver + 1),
      ];
    } else {
      // fallback: replace the last item of overEvents (previously completed over)
      newOverEvents = [...prevOverEvents.slice(0, -1), mergedEvent];
    }

    // Recompute runs/wickets/currentSkin consistently (mergedEvent.runs equals last.runs for extra merge)
    const updatedInn: Innings = {
      ...prevInn,
      allBalls: [...(prevInn.allBalls ?? []).slice(0, -1), mergedEvent],
      runs: prevInn.runs + (mergedEvent.runs ?? 0) - (last.runs ?? 0),
      wickets: prevInn.wickets + 1,
      currentSkin: {
        ...prevInn.currentSkin,
        wickets: prevInn.currentSkin.wickets + 1,
        grossRuns:
          prevInn.currentSkin.grossRuns +
          (mergedEvent.runs ?? 0) -
          (last.runs ?? 0),
      },
      overEvents: newOverEvents,
      lastOverSummary: newLastOverSummary,
      dotBalls: mergedEvent.type === "dot" ? prevInn.dotBalls + 1 : 0,
    };

    const nextInnings = [...withHistory.innings];
    nextInnings[innIndex] = updatedInn;
    safeSet({ ...withHistory, innings: nextInnings, updatedAt: Date.now() });

    toast({
      title: "Wicket on extra",
      description: "Bye/Leg-bye recorded with wicket (same delivery).",
    });
  }

  // 2) Append a normal wicket as a separate delivery (this is the global W button behavior)
  function addWicket() {
    // short lock to avoid double clicks (keeps UI safe)
    if (wicketLockRef.current) return;
    wicketLockRef.current = true;
    setTimeout(() => (wicketLockRef.current = false), 350);

    if (!isAdmin || !state.setupCompleted || isMatchCompleted) {
      toast({
        title: "Cannot record wicket",
        description: "Make sure scoreboard is ready and you are the scorer.",
        variant: "destructive",
      });
      return;
    }

    const innIndex = state.inningsIndex;
    const inn = state.innings[innIndex];
    const all = inn.allBalls ?? [];
    const last = all[all.length - 1];

    // Allow back-to-back wickets, but block obvious duplicate appends:
    // If the last event is a wicket and it happened *very recently* (within 750ms),
    // treat this as a duplicate and block it. Otherwise allow appending another wicket.
    if (last?.type === "wicket") {
      const recentDuplicateWindowMs = 750;
      if (Date.now() - (last.ts ?? 0) < recentDuplicateWindowMs) {
        toast({
          title: "Wicket already recorded",
          description:
            "A wicket event has already been recorded for the last delivery.",
          variant: "destructive",
        });
        return;
      }
    }

    // append wicket with runs: 0 (penalty applied via wickets * WICKET_PENALTY)
    addEvent({
      id: uid("ball"),
      ts: Date.now(),
      type: "wicket",
      runs: 0,
      countsBall: true,
      isWicket: true,
      note: "Wicket",
    });
  }
  // --- END addWicket() ---
  // --- END addWicket replacement ---

  function addExtra(type: "wide" | "noball" | "bye" | "legbye", runs: number) {
    if (!isReadyToScore) {
      toast({
        title: "Select players first",
        description:
          "Please select striker, non-striker, and bowler before scoring.",
        variant: "destructive",
      });
      return;
    }

    const inn = state.innings[state.inningsIndex];

    // Use total legal balls for current over (inn.balls is incremented only for legal balls)
    const currentOver = Math.floor(inn.balls / 6) + 1;

    const isWideOrNoBall = type === "wide" || type === "noball";

    // Indoor rule: Wide / No Ball = 2 default runs + selected runs
    const totalRuns = isWideOrNoBall ? runs + 2 : runs;

    // Use configured overs limit (fallback to 16)
    const oversLimit = clamp(state.oversLimit ?? 16, 1, 50);

    // Wide/No-ball count as a legal delivery only for overs before the final over
    const countsBall = isWideOrNoBall ? currentOver < oversLimit : true;

    addEvent({
      id: uid("ball"),
      ts: Date.now(),
      type,
      runs: totalRuns,
      countsBall,
    });
  }

  const battingName =
    currentInnings.battingTeamId === "a"
      ? state.teams.a.name
      : state.teams.b.name;
  const bowlingName =
    currentInnings.bowlingTeamId === "a"
      ? state.teams.a.name
      : state.teams.b.name;

  const overPills = currentInnings.overEvents;
  const lastOverPills = currentInnings.lastOverSummary;

  const inningsNet = computeInningsNet(currentInnings);
  const totalScore = `${inningsNet}/${currentInnings.wickets}`;

  const oversText = `${formatOvers(currentInnings.balls, state.oversLimit)} ov`;
  const extrasText = totalExtras(currentInnings.extras);

  const isOverLimitReached =
    Math.floor(currentInnings.balls / 6) >= clamp(state.oversLimit, 1, 50);

  const viewerLink = useMemo(
    () => buildViewerLink(state.matchId),
    [state.matchId],
  );
  const adminLink = useMemo(
    () => buildAdminLink(state.matchId, state.adminKey),
    [state.matchId, state.adminKey],
  );

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: label });
    } catch {
      toast({ title: "Couldn’t copy", description: text });
    }
  }

  const headerChip =
    role === "admin" ? (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold"
        data-testid="status-role-admin"
      >
        <Crown className="h-3.5 w-3.5" /> Scorer
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-secondary text-secondary-foreground px-2.5 py-1 text-xs font-semibold"
        data-testid="status-role-viewer"
      >
        <Eye className="h-3.5 w-3.5" /> Viewer
      </span>
    );
  // 🔧 Helper: parse players from textarea (one per line)
  function parsePlayers(input: string): string[] {
    return input
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  function computeLiveSkinNet(inn: Innings): number {
    const SKIN_BALLS = 24;

    const skinStart = inn.skinIndex * SKIN_BALLS;
    const skinEnd = skinStart + SKIN_BALLS;

    const skinBalls = (inn.allBalls ?? []).slice(skinStart, skinEnd);

    let gross = 0;
    let wickets = 0;

    skinBalls.forEach((ev) => {
      gross += ev.runs;
      if (ev.isWicket) wickets += 1;
    });

    return gross - wickets * 5;
  }

  // Helper: returns true when the last event is attachable wicket of the given extra type
  function canAttachWicketToLast(
    type: "wide" | "noball" | "bye" | "legbye",
  ): boolean {
    const inn = state.innings[state.inningsIndex];
    const all = inn.allBalls ?? [];
    const last = all[all.length - 1];
    if (!last) return false;

    const matches =
      last.type === type || (type === "bye" && last.type === "legbye");
    if (!matches) return false;

    if (last.isWicket || last.type === "wicket") return false;

    // Require admin and match not completed; allow even during over-break/skin-break
    if (!isAdmin || !state.setupCompleted) return false;

    return true;
  }

    function setTeamPlayers(teamId: "a" | "b", players: string[]) {
    safeSet(
      pushHistory({
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...state.teams[teamId],
            players,
          },
        },
      }),
    );
    }

    const rosterTeams = useMemo(() => {
    const entries = Object.entries(state.teams ?? {}).map(([teamId, t]) => {
      const playersMap = Array.isArray(t.players)
        ? Object.fromEntries(
            t.players.map((playerId) => [playerId, { id: playerId }]),
          )
        : (t.players ?? {});

      const roster = Array.isArray(t.players)
        ? t.players
        : Object.keys(playersMap);

      return [teamId, { ...t, players: playersMap, roster }];
    });

    return Object.fromEntries(entries);
    }, [state.teams]);

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-4 sm:py-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex items-start justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1
                className="font-display text-2xl sm:text-3xl tracking-tight"
                data-testid="text-app-title"
              >
                Indoor Cricket Scorer
              </h1>
              {headerChip}
            </div>
            <p
              className="mt-1 text-sm text-muted-foreground"
              data-testid="text-app-subtitle"
            >
              Live scoring • touch-first controls • shareable viewer link
            </p>
          </div>

          {matchIdFromRoute ? (
            <Button
              variant="secondary"
              className="tap pressable"
              onClick={() => {
                // Viewer shouldn't land on an Admin-focused start screen.
                // Keep them in viewer mode on the home page.
                window.location.href = isAdmin ? "/" : "/?mode=viewer";
              }}
              data-testid="button-back-home"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Home</span>
            </Button>
          ) : null}
        </motion.div>

        <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-6">
          <div className="lg:col-span-7 space-y-3 sm:space-y-6">
            <Card className="glass p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-testid="text-match-label"
                    >
                      {state.title} • {state.venue}
                    </p>
                    <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                      <div
                        className="font-display text-4xl sm:text-5xl leading-none"
                        data-testid="text-score"
                      >
                        {totalScore}
                      </div>
                      <div className="pb-1">
                        <div
                          className="text-sm font-semibold"
                          data-testid="text-overs"
                        >
                          {oversText}
                        </div>
                        <div
                          className="text-xs text-muted-foreground"
                          data-testid="text-extras"
                        >
                          Extras: {extrasText}
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex gap-2 items-center">
                      {/* Skin only shown after setup/when live */}
                      {(state.setupCompleted || state.status !== "setup") && (
                        <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                          {`Skin ${ currentInnings.skinIndex + 1} / ${TOTAL_SKINS}`}
                        </span>
                      )}

                      {/* Always show friendly match status */}
                      <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                        {matchStatusText}
                      </span>

                      {/* Innings only shown after setup/when live */}
                      {(state.setupCompleted || state.status !== "setup") && (
                        <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                          {`Innings ${state.inningsIndex + 1} • ${battingName} batting`}
                        </span>
                      )}

                      {/* Show overs limit (this now defaults to 16) */}
                      <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                        {`${state.oversLimit} ov match`}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <Button
                      variant="outline"
                      className="tap pressable"
                      onClick={() => copy(viewerLink, "Viewer link copied")}
                      data-testid="button-copy-viewer-link"
                    >
                      <Share2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Share viewer</span>
                    </Button>
                    {isAdmin ? (
                      <Button
                        variant="outline"
                        className="tap pressable"
                        onClick={() => copy(adminLink, "Admin link copied")}
                        data-testid="button-copy-admin-link"
                      >
                        <Copy className="h-4 w-4" />
                        <span className="hidden sm:inline">Copy admin</span>
                      </Button>
                    ) : null}
                  </div>
                </div>

                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Batting card */}
                  <Card className="bg-card/60 border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      BATTING
                    </p>
                    <p className="mt-1 font-semibold">
                      {state.setupCompleted ||
                      currentInnings.striker ||
                      currentInnings.nonStriker
                        ? currentInnings.battingTeamId === "a"
                          ? state.teams.a.name
                          : state.teams.b.name
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {currentInnings.striker || currentInnings.nonStriker
                        ? `${currentInnings.striker || ""} • ${currentInnings.nonStriker || ""}`
                        : ""}
                    </p>
                  </Card>
                  {/* Bowling card */}
                  <Card className="bg-card/60 border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      BOWLING
                    </p>
                    <p className="mt-1 font-semibold">
                      {state.setupCompleted || currentInnings.bowler
                        ? currentInnings.bowlingTeamId === "a"
                          ? state.teams.a.name
                          : state.teams.b.name
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {currentInnings.bowler || ""}
                    </p>
                  </Card>
                  <Card className="bg-card/60 border p-3">
                    <p
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-testid="text-over-label"
                    >
                      This over
                    </p>
                    <div
                      className="mt-2 flex flex-wrap gap-1"
                      data-testid="list-over-pills"
                    >
                      {(overPills.length
                        ? overPills
                        : ([
                            {
                              id: "empty",
                              ts: 0,
                              type: "dot",
                              runs: 0,
                              countsBall: true,
                            },
                          ] as BallEvent[])
                      ).map((ev, idx) => (
                        <span
                          key={`${ev.id}_${idx}`}
                          className={cn(
                            "inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-semibold",
                            idx === 0 && ev.id === "empty"
                              ? "bg-secondary text-secondary-foreground"
                              : pillTone(ev),
                          )}
                          data-testid={`pill-over-${idx}`}
                        >
                          {idx === 0 && ev.id === "empty"
                            ? "—"
                            : eventLabel(ev)}
                        </span>
                      ))}
                    </div>
                    {lastOverPills.length ? (
                      <p
                        className="mt-2 text-xs text-muted-foreground"
                        data-testid="text-last-over"
                      >
                        Last over: {lastOverPills.map(eventLabel).join(" ")}
                      </p>
                    ) : null}
                  </Card>
                </div>

                {!isAdmin ? (
                  <div className="rounded-xl border bg-card/60 p-3 text-sm space-y-2">
                    {needsAdminLink ? (
                      <>
                        <p>
                          <strong>Admin link required.</strong> This match is in
                          scorer mode, but this device doesn’t have the admin
                          key.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Ask the scorer for an Admin link, or use the Viewer link
                          to follow along.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          You’re in <strong>Viewer mode</strong>. Scoring is
                          disabled on this device.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          To create or edit a match, open an Admin link from the
                          scorer.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card className="glass p-4 sm:p-6">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as any)}
              >
                {/* Responsive header: Tabs on left, responsive action buttons on right */}
                <div className="w-full flex items-center gap-3">
                  {/* keep TabsList exactly as-is */}
                  <div className="flex-shrink-0">
                    <TabsList
                      className="bg-card/60 border"
                      data-testid="tabs-admin"
                    >
                      <TabsTrigger value="controls" data-testid="tab-controls">
                        Controls
                      </TabsTrigger>
                      <TabsTrigger value="players" data-testid="tab-players">
                        Players
                      </TabsTrigger>
                      <TabsTrigger value="match" data-testid="tab-match">
                        Match
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* spacer pushes actions to the right */}
                  <div className="flex-1" />

                  {/* actions: responsive / wrap / mobile icon-only */}
                  <div
                    className="flex items-center gap-2 flex-wrap"
                    style={{ paddingRight: "env(safe-area-inset-right, 12px)" }}
                  >
                    {/* Undo: desktop (text + icon) */}
                    <Button
                      variant="secondary"
                      className="hidden sm:inline-flex tap pressable items-center gap-2"
                      disabled={isMatchCompleted}
                      onClick={undo}
                      data-testid="button-undo"
                    >
                      <Undo2 className="h-4 w-4" /> Undo
                    </Button>

                    {/* Undo: mobile (icon only) */}
                    <Button
                      variant="secondary"
                      className="inline-flex sm:hidden tap pressable items-center"
                      disabled={isMatchCompleted}
                      onClick={undo}
                      aria-label="Undo"
                      data-testid="button-undo-mobile"
                    >
                      <Undo2 className="h-5 w-5" />
                    </Button>

                    {/* Reset: desktop (text + icon) */}
                    <Button
                      variant="outline"
                      className="hidden sm:inline-flex tap pressable items-center gap-2"
                      disabled={isMatchCompleted}
                      onClick={() => setShowResetConfirm(true)}
                      data-testid="button-reset"
                    >
                      <RotateCcw className="h-4 w-4" /> Reset
                    </Button>

                    {/* Reset: mobile (icon only) */}
                    <Button
                      variant="outline"
                      className="inline-flex sm:hidden tap pressable items-center"
                      disabled={isMatchCompleted}
                      onClick={() => setShowResetConfirm(true)}
                      aria-label="Reset"
                      data-testid="button-reset-mobile"
                    >
                      <RotateCcw className="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                <TabsContent value="controls" className="mt-4">
                  {!matchEnded && isOverBreak && (
                    <div className="mb-3 rounded-xl border bg-yellow-50 p-3 text-sm text-yellow-900">
                      Over completed. Please select the next bowler to continue.
                    </div>
                  )}

                  {/* 🔵 Skin break banner */}
                  {!matchEnded && isSkinBreak && (
                    <div className="mb-3 rounded-xl border bg-blue-50 p-3 text-sm text-blue-900">
                      Skin completed. Select new striker and non-striker to
                      continue.
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                    <BigButton
                      label="0"
                      sub="Dot"
                      tone="secondary"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(0)}
                      testId="button-run-0"
                    />
                    <BigButton
                      label="1"
                      sub="Run"
                      tone="primary"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(1)}
                      testId="button-run-1"
                    />
                    <BigButton
                      label="2"
                      sub="Runs"
                      tone="primary"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(2)}
                      testId="button-run-2"
                    />
                    <BigButton
                      label="3"
                      sub="Runs"
                      tone="primary"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(3)}
                      testId="button-run-3"
                    />
                    <BigButton
                      label="4"
                      sub="Boundary"
                      tone="accent"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(4)}
                      testId="button-run-4"
                    />
                    <BigButton
                      label="5"
                      sub="Runs"
                      tone="primary"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(5)}
                      testId="button-run-5"
                    />

                    <BigButton
                      label="6"
                      sub="Max"
                      tone="accent"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={() => addRun(6)}
                      testId="button-run-6"
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                    <BigButton
                      label="W"
                      sub="Wicket"
                      tone="danger"
                      disabled={
                        !isAdmin ||
                        !state.setupCompleted ||
                        needsBowlerSelection ||
                        isOverBreak ||
                        isSkinBreak ||
                        !isReadyToScore ||
                        isMatchCompleted
                      }
                      onClick={addWicket}
                      testId="button-wicket"
                    />

                    {/* 2) Replace your Wide Card with this */}
                    {/* --- REPLACE: Wide Card block --- */}
                    {/* Wide card — badge positioned absolutely on card so it cannot be clipped */}
                    <Card className="bg-card/60 border p-3 relative">
                      <p className="text-sm font-semibold">Wide</p>

                      <div className="mt-2 relative">
                        <Button
                          variant="secondary"
                          className="tap pressable h-10 w-full rounded-xl mb-2 inline-flex items-center justify-center"
                          disabled={
                            !isAdmin ||
                            !state.setupCompleted ||
                            needsBowlerSelection ||
                            isOverBreak ||
                            isSkinBreak ||
                            !isReadyToScore ||
                            isMatchCompleted
                          }
                          onClick={() => addExtra("wide", 0)}
                        >
                          Wide (+2)
                        </Button>

                        {/* Inline W to attach wicket to this extra (same delivery) */}
                        {!isExtraMarkedWicket(currentInnings, "wide") ? (
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold shadow z-20"
                            title="Wicket on this extra"
                            aria-label="Wicket on this extra"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>,
                            ) => {
                              e.stopPropagation();
                              addWicketOnExtra("wide");
                            }}
                            // enable iff the last event is attachable (this allows clicking during over-break)
                            disabled={!canAttachWicketToLast("wide")}
                          >
                            W
                          </button>
                        ) : null}
                        <div className="grid grid-cols-4 gap-1 mt-2">
                          {[1, 2, 3, 4].map((n) => (
                            <Button
                              key={n}
                              variant="secondary"
                              className="tap pressable h-10 rounded-xl px-0"
                              disabled={
                                !isAdmin ||
                                !state.setupCompleted ||
                                needsBowlerSelection ||
                                isOverBreak ||
                                isSkinBreak ||
                                !isReadyToScore ||
                                isMatchCompleted
                              }
                              onClick={() => addExtra("wide", n)}
                            >
                              +{n}
                            </Button>
                          ))}
                        </div>
                        {isExtraMarkedWicket(currentInnings, "wide") ? (
                          <span
                            className="w-badge-abs absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold shadow"
                            aria-hidden
                          >
                            W
                          </span>
                        ) : null}
                      </div>
                    </Card>
                    {/* --- END Wide Card block --- */}

                    {/* 3) Replace your No Ball Card with this */}
                    {/* --- REPLACE: No Ball Card block --- */}
                    {/* No Ball card — badge positioned absolutely on card so it cannot be clipped */}
                    <Card className="bg-card/60 border p-3 relative">
                      <p className="text-sm font-semibold">No Ball</p>

                      <div className="mt-2 relative">
                        <Button
                          variant="secondary"
                          className="tap pressable h-10 w-full rounded-xl mb-2 inline-flex items-center justify-center"
                          disabled={
                            !isAdmin ||
                            !state.setupCompleted ||
                            needsBowlerSelection ||
                            isOverBreak ||
                            isSkinBreak ||
                            !isReadyToScore ||
                            isMatchCompleted
                          }
                          onClick={() => addExtra("noball", 0)}
                        >
                          No Ball (+2)
                        </Button>

                        {/* Inline W to attach wicket to this extra (same delivery) */}
                        {!isExtraMarkedWicket(currentInnings, "noball") ? (
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold shadow z-20"
                            title="Wicket on this extra"
                            aria-label="Wicket on this extra"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>,
                            ) => {
                              e.stopPropagation();
                              addWicketOnExtra("noball");
                            }}
                            disabled={!canAttachWicketToLast("noball")}
                          >
                            W
                          </button>
                        ) : null}

                        <div className="grid grid-cols-4 gap-1 mt-2">
                          {[1, 2, 3, 4].map((n) => (
                            <Button
                              key={n}
                              variant="secondary"
                              className="tap pressable h-10 rounded-xl px-0"
                              disabled={
                                !isAdmin ||
                                !state.setupCompleted ||
                                needsBowlerSelection ||
                                isOverBreak ||
                                isSkinBreak ||
                                !isReadyToScore ||
                                isMatchCompleted
                              }
                              onClick={() => addExtra("noball", n)}
                            >
                              +{n}
                            </Button>
                          ))}
                        </div>
                        {isExtraMarkedWicket(currentInnings, "noball") ? (
                          <span
                            className="w-badge-abs absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold shadow"
                            aria-hidden
                          >
                            W
                          </span>
                        ) : null}
                      </div>
                    </Card>
                    {/* --- END No Ball Card block --- */}
                    {/* --- REPLACE: Bye/LB SmallStepper + Wicket button --- */}
                    {/* Bye/LB + inline wicket button (centered) */}
                    {/* Bye/LB — place inline W absolutely so it stays aligned */}
                    <div className="mt-2 relative pt-6">
                      {" "}
                      {/* <-- add top padding to reserve header area */}
                      <div className="min-w-0">
                        <SmallStepper
                          title="Bye/LB"
                          onAdd={(n) => addExtra("bye", n)}
                          disabled={
                            !isAdmin ||
                            !state.setupCompleted ||
                            needsBowlerSelection ||
                            isOverBreak ||
                            isSkinBreak ||
                            !isReadyToScore ||
                            isMatchCompleted
                          }
                          testBase="bye"
                          alt
                          altAction={(n) => addExtra("legbye", n)}
                          altLabel="Leg bye"
                        />
                      </div>
                      {/* Inline W button (hidden once extra is marked) */}
                      {!isExtraMarkedWicket(currentInnings, "bye") &&
                      !isExtraMarkedWicket(currentInnings, "legbye") ? (
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold shadow z-20"
                          aria-label="Wicket on Bye/Legbye"
                          title="Wicket on this extra"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation();
                            addWicketToLastByeOrLegbye();
                          }}
                          disabled={!canAttachWicketToLast("bye")}
                        >
                          W
                        </button>
                      ) : null}
                      {/* Persistent W badge (top-left) — positioned using top/left that match the header area */}
                      {isExtraMarkedWicket(currentInnings, "bye") ||
                      isExtraMarkedWicket(currentInnings, "legbye") ? (
                        <span
                          className="absolute left-3 top-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold shadow pointer-events-none"
                          aria-hidden
                        >
                          W
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {/* --- END Bye/LB SmallStepper + Wicket button --- */}

                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="tap pressable"
                        disabled={
                          !isAdmin ||
                          !state.setupCompleted ||
                          needsBowlerSelection ||
                          isOverBreak ||
                          isSkinBreak ||
                          !isReadyToScore ||
                          isMatchCompleted
                        }
                        onClick={swapBatters}
                        data-testid="button-swap-batters"
                      >
                        Swap batters
                      </Button>
                      <div className="flex items-center gap-2 rounded-xl border bg-card/60 px-3 py-2">
                        <span
                          className="text-sm font-semibold"
                          data-testid="text-over-limit"
                        >
                          Over limit
                        </span>
                        <span
                          className="text-sm text-muted-foreground"
                          data-testid="text-over-limit-value"
                        >
                          {state.oversLimit}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {state.status !== "live" ? (
                        <Button
                          variant="secondary"
                          className="rounded-md"
                          onClick={startMatch} // existing handler
                          disabled={
                            startResumeDisabled // or any existing conditions you were checking
                          }
                          data-testid="btn-start-resume"
                        >
                          Start / Resume
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="tap pressable"
                          disabled={
                            !isAdmin ||
                            !isOverLimitReached ||
                            controlsDisabled ||
                            isMatchCompleted
                          }
                          onClick={toggleTeamsForNextInnings}
                          data-testid="button-next-innings"
                        >
                          Next innings
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        className="tap pressable"
                        disabled={!isAdmin || !isOverLimitReached}
                        onClick={toggleTeamsForNextInnings}
                        data-testid="button-next-innings"
                      >
                        Next innings
                      </Button>
                    </div>
                  </div>

                  {!isAdmin ? (
                    <p
                      className="mt-3 text-xs text-muted-foreground"
                      data-testid="text-readonly-hint"
                    >
                      Ask the scorer for an admin link if you need to update the
                      score.
                    </p>
                  ) : null}
                </TabsContent>

                <TabsContent value="players" className="mt-4">
                  {/* Manage roster button (visible to admins). Inserted above the player selects */}
                  <div className="flex items-center justify-end mb-3">
                    {isAdmin && teamObj ? (
                      <button
                        type="button"
                        className="inline-flex items-center px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => setRosterOpen(true)}
                        title="Manage team roster"
                      >
                        Manage roster
                      </button>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Striker */}
                    <div className="space-y-2">
                      <Label>Striker</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card/70 px-3"
                        value={currentInnings.striker}
                        disabled={
                          !isAdmin ||
                          !state.setupCompleted ||
                          isBatterSelectionLocked
                        }
                        onChange={(e) =>
                          setPlayers(
                            e.target.value,
                            currentInnings.nonStriker,
                            currentInnings.bowler,
                          )
                        }
                      >
                        {/* Striker */}
                        {/* Striker */}
                        <option value="">Select striker</option>
                        {battingPlayers.map((playerKey) => {
                          const team =
                            state.teams?.[currentBattingTeamId ?? ""];
                          let label = String(playerKey);

                          if (team) {
                            const players = team.players;
                            if (Array.isArray(players)) {
                              // players array: label is the array item (likely a name or short id)
                              label = String(playerKey);
                            } else if (players && typeof players === "object") {
                              // players map: show name if present
                              const p = (players as Record<string, any>)[
                                playerKey
                              ];
                              label = p?.name ?? String(playerKey);
                            }
                          }

                          return (
                            <option
                              key={playerKey}
                              value={playerKey}
                              disabled={
                                playerKey === currentInnings.nonStriker ||
                                usedBatters.has(playerKey)
                              }
                            >
                              {label}{" "}
                              {usedBatters.has(playerKey) ? "(used)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Non-Striker */}
                    <div className="space-y-2">
                      <Label>Non-Striker</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card/70 px-3"
                        value={currentInnings.nonStriker}
                        disabled={
                          !isAdmin ||
                          !state.setupCompleted ||
                          isBatterSelectionLocked
                        }
                        onChange={(e) =>
                          setPlayers(
                            currentInnings.striker,
                            e.target.value,
                            currentInnings.bowler,
                          )
                        }
                      >
                        {/* Non-Striker */}
                        {/* Non-Striker */}
                        <option value="">Select non-striker</option>
                        {battingPlayers.map((playerKey) => {
                          const team =
                            state.teams?.[currentBattingTeamId ?? ""];
                          let label = String(playerKey);

                          if (team) {
                            const players = team.players;
                            if (Array.isArray(players)) {
                              label = String(playerKey);
                            } else if (players && typeof players === "object") {
                              const p = (players as Record<string, any>)[
                                playerKey
                              ];
                              label = p?.name ?? String(playerKey);
                            }
                          }

                          return (
                            <option
                              key={playerKey}
                              value={playerKey}
                              disabled={
                                playerKey === currentInnings.striker ||
                                usedBatters.has(playerKey)
                              }
                            >
                              {label}{" "}
                              {usedBatters.has(playerKey) ? "(used)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Bowler */}
                    <div className="space-y-2">
                      <Label>Bowler</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card/70 px-3"
                        value={currentInnings.bowler}
                        disabled={
                          !isAdmin ||
                          !state.setupCompleted ||
                          isBowlerSelectionLocked
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!value) return;

                          const inn = state.innings[state.inningsIndex];

                          // Safety: compute bowling players list for this innings
                          const bowlingPlayersList: string[] = bowlingPlayers;

                          // check immediate consecutive rule first (existing logic)
                          const isConsecutive =
                            isAtOverBreak && inn.lastOverBowler === value;

                          // check max overs (existing)
                          const balls = inn.bowlerBalls?.[value] ?? 0;
                          const overs = Math.floor(balls / 6);
                          const isMaxed = overs >= 2;

                          // New: feasibility check — prevent choices that make finishing impossible
                          const oversLimitVal = clamp(
                            state.oversLimit ?? 16,
                            1,
                            50,
                          );
                          const infeasible = !canCompleteRemainingOvers(
                            inn,
                            bowlingPlayersList,
                            value,
                            oversLimitVal,
                          );

                          if (isConsecutive) {
                            toast({
                              title: "Invalid bowler",
                              description:
                                "Same bowler cannot bowl consecutive overs. Please select a different bowler.",
                              variant: "destructive",
                            });
                            return;
                          }

                          if (isMaxed) {
                            toast({
                              title: "Bowling limit reached",
                              description: `${value} has already bowled 2 overs.`,
                              variant: "destructive",
                            });
                            return;
                          }

                          if (infeasible) {
                            toast({
                              title: "Cannot pick bowler",
                              description:
                                "Picking this bowler now would make it impossible to complete the remaining overs. Please select a different bowler.",
                              variant: "destructive",
                            });
                            return;
                          }

                          // proceed with existing setting behaviour
                          const updated: Innings = {
                            ...inn,
                            bowler: value,
                          };

                          const innings = [...state.innings];
                          innings[state.inningsIndex] = updated;
                          safeSet({ ...state, innings });
                        }}
                      >
                        {/* Bowler */}
                        {/* Bowler */}
                        <option value="">Select bowler</option>
                        {bowlingPlayers.map((playerKey) => {
                          const team =
                            state.teams?.[currentInnings.bowlingTeamId ?? ""];
                          let label = String(playerKey);

                          if (team) {
                            const players = team.players;
                            if (Array.isArray(players)) {
                              label = String(playerKey);
                            } else if (players && typeof players === "object") {
                              const p = (players as Record<string, any>)[
                                playerKey
                              ];
                              label = p?.name ?? String(playerKey);
                            }
                          }

                          const balls = bowlerBalls[playerKey] ?? 0;
                          const overs = Math.floor(balls / 6);
                          const isConsecutive =
                            isAtOverBreak &&
                            currentInnings.lastOverBowler === playerKey;
                          const isMaxed = overs >= 2;

                          const oversLimitVal = clamp(
                            state.oversLimit ?? 16,
                            1,
                            50,
                          );
                          const infeasible = !canCompleteRemainingOvers(
                            currentInnings,
                            bowlingPlayers,
                            playerKey,
                            oversLimitVal,
                          );

                          const disabledReason = isMaxed
                            ? " – max"
                            : isConsecutive
                              ? " – last over"
                              : infeasible
                                ? " – not allowed (would block finish)"
                                : "";

                          return (
                            <option
                              key={playerKey}
                              value={playerKey}
                              disabled={isMaxed || isConsecutive || infeasible}
                              title={
                                isMaxed
                                  ? `${label} – reached 2 overs`
                                  : isConsecutive
                                    ? `${label} – bowled last over`
                                    : infeasible
                                      ? "Picking this bowler would prevent completing the remaining overs"
                                      : ""
                              }
                            >
                              {label} ({overs}/2){disabledReason}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="match" className="mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Match title"
                      value={state.title}
                      disabled={!isAdmin || state.setupCompleted}
                      onChange={(v) => setMeta(v, state.venue)}
                      testId="input-title"
                    />
                    <Field
                      label="Venue"
                      value={state.venue}
                      disabled={!isAdmin || state.setupCompleted}
                      onChange={(v) => setMeta(state.title, v)}
                      testId="input-venue"
                    />
                    <Field
                      label="Team A"
                      value={state.teams.a.name}
                      disabled={!isAdmin || state.setupCompleted}
                      onChange={(v) => setTeams(v, state.teams.b.name)}
                      testId="input-team-a"
                    />
                    <Field
                      label="Team B"
                      value={state.teams.b.name}
                      disabled={!isAdmin || state.setupCompleted}
                      onChange={(v) => setTeams(state.teams.a.name, v)}
                      testId="input-team-b"
                    />
                  </div>
                  {/* Team Players Setup */}
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">
                        Team A Players (one per line)
                      </Label>
                      <textarea
                        className="w-full min-h-[120px] rounded-xl border bg-card/70 p-3 text-sm"
                        disabled={!isAdmin || state.setupCompleted}
                        placeholder={`Batter 1\nBatter 2\nBatter 3\nBatter 4`}
                        onChange={(e) =>
                          setTeamPlayers("a", parsePlayers(e.target.value))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">
                        Team B Players (one per line)
                      </Label>
                      <textarea
                        className="w-full min-h-[120px] rounded-xl border bg-card/70 p-3 text-sm"
                        disabled={!isAdmin || state.setupCompleted}
                        placeholder={`Bowler 1\nBowler 2\nBowler 3\nBowler 4`}
                        onChange={(e) =>
                          setTeamPlayers("b", parsePlayers(e.target.value))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <OverLimitControl
                      value={state.oversLimit}
                      disabled={!isAdmin || state.setupCompleted}
                      onChange={(v) =>
                        safeSet(
                          pushHistory({
                            ...state,
                            oversLimit: clamp(v, 1, 50),
                          }),
                        )
                      }
                    />
                    {/* Toss controls */}
                    {/* Robust Toss card — adaptive grid to avoid overlap */}
                    {/* Reliable Toss card — flex layout, wraps when space is tight */}
                    {/* Toss card — improved accessibility: ids, htmlFor, title, focus rings, aria-live */}
                    <Card className="bg-card/60 border p-3 sm:col-span-2">
                      <div className="flex flex-wrap items-start gap-3">
                        {/* Left: selects row that fills available space */}
                        <div className="flex-1 min-w-0 flex gap-3">
                          {/* Toss winner */}
                          <div className="flex-1 min-w-0">
                            <label
                              htmlFor="toss-winner-select"
                              className="text-sm font-semibold mb-1 inline-block"
                            >
                              Toss winner
                            </label>
                            <select
                              id="toss-winner-select"
                              className="h-11 w-full rounded-xl border bg-card/70 px-4 pr-10 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary/40"
                              title={
                                tossWinnerSel
                                  ? state.teams[tossWinnerSel].name
                                  : "Select toss winner"
                              }
                              value={tossWinnerSel}
                              onChange={(e) =>
                                setTossWinnerSel(
                                  e.target.value as "a" | "b" | "",
                                )
                              }
                              data-testid="select-toss-winner"
                            >
                              <option value="">Select</option>
                              <option value="a">{state.teams.a.name}</option>
                              <option value="b">{state.teams.b.name}</option>
                            </select>
                          </div>

                          {/* Choice */}
                          <div className="flex-1 min-w-0">
                            <label
                              htmlFor="toss-choice-select"
                              className="text-sm font-semibold mb-1 inline-block"
                            >
                              Choice
                            </label>
                            <select
                              id="toss-choice-select"
                              className="h-11 w-full rounded-xl border bg-card/70 px-4 pr-10 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary/40"
                              title={
                                tossChoiceSel ? tossChoiceSel : "Select choice"
                              }
                              value={tossChoiceSel}
                              onChange={(e) =>
                                setTossChoiceSel(
                                  e.target.value as "bat" | "bowl" | "",
                                )
                              }
                              data-testid="select-toss-choice"
                            >
                              <option value="">Select</option>
                              <option value="bat">Bat</option>
                              <option value="bowl">Bowl</option>
                            </select>
                          </div>
                        </div>

                        {/* Right: apply button never shrinks; wraps below if not enough horizontal space */}
                        <div className="flex-shrink-0 self-end">
                          <Button
                            variant="secondary"
                            className="h-11 focus:outline-none focus:ring-2 focus:ring-primary/40"
                            onClick={applyToss}
                            disabled={
                              !isAdmin || !tossWinnerSel || !tossChoiceSel
                            }
                            data-testid="button-apply-toss"
                          >
                            Apply Toss
                          </Button>
                        </div>

                        {/* Summary — full width underneath; announce changes for assistive tech */}
                        <div
                          className="w-full mt-2"
                          aria-live="polite"
                          role="status"
                        >
                          <div className="rounded-md border bg-muted/5 px-3 py-2 text-sm text-muted-foreground min-w-0">
                            {state.tossWinner && state.tossChoice ? (
                              <span data-testid="text-toss-summary">
                                <strong className="font-semibold">
                                  {state.teams[state.tossWinner].name}
                                </strong>{" "}
                                won the toss and chose to {state.tossChoice}.
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                No toss recorded
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                    <div className="sm:col-span-3">
                      <Button
                        className="w-full tap pressable"
                        disabled={!isAdmin || state.setupCompleted}
                        onClick={confirmMatchSetup}
                      >
                        {state.setupCompleted
                          ? "Match Setup Confirmed"
                          : "Confirm Match Details"}
                      </Button>
                    </div>

                    <Card className="bg-card/60 border p-3 sm:col-span-2">
                      <p
                        className="text-sm font-semibold"
                        data-testid="text-share-heading"
                      >
                        Share links
                      </p>
                      <p
                        className="mt-1 text-xs text-muted-foreground"
                        data-testid="text-share-sub"
                      >
                        Viewer is read-only. Admin requires the key.
                      </p>
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            className="tap pressable w-full justify-center"
                            onClick={() =>
                              copy(viewerLink, "Viewer link copied")
                            }
                            data-testid="button-share-viewer"
                          >
                            <Eye className="h-4 w-4" /> Copy viewer link
                          </Button>
                          <Button
                            variant="outline"
                            className="tap pressable w-full justify-center"
                            onClick={() => copy(adminLink, "Admin link copied")}
                            disabled={!isAdmin}
                            data-testid="button-share-admin"
                          >
                            <Crown className="h-4 w-4" /> Copy admin link
                          </Button>
                        </div>

                        <div
                          className="rounded-xl border bg-card/60 p-2 text-xs text-muted-foreground break-all"
                          data-testid="text-viewer-link"
                        >
                          {viewerLink}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Label
                            className="text-sm"
                            htmlFor="toggle-viewer"
                            data-testid="label-viewer-mode"
                          >
                            Viewer mode
                          </Label>
                          <Switch
                            id="toggle-viewer"
                            checked={role === "viewer"}
                            onCheckedChange={(checked) => {
                              const nextMode: Role = checked
                                ? "viewer"
                                : "admin";
                              const nextSearch =
                                nextMode === "viewer"
                                  ? setQueryParam(url.search, "mode", "viewer")
                                  : setQueryParam(
                                      setQueryParam(
                                        url.search,
                                        "mode",
                                        "admin",
                                      ),
                                      "key",
                                      state.adminKey,
                                    );
                              setLocation(
                                `/match/${encodeURIComponent(state.matchId)}${nextSearch}`,
                              );
                            }}
                            disabled={!isAdmin}
                            data-testid="switch-viewer-mode"
                          />
                        </div>
                      </div>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          <div className="lg:col-span-5 space-y-3 sm:space-y-6">
            <Card className="glass p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold mb-2">Match Summary</p>

                  {/* Toss */}
                  <div className="text-sm mb-2">
                    <div className="text-xs text-muted-foreground">Toss</div>
                    <div className="font-medium">
                      {state.tossWinner
                        ? `Toss: ${state.teams[state.tossWinner].name} won${
                            state.tossChoice ? ` and chose to ${state.tossChoice}` : ""
                          }`
                        : "Toss: —"}
                    </div>
                  </div>

                  {/* Score */}
                  <div className="text-sm">
                    <div className="text-xs text-muted-foreground">Score</div>

                    <div className="font-medium">
                      {`${state.teams.a.name}: Net ${computeInningsNet(state.innings[0])} (Gross ${state.innings[0]?.runs ?? 0}, Outs ${state.innings[0]?.wickets ?? 0}) • Overs ${formatOvers(state.innings[0]?.balls ?? 0, state.oversLimit)}`}
                    </div>

                    <div className="font-medium mt-1">
                      {`${state.teams.b.name}: Net ${computeInningsNet(state.innings[1])} (Gross ${state.innings[1]?.runs ?? 0}, Outs ${state.innings[1]?.wickets ?? 0}) • Overs ${formatOvers(state.innings[1]?.balls ?? 0, state.oversLimit)}`}
                    </div>

                    {/* Result / winner line (ONLY shown when match is completed) */}
                    <div className="mt-3">
                      {(() => {
                        const aTotal = computeInningsNet(state.innings[0]);
                        const bTotal = computeInningsNet(state.innings[1]);

                        if (state.status === "completed") {
                          if (aTotal > bTotal) {
                            return (
                              <div className="inline-block bg-sky-100 text-sky-700 px-3 py-1 rounded-lg font-semibold text-lg">
                                Result: {state.teams.a.name} won
                              </div>
                            );
                          } else if (bTotal > aTotal) {
                            return (
                              <div className="inline-block bg-sky-100 text-sky-700 px-3 py-1 rounded-lg font-semibold text-lg">
                                Result: {state.teams.b.name} won
                              </div>
                            );
                          } else {
                            return (
                              <div className="text-lg font-semibold text-sky-600">
                                Result: Match tied
                              </div>
                            );
                          }
                        }

                        // Match is not completed — show nothing (no "Leading" line)
                        return null;
                      })()}
                    </div>
                  </div>
                </div>

                {/* WhatsApp icon-only button (click to open WhatsApp with the match summary text).
        NOTE: Match ID is not included in the shared text. */}
                <div className="flex items-start">
                  <button
                    className="inline-flex items-center justify-center rounded-full p-2 hover:bg-muted/40"
                    aria-label="Share match summary on WhatsApp"
                    onClick={() => {
                      try {
                        const aTotal = computeInningsNet(state.innings[0]);
                        const bTotal = computeInningsNet(state.innings[1]);

                        const lines: string[] = [];
                        lines.push(
                          `${state.title}${state.venue ? ` — ${state.venue}` : ""}`,
                        );
                        lines.push(""); // separator

                        // Toss
                        lines.push(
                          state.tossWinner
                            ? `Toss: ${state.teams[state.tossWinner].name} won${
                                state.tossChoice ? ` and chose to ${state.tossChoice}` : ""
                              }`
                            : `Toss: —`,
                        );

                        lines.push(""); // separator

                        // Score lines
                        lines.push(
                          `${state.teams.a.name}: Net ${aTotal} (Gross ${state.innings[0]?.runs ?? 0}, Outs ${state.innings[0]?.wickets ?? 0}) • Overs ${formatOvers(state.innings[0]?.balls ?? 0, state.oversLimit)}`,
                        );
                        lines.push(
                          `${state.teams.b.name}: Net ${bTotal} (Gross ${state.innings[1]?.runs ?? 0}, Outs ${state.innings[1]?.wickets ?? 0}) • Overs ${formatOvers(state.innings[1]?.balls ?? 0, state.oversLimit)}`,
                        );

                        // Result / winner text (only include explicit Result when match is completed)
                        if (state.status === "completed") {
                          if (aTotal > bTotal)
                            lines.push("", `Result: ${state.teams.a.name} won`);
                          else if (bTotal > aTotal)
                            lines.push("", `Result: ${state.teams.b.name} won`);
                          else lines.push("", "Result: Match tied");
                        }

                        const text = lines.join("\n");
                        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
                        window.open(url, "_blank");
                      } catch (err) {
                        // best-effort fallback: copy text to clipboard and notify
                        try {
                          const fallback = `Match summary for ${state.title} — open the app to view details.`;
                          navigator.clipboard?.writeText(fallback);
                          alert(
                            "Could not open WhatsApp directly. A fallback summary was copied to clipboard.",
                          );
                        } catch {
                          alert(
                            "Could not open WhatsApp. Please copy the summary manually.",
                          );
                        }
                      }
                    }}
                  >
                    {/* WhatsApp SVG icon only */}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        fill="#25D366"
                        d="M20.52 3.478A11.907 11.907 0 0012 .999C6.48.999 1.96 5.52 1.96 11.04c0 1.94.5 3.84 1.45 5.5L1 23l6.65-1.74A11.98 11.98 0 0012 23c5.52 0 10.04-4.52 10.04-10.04 0-2.69-1.05-5.22-2.52-6.98z"
                      />
                      <path
                        fill="#fff"
                        d="M17.3 14.8c-.3-.15-1.7-.85-1.95-.95-.25-.1-.44-.15-.63.15-.2.3-.7.95-.85 1.15-.15.2-.3.25-.55.1-.25-.15-1.05-.39-2-1.24-.74-.66-1.23-1.48-1.37-1.73-.15-.25-.02-.39.11-.52.11-.11.25-.29.38-.44.13-.15.17-.25.26-.42.08-.17.04-.32-.02-.47-.06-.15-.63-1.52-.87-2.08-.23-.55-.47-.47-.66-.48-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.32-.27.25-1.04 1.02-1.04 2.47 0 1.44 1.06 2.83 1.21 3.02.15.19 2.08 3.3 5.05 4.62 2.97 1.32 2.97.88 3.5.82.53-.06 1.72-.7 1.97-1.38.25-.68.25-1.26.18-1.38-.07-.12-.25-.19-.55-.34z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </Card>
            <Card className="glass p-4 sm:p-6">
              <p className="text-sm font-semibold mb-3">Skin-wise Comparison</p>

              <div className="grid grid-cols-4 text-sm font-semibold border-b pb-2">
                <div>Skin</div>
                <div className="text-center">{state.teams.a.name}</div>
                <div className="text-center">{state.teams.b.name}</div>
                <div className="text-center">Winner</div>
              </div>

              {[0, 1, 2, 3].map((skin) => {
                function getSkinNet(
                  inn: Innings | undefined,
                  skinIndex: number,
                ): number | null {
                  if (!inn) return null;

                  // If there are no events at all in this innings and no completed skins,
                  // treat the skin as not-yet-started → return null (so UI shows —)
                  if (
                    (inn.deliveries ?? 0) === 0 &&
                    (inn.completedSkins?.length ?? 0) === 0
                  ) {
                    return null;
                  }

                  // Completed skin
                  if (inn.completedSkins?.[skinIndex]) {
                    return inn.completedSkins[skinIndex].netRuns;
                  }

                  // Live skin: only show live net if this is the active skin and there have been deliveries
                  if (inn.skinIndex === skinIndex) {
                    return computeLiveSkinNet(inn);
                  }

                  return null;
                }

                const aNet = getSkinNet(state.innings[0], skin);
                const bNet = getSkinNet(state.innings[1], skin);

                // Only declare a winner after BOTH teams have completed this skin.
                const aCompleted = !!state.innings[0]?.completedSkins?.[skin];
                const bCompleted = !!state.innings[1]?.completedSkins?.[skin];

                let winner = "—";

                if (
                  aNet !== null &&
                  bNet !== null &&
                  aCompleted &&
                  bCompleted
                ) {
                  if (aNet > bNet) winner = state.teams.a.name;
                  else if (bNet > aNet) winner = state.teams.b.name;
                  else winner = "Tie";
                }

                // helper to read finishing pair (if any) for an innings' completed skin
                const finishingPairFor = (innIdx: 0 | 1) => {
                  const innings = state.innings[innIdx];
                  const entry = innings?.completedSkins?.[skin];
                  return entry?.batters && entry.batters.length
                    ? entry.batters
                    : null;
                };

                const aPair = finishingPairFor(0);
                const bPair = finishingPairFor(1);

                return (
                  <div
                    key={skin}
                    className="grid grid-cols-4 text-sm py-2 border-b"
                  >
                    <div>Skin {skin + 1}</div>

                    {/* Team A: net + finishing pair (if completed) */}
                    <div className="text-center">
                      {aNet ?? "—"}
                      {aCompleted && aPair ? (
                        <div
                          className="text-xs text-muted-foreground mt-1"
                          title={aPair.join(", ")}
                        >
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              display: "inline-block",
                              maxWidth: "160px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {aPair.join(" · ")}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* Team B: net + finishing pair (if completed) */}
                    <div className="text-center">
                      {bNet ?? "—"}
                      {bCompleted && bPair ? (
                        <div
                          className="text-xs text-muted-foreground mt-1"
                          title={bPair.join(", ")}
                        >
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              display: "inline-block",
                              maxWidth: "160px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {bPair.join(" · ")}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="text-center">{winner}</div>
                  </div>
                );
              })}
            </Card>

            <Card className="glass p-4 sm:p-6">
              <p
                className="text-sm font-semibold"
                data-testid="text-mode-heading"
              >
                Mode
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p
                    className="text-sm font-semibold"
                    data-testid="text-mode-value"
                  >
                    {isAdmin ? "Admin (Scorer)" : "Viewer (Read-only)"}
                  </p>
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-mode-help"
                  >
                    {isAdmin
                      ? "This device can update the score and manage innings."
                      : "This device can only view the match."}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    isAdmin
                      ? "bg-primary/10 text-primary"
                      : "bg-secondary text-secondary-foreground",
                  )}
                  data-testid="status-mode-chip"
                >
                  {isAdmin ? "Admin" : "Viewer"}
                </span>
              </div>

              <Separator className="my-4" />

              <div className="grid grid-cols-1 gap-2">
                <Button
                  variant="secondary"
                  className="tap pressable justify-start"
                  onClick={() => copy(viewerLink, "Viewer link copied")}
                  data-testid="button-copy-viewer-side"
                >
                  <Eye className="h-4 w-4" /> Copy viewer link
                </Button>

                {isAdmin ? (
                  <Button
                    variant="outline"
                    className="tap pressable justify-start"
                    onClick={() => copy(adminLink, "Admin link copied")}
                    data-testid="button-copy-admin-side"
                  >
                    <Crown className="h-4 w-4" /> Copy admin link
                  </Button>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
        {showResetConfirm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setShowResetConfirm(false)}
            />

            {/* dialog */}
            <div className="relative z-10 w-full max-w-lg rounded-xl bg-card p-6 shadow-lg">
              <h3 className="text-lg font-semibold">Confirm reset</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Are you sure you want to reset the match? This clears the
                current innings score. You can still use Undo to revert this
                action.
              </p>

              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowResetConfirm(false)}
                >
                  Cancel
                </Button>

                <Button
                  variant="destructive"
                  onClick={() => {
                    // call your existing resetMatch function and close the modal
                    resetMatch();
                    setShowResetConfirm(false);
                  }}
                  data-testid="button-confirm-reset"
                >
                  Reset match
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        <footer
          className="mt-8 pb-10 text-xs text-muted-foreground"
          data-testid="text-footer"
        >
          Tip: keep the scorer device in Admin mode; share the Viewer link with
          spectators.
        </footer>

        {teamObj ? (
          <ManageRoster
            teams={rosterTeams}
            initialTeamId={currentBattingTeamId}
            open={isRosterOpen}
            onClose={() => setRosterOpen(false)}
            onChange={(teamId, updatedTeam) => {
              safeSet({
                ...state,
                teams: {
                  ...state.teams,
                  [teamId]: {
                    ...(state.teams?.[teamId] ?? {}),
                    ...updatedTeam,
                  },
                },
              });
            }}
            onSubstitute={async (teamId, oldId, newId) => {
              // existing substitution logic...
            }}
            api={{
              // bind matchId + adminKey here so ManageRoster can call api.addPlayer(teamId, name)
              addPlayer: (teamId: string, name: string) =>
                teamApi.addPlayer(teamId, name, state.matchId, keyFromUrl),
              updatePlayer: (teamId: string, playerId: string, payload: any) =>
                teamApi.updatePlayer
                  ? teamApi.updatePlayer(teamId, playerId, payload)
                  : Promise.reject(new Error("Not implemented")),
              deactivatePlayer: (teamId: string, playerId: string) =>
                teamApi.deactivatePlayer
                  ? teamApi.deactivatePlayer(teamId, playerId)
                  : Promise.reject(new Error("Not implemented")),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function BigButton({
  label,
  sub,
  tone,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  sub: string;
  tone: "primary" | "secondary" | "accent" | "danger";
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  const toneClasses =
    tone === "primary"
      ? "bg-primary text-primary-foreground border border-primary/30"
      : tone === "accent"
        ? "bg-accent text-accent-foreground border border-accent/30"
        : tone === "danger"
          ? "bg-destructive text-destructive-foreground border border-destructive/30"
          : "bg-secondary text-secondary-foreground border";

  return (
    <Button
      className={cn(
        "tap pressable h-16 sm:h-20 rounded-2xl text-left justify-between px-4",
        toneClasses,
      )}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex items-end justify-between w-full">
        <div className="flex flex-col">
          <span className="text-2xl sm:text-3xl font-display leading-none">
            {label}
          </span>
          <span className="text-xs opacity-90">{sub}</span>
        </div>
        <span className="text-xs opacity-80">Tap</span>
      </div>
    </Button>
  );
}

function SmallStepper({
  title,
  disabled,
  onAdd,
  testBase,
  alt,
  altAction,
  altLabel,
}: {
  title: string;
  disabled?: boolean;
  onAdd: (n: number) => void;
  testBase: string;
  alt?: boolean;
  altAction?: (n: number) => void;
  altLabel?: string;
}) {
  const options = [1, 2, 3, 4];

  return (
    <Card className="bg-card/60 border p-3">
      <p
        className="text-sm font-semibold"
        data-testid={`text-extra-${testBase}`}
      >
        {title}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {options.map((n) => (
          <Button
            key={n}
            variant="secondary"
            className="tap pressable h-10 rounded-xl px-0"
            disabled={disabled}
            onClick={() => onAdd(n)}
            data-testid={`button-extra-${testBase}-${n}`}
          >
            +{n}
          </Button>
        ))}
      </div>
      {alt && altAction ? (
        <div className="mt-2">
          <Button
            variant="outline"
            className="tap pressable h-10 w-full rounded-xl"
            disabled={disabled}
            onClick={() => altAction(1)}
            data-testid={`button-extra-${testBase}-alt`}
          >
            {altLabel ?? "Alt"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm" data-testid={`label-${testId}`}>
        {label}
      </Label>
      <Input
        value={value}
        readOnly={disabled}
        onChange={(e) => {
          if (disabled) return;
          onChange(e.target.value);
        }}
        className={cn(
          "h-11 rounded-xl bg-card/70",
          disabled && "pointer-events-none opacity-60",
        )}
      />
    </div>
  );
}

function ScoreStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="rounded-2xl border bg-card/60 p-3">
      <p
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        data-testid={`label-${testId}`}
      >
        {label}
      </p>
      <p className="mt-1 font-display text-2xl" data-testid={`text-${testId}`}>
        {value}
      </p>
    </div>
  );
}

function OverLimitControl({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Card className="bg-card/60 border p-3">
      <p
        className="text-sm font-semibold"
        data-testid="text-overs-limit-heading"
      >
        Overs limit
      </p>
      <p
        className="text-xs text-muted-foreground"
        data-testid="text-overs-limit-sub"
      >
        Typical indoor: 16 overs.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          className="tap pressable h-10 w-12 rounded-xl"
          disabled={disabled}
          onClick={() => onChange(Math.max(1, value - 1))}
          data-testid="button-overs-minus"
        >
          −
        </Button>
        <div className="flex-1 rounded-xl border bg-card/60 px-3 py-2 text-center">
          <span
            className="text-sm font-semibold"
            data-testid="text-overs-value"
          >
            {value}
          </span>
        </div>
        <Button
          variant="secondary"
          className="tap pressable h-10 w-12 rounded-xl"
          disabled={disabled}
          onClick={() => onChange(Math.min(50, value + 1))}
          data-testid="button-overs-plus"
        >
          +
        </Button>
      </div>
    </Card>
  );
}

export default dynamic(() => Promise.resolve(ScoringApp), { ssr: false });

