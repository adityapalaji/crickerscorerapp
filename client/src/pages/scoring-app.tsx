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

  adminKey: string; // used only to gate UI locally + share link
  history: { snapshots: MatchState[] };
};

const STORAGE_PREFIX = "ic_scoring_match_v1:";
const MAX_BOWLER_BALLS = 12;
const TOTAL_SKINS = 4;

const WICKET_PENALTY = 5;

function computeInningsNet(inn: Innings): number {
  return inn.runs - inn.wickets * WICKET_PENALTY;
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

    next.completedSkins = [
      ...completed,
      {
        skin: next.skinIndex + 1,
        grossRuns: updatedCurrentSkin.grossRuns,
        wickets: updatedCurrentSkin.wickets,
        netRuns: skinNet,
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

  if (next.balls % 6 === 0 && next.overEvents.length) {
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

function buildViewerLink(matchId: string) {
  return `${window.location.origin}/match/${encodeURIComponent(matchId)}?mode=viewer`;
}

function buildAdminLink(matchId: string, adminKey: string) {
  return `${window.location.origin}/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`;
}

export default function ScoringApp() {
  console.log("🚀 ScoringApp rendered");
  const { toast } = useToast();
  const [, params] = useRoute("/match/:matchId");
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"controls" | "players" | "match">(
    "controls",
  );

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

  const battingPlayers: string[] = useMemo(() => {
    if (!currentInnings) return [];

    if (currentInnings.battingTeamId === "a") {
      return state.teams.a.players ?? [];
    }

    if (currentInnings.battingTeamId === "b") {
      return state.teams.b.players ?? [];
    }

    return [];
  }, [currentInnings, state.teams.a.players, state.teams.b.players]);

  const bowlingPlayers: string[] = useMemo(() => {
    if (!currentInnings) return [];

    if (currentInnings.bowlingTeamId === "a") {
      return state.teams.a.players ?? [];
    }

    if (currentInnings.bowlingTeamId === "b") {
      return state.teams.b.players ?? [];
    }

    return [];
  }, [currentInnings, state.teams.a.players, state.teams.b.players]);

  const usedBatters = useMemo(() => {
    return new Set(currentInnings.usedBatters ?? []);
  }, [currentInnings.usedBatters]);

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

  // derived near existing matchEnded/matchCompleted variables

  const teamARuns = state.innings[0]?.runs ?? 0;
  const teamBRuns = state.innings[1]?.runs ?? 0;

  // -- Replace the old matchResult calculation with this --
  let matchResult = "";

  if (matchEnded) {
    if (teamARuns > teamBRuns) {
      // Option A: normal case-sensitive team name
      matchResult = `${state.teams.a.name} won`;
      // Option B: uppercase "TEAM A WON"
      // matchResult = `${state.teams.a.name.toUpperCase()} WON`;
    } else if (teamBRuns > teamARuns) {
      matchResult = `${state.teams.b.name} won`;
      // Or uppercase:
      // matchResult = `${state.teams.b.name.toUpperCase()} WON`;
    } else {
      matchResult = "Match tied";
      // Or "Tie" if you prefer shorter:
      // matchResult = "Match tied";
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
  <p className="text-xs text-muted-foreground mb-3">{matchStatusText}</p>;

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

  function addWicket() {
    if (!isReadyToScore) {
      toast({
        title: "Select players first",
        description:
          "Please select striker, non-striker, and bowler before scoring.",
        variant: "destructive",
      });
      return;
    }

    addEvent({
      id: uid("ball"),
      ts: Date.now(),
      type: "wicket",
      runs: 0,
      countsBall: true,
      isWicket: true,
      note: "Wicket -5",
    });
  }

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
                    <div className="inline-flex gap-2 items-center">
                      {/* Skin only shown after setup/when live */}
                      {(state.setupCompleted || state.status !== "setup") && (
                        <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                          {`Skin ${currentInnings.skinIndex + 1} / ${TOTAL_SKINS}`}
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
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as any)}
              >
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
                      disabled={isMatchCompleted}
                      onClick={undo}
                      data-testid="button-undo"
                    >
                      <Undo2 className="h-4 w-4" /> Undo
                    </Button>
                    <Button
                      variant="outline"
                      className="tap pressable"
                      disabled={isMatchCompleted}
                      onClick={resetMatch}
                      data-testid="button-reset"
                    >
                      <RotateCcw className="h-4 w-4" /> Reset
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
                    <Card className="bg-card/60 border p-3">
                      <p className="text-sm font-semibold">Wide</p>

                      {/* Default Wide (+2 runs) */}
                      <Button
                        variant="secondary"
                        className="tap pressable h-10 w-full rounded-xl mb-2"
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

                      <div className="grid grid-cols-4 gap-1">
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
                    </Card>

                    <Card className="bg-card/60 border p-3">
                      <p className="text-sm font-semibold">No Ball</p>

                      {/* Default No Ball (+2 runs) */}
                      <Button
                        variant="secondary"
                        className="tap pressable h-10 w-full rounded-xl mb-2"
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

                      <div className="grid grid-cols-4 gap-1">
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
                    </Card>

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
                          variant="secondary"
                          className="rounded-md"
                          onClick={toggleTeamsForNextInnings} // existing handler
                          disabled={nextInningsDisabled}
                          data-testid="btn-next-innings"
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
                          const updated: Innings = {
                            ...inn,
                            bowler: value,
                          };

                          const innings = [...state.innings];
                          innings[state.inningsIndex] = updated;
                          safeSet({ ...state, innings });
                        }}
                      >
                        <option value="">Select bowler</option>
                        {bowlingPlayers.map((p) => {
                          const balls = bowlerBalls[p] ?? 0;
                          const overs = Math.floor(balls / 6);

                          const isConsecutive =
                            isAtOverBreak &&
                            currentInnings.lastOverBowler === p;

                          const isMaxed = overs >= 2;

                          return (
                            <option
                              key={p}
                              value={p}
                              disabled={isMaxed || isConsecutive}
                            >
                              {p} ({overs}/2)
                              {isMaxed ? " – max" : ""}
                              {isConsecutive ? " – last over" : ""}
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
              <p className="text-sm font-semibold mb-2">Match Summary</p>

              {/* Friendly status line */}
              <p className="text-xs text-muted-foreground mb-3">
                {matchStatusText}
              </p>

              {/* If match has ended, show the overall match result prominently */}
              {matchEnded && matchResult ? (
                <div className="mb-3">
                  <div className="text-sm font-semibold mb-1">Result</div>
                  <div className="text-base font-bold text-primary">
                    {matchResult}
                  </div>
                </div>
              ) : null}

              {/* Per-innings summary lines */}
              {[0, 1].map((idx) => {
                const inn = state.innings[idx];
                if (!inn) return null;

                const team =
                  inn.battingTeamId === "a"
                    ? state.teams.a.name
                    : state.teams.b.name;

                const gross = inn.runs;
                const outs = inn.wickets;

                const completedNet =
                  inn.completedSkins?.reduce(
                    (sum, skin) => sum + skin.netRuns,
                    0,
                  ) ?? 0;

                const liveNet =
                  (inn.currentSkin?.grossRuns ?? 0) -
                  (inn.currentSkin?.wickets ?? 0) * WICKET_PENALTY;

                const net = completedNet + liveNet;
                const overs = formatOvers(inn.balls, state.oversLimit);

                const noPlay =
                  (inn.deliveries ?? 0) === 0 &&
                  (inn.completedSkins?.length ?? 0) === 0;

                const displayNet = noPlay ? "—" : net;

                return (
                  <div key={idx} className="text-sm mb-2">
                    <span className="font-semibold">{team}:</span> Net{" "}
                    {displayNet} (Gross {gross}, Outs {outs}) • Overs {overs}/
                    {state.oversLimit}
                  </div>
                );
              })}
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

                return (
                  <div
                    key={skin}
                    className="grid grid-cols-4 text-sm py-2 border-b"
                  >
                    <div>Skin {skin + 1}</div>
                    <div className="text-center">{aNet ?? "—"}</div>
                    <div className="text-center">{bNet ?? "—"}</div>
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
