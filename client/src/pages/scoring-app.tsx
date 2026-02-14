import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, Copy, Crown, Eye, RotateCcw, Share2, Undo2 } from "lucide-react";

import ManageRoster from "../components/ui/ManageRoster";
import * as teamApi from "../api/teams";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  createMatchInCloud,
  fetchMatchFromCloud,
  saveMatchToCloud,
} from "../lib/cloudSync";

type Role = "admin" | "viewer";

type ScoreboardDisplayType = "skins" | "traditional";

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

  strikerAtEvent?: string;
  nonStrikerAtEvent?: string;
  bowlerAtEvent?: string;

  batterRuns?: number;
};

type SkinScore = {
  skin: number;
  grossRuns: number;
  wickets: number;
  netRuns: number;
  batters?: string[];
};

type Innings = {
  id: string;
  battingTeamId: string;
  bowlingTeamId: string;
  awaitingBatsmanSelection: boolean;

  runs: number;
  wickets: number;
  balls: number;
  deliveries: number;

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

  batterSkinById?: Record<string, number>;
  usedBatters: string[];
};

type MatchState = {
  version: number;
  matchId: string;
  createdAt: number;
  updatedAt: number;
  setupCompleted: boolean;

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

  tossWinner?: "a" | "b" | null;
  tossChoice?: "bat" | "bowl" | null;

  scoreboardDisplay?: ScoreboardDisplayType;

  adminKey: string;
  history: { snapshots: MatchState[] };
};

const STORAGE_PREFIX = "ic_scoring_match_v1:";
const TOTAL_SKINS = 4;
const WICKET_PENALTY = 5;

type BatterStat = {
  name: string;
  runs: number;
  balls: number;
  outs: number;
  skin: number | null;
};

function computeBattingCard(inn: Innings | null): BatterStat[] {
  if (!inn) return [];

  const skinMap = inn.batterSkinById ?? {};

  const stats = new Map<string, BatterStat>();
  const ensure = (name: string) => {
    const key = String(name || "").trim();
    if (!key) return null;
    if (!stats.has(key)) {
      stats.set(key, {
        name: key,
        runs: 0,
        balls: 0,
        outs: 0,
        skin: skinMap[key] ?? null,
      });
    }
    return stats.get(key)!;
  };

  for (const ev of (inn.allBalls ?? []) as BallEvent[]) {
    const striker = String(ev.strikerAtEvent ?? "").trim();
    const s = ensure(striker);
    if (!s) continue;

    s.runs += Number(ev.batterRuns ?? 0);
    if (ev.countsBall) s.balls += 1;
    if (ev.isWicket || ev.type === "wicket") s.outs += 1;

    if (s.skin == null && skinMap[striker] != null) {
      s.skin = skinMap[striker];
    }
  }

  ensure(inn.striker);
  ensure(inn.nonStriker);

  const all = Array.from(stats.values());
  all.sort((a, b) => {
    const aActive = a.name === inn.striker || a.name === inn.nonStriker;
    const bActive = b.name === inn.striker || b.name === inn.nonStriker;
    if (aActive && !bActive) return -1;
    if (bActive && !aActive) return 1;

    // Sort by runs desc, outs asc, balls desc
    if (b.runs !== a.runs) return b.runs - a.runs;
    if (a.outs !== b.outs) return a.outs - b.outs;
    if (b.balls !== a.balls) return b.balls - a.balls;
    return a.name.localeCompare(b.name);
  });

  return all;
}

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

    if (!parsed.scoreboardDisplay) parsed.scoreboardDisplay = "skins";

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
    batterSkinById: {},
    allBalls: [],
    currentSkin: {
      grossRuns: 0,
      wickets: 0,
    },
  };

  return {
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

    tossWinner: null,
    tossChoice: null,

    status: "setup",
    setupCompleted: false,

    scoreboardDisplay: "skins",

    adminKey,
    history: { snapshots: [] },
  };
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

function totalExtras(extras: {
  wide: number;
  noball: number;
  bye: number;
  legbye: number;
}) {
  const w = extras?.wide ?? 0;
  const nb = extras?.noball ?? 0;
  const b = extras?.bye ?? 0;
  const lb = extras?.legbye ?? 0;
  const parts: string[] = [];
  if (w) parts.push(`Wd ${w}`);
  if (nb) parts.push(`Nb ${nb}`);
  if (b) parts.push(`B ${b}`);
  if (lb) parts.push(`Lb ${lb}`);
  return parts.length ? parts.join(", ") : "0";
}

function getQueryParam(search: string, key: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  return params.get(key);
}

function getOrigin() {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

function buildViewerLink(matchId: string) {
  return `${getOrigin()}/match/${encodeURIComponent(matchId)}?mode=viewer`;
}

function buildAdminLink(matchId: string, adminKey: string) {
  return `${getOrigin()}/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`;
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
          <span className="text-2xl sm:text-3xl font-display leading-none">{label}</span>
          <span className="text-xs opacity-90">{sub}</span>
        </div>
        <span className="text-xs opacity-80">Tap</span>
      </div>
    </Button>
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

function TraditionalScoreboardCard({
  state,
  teamAName,
  teamBName,
  inningsA,
  inningsB,
}: {
  state: MatchState;
  teamAName: string;
  teamBName: string;
  inningsA: Innings | null;
  inningsB: Innings | null;
}) {
  const activeInnings: Innings | null =
    state.inningsIndex >= 1
      ? state.innings?.[state.inningsIndex] ?? inningsB ?? inningsA
      : state.innings?.[0] ?? inningsA ?? inningsB;

  const previousInnings: Innings | null =
    state.inningsIndex >= 1 ? state.innings?.[state.inningsIndex - 1] ?? inningsA : null;

  const [showPreviousInnings, setShowPreviousInnings] = useState(false);
  const [showAllBatters, setShowAllBatters] = useState(false);

  const teamNameForInnings = (inn: Innings | null) => {
    if (!inn) return "—";
    return inn.battingTeamId === "a" ? teamAName : teamBName;
  };

  const renderInningsScorecard = (inn: Innings | null) => {
    if (!inn) return null;

    const battingTeamName = teamNameForInnings(inn);
    const innNet = computeInningsNet(inn);

    const totalOuts = inn.wickets ?? 0;
    const totalOvers = formatOvers(inn.balls ?? 0, state.oversLimit);

    const extras = inn.extras ?? { wide: 0, noball: 0, bye: 0, legbye: 0 };
    const extrasTotal =
      (extras.wide ?? 0) +
      (extras.noball ?? 0) +
      (extras.bye ?? 0) +
      (extras.legbye ?? 0);

    const batters = computeBattingCard(inn);
    const visibleBatters = (batters ?? []).map((b) => ({
      ...b,
      runs: Number(b.runs ?? 0) - Number(b.outs ?? 0) * WICKET_PENALTY,
    }));

    const filteredBatters = showAllBatters
      ? visibleBatters
      : visibleBatters.filter((b) => {
          const isActive = b.name === inn.striker || b.name === inn.nonStriker;
          return isActive || Number(b.balls ?? 0) > 0 || Number(b.outs ?? 0) > 0;
        });

    return (
      <div className="mt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{battingTeamName}</p>
          </div>
          <div className="text-right">
            <div className="flex items-baseline justify-end gap-2">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">NET</span>
              <span className="text-2xl font-display leading-none tabular-nums">
                {innNet}/{totalOuts}
              </span>
              <span className="text-sm font-medium text-muted-foreground tabular-nums">
                ({totalOvers} Ov)
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-sm font-semibold">Batters</p>
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => setShowAllBatters((v) => !v)}
          >
            {showAllBatters ? "Hide Completed Players ▲" : "Show Full Scoreboard ▼"}
          </Button>
        </div>

        <div className="mt-2 grid grid-cols-[1fr,3rem,3rem,3.5rem] gap-2 text-xs font-semibold text-muted-foreground border-b pb-2">
          <div>Batters</div>
          <div className="text-right">R</div>
          <div className="text-right">B</div>
          <div className="text-right">Outs</div>
        </div>

        {filteredBatters.length ? (
          <div className="divide-y">
            {filteredBatters.map((b) => (
              <div
                key={b.name}
                className="grid grid-cols-[1fr,3rem,3rem,3.5rem] gap-2 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate" title={b.name}>
                    {b.name}
                  </div>
                  {b.skin != null ? (
                    <div className="mt-1">
                      <span className="inline-flex items-center rounded-md border bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Skin {b.skin}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="text-right tabular-nums">{b.runs}</div>
                <div className="text-right tabular-nums">{b.balls}</div>
                <div className="text-right tabular-nums">{b.outs}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No batting data yet.</p>
        )}

        <div className="mt-3 border-t pt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Extras</span>
            <span className="tabular-nums">
              {extrasTotal}{" "}
              <span className="text-muted-foreground">
                (wd {extras.wide ?? 0}, nb {extras.noball ?? 0}, b {extras.bye ?? 0}, lb {extras.legbye ?? 0})
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {innNet}/{totalOuts} <span className="text-muted-foreground">({totalOvers} Ov)</span>
            </span>
          </div>
        </div>

        {/* Bowlers section omitted in this simplified recovery build */}
      </div>
    );
  };

  return (
    <Card className="glass p-4 sm:p-6">
      <div className="mb-3">
        <div className="text-xs font-semibold tracking-widest text-muted-foreground">SCOREBOARD</div>
      </div>

      {/* Current innings always visible */}
      {renderInningsScorecard(activeInnings)}

      {/* Previous innings collapsible */}
      {previousInnings ? (
        <div className="mt-4">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => setShowPreviousInnings((v) => !v)}
            >
              {showPreviousInnings
                ? "Hide 1st Innings Scorecard ▲"
                : "View 1st Innings Scorecard ▼"}
            </Button>
          </div>

          {showPreviousInnings ? (
            <div className="mt-2 rounded-xl border bg-card/40 p-3">
              {renderInningsScorecard(previousInnings)}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function ScoringApp() {
  const { toast } = useToast();
  const [, params] = useRoute<{ matchId: string }>("/match/:matchId");
  const [location] = useLocation();

  const matchIdFromRoute = params ? params.matchId : null;
  const url = useMemo(() => {
    if (typeof window === "undefined") return new URL(`http://localhost${location ?? ""}`);
    return new URL(window.location.href);
  }, [location]);

  const roleFromUrl = (getQueryParam(url.search, "mode") as Role | null) ?? "admin";
  const [keyFromUrl] = useState<string | null>(() => getQueryParam(url.search, "key"));
  const isExplicitAdminRequest = roleFromUrl === "admin";

  const [state, setState] = useState<MatchState>(() => {
    const matchId = matchIdFromRoute ?? "default";
    return loadMatch(matchId) ?? defaultMatch(matchId === "default" ? undefined : matchId);
  });

  const role: Role = useMemo(() => {
    if (roleFromUrl === "viewer") return "viewer";
    if (!keyFromUrl) return "viewer";
    return keyFromUrl === state.adminKey ? "admin" : "viewer";
  }, [roleFromUrl, keyFromUrl, state.adminKey]);

  const isAdmin = role === "admin";
  const needsAdminLink = isExplicitAdminRequest && !isAdmin;
  const adminKeyForCloud = keyFromUrl ?? state.adminKey;

  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >(matchIdFromRoute ? "loading" : "idle");

  const cloudSaveTimerRef = useRef<any>(null);

  useEffect(() => {
    if (!matchIdFromRoute) return;
    let cancelled = false;

    (async () => {
      try {
        setCloudSyncStatus("loading");
        const cloud = await fetchMatchFromCloud(matchIdFromRoute);
        if (cancelled) return;

        if (cloud) {
          setState(cloud as any);
          try {
            saveMatch(cloud as any);
          } catch {
            // ignore
          }
          setCloudSyncStatus("saved");
        } else {
          setCloudSyncStatus("idle");
        }
      } catch {
        if (cancelled) return;
        setCloudSyncStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [matchIdFromRoute]);

  useEffect(() => {
    if (!matchIdFromRoute) return;
    if (!isAdmin) return;
    if (cloudSyncStatus === "loading") return;

    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);

    cloudSaveTimerRef.current = setTimeout(async () => {
      try {
        setCloudSyncStatus("saving");
        const saved = await saveMatchToCloud(
          matchIdFromRoute,
          state,
          adminKeyForCloud,
        );
        setState(saved as any);
        setCloudSyncStatus("saved");
      } catch {
        setCloudSyncStatus("error");
      }
    }, 1200);

    return () => {
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    };
  }, [state, matchIdFromRoute, isAdmin, adminKeyForCloud, cloudSyncStatus]);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"controls" | "players" | "match">("controls");

  const currentInnings = state.innings[state.inningsIndex];
  const currentBattingTeamId = currentInnings?.battingTeamId;

  const battingName =
    currentBattingTeamId === "a" ? state.teams.a.name : state.teams.b.name;

  const matchStatusText = useMemo(() => {
    if (state.status === "setup") {
      return state.setupCompleted ? "Ready to start" : "Not started";
    }
    if (state.status === "live") return "Live";
    if (state.status === "innings_break") return "Innings break";
    return "Match completed";
  }, [state.status, state.setupCompleted]);

  const [isRosterOpen, setRosterOpen] = useState(false);

  const teamObj = useMemo(() => {
    if (!currentBattingTeamId) return null;
    const t = (state as any).teams?.[currentBattingTeamId];
    if (!t) return null;
    return {
      id: t.id ?? currentBattingTeamId,
      name: t.name ?? `Team ${currentBattingTeamId}`,
      roster: t.roster ?? Object.keys(t.players ?? {}),
      players: t.players ?? {},
    };
  }, [state, currentBattingTeamId]);

  const rosterTeams = useMemo(() => {
    const entries = Object.entries(state.teams ?? {}).map(([teamId, t]) => {
      const playersMap = Array.isArray(t.players)
        ? Object.fromEntries(t.players.map((playerId) => [playerId, { id: playerId }]))
        : (t.players ?? {});

      const roster = Array.isArray(t.players) ? t.players : Object.keys(playersMap);

      return [teamId, { ...t, players: playersMap, roster }];
    });

    return Object.fromEntries(entries);
  }, [state.teams]);

  const battingPlayers: string[] = useMemo(() => {
    const battingTeamId = currentInnings?.battingTeamId;
    if (!battingTeamId) return [];
    const team = state.teams?.[battingTeamId];
    if (!team) return [];
    if (Array.isArray((team as any).roster) && (team as any).roster.length) return (team as any).roster;
    if (Array.isArray(team.players) && team.players.length) return team.players;
    return [];
  }, [currentInnings?.battingTeamId, state.teams]);

  const usedBatters = new Set<string>(currentInnings.usedBatters ?? []);

  const inningsNet = computeInningsNet(currentInnings);
  const totalScore = `${inningsNet}/${currentInnings.wickets}`;

  const oversText = `${formatOvers(currentInnings.balls, state.oversLimit)} ov`;
  const extrasText = totalExtras(currentInnings.extras ?? { wide: 0, noball: 0, bye: 0, legbye: 0 });

  const viewerLink = useMemo(() => buildViewerLink(state.matchId), [state.matchId]);
  const adminLink = useMemo(
    () => buildAdminLink(state.matchId, state.adminKey),
    [state.matchId, state.adminKey],
  );

  function safeSet(next: MatchState) {
    setState({ ...next, updatedAt: Date.now() });
  }

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
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold">
        <Crown className="h-3.5 w-3.5" /> Scorer
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary text-secondary-foreground px-2.5 py-1 text-xs font-semibold">
        <Eye className="h-3.5 w-3.5" /> Viewer
      </span>
    );

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
              <h1 className="font-display text-2xl sm:text-3xl tracking-tight">Indoor Cricket Scorer</h1>
              {headerChip}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Live scoring • touch-first controls • shareable viewer link
            </p>
          </div>
          {matchIdFromRoute ? (
            <Button
              variant="secondary"
              className="tap pressable"
              onClick={() => {
                window.location.href = isAdmin ? "/" : "/?mode=viewer";
              }}
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
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {state.title} • {state.venue}
                    </p>
                    <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                      <div className="font-display text-4xl sm:text-5xl leading-none">{totalScore}</div>
                      <div className="pb-1">
                        <div className="text-sm font-semibold">{oversText}</div>
                        <div className="text-xs text-muted-foreground">Extras: {extrasText}</div>
                      </div>
                    </div>
                    <div className="inline-flex gap-2 items-center">
                      {(state.setupCompleted || state.status !== "setup") && (
                        <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                          {`Skin ${ currentInnings.skinIndex + 1} / ${TOTAL_SKINS}`}
                        </span>
                      )}

                      <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                        {matchStatusText}
                      </span>

                      {(state.setupCompleted || state.status !== "setup") && (
                        <span className="rounded-md px-2 py-1 text-xs bg-muted/30">
                          {`Innings ${state.inningsIndex + 1} • ${battingName} batting`}
                        </span>
                      )}

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
                    >
                      <Share2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Share viewer</span>
                    </Button>
                    {isAdmin ? (
                      <Button
                        variant="outline"
                        className="tap pressable"
                        onClick={() => copy(adminLink, "Admin link copied")}
                      >
                        <Copy className="h-4 w-4" />
                        <span className="hidden sm:inline">Copy admin</span>
                      </Button>
                    ) : null}
                  </div>
                </div>

                <Separator />

                {!isAdmin ? (
                  <div className="rounded-xl border bg-card/60 p-3 text-sm space-y-2">
                    {needsAdminLink ? (
                      <>
                        <p>
                          <strong>Admin link required.</strong> This match is in scorer mode, but this device doesn’t have the admin key.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Ask the scorer for an Admin link, or use the Viewer link to follow along.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          You’re in <strong>Viewer mode</strong>. Scoring is disabled on this device.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          To create or edit a match, open an Admin link from the scorer.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card className="glass p-4 sm:p-6">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                <div className="w-full flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <TabsList className="bg-card/60 border">
                      <TabsTrigger value="controls">Controls</TabsTrigger>
                      <TabsTrigger value="players">Players</TabsTrigger>
                      <TabsTrigger value="match">Match</TabsTrigger>
                    </TabsList>
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="secondary"
                      className="hidden sm:inline-flex tap pressable items-center gap-2"
                      onClick={() => {}}
                    >
                      <Undo2 className="h-4 w-4" /> Undo
                    </Button>

                    <Button
                      variant="outline"
                      className="hidden sm:inline-flex tap pressable items-center gap-2"
                      onClick={() => setShowResetConfirm(true)}
                    >
                      <RotateCcw className="h-4 w-4" /> Reset
                    </Button>
                  </div>
                </div>

                <TabsContent value="controls" className="mt-4">
                  <div className="text-sm text-muted-foreground">Controls UI not relevant to this fix.</div>
                </TabsContent>

                <TabsContent value="players" className="mt-4">
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
                    <div className="space-y-2">
                      <Label>Striker</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card/70 px-3"
                        value={currentInnings.striker}
                        disabled={!isAdmin || !state.setupCompleted}
                        onChange={() => {}}
                      >
                        <option value="">Select striker</option>
                        {battingPlayers.map((p) => (
                          <option key={p} value={p} disabled={p === currentInnings.nonStriker}>
                            {p} {usedBatters.has(p) ? "(used)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label>Non-Striker</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card/70 px-3"
                        value={currentInnings.nonStriker}
                        disabled={!isAdmin || !state.setupCompleted}
                        onChange={() => {}}
                      >
                        <option value="">Select non-striker</option>
                        {battingPlayers.map((p) => (
                          <option key={p} value={p} disabled={p === currentInnings.striker}>
                            {p} {usedBatters.has(p) ? "(used)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label>Bowler</Label>
                      <select
                        className="h-11 w-full rounded-xl border bg-card/70 px-3"
                        value={currentInnings.bowler}
                        disabled={!isAdmin || !state.setupCompleted}
                        onChange={() => {}}
                      >
                        <option value="">Select bowler</option>
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
                      onChange={() => {}}
                      testId="input-title"
                    />
                    <Field
                      label="Venue"
                      value={state.venue}
                      disabled={!isAdmin || state.setupCompleted}
                      onChange={() => {}}
                      testId="input-venue"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          <div className="lg:col-span-5 space-y-3 sm:space-y-6">
            <TraditionalScoreboardCard
              state={state}
              teamAName={state.teams.a.name}
              teamBName={state.teams.b.name}
              inningsA={state.innings[0] ?? null}
              inningsB={state.innings[1] ?? null}
            />
          </div>
        </div>

        {showResetConfirm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setShowResetConfirm(false)}
            />
            <div className="relative z-10 w-full max-w-lg rounded-xl bg-card p-6 shadow-lg">
              <h3 className="text-lg font-semibold">Confirm reset</h3>
              <p className="mt-2 text-sm text-muted-foreground">Reset UI not relevant to this fix.</p>

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {teamObj ? (
          <ManageRoster
            teams={rosterTeams}
            initialTeamId={currentBattingTeamId}
            open={isRosterOpen}
            onClose={() => setRosterOpen(false)}
            onChange={(teamId, updatedTeam) => {
              const rosterIds =
                Array.isArray((updatedTeam as any).roster) && (updatedTeam as any).roster.length
                  ? ((updatedTeam as any).roster as string[])
                  : Object.keys(((updatedTeam as any).players ?? {}) as Record<string, any>);

              const playersMap = (((updatedTeam as any).players ?? {}) as Record<string, any>) || {};
              const nextPlayerNames = rosterIds.map((id) => playersMap?.[id]?.name ?? id);

              safeSet({
                ...state,
                teams: {
                  ...state.teams,
                  [teamId]: {
                    ...(state.teams as any)[teamId],
                    id: (updatedTeam as any).id ?? (state.teams as any)?.[teamId]?.id ?? teamId,
                    name: (updatedTeam as any).name ?? (state.teams as any)?.[teamId]?.name,
                    players: nextPlayerNames,
                  },
                },
              });
            }}
            onSubstitute={async () => {}}
            api={{
              addPlayer: (teamId: string, name: string) =>
                teamApi.addPlayer(teamId, name, state.matchId, keyFromUrl),
              updatePlayer: () => Promise.reject(new Error("Not implemented")),
              deactivatePlayer: () => Promise.reject(new Error("Not implemented")),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(ScoringApp), { ssr: false });

