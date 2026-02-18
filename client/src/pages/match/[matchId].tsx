import { useRouter } from "next/router";
import ScoringApp from "../scoring-app";

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
