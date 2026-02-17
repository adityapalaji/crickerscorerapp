import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

function getQueryMode(): "admin" | "viewer" {
  if (typeof window === "undefined") return "admin";
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "viewer" ? "viewer" : "admin";
}

export default function HomeLanding() {
  const router = useRouter();
  const [isCreating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreboardDisplay, setScoreboardDisplay] = useState<
    "skins" | "traditional"
  >("skins");

  const mode = useMemo(() => getQueryMode(), []);
  const isViewerLanding = mode === "viewer";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl tracking-tight">
          Indoor Cricket Scorer
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isViewerLanding
            ? "You’re in Viewer mode. You can open a Viewer link to watch a match."
            : "Start a new match as the scorer (Admin), then share the Viewer link with spectators."}
        </p>

        <Card className="mt-6 p-6 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">New match</p>
            <p className="text-xs text-muted-foreground">
              {isViewerLanding
                ? "Match creation is disabled in Viewer mode. Ask the scorer for an Admin link."
                : "This will open the scoring screen in Admin mode on this device."}
            </p>
          </div>

          {!isViewerLanding ? (
            <div className="space-y-3">
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">Scoreboard type</div>
                <div className="mt-2">
                  <RadioGroup
                    value={scoreboardDisplay}
                    onValueChange={(v) => {
                      if (v === "skins" || v === "traditional") {
                        setScoreboardDisplay(v);
                      }
                    }}
                    className="grid gap-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="skins" id="scoreboard-skins" />
                      <Label htmlFor="scoreboard-skins">
                        Skin-wise comparison (default)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="traditional" id="scoreboard-traditional" />
                      <Label htmlFor="scoreboard-traditional">
                        Traditional scoreboard
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={async () => {
                  if (!router.isReady) return;
                  if (isCreating) return;

                  setError(null);
                  setCreating(true);
                  try {
                    const res = await fetch("/api/matches", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ scoreboardDisplay }),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      throw new Error(body?.error || `HTTP ${res.status}`);
                    }
                    const data = (await res.json()) as { matchId?: string; adminKey?: string };
                    if (!data?.matchId || !data?.adminKey) {
                      throw new Error("Missing match ID or admin key");
                    }
                    // Navigate to the match scoring page
                    const nextPath = `/match/${encodeURIComponent(data.matchId)}?mode=admin&key=${encodeURIComponent(data.adminKey)}`;
                    router.push(nextPath);
                  } catch (e: any) {
                    setError(e?.message || "Failed to create match");
                    setCreating(false);
                  }
                }}
                disabled={isCreating}
                data-testid="button-start-new-match"
              >
                {isCreating ? "Creating match…" : "Start New Match (Admin)"}
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled
              data-testid="button-start-new-match-disabled"
            >
              Start New Match (Admin)
            </Button>
          )}

          {error ? (
            <p className="text-xs text-destructive" data-testid="text-create-error">
              {error}
            </p>
          ) : null}
        </Card>

        <Card className="mt-4 p-6 space-y-2">
          <p className="text-sm font-semibold">Already have a link?</p>
          <p className="text-xs text-muted-foreground">
            Open an Admin link to score, or a Viewer link to watch.
          </p>
        </Card>
      </div>
    </div>
  );
}
