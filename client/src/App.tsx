import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ScoringApp from "./pages/scoring-app";
import dynamic from "next/dynamic";

const HomeLanding = dynamic(() => import("./pages/home"), { ssr: false });

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <HomeLanding />}</Route>
      <Route path="/match/:matchId">{() => <ScoringApp />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
