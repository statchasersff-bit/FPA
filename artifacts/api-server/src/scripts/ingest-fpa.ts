/**
 * CLI: ingest Fantasy Points Allowed from nflverse into Postgres.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run ingest-fpa
 *   pnpm --filter @workspace/api-server run ingest-fpa -- --baseline 2025 --current 2026
 *
 * Defaults come from FPA_BASELINE_SEASON (2025) and FPA_CURRENT_SEASON (2026).
 * Intended to be run on a schedule (e.g. weekly during the season) to refresh
 * the snapshots the API serves.
 */

import { pool } from "@workspace/db";
import { ingestFpa } from "../lib/fpa-ingest";
import { logger } from "../lib/logger";

function parseArg(name: string): number | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  const val = Number(process.argv[idx + 1]);
  return Number.isNaN(val) ? undefined : val;
}

async function main() {
  const baselineSeason = parseArg("baseline");
  const currentSeason = parseArg("current");

  const result = await ingestFpa({ baselineSeason, currentSeason });
  logger.info(result, "ingest-fpa finished");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "ingest-fpa failed");
    await pool.end().catch(() => {});
    process.exit(1);
  });
