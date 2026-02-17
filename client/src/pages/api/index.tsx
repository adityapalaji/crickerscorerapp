import type { NextApiRequest, NextApiResponse } from "next";
import { validateProductionEnv } from "../../lib/validateEnv";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Validate production environment on first API call
  try {
    validateProductionEnv();
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: "Production environment validation failed",
      details: err?.message ?? String(err),
    });
  }

  res.status(200).json({ ok: true });
}

