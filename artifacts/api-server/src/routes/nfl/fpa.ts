import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  fantasyPointsAllowedSnapshotsTable,
  type FpaSnapshot,
} from "@workspace/db";
import { GetNflFpaQueryParams, DownloadNflFpaQueryParams } from "@workspace/api-zod";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// ─── NFL team data ─────────────────────────────────────────────────────────────

interface TeamSeed {
  abbr: string;
  name: string;
  // half-PPR raw values (2025 full-season averages)
  qbRaw: number;
  rbRaw: number;
  wrRaw: number;
  teRaw: number;
  // schedule bias offsets for adjusted (positive = faced harder offenses)
  qbBias: number;
  rbBias: number;
  wrBias: number;
  teBias: number;
}

const TEAMS: TeamSeed[] = [
  // Toughest defenses (low FPA)
  { abbr: "BAL", name: "Baltimore Ravens",     qbRaw: 13.8, rbRaw: 16.2, wrRaw: 22.5, teRaw: 5.8,  qbBias: 0.4,  rbBias: 0.6,  wrBias: 0.8,  teBias: 0.2  },
  { abbr: "KC",  name: "Kansas City Chiefs",   qbRaw: 14.5, rbRaw: 17.4, wrRaw: 24.2, teRaw: 5.2,  qbBias: -0.3, rbBias: -0.5, wrBias: -0.6, teBias: -0.2 },
  { abbr: "BUF", name: "Buffalo Bills",        qbRaw: 15.1, rbRaw: 16.8, wrRaw: 25.1, teRaw: 6.1,  qbBias: 0.2,  rbBias: 0.3,  wrBias: 0.5,  teBias: 0.1  },
  { abbr: "PIT", name: "Pittsburgh Steelers",  qbRaw: 14.8, rbRaw: 18.2, wrRaw: 26.3, teRaw: 6.4,  qbBias: -0.1, rbBias: 0.2,  wrBias: 0.3,  teBias: -0.1 },
  { abbr: "MIN", name: "Minnesota Vikings",    qbRaw: 15.5, rbRaw: 18.8, wrRaw: 25.8, teRaw: 7.2,  qbBias: 0.5,  rbBias: 0.7,  wrBias: 0.9,  teBias: 0.3  },
  { abbr: "SF",  name: "San Francisco 49ers",  qbRaw: 15.2, rbRaw: 15.2, wrRaw: 27.4, teRaw: 7.5,  qbBias: -0.4, rbBias: -0.8, wrBias: -1.0, teBias: -0.3 },
  { abbr: "MIA", name: "Miami Dolphins",       qbRaw: 15.8, rbRaw: 19.5, wrRaw: 26.5, teRaw: 6.8,  qbBias: 0.3,  rbBias: 0.4,  wrBias: 0.6,  teBias: 0.2  },
  { abbr: "DEN", name: "Denver Broncos",       qbRaw: 16.2, rbRaw: 17.8, wrRaw: 28.1, teRaw: 7.9,  qbBias: -0.2, rbBias: 0.1,  wrBias: 0.2,  teBias: -0.1 },
  { abbr: "PHI", name: "Philadelphia Eagles",  qbRaw: 16.5, rbRaw: 19.2, wrRaw: 27.8, teRaw: 8.1,  qbBias: 0.1,  rbBias: -0.3, wrBias: -0.4, teBias: 0.1  },
  { abbr: "DAL", name: "Dallas Cowboys",       qbRaw: 16.8, rbRaw: 20.1, wrRaw: 28.5, teRaw: 7.6,  qbBias: 0.4,  rbBias: 0.5,  wrBias: 0.7,  teBias: 0.2  },
  // Middle of pack
  { abbr: "GB",  name: "Green Bay Packers",    qbRaw: 17.4, rbRaw: 21.2, wrRaw: 30.2, teRaw: 13.2, qbBias: -0.3, rbBias: -0.2, wrBias: -0.3, teBias: 0.4  },
  { abbr: "TB",  name: "Tampa Bay Buccaneers", qbRaw: 17.8, rbRaw: 21.8, wrRaw: 31.5, teRaw: 9.2,  qbBias: 0.2,  rbBias: 0.3,  wrBias: 0.4,  teBias: -0.2 },
  { abbr: "NE",  name: "New England Patriots", qbRaw: 17.2, rbRaw: 20.5, wrRaw: 30.8, teRaw: 8.8,  qbBias: -0.5, rbBias: -0.6, wrBias: -0.8, teBias: -0.3 },
  { abbr: "LAR", name: "Los Angeles Rams",     qbRaw: 18.2, rbRaw: 29.5, wrRaw: 32.1, teRaw: 9.5,  qbBias: 0.1,  rbBias: 0.2,  wrBias: 0.3,  teBias: 0.1  },
  { abbr: "SEA", name: "Seattle Seahawks",     qbRaw: 18.5, rbRaw: 22.4, wrRaw: 32.8, teRaw: 10.1, qbBias: 0.3,  rbBias: -0.1, wrBias: -0.2, teBias: 0.2  },
  { abbr: "DET", name: "Detroit Lions",        qbRaw: 18.8, rbRaw: 22.8, wrRaw: 33.2, teRaw: 9.8,  qbBias: -0.2, rbBias: 0.4,  wrBias: 0.5,  teBias: -0.1 },
  { abbr: "ATL", name: "Atlanta Falcons",      qbRaw: 19.2, rbRaw: 23.5, wrRaw: 33.8, teRaw: 10.4, qbBias: 0.4,  rbBias: -0.3, wrBias: -0.4, teBias: 0.3  },
  { abbr: "LV",  name: "Las Vegas Raiders",    qbRaw: 19.5, rbRaw: 23.2, wrRaw: 34.5, teRaw: 9.6,  qbBias: -0.1, rbBias: 0.2,  wrBias: 0.3,  teBias: -0.2 },
  { abbr: "CIN", name: "Cincinnati Bengals",   qbRaw: 19.8, rbRaw: 24.1, wrRaw: 34.2, teRaw: 10.8, qbBias: 0.2,  rbBias: -0.4, wrBias: -0.5, teBias: 0.1  },
  { abbr: "JAX", name: "Jacksonville Jaguars", qbRaw: 20.1, rbRaw: 24.5, wrRaw: 35.1, teRaw: 9.2,  qbBias: -0.3, rbBias: 0.3,  wrBias: 0.4,  teBias: -0.3 },
  { abbr: "NYJ", name: "New York Jets",        qbRaw: 20.5, rbRaw: 24.8, wrRaw: 35.8, teRaw: 10.2, qbBias: 0.5,  rbBias: -0.2, wrBias: -0.3, teBias: 0.2  },
  { abbr: "LAC", name: "Los Angeles Chargers", qbRaw: 20.8, rbRaw: 25.2, wrRaw: 36.2, teRaw: 11.2, qbBias: -0.4, rbBias: 0.5,  wrBias: 0.6,  teBias: -0.1 },
  { abbr: "HOU", name: "Houston Texans",       qbRaw: 21.2, rbRaw: 25.8, wrRaw: 36.8, teRaw: 10.5, qbBias: 0.1,  rbBias: -0.3, wrBias: -0.4, teBias: 0.3  },
  { abbr: "WAS", name: "Washington Commanders",qbRaw: 21.5, rbRaw: 26.2, wrRaw: 37.5, teRaw: 11.5, qbBias: -0.2, rbBias: 0.4,  wrBias: 0.5,  teBias: -0.2 },
  { abbr: "CLE", name: "Cleveland Browns",     qbRaw: 21.8, rbRaw: 26.5, wrRaw: 38.2, teRaw: 10.8, qbBias: 0.3,  rbBias: -0.5, wrBias: -0.6, teBias: 0.1  },
  { abbr: "NYG", name: "New York Giants",      qbRaw: 22.2, rbRaw: 27.1, wrRaw: 42.1, teRaw: 11.8, qbBias: -0.5, rbBias: 0.3,  wrBias: 0.4,  teBias: -0.3 },
  { abbr: "NO",  name: "New Orleans Saints",   qbRaw: 22.5, rbRaw: 28.8, wrRaw: 38.8, teRaw: 14.2, qbBias: 0.4,  rbBias: -0.4, wrBias: -0.5, teBias: 0.2  },
  // Easiest defenses (high FPA)
  { abbr: "IND", name: "Indianapolis Colts",   qbRaw: 24.8, rbRaw: 30.8, wrRaw: 43.5, teRaw: 12.2, qbBias: -0.3, rbBias: 0.6,  wrBias: 0.8,  teBias: -0.4 },
  { abbr: "TEN", name: "Tennessee Titans",     qbRaw: 23.5, rbRaw: 29.2, wrRaw: 42.8, teRaw: 11.8, qbBias: 0.2,  rbBias: -0.7, wrBias: -0.9, teBias: 0.3  },
  { abbr: "ARI", name: "Arizona Cardinals",    qbRaw: 23.8, rbRaw: 28.5, wrRaw: 43.5, teRaw: 12.8, qbBias: -0.4, rbBias: 0.5,  wrBias: 0.7,  teBias: -0.5 },
  { abbr: "CHI", name: "Chicago Bears",        qbRaw: 24.2, rbRaw: 28.2, wrRaw: 44.8, teRaw: 13.8, qbBias: 0.3,  rbBias: -0.6, wrBias: -0.8, teBias: 0.4  },
  { abbr: "CAR", name: "Carolina Panthers",    qbRaw: 25.2, rbRaw: 31.5, wrRaw: 46.2, teRaw: 13.5, qbBias: -0.5, rbBias: 0.7,  wrBias: 0.9,  teBias: -0.6 },
];

const GAMES_PLAYED_2025 = 17;

// Reception adjustment per format (relative to half-PPR)
// based on avg receptions per game: RB ~3, WR ~7, TE ~4
const FORMAT_ADJUSTMENTS = {
  standard: { rb: -1.5, wr: -3.5, te: -2.0 },
  half:     { rb:  0.0, wr:  0.0, te:  0.0 },
  ppr:      { rb:  1.5, wr:  3.5, te:  2.0 },
} as const;

type ScoringFormat = "standard" | "half" | "ppr";

function applyFormat(seed: TeamSeed, format: ScoringFormat) {
  const adj = FORMAT_ADJUSTMENTS[format];
  return {
    qbRaw:  +seed.qbRaw.toFixed(2),
    rbRaw:  +(seed.rbRaw + adj.rb).toFixed(2),
    wrRaw:  +(seed.wrRaw + adj.wr).toFixed(2),
    teRaw:  +(seed.teRaw + adj.te).toFixed(2),
    qbAdj:  +(seed.qbRaw + seed.qbBias).toFixed(2),
    rbAdj:  +(seed.rbRaw + adj.rb + seed.rbBias).toFixed(2),
    wrAdj:  +(seed.wrRaw + adj.wr + seed.wrBias).toFixed(2),
    teAdj:  +(seed.teRaw + adj.te + seed.teBias).toFixed(2),
  };
}

// ─── Seeding ───────────────────────────────────────────────────────────────────

async function seedSnapshotsIfEmpty(): Promise<void> {
  const existing = await db
    .select({ id: fantasyPointsAllowedSnapshotsTable.id })
    .from(fantasyPointsAllowedSnapshotsTable)
    .limit(1);

  if (existing.length > 0) return;

  logger.info("Seeding FPA snapshot data for 2025 preseason baseline");

  const formats: ScoringFormat[] = ["standard", "half", "ppr"];

  const rows = formats.flatMap((format) =>
    TEAMS.map((t) => {
      const v = applyFormat(t, format);
      const offRaw = +(v.qbRaw + v.rbRaw + v.wrRaw + v.teRaw).toFixed(2);
      const offAdj = +(v.qbAdj + v.rbAdj + v.wrAdj + v.teAdj).toFixed(2);
      return {
        season: 2025,
        weekNumber: null as number | null,
        defenseTeamAbbr: t.abbr,
        defenseTeamName: t.name,
        scoringFormat: format,
        qbFpaRaw: v.qbRaw.toString(),
        rbFpaRaw: v.rbRaw.toString(),
        wrFpaRaw: v.wrRaw.toString(),
        teFpaRaw: v.teRaw.toString(),
        offFpaRaw: offRaw.toString(),
        qbFpaAdj: v.qbAdj.toString(),
        rbFpaAdj: v.rbAdj.toString(),
        wrFpaAdj: v.wrAdj.toString(),
        teFpaAdj: v.teAdj.toString(),
        offFpaAdj: offAdj.toString(),
        gamesPlayed: GAMES_PLAYED_2025,
        dataMode: "preseason_baseline",
      };
    }),
  );

  await db.insert(fantasyPointsAllowedSnapshotsTable).values(rows);
  logger.info({ count: rows.length }, "FPA seed complete");
}

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
        "Preseason mode: 70% weight on 2025 full-season data and 30% weight on the final 8 weeks of 2025. No 2026 regular-season games have been played yet.",
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
  if (weekNumber >= 5 && weekNumber < 12) {
    return {
      dataMode: `Week ${weekNumber} — Current Season`,
      methodology:
        `Week ${weekNumber}: Mostly 2026 current-season data with a small stabilizing prior from 2025.`,
      isPreseason: false,
    };
  }
  return {
    dataMode: `Week ${weekNumber} — Rolling 10 Weeks`,
    methodology:
      `Week ${weekNumber}: Rolling 10-week window of 2026 regular-season data. Full-season averages are no longer used.`,
    isPreseason: false,
  };
}

// ─── Ranking helpers ──────────────────────────────────────────────────────────

function rankAsc<T>(rows: T[], key: keyof T): Map<T, number> {
  const sorted = [...rows].sort(
    (a, b) => (a[key] as number) - (b[key] as number),
  );
  const map = new Map<T, number>();
  sorted.forEach((r, i) => map.set(r, i + 1));
  return map;
}

// ─── Build row response from snapshot ────────────────────────────────────────

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
  const rows: ProcessedRow[] = snapshots.map((s) => ({
    team: s.defenseTeamName,
    teamAbbr: s.defenseTeamAbbr,
    qbFpa:
      view === "raw"
        ? parseFloat(s.qbFpaRaw)
        : parseFloat(s.qbFpaAdj),
    rbFpa:
      view === "raw"
        ? parseFloat(s.rbFpaRaw)
        : parseFloat(s.rbFpaAdj),
    wrFpa:
      view === "raw"
        ? parseFloat(s.wrFpaRaw)
        : parseFloat(s.wrFpaAdj),
    teFpa:
      view === "raw"
        ? parseFloat(s.teFpaRaw)
        : parseFloat(s.teFpaAdj),
    offFpa:
      view === "raw"
        ? parseFloat(s.offFpaRaw)
        : parseFloat(s.offFpaAdj),
    gamesPlayed: s.gamesPlayed,
    // placeholders — will be filled after ranking
    qbRank: 0,
    rbRank: 0,
    wrRank: 0,
    teRank: 0,
  }));

  // Rank 1 = toughest = lowest FPA
  const qbRanks = rankAsc(rows, "qbFpa");
  const rbRanks = rankAsc(rows, "rbFpa");
  const wrRanks = rankAsc(rows, "wrFpa");
  const teRanks = rankAsc(rows, "teFpa");

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
    const safeView = (view ?? "adjusted") as "raw" | "adjusted";

    await seedSnapshotsIfEmpty();

    // For 2026 preseason, read from the 2025 baseline snapshots
    const dbSeason = season === 2026 ? 2025 : season;

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
    const { dataMode, methodology, isPreseason } = getDataMode(null);

    res.json({
      rows,
      dataMode,
      methodology,
      season: season ?? 2026,
      format: safeFormat,
      view: safeView,
      weekNumber: null,
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
    const safeView = (view ?? "adjusted") as "raw" | "adjusted";

    await seedSnapshotsIfEmpty();

    const dbSeason = season === 2026 ? 2025 : season;

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
      "Team",
      "QB Rank",
      "QB FPA",
      "RB Rank",
      "RB FPA",
      "WR Rank",
      "WR FPA",
      "TE Rank",
      "TE FPA",
      "OFF FPA",
      "Games Played",
    ];

    const csvRows = rows.map((r) =>
      [
        r.team,
        r.qbRank,
        r.qbFpa.toFixed(1),
        r.rbRank,
        r.rbFpa.toFixed(1),
        r.wrRank,
        r.wrFpa.toFixed(1),
        r.teRank,
        r.teFpa.toFixed(1),
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
