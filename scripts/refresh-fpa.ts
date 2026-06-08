/**
 * Fantasy Points Allowed snapshot generator — standalone, DB-free.
 *
 * Regenerates the data snapshot that ships INSIDE the WordPress plugin
 * (artifacts/wordpress-plugin/statchasers-data-tools/data/fpa-data.json):
 *
 *   1. Fetch the weekly player stats CSV published by nflverse.
 *   2. Score every QB/RB/WR/TE player-week in Standard / Half-PPR / PPR.
 *   3. Compute per-defense Fantasy Points Allowed (FPA) and schedule-adjusted
 *      FPA (aFPA), blending the 2025 baseline with live current-season data once
 *      the season is under way.
 *   4. Build the six {format × view} combos the frontend consumes.
 *   5. Write the resulting JSON to the plugin's bundled data file.
 *
 * After running this, rebuild the plugin zip and re-upload it in WordPress —
 * the plugin reads this file directly; there is no push/sync endpoint.
 *
 * The computation here is a faithful, dependency-free port of the api-server
 * pipeline (artifacts/api-server/src/lib/{nflverse,fpa-ingest}.ts and
 * routes/nfl/fpa.ts). It deliberately avoids Postgres and any @workspace/*
 * import so it can run anywhere Node + tsx is available.
 *
 * Environment:
 *   FPA_CURRENT_SEASON          Optional override (default 2026).
 *   FPA_BASELINE_SEASON         Optional override (default 2025).
 *   FPA_OUTPUT_FILE             Optional output path
 *                               (default: the plugin's data/fpa-data.json).
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const CURRENT_SEASON = Number(process.env.FPA_CURRENT_SEASON ?? 2026);
const BASELINE_SEASON = Number(process.env.FPA_BASELINE_SEASON ?? 2025);
const DEFAULT_OUTPUT_FILE =
  "artifacts/wordpress-plugin/statchasers-data-tools/data/fpa-data.json";
const OUTPUT_FILE = process.env.FPA_OUTPUT_FILE ?? DEFAULT_OUTPUT_FILE;

const ROLLING_WINDOW_WEEKS = 10;
// Preseason baseline mirrors industry "Weeks 1–17" tables — Week 18 excluded.
const BASELINE_MAX_WEEK = 17;

// ─── Tiny logger ────────────────────────────────────────────────────────────────

const log = (...args: unknown[]) => console.log("[refresh-fpa]", ...args);
const warn = (...args: unknown[]) => console.warn("[refresh-fpa]", ...args);

// ─── Scoring definitions (ported from nflverse.ts) ──────────────────────────────

const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type FantasyPosition = (typeof FANTASY_POSITIONS)[number];
const FANTASY_POSITION_SET = new Set<string>(FANTASY_POSITIONS);

type ScoringFormat = "standard" | "half" | "ppr";
const SCORING_FORMATS: ScoringFormat[] = ["standard", "half", "ppr"];

const RECEPTION_POINTS: Record<ScoringFormat, number> = {
  standard: 0,
  half: 0.5,
  ppr: 1,
};

const NFLVERSE_RELEASE_TAGS = ["stats_player", "player_stats"] as const;
type NflverseReleaseTag = (typeof NFLVERSE_RELEASE_TAGS)[number];

function nflverseWeeklyUrl(season: number, tag: NflverseReleaseTag): string {
  return (
    "https://github.com/nflverse/nflverse-data/releases/download/" +
    `${tag}/stats_player_week_${season}.csv`
  );
}

// Keyed by the abbreviations nflverse emits. Legacy relocation codes included.
const TEAM_NAMES: Record<string, string> = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LA: "Los Angeles Rams",
  LAC: "Los Angeles Chargers",
  LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
  LAR: "Los Angeles Rams",
  OAK: "Las Vegas Raiders",
  SD: "Los Angeles Chargers",
  STL: "Los Angeles Rams",
  WSH: "Washington Commanders",
};

function teamName(abbr: string): string {
  return TEAM_NAMES[abbr] ?? abbr;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── CSV parsing (RFC-4180) ─────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function num(v: string | undefined): number {
  if (v === undefined || v === "" || v === "NA") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

// ─── Fetch + score (ported from nflverse.ts) ────────────────────────────────────

interface ScoredPlayerWeek {
  season: number;
  week: number;
  position: FantasyPosition;
  team: string; // offensive team the player belongs to
  defenseTeam: string; // opponent_team — the defense that allowed these points
  points: Record<ScoringFormat, number>;
}

class NflverseSeasonUnavailableError extends Error {
  constructor(public season: number) {
    super(`nflverse weekly stats not available for season ${season}`);
    this.name = "NflverseSeasonUnavailableError";
  }
}

function scoreRow(get: (col: string) => string | undefined): Record<ScoringFormat, number> {
  const g = (c: string) => num(get(c));

  const base =
    g("passing_yards") * 0.04 +
    g("passing_tds") * 4 +
    g("passing_interceptions") * -1 +
    (g("sack_fumbles_lost") +
      g("rushing_fumbles_lost") +
      g("receiving_fumbles_lost")) *
      -2 +
    g("rushing_yards") * 0.1 +
    g("rushing_tds") * 6 +
    g("receiving_yards") * 0.1 +
    g("receiving_tds") * 6 +
    (g("passing_2pt_conversions") +
      g("rushing_2pt_conversions") +
      g("receiving_2pt_conversions")) *
      2;
  // NOTE: special_teams_tds (punt/kick return TDs) are intentionally excluded.
  // FPA measures offensive production a defense allows; a return TD is a
  // special-teams play the defense had no part in. Keep in sync with
  // artifacts/api-server/src/lib/nflverse.ts.

  const receptions = g("receptions");

  return {
    standard: base + receptions * RECEPTION_POINTS.standard,
    half: base + receptions * RECEPTION_POINTS.half,
    ppr: base + receptions * RECEPTION_POINTS.ppr,
  };
}

async function fetchScoredWeeklyStats(season: number): Promise<ScoredPlayerWeek[]> {
  const seasonType = "REG";

  let text: string | null = null;
  for (const tag of NFLVERSE_RELEASE_TAGS) {
    const url = nflverseWeeklyUrl(season, tag);
    log(`fetching nflverse weekly stats: ${url}`);
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      warn(`request failed for ${url} — trying next tag`, err);
      continue;
    }
    if (!res.ok) {
      warn(`${url} returned HTTP ${res.status} — trying next tag`);
      continue;
    }
    text = await res.text();
    log(`fetched ${season} (${tag}): ${text.length} bytes`);
    break;
  }

  if (text === null) {
    throw new NflverseSeasonUnavailableError(season);
  }

  const matrix = parseCsv(text);
  if (matrix.length < 2) {
    throw new Error(`nflverse weekly stats for ${season} were empty`);
  }

  const header = matrix[0];
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h, i));

  const required = ["position", "season", "week", "season_type", "team", "opponent_team"];
  for (const col of required) {
    if (!colIndex.has(col)) {
      throw new Error(`nflverse CSV for ${season} missing column "${col}"`);
    }
  }

  const out: ScoredPlayerWeek[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (cells.length !== header.length) continue;

    // nflverse lists fullbacks as "FB", but fantasy sites bucket fullback
    // production into RB (matching the CSV's own `position_group`). Remap
    // FB -> RB before filtering so RB FPA includes FB snaps. Keep in sync with
    // artifacts/api-server/src/lib/nflverse.ts.
    const rawPosition = cells[colIndex.get("position")!];
    const position = rawPosition === "FB" ? "RB" : rawPosition;
    if (!FANTASY_POSITION_SET.has(position)) continue;

    if (cells[colIndex.get("season_type")!] !== seasonType) continue;

    const defenseTeam = cells[colIndex.get("opponent_team")!];
    if (!defenseTeam) continue;

    const get = (col: string): string | undefined => {
      const idx = colIndex.get(col);
      return idx === undefined ? undefined : cells[idx];
    };

    out.push({
      season: num(cells[colIndex.get("season")!]),
      week: num(cells[colIndex.get("week")!]),
      position: position as FantasyPosition,
      team: cells[colIndex.get("team")!],
      defenseTeam,
      points: scoreRow(get),
    });
  }

  log(`scored ${out.length} QB/RB/WR/TE player-weeks for ${season}`);
  return out;
}

// ─── FPA computation (ported from fpa-ingest.ts) ────────────────────────────────

interface PositionFpa {
  raw: number;
  adj: number;
}
interface DefenseFpa {
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}
type FpaTable = Map<string, DefenseFpa>;

function emptyPosRecord<T>(make: () => T): Record<FantasyPosition, T> {
  return Object.fromEntries(FANTASY_POSITIONS.map((p) => [p, make()])) as Record<
    FantasyPosition,
    T
  >;
}

function computeFpaTable(rows: ScoredPlayerWeek[], format: ScoringFormat): FpaTable {
  const defWeeks = new Map<string, Set<number>>();
  const defTotals = new Map<string, Record<FantasyPosition, number>>();
  const defFacedByWeek = new Map<string, Map<number, string>>();

  const offWeeks = new Map<string, Set<number>>();
  const offTotals = new Map<string, Record<FantasyPosition, number>>();

  for (const r of rows) {
    const pts = r.points[format];
    const D = r.defenseTeam;
    const O = r.team;

    if (!defWeeks.has(D)) {
      defWeeks.set(D, new Set());
      defTotals.set(D, emptyPosRecord(() => 0));
      defFacedByWeek.set(D, new Map());
    }
    defWeeks.get(D)!.add(r.week);
    defTotals.get(D)![r.position] += pts;
    defFacedByWeek.get(D)!.set(r.week, O);

    if (!offWeeks.has(O)) {
      offWeeks.set(O, new Set());
      offTotals.set(O, emptyPosRecord(() => 0));
    }
    offWeeks.get(O)!.add(r.week);
    offTotals.get(O)![r.position] += pts;
  }

  const offPpg = new Map<string, Record<FantasyPosition, number>>();
  for (const [O, weeks] of offWeeks) {
    const g = weeks.size || 1;
    const totals = offTotals.get(O)!;
    offPpg.set(O, emptyPosRecord<number>(() => 0));
    for (const p of FANTASY_POSITIONS) offPpg.get(O)![p] = totals[p] / g;
  }

  const leagueAvg = emptyPosRecord(() => 0);
  for (const p of FANTASY_POSITIONS) {
    let sum = 0;
    let count = 0;
    for (const O of offPpg.keys()) {
      sum += offPpg.get(O)![p];
      count++;
    }
    leagueAvg[p] = count ? sum / count : 0;
  }

  const table: FpaTable = new Map();
  for (const [D, weeks] of defWeeks) {
    const games = weeks.size || 1;
    const totals = defTotals.get(D)!;
    const faced = [...defFacedByWeek.get(D)!.values()];

    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      const raw = totals[p] / games;

      let sosSum = 0;
      let sosCount = 0;
      for (const off of faced) {
        const ppg = offPpg.get(off);
        if (ppg) {
          sosSum += ppg[p];
          sosCount++;
        }
      }
      const sos = sosCount ? sosSum / sosCount : leagueAvg[p];
      const adj = raw - (sos - leagueAvg[p]);

      byPos[p] = { raw, adj };
    }

    table.set(D, { games, byPos });
  }

  return table;
}

function distinctWeeksDesc(rows: ScoredPlayerWeek[]): number[] {
  return [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a);
}

function rowsForWeeks(rows: ScoredPlayerWeek[], weeks: Set<number>): ScoredPlayerWeek[] {
  return rows.filter((r) => weeks.has(r.week));
}

function currentSeasonWeight(weeksPlayed: number): number {
  if (weeksPlayed <= 0) return 0;
  if (weeksPlayed === 1) return 0.25;
  if (weeksPlayed === 2) return 0.4;
  if (weeksPlayed === 3) return 0.6;
  if (weeksPlayed === 4) return 0.8;
  if (weeksPlayed < 12) return Math.min(0.9, 0.8 + (weeksPlayed - 4) * 0.02);
  return 1;
}

interface BlendedDefense {
  abbr: string;
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}

function buildPreseasonBaseline(full: FpaTable): Map<string, BlendedDefense> {
  const out = new Map<string, BlendedDefense>();
  for (const [abbr, fullDef] of full) {
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      byPos[p] = { ...fullDef.byPos[p] };
    }
    out.set(abbr, { abbr, games: fullDef.games, byPos });
  }
  return out;
}

function blendWithCurrent(
  baseline: Map<string, BlendedDefense>,
  current: FpaTable,
  weeksPlayed: number,
): Map<string, BlendedDefense> {
  const w = currentSeasonWeight(weeksPlayed);
  const out = new Map<string, BlendedDefense>();
  const abbrs = new Set<string>([...baseline.keys(), ...current.keys()]);
  for (const abbr of abbrs) {
    const base = baseline.get(abbr);
    const cur = current.get(abbr);
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      const b = base?.byPos[p] ?? cur!.byPos[p];
      const c = cur?.byPos[p] ?? b;
      byPos[p] = {
        raw: (1 - w) * b.raw + w * c.raw,
        adj: (1 - w) * b.adj + w * c.adj,
      };
    }
    out.set(abbr, {
      abbr,
      games: cur?.games ?? base?.games ?? 0,
      byPos,
    });
  }
  return out;
}

// ─── Presentation (ported from routes/nfl/fpa.ts) ───────────────────────────────

function getDataMode(weekNumber: number | null): {
  dataMode: string;
  methodology: string;
  isPreseason: boolean;
} {
  if (weekNumber === null || weekNumber < 1) {
    return {
      dataMode: "Preseason Baseline",
      methodology:
        `Preseason mode: 100% weight on ${BASELINE_SEASON} full-season data. No ${CURRENT_SEASON} regular-season games have been played yet.`,
      isPreseason: true,
    };
  }
  if (weekNumber === 1) {
    return {
      dataMode: "Week 1 — Early Season",
      methodology: `Week 1: 75% preseason baseline (${BASELINE_SEASON} season) and 25% ${CURRENT_SEASON} regular-season data. Small sample — treat rankings with caution.`,
      isPreseason: false,
    };
  }
  if (weekNumber === 2) {
    return {
      dataMode: "Week 2 — Early Season",
      methodology: `Week 2: 60% preseason baseline (${BASELINE_SEASON} season) and 40% ${CURRENT_SEASON} regular-season data. Small sample — treat rankings with caution.`,
      isPreseason: false,
    };
  }
  if (weekNumber === 3) {
    return {
      dataMode: "Week 3",
      methodology: `Week 3: 40% preseason baseline (${BASELINE_SEASON} season) and 60% ${CURRENT_SEASON} regular-season data.`,
      isPreseason: false,
    };
  }
  if (weekNumber === 4) {
    return {
      dataMode: "Week 4",
      methodology: `Week 4: 20% preseason baseline (${BASELINE_SEASON} season) and 80% ${CURRENT_SEASON} regular-season data.`,
      isPreseason: false,
    };
  }
  if (weekNumber < 12) {
    return {
      dataMode: `Week ${weekNumber} — Current Season`,
      methodology: `Week ${weekNumber}: mostly ${CURRENT_SEASON} current-season data with a small stabilizing prior from ${BASELINE_SEASON}.`,
      isPreseason: false,
    };
  }
  return {
    dataMode: `Week ${weekNumber} — Rolling 10 Weeks`,
    methodology: `Week ${weekNumber}: rolling 10-week window of ${CURRENT_SEASON} regular-season data. Full-season averages are no longer used.`,
    isPreseason: false,
  };
}

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

// Industry convention: Rank 1 = most fantasy points allowed = easiest matchup.
function rankByFpaDesc(rows: ProcessedRow[], key: keyof ProcessedRow): Map<ProcessedRow, number> {
  const sorted = [...rows].sort((a, b) => (b[key] as number) - (a[key] as number));
  const map = new Map<ProcessedRow, number>();
  sorted.forEach((r, i) => map.set(r, i + 1));
  return map;
}

function buildRows(
  blended: Map<string, BlendedDefense>,
  view: "raw" | "adjusted",
): ProcessedRow[] {
  const field: keyof PositionFpa = view === "raw" ? "raw" : "adj";

  const rows: ProcessedRow[] = [...blended.values()].map((def) => {
    const qbFpa = round2(def.byPos.QB[field]);
    const rbFpa = round2(def.byPos.RB[field]);
    const wrFpa = round2(def.byPos.WR[field]);
    const teFpa = round2(def.byPos.TE[field]);
    const offFpa = round2(
      def.byPos.QB[field] + def.byPos.RB[field] + def.byPos.WR[field] + def.byPos.TE[field],
    );
    return {
      team: teamName(def.abbr),
      teamAbbr: def.abbr,
      qbFpa,
      rbFpa,
      wrFpa,
      teFpa,
      offFpa,
      gamesPlayed: def.games,
      qbRank: 0,
      rbRank: 0,
      wrRank: 0,
      teRank: 0,
    };
  });

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

// ─── Pipeline ───────────────────────────────────────────────────────────────────

interface Combo {
  rows: ProcessedRow[];
  dataMode: string;
  methodology: string;
  season: number;
  format: ScoringFormat;
  view: "raw" | "adjusted";
  weekNumber: number | null;
  isPreseason: boolean;
}

interface SyncPayload {
  generatedAt: string;
  currentSeason: number;
  baselineSeason: number;
  weekNumber: number | null;
  dataMode: string;
  isPreseason: boolean;
  teamCount: number;
  combos: Record<string, Combo>;
}

async function buildPayload(): Promise<SyncPayload> {
  log(`computing FPA — baseline ${BASELINE_SEASON}, current ${CURRENT_SEASON}`);

  const baselineRows = (await fetchScoredWeeklyStats(BASELINE_SEASON)).filter(
    (r) => r.week >= 1 && r.week <= BASELINE_MAX_WEEK,
  );
  if (baselineRows.length === 0) {
    throw new Error(`No baseline rows scored for ${BASELINE_SEASON}; aborting`);
  }

  let currentRows: ScoredPlayerWeek[] = [];
  try {
    currentRows = await fetchScoredWeeklyStats(CURRENT_SEASON);
  } catch (err) {
    if (err instanceof NflverseSeasonUnavailableError) {
      log(`current season ${CURRENT_SEASON} not yet published — preseason baseline only`);
    } else {
      throw err;
    }
  }

  const currentWeeksPlayed = currentRows.length
    ? new Set(currentRows.map((r) => r.week)).size
    : 0;
  const isPreseason = currentWeeksPlayed === 0;
  const weekNumber = isPreseason ? null : Math.max(...currentRows.map((r) => r.week));
  const { dataMode } = getDataMode(weekNumber);

  const combos: Record<string, Combo> = {};
  let teamCount = 0;

  for (const format of SCORING_FORMATS) {
    const full = computeFpaTable(baselineRows, format);
    let blended = buildPreseasonBaseline(full);

    if (!isPreseason) {
      const curWeeks =
        currentWeeksPlayed >= 12
          ? new Set(distinctWeeksDesc(currentRows).slice(0, ROLLING_WINDOW_WEEKS))
          : new Set(currentRows.map((r) => r.week));
      const current = computeFpaTable(rowsForWeeks(currentRows, curWeeks), format);
      blended = blendWithCurrent(blended, current, currentWeeksPlayed);
    }

    for (const view of ["raw", "adjusted"] as const) {
      const rows = buildRows(blended, view);
      teamCount = rows.length;
      const mode = getDataMode(weekNumber);
      combos[`${format}:${view}`] = {
        rows,
        dataMode: mode.dataMode,
        methodology: mode.methodology,
        season: CURRENT_SEASON,
        format,
        view,
        weekNumber,
        isPreseason: mode.isPreseason,
      };
    }
  }

  return {
    // Stamp time at runtime; new Date() is fine here (this is not a workflow script).
    generatedAt: new Date().toISOString(),
    currentSeason: CURRENT_SEASON,
    baselineSeason: BASELINE_SEASON,
    weekNumber,
    dataMode,
    isPreseason,
    teamCount,
    combos,
  };
}

async function main(): Promise<void> {
  const payload = await buildPayload();

  // Write the snapshot into the plugin's bundled data file.
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  log(
    `wrote ${OUTPUT_FILE} — mode "${payload.dataMode}", ${payload.teamCount} teams, ` +
      `preseason=${payload.isPreseason}`,
  );
  log("Rebuild the plugin zip and re-upload it in WordPress to publish this data.");
}

main().catch((err) => {
  console.error("[refresh-fpa] FAILED:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
