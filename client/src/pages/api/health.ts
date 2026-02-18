import type { NextApiRequest, NextApiResponse } from "next";
import { validateProductionEnv } from "../../lib/validateEnv";
import { checkPgHealth } from "../../lib/postgresStore";

const API_VERSION = "2026-02-13";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Validate production environment on first health check
  try {
    validateProductionEnv();
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: "Production environment validation failed",
      details: err?.message ?? String(err),
      meta: { version: API_VERSION },
    });
  }

  const isProd = process.env.NODE_ENV === "production";

  try {
    // Test Postgres connectivity
    const pgHealthy = await checkPgHealth();

    if (!pgHealthy) {
      throw new Error("Postgres health check failed");
    }

    return res.status(200).json({
      ok: true,
      database: { ok: true, type: "postgres" },
      meta: { version: API_VERSION },
    });
  } catch (err: any) {
    const message = err?.message ?? String(err);

    // In production, surface this as an unhealthy status.
    // In dev, you might not have DATABASE_URL configured; still helpful to see that explicitly.
    return res.status(isProd ? 503 : 200).json({
      ok: !isProd,
      database: { ok: false, error: message, type: "postgres" },
      meta: { version: API_VERSION },
    });
  }
}
