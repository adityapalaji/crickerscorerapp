import type { NextApiRequest, NextApiResponse } from "next";

const API_VERSION = "2026-02-13";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const isProd = process.env.NODE_ENV === "production";

  // If KV isn't configured, @vercel/kv may still import, but kv operations will fail.
  // We intentionally make health reflect that in production.
  try {
    const mod = await import("@vercel/kv");
    const kv = mod.kv as any;

    // Minimal read/write probe. Using a short-lived key avoids polluting data.
    const key = `health:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const payload = { ok: true, at: Date.now() };

    await kv.set(key, payload, { ex: 30 });
    const got = await kv.get(key);

    if (!got) {
      // Treat missing read-after-write as unhealthy.
      throw new Error("KV probe failed: unable to read back written value");
    }

    return res.status(200).json({
      ok: true,
      kv: { ok: true },
      meta: { version: API_VERSION },
    });
  } catch (err: any) {
    const message = err?.message ?? String(err);

    // In production, surface this as an unhealthy status.
    // In dev, you might not have KV configured; still helpful to see that explicitly.
    return res.status(isProd ? 503 : 200).json({
      ok: !isProd,
      kv: { ok: false, error: message },
      meta: { version: API_VERSION },
    });
  }
}

