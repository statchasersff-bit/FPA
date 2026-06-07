/**
 * nflverse data source for Fantasy Points Allowed.
 *
 * Fetches the weekly player stats CSV published by nflverse and computes
 * fantasy points for every player-row in Standard, Half-PPR, and PPR scoring.
 *
 * Source (per season):
 *   https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_<season>.csv
 *
 * The CSV already ships `fantasy_points` (standard) and `fantasy_points_ppr`
 * columns, but we compute all three formats manually from the raw stat columns
 * so the scoring rules are explicit and auditable (and so Half-PPR exists).
 */

import { logger } from "./logger";

export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type FantasyPosition = (typeof FANTASY_POSITIONS)[number];

export type ScoringFormat = "standard" | "half" | "ppr";
export const SCORING_FORMATS: ScoringFormat[] = ["standard", "half", "ppr"];

const FANTASY_POSITION_SET = new Set<string>(FANTASY_POSITIONS);

// nflverse has published the weekly player stats under two release tags over
// time. The current release is `stats_player`; the older one is `player_stats`.
// Try the current tag first, then fall back to the legacy tag.
export const NFLVERSE_RELEASE_TAGS = ["stats_player", "player_stats"] as const;
export type NflverseReleaseTag = (typeof NFLVERSE_RELEASE_TAGS)[number];

export function nflverseWeeklyUrl(
  season: number,
  releaseTag: NflverseReleaseTag,
): string {
  return (
    "https://github.com/nflverse/nflverse-data/releases/download/" +
    `${releaseTag}/stats_player_week_${season}.csv`
  );
}

export function nflverseWeeklyUrlCandidates(
  season: number,
): { tag: NflverseReleaseTag; url: string }[] {
  return NFLVERSE_RELEASE_TAGS.map((tag) => ({
    tag,
    url: nflverseWeeklyUrl(season, tag),
  }));
}

// ─── CSV parsing (RFC-4180: handles quoted fields, escaped quotes, CRLF) ──────

export function parseCsv(text: string): string[][] {
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
  // flush trailing field/row (file may not end with a newline)
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

// ─── Fantasy scoring ─────────────────────────────────────────────────────────

// Standard scoring:
//   pass: 0.04/yd, 4/TD, -1/INT
//   rush: 0.1/yd, 6/TD
//   recv: 0.1/yd, 6/TD
//   2pt conversions: 2 each (pass/rush/recv)
//   fumbles lost: -2 each (sack/rush/recv)
//   special teams TD: 6
// Half-PPR adds 0.5/reception, PPR adds 1.0/reception.
const RECEPTION_POINTS: Record<ScoringFormat, number> = {
  standard: 0,
  half: 0.5,
  ppr: 1,
};

export interface ScoredPlayerWeek {
  season: number;
  week: number;
  seasonType: string;
  position: FantasyPosition;
  team: string; // offensive team the player belongs to
  defenseTeam: string; // opponent_team — the defense that allowed these points
  receptions: number;
  points: Record<ScoringFormat, number>;
}

/** Compute fantasy points for all three formats from a raw stat row. */
export function scoreRow(get: (col: string) => string | undefined): {
  receptions: number;
  points: Record<ScoringFormat, number>;
} {
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
      2 +
    g("special_teams_tds") * 6;

  const receptions = g("receptions");

  return {
    receptions,
    points: {
      standard: base + receptions * RECEPTION_POINTS.standard,
      half: base + receptions * RECEPTION_POINTS.half,
      ppr: base + receptions * RECEPTION_POINTS.ppr,
    },
  };
}

// ─── Fetch + parse ───────────────────────────────────────────────────────────

export class NflverseSeasonUnavailableError extends Error {
  constructor(public season: number) {
    super(`nflverse weekly stats not available for season ${season}`);
    this.name = "NflverseSeasonUnavailableError";
  }
}

/**
 * Fetch and score the weekly player stats for a season.
 *
 * @param season         The season to fetch (e.g. 2025).
 * @param opts.seasonType Filter by season_type. Defaults to "REG".
 * @returns One scored record per fantasy-relevant (QB/RB/WR/TE) player-week.
 * @throws NflverseSeasonUnavailableError if the release asset 404s (e.g. the
 *         season has not been published yet).
 */
export async function fetchScoredWeeklyStats(
  season: number,
  opts: { seasonType?: string | null } = {},
): Promise<ScoredPlayerWeek[]> {
  const seasonType = opts.seasonType === undefined ? "REG" : opts.seasonType;

  // Try each release tag in order (current `stats_player`, then legacy
  // `player_stats`). Only if every candidate fails do we treat the season as
  // unavailable. Each attempt is logged with its outcome for debugging.
  let text: string | null = null;
  const candidates = nflverseWeeklyUrlCandidates(season);
  for (const { tag, url } of candidates) {
    logger.info({ season, tag, url }, "trying nflverse weekly stats URL");
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      logger.warn(
        { season, tag, url, err },
        "nflverse weekly stats URL request failed — trying next path",
      );
      continue;
    }
    if (!res.ok) {
      logger.warn(
        { season, tag, url, status: res.status },
        "nflverse weekly stats URL did not return OK — trying next path",
      );
      continue;
    }
    text = await res.text();
    logger.info(
      { season, tag, url, status: res.status, bytes: text.length },
      "nflverse weekly stats URL succeeded",
    );
    break;
  }

  if (text === null) {
    logger.warn(
      { season, tried: candidates.map((c) => c.url) },
      "all nflverse weekly stats URLs failed — season unavailable",
    );
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
    if (cells.length !== header.length) continue; // skip malformed rows

    const position = cells[colIndex.get("position")!];
    if (!FANTASY_POSITION_SET.has(position)) continue;

    const rowSeasonType = cells[colIndex.get("season_type")!];
    if (seasonType !== null && rowSeasonType !== seasonType) continue;

    const defenseTeam = cells[colIndex.get("opponent_team")!];
    if (!defenseTeam) continue;

    const get = (col: string): string | undefined => {
      const idx = colIndex.get(col);
      return idx === undefined ? undefined : cells[idx];
    };

    const { receptions, points } = scoreRow(get);

    out.push({
      season: num(cells[colIndex.get("season")!]),
      week: num(cells[colIndex.get("week")!]),
      seasonType: rowSeasonType,
      position: position as FantasyPosition,
      team: cells[colIndex.get("team")!],
      defenseTeam,
      receptions,
      points,
    });
  }

  logger.info(
    { season, rows: out.length },
    "scored nflverse weekly stats (QB/RB/WR/TE)",
  );
  return out;
}

// ─── Team metadata ───────────────────────────────────────────────────────────

// Keyed by the abbreviations nflverse emits in `opponent_team` / `team`.
// Note: nflverse uses LA (Rams), LAC (Chargers), LV (Raiders), WAS, etc.
// Legacy relocation codes are included so older seasons still resolve.
export const TEAM_NAMES: Record<string, string> = {
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
  // legacy aliases
  LAR: "Los Angeles Rams",
  OAK: "Las Vegas Raiders",
  SD: "Los Angeles Chargers",
  STL: "Los Angeles Rams",
  WSH: "Washington Commanders",
};

export function teamName(abbr: string): string {
  return TEAM_NAMES[abbr] ?? abbr;
}
