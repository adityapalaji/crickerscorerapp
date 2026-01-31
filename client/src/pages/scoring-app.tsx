import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Copy,
  Crown,
  Eye,
  RotateCcw,
  Share2,
  Shield,
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

type Innings = {
  id: string;
  battingTeamId: string;
  bowlingTeamId: string;

  runs: number;
  wickets: number;
  balls: number;

  dotBalls: number;

  extras: {
    wide: number;
    noball: number;
    bye: number;
    legbye: number;
  };

  striker: string;
  nonStriker: string;
  bowler: string;

  overEvents: BallEvent[];
  lastOverSummary: BallEvent[];

  skinIndex: number;
  ballsInSkin: number;

  // 👇 THESE THREE LINES ARE WHAT “Extend Innings” MEANS
  usedBatters: string[];
  bowlerBalls: Record<string, number>;
  lastOverBowler: string | null;
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

  adminKey: string; // used only to gate UI locally + share link
  history: { snapshots: MatchState[] };
};

const STORAGE_PREFIX = "ic_scoring_match_v1:";
const MAX_BOWLER_BALLS = 12;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatOvers(balls: number) {
  const o = Math.floor(balls / 6);
  const b = balls % 6;
  return `${o}.${b}`;
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
    extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },
    striker: "Batter 1",
    nonStriker: "Batter 2",
    bowler: "Bowler 1",
    overEvents: [],
    lastOverSummary: [],
    skinIndex: 0,
    ballsInSkin: 0,
    lastOverBowler: null,
    usedBatters: [],
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

    oversLimit: 8,

    inningsIndex: 0,
    innings: [baseInnings],

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

function applyBallEvent(inn: Innings, ev: BallEvent): Innings {
  const next: Innings = {
    ...inn,
    runs: inn.runs + ev.runs,
    wickets: inn.wickets + (ev.isWicket ? 1 : 0),
    balls: inn.balls + (ev.countsBall ? 1 : 0),
    ballsInSkin: inn.ballsInSkin + (ev.countsBall ? 1 : 0),
    overEvents: [...inn.overEvents, ev],
    dotBalls: ev.type === "dot" ? inn.dotBalls + 1 : 0,
  };
  // Skin ends after 4 overs (24 balls)
  if (next.ballsInSkin === 24) {
    next.skinIndex += 1;
    next.ballsInSkin = 0;
  }

  if (ev.type === "wide")
    next.extras = { ...next.extras, wide: next.extras.wide + ev.runs };
  if (ev.type === "noball")
    next.extras = { ...next.extras, noball: next.extras.noball + ev.runs };
  if (ev.type === "bye")
    next.extras = { ...next.extras, bye: next.extras.bye + ev.runs };
  if (ev.type === "legbye")
    next.extras = { ...next.extras, legbye: next.extras.legbye + ev.runs };

  if (next.balls % 6 === 0 && next.overEvents.length) {
    next.lastOverSummary = next.overEvents;
    next.overEvents = [];
    next.lastOverBowler = inn.bowler; // 👈 record who bowled this over
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

function buildViewerLink(matchId: string) {
  return `${window.location.origin}/match/${encodeURIComponent(matchId)}?mode=viewer`;
}

function buildAdminLink(matchId: string, adminKey: string) {
  return `${window.location.origin}/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`;
}

export default function ScoringApp() {
  const { toast } = useToast();
  const [, params] = useRoute("/match/:matchId");
  const [location, setLocation] = useLocation();

  const matchIdFromRoute = params?.matchId;
  const url = useMemo(() => new URL(window.location.href), [location]);

  const roleFromUrl =
    (getQueryParam(url.search, "mode") as Role | null) ?? "admin";
  const keyFromUrl = getQueryParam(url.search, "key");

  const [state, setState] = useState<MatchState>(() => {
    const matchId = matchIdFromRoute ?? "default";
    const stored = loadMatch(matchId);
    const seed =
      stored ?? defaultMatch(matchId === "default" ? undefined : matchId);
    return seed;
  });

  const role: Role = useMemo(() => {
    if (roleFromUrl === "viewer") return "viewer";
    if (!keyFromUrl) return "viewer";
    return keyFromUrl === state.adminKey ? "admin" : "viewer";
  }, [roleFromUrl, keyFromUrl, state.adminKey]);

  const isAdmin = role === "admin";

  const currentInnings = state.innings[state.inningsIndex];
  const teamABatters = state.teams.a.players ?? [];
  const teamBBatters = state.teams.b.players ?? [];

  const battingPlayers =
    currentInnings.battingTeamId === "a"
      ? state.teams.a.players
      : state.teams.b.players;

  const bowlingPlayers =
    currentInnings.bowlingTeamId === "a"
      ? state.teams.a.players
      : state.teams.b.players;

  const usedBatters = new Set(
    state.innings
      .filter((inn, idx) => idx < state.inningsIndex) // previous innings only
      .flatMap((inn) => [inn.striker, inn.nonStriker]),
  );

  const bowlerOvers = currentInnings.bowlerBalls ?? {};

  const isSkinLocked = currentInnings.ballsInSkin > 0;

  const targetText = useMemo(() => {
    if (state.inningsIndex === 1) {
      const first = state.innings[0];
      return `Target: ${first.runs + 1}`;
    }
    return "";
  }, [state.inningsIndex, state.innings]);

  const matchStatusText = useMemo(() => {
    if (state.status === "setup") return "Ready to start";
    if (state.status === "live") return "Live";
    if (state.status === "innings_break") return "Innings break";
    return "Completed";
  }, [state.status]);

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
      bowlerBalls: {},
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
    const fresh = defaultMatch(undefined);
    safeSet(fresh);
    setLocation(
      buildAdminLink(fresh.matchId, fresh.adminKey).replace(
        window.location.origin,
        "",
      ),
      {
        replace: true,
      },
    );
    toast({
      title: "New match created",
      description: "Share the viewer link for spectators.",
    });
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
        teams: { a: { id: "a", name: a }, b: { id: "b", name: b } },
      }),
    );
  }

  function setMeta(title: string, venue: string) {
    safeSet(pushHistory({ ...state, title, venue }));
  }

  function setPlayers(striker: string, nonStriker: string, bowler: string) {
    const inn = state.innings[state.inningsIndex];

    // 🔒 Lock players once skin has started
    if (inn.ballsInSkin > 0) return;

    const updated: Innings = { ...inn, striker, nonStriker, bowler };
    const innings = [...state.innings];
    innings[state.inningsIndex] = updated;
    safeSet(pushHistory({ ...state, innings }));
  }

  function swapBatters() {
    const inn = state.innings[state.inningsIndex];
    setPlayers(inn.nonStriker, inn.striker, inn.bowler);
  }

  function toggleTeamsForNextInnings() {
    const prev = state.innings[state.inningsIndex];

    const nextInnings: Innings = {
      id: uid("inn"),
      battingTeamId: prev.bowlingTeamId,
      bowlingTeamId: prev.battingTeamId,

      runs: 0,
      wickets: 0,
      balls: 0,

      dotBalls: 0,

      extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },

      striker: "Batter 1",
      nonStriker: "Batter 2",
      bowler: "Bowler 1",

      overEvents: [],
      lastOverSummary: [],

      // 🔑 REQUIRED for indoor rules
      skinIndex: 0,
      ballsInSkin: 0,

      // 🔑 REQUIRED for bowling rules
      bowlerBalls: {},
      lastOverBowler: null,
      usedBatters: [],
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
    safeSet(pushHistory({ ...state, status: "innings_break" }));
  }

  function addEvent(ev: BallEvent) {
    // 🔍 Use CURRENT state only for validation
    const currentInn = state.innings[state.inningsIndex];

    // 🚫 1) Enforce bowling rules only on legal balls
    if (ev.countsBall) {
      const bowler = currentInn.bowler;
      const ballsBowled = currentInn.bowlerBalls[bowler] ?? 0;

      // ❌ Max 2 overs per bowler
      if (ballsBowled >= 12) {
        toast({
          title: "Bowling limit reached",
          description: `${bowler} has already bowled 2 overs.`,
          variant: "destructive",
        });
        return;
      }

      // ❌ Prevent consecutive overs
      const isStartOfNewOver = currentInn.balls % 6 === 0;

      if (
        isStartOfNewOver &&
        currentInn.lastOverBowler === bowler &&
        currentInn.balls > 0
      ) {
        toast({
          title: "Invalid bowler",
          description: `${bowler} cannot bowl consecutive overs.`,
          variant: "destructive",
        });
        return;
      }
    }

    // 📸 2) Save history snapshot
    const withHistory = pushHistory(state);

    const inn = state.innings[state.inningsIndex];

    if (ev.countsBall && inn.balls % 6 === 0 && inn.balls > 0 && !inn.bowler) {
      toast({
        title: "Select bowler",
        description: "Please select a bowler for the next over.",
        variant: "destructive",
      });
      return;
    }

    // 🧮 3) Apply event to cloned state
    const historyInn = withHistory.innings[withHistory.inningsIndex];
    const updatedInn = applyBallEvent(historyInn, ev);

    const innings = [...withHistory.innings];
    innings[withHistory.inningsIndex] = updatedInn;

    // ✅ 4) Commit
    safeSet({ ...withHistory, innings, status: "live" });
  }

  function addRun(runs: number) {
    const inn = state.innings[state.inningsIndex];

    // DOT ball
    if (runs === 0) {
      const nextDotCount = inn.dotBalls + 1;

      // AUTO OUT on 3rd dot ball
      if (nextDotCount === 3) {
        addEvent({
          id: uid("ball"),
          ts: Date.now(),
          type: "wicket",
          runs: -5,
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

    // NORMAL RUN (1–6)
    addEvent({
      id: uid("ball"),
      ts: Date.now(),
      type: "run",
      runs,
      countsBall: true,
    });
  }

  function addWicket() {
    addEvent({
      id: uid("ball"),
      ts: Date.now(),
      type: "wicket",
      runs: -5,
      countsBall: true,
      isWicket: true,
      note: "Wicket -5",
    });
  }

  function addExtra(type: "wide" | "noball" | "bye" | "legbye", runs: number) {
    const inn = state.innings[state.inningsIndex];

    // Current over number (1-based)
    const currentOver = Math.floor(inn.balls / 6) + 1;

    const isWideOrNoBall = type === "wide" || type === "noball";

    // Indoor rule:
    // Wide / No Ball = 2 default runs + selected runs
    const totalRuns = isWideOrNoBall ? runs + 2 : runs;

    // Ball counting rule:
    // Overs 1–15 → WD/NB counts as ball
    // Over 16 → WD/NB does NOT count as ball
    const countsBall = isWideOrNoBall
      ? currentOver < 16
      : type === "bye" || type === "legbye";

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

  const totalScore = `${currentInnings.runs}/${currentInnings.wickets}`;
  const oversText = `${formatOvers(currentInnings.balls)} ov`;
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
              onClick={() => (window.location.href = "/")}
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
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                          state.status === "live"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary text-secondary-foreground",
                        )}
                        data-testid="status-match"
                      >
                        <Shield className="h-3.5 w-3.5 mr-1" />{" "}
                        {matchStatusText}
                      </span>
                      <span
                        className="inline-flex items-center rounded-full bg-card/60 border px-2.5 py-1 text-xs font-semibold"
                        data-testid="status-innings"
                      >
                        Innings {state.inningsIndex + 1} • {battingName} batting
                      </span>
                      {targetText ? (
                        <span
                          className="inline-flex items-center rounded-full bg-accent/10 text-accent px-2.5 py-1 text-xs font-semibold"
                          data-testid="status-target"
                        >
                          {targetText}
                        </span>
                      ) : null}
                      <span
                        className="inline-flex items-center rounded-full bg-card/60 border px-2.5 py-1 text-xs font-semibold"
                        data-testid="status-overs-limit"
                      >
                        {state.oversLimit} ov match
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
                  <Card className="bg-card/60 border p-3">
                    <p
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-testid="text-batting-label"
                    >
                      Batting
                    </p>
                    <p
                      className="mt-1 font-semibold"
                      data-testid="text-batting-team"
                    >
                      {battingName}
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="text-batters"
                    >
                      {currentInnings.striker} (str) •{" "}
                      {currentInnings.nonStriker} (ns)
                    </p>
                  </Card>
                  <Card className="bg-card/60 border p-3">
                    <p
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-testid="text-bowling-label"
                    >
                      Bowling
                    </p>
                    <p
                      className="mt-1 font-semibold"
                      data-testid="text-bowling-team"
                    >
                      {bowlingName}
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="text-bowler"
                    >
                      {currentInnings.bowler}
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
                    <p>
                      You’re in <strong>Viewer mode</strong>. Scoring is
                      disabled on this device.
                    </p>

                    <Button
                      variant="default"
                      className="tap pressable w-full"
                      onClick={startNewMatch}
                    >
                      Start New Match (Admin)
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      This will create a new match and open it in Admin mode.
                    </p>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card className="glass p-4 sm:p-6">
              <Tabs defaultValue="controls">
                <div className="flex items-center justify-between gap-3">
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

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      className="tap pressable"
                      disabled={
                        !isAdmin || state.history.snapshots.length === 0
                      }
                      onClick={undo}
                      data-testid="button-undo"
                    >
                      <Undo2 className="h-4 w-4" /> Undo
                    </Button>
                    <Button
                      variant="outline"
                      className="tap pressable"
                      disabled={!isAdmin}
                      onClick={resetMatch}
                      data-testid="button-reset"
                    >
                      <RotateCcw className="h-4 w-4" /> Reset
                    </Button>
                  </div>
                </div>

                <TabsContent value="controls" className="mt-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                    <BigButton
                      label="0"
                      sub="Dot"
                      tone="secondary"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(0)}
                      testId="button-run-0"
                    />
                    <BigButton
                      label="1"
                      sub="Run"
                      tone="primary"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(1)}
                      testId="button-run-1"
                    />
                    <BigButton
                      label="2"
                      sub="Runs"
                      tone="primary"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(2)}
                      testId="button-run-2"
                    />
                    <BigButton
                      label="3"
                      sub="Runs"
                      tone="primary"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(3)}
                      testId="button-run-3"
                    />
                    <BigButton
                      label="4"
                      sub="Boundary"
                      tone="accent"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(4)}
                      testId="button-run-4"
                    />
                    <BigButton
                      label="5"
                      sub="Runs"
                      tone="primary"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(5)}
                      testId="button-run-5"
                    />

                    <BigButton
                      label="6"
                      sub="Max"
                      tone="accent"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={() => addRun(6)}
                      testId="button-run-6"
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                    <BigButton
                      label="W"
                      sub="Wicket"
                      tone="danger"
                      disabled={!isAdmin || !state.setupCompleted}
                      onClick={addWicket}
                      testId="button-wicket"
                    />
                    <Card className="bg-card/60 border p-3">
                      <p className="text-sm font-semibold">Wide</p>

                      {/* Default Wide (+2 runs) */}
                      <Button
                        variant="secondary"
                        className="tap pressable h-10 w-full rounded-xl mb-2"
                        disabled={!isAdmin || !state.setupCompleted}
                        onClick={() => addExtra("wide", 0)}
                      >
                        Wide (+2)
                      </Button>

                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((n) => (
                          <Button
                            key={n}
                            variant="secondary"
                            className="tap pressable h-10 rounded-xl px-0"
                            disabled={!isAdmin || !state.setupCompleted}
                            onClick={() => addExtra("wide", n)}
                          >
                            +{n}
                          </Button>
                        ))}
                      </div>
                    </Card>

                    <Card className="bg-card/60 border p-3">
                      <p className="text-sm font-semibold">No Ball</p>

                      {/* Default No Ball (+2 runs) */}
                      <Button
                        variant="secondary"
                        className="tap pressable h-10 w-full rounded-xl mb-2"
                        disabled={!isAdmin || !state.setupCompleted}
                        onClick={() => addExtra("noball", 0)}
                      >
                        No Ball (+2)
                      </Button>

                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((n) => (
                          <Button
                            key={n}
                            variant="secondary"
                            className="tap pressable h-10 rounded-xl px-0"
                            disabled={!isAdmin || !state.setupCompleted}
                            onClick={() => addExtra("noball", n)}
                          >
                            +{n}
                          </Button>
                        ))}
                      </div>
                    </Card>

                    <SmallStepper
                      title="Bye/LB"
                      onAdd={(n) => addExtra("bye", n)}
                      disabled={!isAdmin || !state.setupCompleted}
                      testBase="bye"
                      alt
                      altAction={(n) => addExtra("legbye", n)}
                      altLabel="Leg bye"
                    />
                  </div>

                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="tap pressable"
                        disabled={!isAdmin}
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
                          className="tap pressable"
                          disabled={!isAdmin || !state.setupCompleted}
                          onClick={startMatch}
                          data-testid="button-start"
                        >
                          Start / Resume
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="tap pressable"
                          disabled={!isAdmin}
                          onClick={endInnings}
                          data-testid="button-end-innings"
                        >
                          End innings
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Striker</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card px-3"
                        disabled={!isAdmin || !state.setupCompleted}
                        value={currentInnings.striker}
                        onChange={(e) =>
                          setPlayers(
                            e.target.value,
                            currentInnings.nonStriker,
                            currentInnings.bowler,
                          )
                        }
                      >
                        <option value="">Select striker</option>
                        {battingPlayers.map((p) => (
                          <option
                            key={p}
                            value={p}
                            disabled={
                              p === currentInnings.nonStriker ||
                              usedBatters.has(p)
                            }
                          >
                            {p} {usedBatters.has(p) ? "(used)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label>Non-Striker</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card px-3"
                        disabled={!isAdmin || !state.setupCompleted}
                        value={currentInnings.nonStriker}
                        onChange={(e) =>
                          setPlayers(
                            currentInnings.striker,
                            e.target.value,
                            currentInnings.bowler,
                          )
                        }
                      >
                        <option value="">Select non-striker</option>
                        {battingPlayers.map((p) => (
                          <option
                            key={p}
                            value={p}
                            disabled={
                              p === currentInnings.striker || usedBatters.has(p)
                            }
                          >
                            {p} {usedBatters.has(p) ? "(used)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label>Bowler</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card px-3"
                        disabled={!isAdmin || !state.setupCompleted}
                        value={currentInnings.bowler}
                        onChange={(e) =>
                          setPlayers(
                            currentInnings.striker,
                            currentInnings.nonStriker,
                            e.target.value,
                          )
                        }
                      >
                        <option value="">Select bowler</option>
                        {bowlingPlayers.map((p) => {
                          const balls = bowlerOvers[p] ?? 0;
                          const overs = Math.floor(balls / 6);

                          const disabled =
                            overs >= 2 || p === currentInnings.lastOverBowler;

                          return (
                            <option key={p} value={p} disabled={disabled}>
                              {p}
                              {overs >= 2 ? " (2 overs done)" : ""}
                              {p === currentInnings.lastOverBowler
                                ? " (last over)"
                                : ""}
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
              <p
                className="text-sm font-semibold"
                data-testid="text-summary-heading"
              >
                Live scoreboard
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <ScoreStat
                  label="Runs"
                  value={`${currentInnings.runs}`}
                  testId="stat-runs"
                />
                <ScoreStat
                  label="Wkts"
                  value={`${currentInnings.wickets}`}
                  testId="stat-wkts"
                />
                <ScoreStat
                  label="Overs"
                  value={formatOvers(currentInnings.balls)}
                  testId="stat-overs"
                />
                <ScoreStat
                  label="Extras"
                  value={`${extrasText}`}
                  testId="stat-extras"
                />
              </div>

              <Separator className="my-4" />

              <div className="grid grid-cols-1 gap-3">
                <Card className="bg-card/60 border p-3">
                  <p
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    data-testid="text-now-batting"
                  >
                    Now batting
                  </p>
                  <p
                    className="mt-1 text-sm"
                    data-testid="text-now-batting-value"
                  >
                    <span className="font-semibold">
                      {currentInnings.striker}
                    </span>{" "}
                    &nbsp;•&nbsp; {currentInnings.nonStriker}
                  </p>
                </Card>
                <Card className="bg-card/60 border p-3">
                  <p
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    data-testid="text-now-bowling"
                  >
                    Current bowler
                  </p>
                  <p
                    className="mt-1 text-sm"
                    data-testid="text-now-bowler-value"
                  >
                    <span className="font-semibold">
                      {currentInnings.bowler}
                    </span>
                  </p>
                </Card>
              </div>

              <Separator className="my-4" />

              <div>
                <p
                  className="text-sm font-semibold"
                  data-testid="text-recent-events"
                >
                  Recent balls
                </p>
                <div
                  className="mt-2 flex flex-wrap gap-1"
                  data-testid="list-recent-balls"
                >
                  {state.innings[state.inningsIndex].lastOverSummary
                    .slice(-12)
                    .concat(state.innings[state.inningsIndex].overEvents)
                    .slice(-12)
                    .map((ev, idx) => (
                      <span
                        key={`${ev.id}_${idx}`}
                        className={cn(
                          "inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-semibold",
                          pillTone(ev),
                        )}
                        data-testid={`pill-recent-${idx}`}
                      >
                        {eventLabel(ev)}
                      </span>
                    ))}
                </div>
              </div>
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

        <footer
          className="mt-8 pb-10 text-xs text-muted-foreground"
          data-testid="text-footer"
        >
          Tip: keep the scorer device in Admin mode; share the Viewer link with
          spectators.
        </footer>
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
