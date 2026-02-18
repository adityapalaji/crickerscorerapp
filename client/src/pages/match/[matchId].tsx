import { useRouter } from "next/router";
import dynamic from "next/dynamic";

// Disable SSR for scoring app to prevent hydration mismatches with localStorage
const ScoringApp = dynamic(() => import("../scoring-app"), { ssr: false });

export default function MatchPage() {
    const router = useRouter();
    const { matchId } = router.query;

    // Wait for router to be ready to get query params
    if (!router.isReady) {
        return null;
    }

    if (!matchId || typeof matchId !== "string") {
        return null;
    }

    return <ScoringApp matchIdFromRoute={matchId} />;
}
