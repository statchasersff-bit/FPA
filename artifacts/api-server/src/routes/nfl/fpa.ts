import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  fantasyPointsAllowedSnapshotsTable,
  type FpaSnapshot,
} from "@workspace/db";
import { GetNflFpaQueryParams, DownloadNflFpaQueryParams } from "@workspace/api-zod";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

type ScoringFormat = "standard" | "half" | "ppr";

// ─── Data mode logic ──────────────────────────────────────────────────────────

function getDataMode(weekNumber: number | null): {
  dataMode: string;
  methodology: string;
  isPreseason: boolean;
} {
  if (weekNumber === null || weekNumber < 1) {
    return {
      dataMode: "Preseason Baseline",
      methodology:
        "Preseason mode: 100% weight on 2025 full-season data. No 2026 regular-season games have been played yet.",
      isPreseason: true,
    };
  }
  if (weekNumber === 1) {
    return {
      dataMode: "Week 1 — Early Season",
      methodology:
        "Week 1: 75% preseason baseline (2025 season) and 25% 2026 regular-season data. Small sample — treat rankings with caution.",
      isPreseason: false,
    };
  }
  if (weekNumber === 2) {
    return {
      dataMode: "Week 2 — Early Season",
      methodology:
        "Week 2: 60% preseason baseline (2025 season) and 40% 2026 regular-season data. Small sample — treat rankings with caution.",
      isPreseason: false,
    };
  }
  if (weekNumber === 3) {
    return {
      dataMode: "Week 3",
      methodology:
        "Week 3: 40% preseason baseline (2025 season) and 60% 2026 regular-season data.",
      isPreseason: false,
    };
  }
  if (weekNumber === 4) {
    return {
      dataMode: "Week 4",
      methodology:
        "Week 4: 20% preseason baseline (2025 season) and 80% 2026 regular-season data.",
      isPreseason: false,
    };
  }
  if (weekNumber < 12) {
    return {
      dataMode: `Week ${weekNumber} — Current Season`,
      methodology: `Week ${weekNumber}: mostly 2026 current-season data with a small stabilizing prior from 2025.`,
      isPreseason: false,
    };
  }
  return {
    dataMode: `Week ${weekNumber} — Rolling 10 Weeks`,
    methodology: `Week ${weekNumber}: rolling 10-week window of 2026 regular-season data. Full-season averages are no longer used.`,
    isPreseason: false,
  };
}

// ─── Ranking helpers ──────────────────────────────────────────────────────────

// Industry convention (FantasyPros etc.): Rank 1 = most fantasy points
// allowed = easiest matchup. So rank by FPA descending.
function rankByFpaDesc<T>(rows: T[], key: keyof T): Map<T, number> {
  const sorted = [...rows].sort(
    (a, b) => (b[key] as number) - (a[key] as number),
  );
  const map = new Map<T, number>();
  sorted.forEach((r, i) => map.set(r, i + 1));
  return map;
}

// ─── Build rows from snapshots ────────────────────────────────────────────────

interface ProcessedRow {
  team: string;
  teamAbbr: string;
  qbRank: number;
  qbFpa: number;
  rbRank: number;
  rbFpa: number;
  wrRank: number;
  wrFpa: number;
  teRank: number;
  teFpa: number;
  offFpa: number;
  gamesPlayed: number;
}

function buildRows(
  snapshots: FpaSnapshot[],
  view: "raw" | "adjusted",
): ProcessedRow[] {
  const pick = (raw: string, adj: string) =>
    parseFloat(view === "raw" ? raw : adj);

  const rows: ProcessedRow[] = snapshots.map((s) => ({
    team: s.defenseTeamName,
    teamAbbr: s.defenseTeamAbbr,
    qbFpa: pick(s.qbFpaRaw, s.qbFpaAdj),
    rbFpa: pick(s.rbFpaRaw, s.rbFpaAdj),
    wrFpa: pick(s.wrFpaRaw, s.wrFpaAdj),
    teFpa: pick(s.teFpaRaw, s.teFpaAdj),
    offFpa: pick(s.offFpaRaw, s.offFpaAdj),
    gamesPlayed: s.gamesPlayed,
    qbRank: 0,
    rbRank: 0,
    wrRank: 0,
    teRank: 0,
  }));

  // Rank 1 = easiest = most FPA allowed
  const qbRanks = rankByFpaDesc(rows, "qbFpa");
  const rbRanks = rankByFpaDesc(rows, "rbFpa");
  const wrRanks = rankByFpaDesc(rows, "wrFpa");
  const teRanks = rankByFpaDesc(rows, "teFpa");

  return rows.map((r) => ({
    ...r,
    qbRank: qbRanks.get(r)!,
    rbRank: rbRanks.get(r)!,
    wrRank: wrRanks.get(r)!,
    teRank: teRanks.get(r)!,
  }));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get(
  "/nfl/fantasy-points-allowed",
  async (req, res): Promise<void> => {
    const parsed = GetNflFpaQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { season, format, view } = parsed.data;
    const safeFormat = (format ?? "half") as ScoringFormat;
    const safeView   = (view   ?? "adjusted") as "raw" | "adjusted";

    // Serve the snapshots produced by the ingest pipeline for the requested
    // season (defaults to the current 2026 projection season).
    const dbSeason = season ?? 2026;

    const snapshots = await db
      .select()
      .from(fantasyPointsAllowedSnapshotsTable)
      .where(
        and(
          eq(fantasyPointsAllowedSnapshotsTable.season, dbSeason),
          eq(fantasyPointsAllowedSnapshotsTable.scoringFormat, safeFormat),
        ),
      );

    if (snapshots.length === 0) {
      res.status(404).json({ error: "No data found for the given parameters" });
      return;
    }

    const rows = buildRows(snapshots, safeView);
    const weekNumber = snapshots[0].weekNumber;
    const { dataMode, methodology, isPreseason } = getDataMode(weekNumber);

    res.json({
      rows,
      dataMode,
      methodology,
      season: dbSeason,
      format: safeFormat,
      view: safeView,
      weekNumber,
      isPreseason,
    });
  },
);

router.get(
  "/nfl/fantasy-points-allowed/download",
  async (req, res): Promise<void> => {
    const parsed = DownloadNflFpaQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { season, format, view } = parsed.data;
    const safeFormat = (format ?? "half") as ScoringFormat;
    const safeView   = (view   ?? "adjusted") as "raw" | "adjusted";

    const dbSeason = season ?? 2026;

    const snapshots = await db
      .select()
      .from(fantasyPointsAllowedSnapshotsTable)
      .where(
        and(
          eq(fantasyPointsAllowedSnapshotsTable.season, dbSeason),
          eq(fantasyPointsAllowedSnapshotsTable.scoringFormat, safeFormat),
        ),
      );

    if (snapshots.length === 0) {
      res.status(404).json({ error: "No data found" });
      return;
    }

    const rows = buildRows(snapshots, safeView);

    const headers = [
      "Team", "QB Rank", "QB FPA",
      "RB Rank", "RB FPA",
      "WR Rank", "WR FPA",
      "TE Rank", "TE FPA",
      "OFF FPA", "Games Played",
    ];

    const csvRows = rows.map((r) =>
      [
        r.team,
        r.qbRank, r.qbFpa.toFixed(1),
        r.rbRank, r.rbFpa.toFixed(1),
        r.wrRank, r.wrFpa.toFixed(1),
        r.teRank, r.teFpa.toFixed(1),
        r.offFpa.toFixed(1),
        r.gamesPlayed,
      ].join(","),
    );

    const csv = [headers.join(","), ...csvRows].join("\n");
    const filename = `fpa-${safeFormat}-${safeView}-${season ?? 2026}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  },
);

export default router;
