import { useRouter } from "next/router";
import ScoringApp from "../scoring-app";

export default function MatchPage() {
    const router = useRouter();
    const { matchId } = router.query;

    if (!matchId || typeof matchId !== "string") {
        return null;
    }

    return <ScoringApp matchIdFromRoute={matchId} />;
}
