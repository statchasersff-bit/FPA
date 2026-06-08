import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Individual game-level FPA records
export const fantasyPointsAllowedGamesTable = pgTable(
  "fantasy_points_allowed_games",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    defenseTeamAbbr: text("defense_team_abbr").notNull(),
    offenseTeamAbbr: text("offense_team_abbr").notNull(),
    position: text("position").notNull(), // QB, RB, WR, TE
    scoringFormat: text("scoring_format").notNull(), // standard, half, ppr
    fantasyPoints: numeric("fantasy_points", { precision: 8, scale: 2 }).notNull(),
    gamesCount: integer("games_count").notNull().default(1),
    isBaseline: boolean("is_baseline").notNull().default(false), // true if seeded/historical
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("fpa_games_defense_season_idx").on(t.defenseTeamAbbr, t.season),
    index("fpa_games_season_week_idx").on(t.season, t.week),
  ],
);

// Precomputed snapshots for fast reads
export const fantasyPointsAllowedSnapshotsTable = pgTable(
  "fantasy_points_allowed_snapshots",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    weekNumber: integer("week_number"), // null = preseason
    defenseTeamAbbr: text("defense_team_abbr").notNull(),
    defenseTeamName: text("defense_team_name").notNull(),
    scoringFormat: text("scoring_format").notNull(), // standard, half, ppr
    // Raw FPA — stored at full precision so ranking (routes/nfl/fpa.ts) sees
    // true values; rounding to display happens only in the frontend (toFixed).
    qbFpaRaw: numeric("qb_fpa_raw", { precision: 12, scale: 6 }).notNull(),
    rbFpaRaw: numeric("rb_fpa_raw", { precision: 12, scale: 6 }).notNull(),
    wrFpaRaw: numeric("wr_fpa_raw", { precision: 12, scale: 6 }).notNull(),
    teFpaRaw: numeric("te_fpa_raw", { precision: 12, scale: 6 }).notNull(),
    offFpaRaw: numeric("off_fpa_raw", { precision: 12, scale: 6 }).notNull(),
    // Adjusted FPA — full precision (see note above).
    qbFpaAdj: numeric("qb_fpa_adj", { precision: 12, scale: 6 }).notNull(),
    rbFpaAdj: numeric("rb_fpa_adj", { precision: 12, scale: 6 }).notNull(),
    wrFpaAdj: numeric("wr_fpa_adj", { precision: 12, scale: 6 }).notNull(),
    teFpaAdj: numeric("te_fpa_adj", { precision: 12, scale: 6 }).notNull(),
    offFpaAdj: numeric("off_fpa_adj", { precision: 12, scale: 6 }).notNull(),
    gamesPlayed: integer("games_played").notNull(),
    dataMode: text("data_mode").notNull(), // e.g. "preseason_baseline", "week1", etc.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fpa_snapshots_season_format_idx").on(t.season, t.scoringFormat),
  ],
);

export const insertFpaGameSchema = createInsertSchema(
  fantasyPointsAllowedGamesTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const insertFpaSnapshotSchema = createInsertSchema(
  fantasyPointsAllowedSnapshotsTable,
).omit({ id: true, createdAt: true });

export type InsertFpaGame = z.infer<typeof insertFpaGameSchema>;
export type FpaGame = typeof fantasyPointsAllowedGamesTable.$inferSelect;
export type InsertFpaSnapshot = z.infer<typeof insertFpaSnapshotSchema>;
export type FpaSnapshot = typeof fantasyPointsAllowedSnapshotsTable.$inferSelect;
