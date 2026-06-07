import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { ingestFpa } from "../../lib/fpa-ingest";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

/**
 * Admin-only FPA refresh endpoint.
 *
 * Triggers the nflverse ingest pipeline that recomputes the FPA snapshots the
 * public API serves. Intended to be called by a trusted control plane (the
 * StatChasers WordPress plugin) — never from a browser — using the shared
 * admin secret. The secret is sent as `Authorization: Bearer <secret>` or in
 * an `x-admin-secret` header and compared against `FPA_ADMIN_SECRET`.
 */

function extractSecret(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerSecret = req.header("x-admin-secret");
  return headerSecret ? headerSecret.trim() : null;
}

/** Constant-time-ish comparison to avoid leaking length/timing trivially. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.FPA_ADMIN_SECRET;
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: "FPA_ADMIN_SECRET is not configured on the server.",
    });
    return;
  }
  const provided = extractSecret(req);
  if (!provided || !secretsMatch(provided, expected)) {
    res.status(401).json({ ok: false, error: "Unauthorized." });
    return;
  }
  next();
}

router.post(
  "/admin/fpa/refresh",
  requireAdminSecret,
  async (req: Request, res: Response): Promise<void> => {
    const baselineSeason = Number(req.body?.baselineSeason) || undefined;
    const currentSeason = Number(req.body?.currentSeason) || undefined;

    try {
      logger.info({ baselineSeason, currentSeason }, "admin FPA refresh requested");
      const result = await ingestFpa({ baselineSeason, currentSeason });
      res.json({
        ok: true,
        refreshedAt: new Date().toISOString(),
        ...result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "admin FPA refresh failed");
      res.status(500).json({ ok: false, error: message });
    }
  },
);

export default router;
