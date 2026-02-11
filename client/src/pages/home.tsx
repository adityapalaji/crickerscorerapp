import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function getOrigin() {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

function buildAdminLink(matchId: string, adminKey: string) {
  return `${getOrigin()}/match/${encodeURIComponent(matchId)}?mode=admin&key=${encodeURIComponent(adminKey)}`;
}

export default function HomeLanding() {
  const next = useMemo(() => {
    const matchId = uid("match");
    const adminKey = uid("admin");
    return { matchId, adminKey };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl tracking-tight">Indoor Cricket Scorer</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start a new match as the scorer (Admin), then share the Viewer link with spectators.
        </p>

        <Card className="mt-6 p-6 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">New match</p>
            <p className="text-xs text-muted-foreground">
              This will open the scoring screen in Admin mode on this device.
            </p>
          </div>

          <Button
            className="w-full"
            onClick={() => {
              if (typeof window === "undefined") return;
              // Go directly to an admin link (includes key). Match state will be created locally and
              // cloud-saved once you start scoring.
              const adminUrl = buildAdminLink(next.matchId, next.adminKey);
              window.location.assign(adminUrl);
            }}
            data-testid="button-start-new-match"
          >
            Start New Match (Admin)
          </Button>
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
