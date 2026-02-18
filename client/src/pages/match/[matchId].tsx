import { useRouter } from "next/router";
import type { GetServerSideProps } from "next";
import ScoringApp from "../../components/ScoringApp";

export const getServerSideProps: GetServerSideProps = async (context) => {
    const { matchId } = context.params ?? {};
    if (!matchId || typeof matchId !== "string") {
        return { notFound: true };
    }
    return { props: { matchId } };
};

interface MatchPageProps {
    matchId: string;
}

export default function MatchPage({ matchId }: MatchPageProps) {
    const router = useRouter();

    if (!router.isReady) {
        return null;
    }

    return <ScoringApp matchIdFromRoute={matchId} />;
}
