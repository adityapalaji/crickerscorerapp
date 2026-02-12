import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function HomeLanding() {
  const [isCreating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl tracking-tight">
          Indoor Cricket Scorer
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start a new match as the scorer (Admin), then share the Viewer link with
          spectators.
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
            onClick={async () => {
              if (typeof window === "undefined") return;
              if (isCreating) return;

              setError(null);
              setCreating(true);
              try {
                const res = await fetch("/api/matches", { method: "POST" });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  throw new Error(body?.error || `HTTP ${res.status}`);
                }
                const data = (await res.json()) as { adminUrl?: string };
                if (!data?.adminUrl) throw new Error("Missing adminUrl");
                window.location.assign(data.adminUrl);
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
