/**
 * App.tsx - Root providers wrapper
 * 
 * NOTE: Routing is handled by Next.js Pages Router in production
 * (src/pages/index.tsx, src/pages/match/[matchId].tsx, etc.)
 * 
 * This component is only used as a client-side providers wrapper.
 * Do NOT add routing logic here (use Next.js pages instead).
 */

import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

function App({ children }: { children?: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
