import { useState, useMemo } from "react";
import {
  useGetNflFpa,
  getGetNflFpaQueryKey,
} from "@workspace/api-client-react";
import {
  Download,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Info,
  TrendingUp,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type ScoringFormat = "standard" | "half" | "ppr";
type ViewMode = "raw" | "adjusted";
type DataRange = "preseason" | "season" | "last5" | "last10";
type PositionKey = "qb" | "rb" | "wr" | "te" | "off";
type PositionFilter = "all" | PositionKey;

type Row = {
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
  offRank: number;
  gamesPlayed: number;
};

type SortField =
  | "team"
  | "qbRank"
  | "qbFpa"
  | "rbRank"
  | "rbFpa"
  | "wrRank"
  | "wrFpa"
  | "teRank"
  | "teFpa"
  | "offRank"
  | "offFpa";
type SortDirection = "asc" | "desc";

// ─── Matchup tiers ───────────────────────────────────────────────────────────
// Rank 1 = toughest (fewest pts allowed). Rank 32 = easiest (most pts allowed).

type Tier = {
  key: "tough" | "neutral" | "good" | "smash";
  label: string;
  // [text color, soft background, hairline border] kept in one className.
  pill: string;
  dot: string;
};

function getTier(rank: number): Tier {
  if (rank <= 8)
    return {
      key: "tough",
      label: "Tough",
      pill: "text-[hsl(6_78%_64%)] bg-[hsl(6_72%_52%/0.12)] border-[hsl(6_72%_52%/0.28)]",
      dot: "bg-[hsl(6_78%_60%)]",
    };
  if (rank <= 16)
    return {
      key: "neutral",
      label: "Neutral",
      pill: "text-muted-foreground bg-white/[0.04] border-white/10",
      dot: "bg-muted-foreground",
    };
  if (rank <= 24)
    return {
      key: "good",
      label: "Good",
      pill: "text-primary bg-primary/10 border-primary/30",
      dot: "bg-primary",
    };
  return {
    key: "smash",
    label: "Smash",
    pill: "text-[hsl(151_68%_56%)] bg-[hsl(151_60%_45%/0.12)] border-[hsl(151_60%_45%/0.30)]",
    dot: "bg-[hsl(151_68%_50%)]",
  };
}

function overallLabel(rank: number): string {
  if (rank <= 8) return "Very Tough";
  if (rank <= 16) return "Neutral";
  if (rank <= 24) return "Favorable";
  return "Very Favorable";
}

// ─── Team logos (ESPN CDN with abbreviation fallback) ────────────────────────

const ESPN_ABBR: Record<string, string> = { WAS: "wsh" };

function TeamLogo({ abbr, size = 28 }: { abbr: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const slug = ESPN_ABBR[abbr] ?? abbr.toLowerCase();
  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground ring-1 ring-white/10"
        style={{ width: size, height: size }}
      >
        {abbr.slice(0, 3)}
      </div>
    );
  }
  return (
    <img
      src={`https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`}
      alt={abbr}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────

const POSITIONS: { key: PositionKey; label: string }[] = [
  { key: "qb", label: "QB" },
  { key: "rb", label: "RB" },
  { key: "wr", label: "WR" },
  { key: "te", label: "TE" },
  { key: "off", label: "OFF" },
];

function rankOf(row: Row, pos: PositionKey): number {
  return row[`${pos}Rank` as keyof Row] as number;
}
function fpaOf(row: Row, pos: PositionKey): number {
  return row[`${pos}Fpa` as keyof Row] as number;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Rank chip used inside the desktop table cells.
function RankChip({ rank }: { rank: number }) {
  const tier = getTier(rank);
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-md border px-1.5 text-xs font-bold tabular-nums",
        tier.pill,
      )}
    >
      {rank}
    </span>
  );
}

function TierBadge({ rank }: { rank: number }) {
  const tier = getTier(rank);
  return (
    <span
      className={cn(
        "sc-fpa-badge inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tier.pill,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tier.dot)} />
      {tier.label}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FpaPage() {
  const [format, setFormat] = useState<ScoringFormat>("half");
  const [view, setView] = useState<ViewMode>("raw");
  const [range, setRange] = useState<DataRange>("preseason");
  const [position, setPosition] = useState<PositionFilter>("all");
  const [search, setSearch] = useState("");
  const season = 2026;

  const [sortField, setSortField] = useState<SortField>("offFpa");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [showMethodology, setShowMethodology] = useState(false);

  const { data, isLoading, error } = useGetNflFpa(
    { season, format, view },
    { query: { queryKey: getGetNflFpaQueryKey({ season, format, view }) } },
  );

  // Attach a client-side OFF rank (1 = toughest = lowest offFpa).
  const rows: Row[] = useMemo(() => {
    if (!data?.rows) return [];
    const base = data.rows as Omit<Row, "offRank">[];
    const offOrder = [...base].sort((a, b) => a.offFpa - b.offFpa);
    const offRankByAbbr = new Map<string, number>();
    offOrder.forEach((r, i) => offRankByAbbr.set(r.teamAbbr, i + 1));
    return base.map((r) => ({ ...r, offRank: offRankByAbbr.get(r.teamAbbr)! }));
  }, [data?.rows]);

  // When a single position is selected, sort by it by default.
  const effectiveSortField: SortField =
    position !== "all" && sortField === "offFpa"
      ? (`${position}Fpa` as SortField)
      : sortField;

  const handleSort = (field: SortField) => {
    if (effectiveSortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Default: FPA fields high→low (easiest first), rank/team low→high.
      setSortDirection(field.endsWith("Fpa") ? "desc" : "asc");
    }
  };

  const processedRows = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (row) =>
          row.teamAbbr.toLowerCase().includes(q) ||
          row.team.toLowerCase().includes(q),
      );
    }
    const field = effectiveSortField;
    return [...r].sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [rows, search, effectiveSortField, sortDirection]);

  // Summary cards — easiest matchup per position (rank 32) + toughest defense.
  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const easiest = (pos: PositionKey) =>
      rows.reduce((best, r) => (fpaOf(r, pos) > fpaOf(best, pos) ? r : best));
    const toughestOverall = rows.reduce((best, r) =>
      r.offRank < best.offRank ? r : best,
    );
    return {
      qb: easiest("qb"),
      rb: easiest("rb"),
      wr: easiest("wr"),
      toughest: toughestOverall,
    };
  }, [rows]);

  const handleDownloadCsv = () => {
    const cols: { header: string; value: (r: Row) => string | number }[] = [
      { header: "Team", value: (r) => r.team },
      { header: "Abbr", value: (r) => r.teamAbbr },
      { header: "QB Rank", value: (r) => r.qbRank },
      { header: "QB FPA", value: (r) => r.qbFpa.toFixed(1) },
      { header: "RB Rank", value: (r) => r.rbRank },
      { header: "RB FPA", value: (r) => r.rbFpa.toFixed(1) },
      { header: "WR Rank", value: (r) => r.wrRank },
      { header: "WR FPA", value: (r) => r.wrFpa.toFixed(1) },
      { header: "TE Rank", value: (r) => r.teRank },
      { header: "TE FPA", value: (r) => r.teFpa.toFixed(1) },
      { header: "OFF Rank", value: (r) => r.offRank },
      { header: "OFF FPA", value: (r) => r.offFpa.toFixed(1) },
    ];
    const lines = [
      cols.map((c) => c.header).join(","),
      ...processedRows.map((r) => cols.map((c) => `${c.value(r)}`).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statchasers-fpa-${format}-${view}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (effectiveSortField !== field)
      return (
        <ChevronsUpDown className="ml-1 inline-block h-3.5 w-3.5 text-muted-foreground/40" />
      );
    return sortDirection === "asc" ? (
      <ChevronUp className="ml-1 inline-block h-3.5 w-3.5 text-primary" />
    ) : (
      <ChevronDown className="ml-1 inline-block h-3.5 w-3.5 text-primary" />
    );
  };

  // Which position blocks are visible in the table / cards.
  const visiblePositions: PositionKey[] =
    position === "all"
      ? ["qb", "rb", "wr", "te", "off"]
      : position === "off"
        ? ["off"]
        : [position];

  const tableColSpan = 1 + visiblePositions.length * 2;

  return (
    <div className="sc-fpa-page min-h-[100dvh] bg-background text-foreground">
      {/* ambient gold glow behind hero */}
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-[0.18]"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, hsl(43 96% 56% / 0.45), transparent 70%)",
          }}
        />

        <div className="relative mx-auto max-w-[1400px] space-y-6 px-4 py-6 md:px-8 md:py-8">
          {/* ─── Hero ─────────────────────────────────────────────────── */}
          <header className="sc-fpa-hero">
            <div className="mb-3 inline-flex items-center rounded-full border border-primary/40 bg-primary/5 px-3 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                {season} Preseason Baseline
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              Fantasy Points Allowed{" "}
              <span className="text-primary">by Position</span>
            </h1>
            <div className="mt-2 h-1 w-20 rounded-full bg-gradient-to-r from-primary to-primary/30" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              Identify the best and toughest fantasy football matchups using raw
              and schedule-adjusted points allowed by position.
            </p>
          </header>

          {/* ─── Data mode card ──────────────────────────────────────── */}
          <div className="sc-fpa-card rounded-xl border border-border bg-card/80 p-4 md:p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/25">
                <TrendingUp className="h-[18px] w-[18px] text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">
                  Current Data Mode:{" "}
                  <span className="text-primary">
                    {data?.dataMode ?? "Preseason Baseline"}
                  </span>
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground md:text-[13px]">
                  Because no meaningful {season} regular-season sample exists
                  yet, this page currently uses a blended preseason baseline
                  built from 2025 full-season data and late-season 2025 trends.
                  As {season} games are played, the model will gradually shift
                  toward current-season data.
                </p>
                <button
                  onClick={() => setShowMethodology(!showMethodology)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                  data-testid="button-toggle-methodology"
                >
                  <Info className="h-3.5 w-3.5" />
                  How it works
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      showMethodology && "rotate-180",
                    )}
                  />
                </button>
                {showMethodology && (
                  <ul className="mt-3 grid gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground sm:grid-cols-2">
                    {[
                      ["Preseason", "70% 2025 full season + 30% final 8 weeks of 2025"],
                      ["Weeks 1–4", "Blended baseline and 2026 data"],
                      ["Week 5+",   "Mostly current-season data"],
                      ["Week 12+",  "Rolling 10-week data"],
                    ].map(([k, v]) => (
                      <li key={k} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                        <span>
                          <span className="font-semibold text-foreground">{k}:</span>{" "}
                          {v}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* ─── Controls ────────────────────────────────────────────── */}
          <div className="sc-fpa-controls sticky top-0 z-30 -mx-4 border-y border-border bg-background/85 px-4 py-3 backdrop-blur-md md:mx-0 md:rounded-xl md:border md:px-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <ControlGroup label="Scoring">
                <Chips
                  value={format}
                  onChange={(v) => setFormat(v as ScoringFormat)}
                  options={[
                    { value: "standard", label: "STD" },
                    { value: "half", label: "½ PPR" },
                    { value: "ppr", label: "PPR" },
                  ]}
                />
              </ControlGroup>

              <Divider />

              <ControlGroup
                label="View"
                tooltip={
                  view === "adjusted"
                    ? "Adjusted FPA removes schedule bias by comparing actual points allowed to the expected production of the offenses faced."
                    : "Raw FPA shows the average fantasy points scored by each position against that defense."
                }
              >
                <Chips
                  value={view}
                  onChange={(v) => setView(v as ViewMode)}
                  options={[
                    { value: "raw", label: "Raw" },
                    { value: "adjusted", label: "Adjusted" },
                  ]}
                />
              </ControlGroup>

              <Divider />

              <ControlGroup label="Data Range">
                <Chips
                  value={range}
                  onChange={(v) => setRange(v as DataRange)}
                  options={[
                    { value: "preseason", label: "Preseason" },
                    { value: "season", label: "2026", disabled: true },
                    { value: "last5", label: "Last 5", disabled: true },
                    { value: "last10", label: "Last 10", disabled: true },
                  ]}
                  disabledTooltip="Begins blending in after Week 1"
                />
              </ControlGroup>

              <div className="ml-auto flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search team"
                    className="h-8 w-36 rounded-lg border-border bg-muted/40 pl-8 text-xs focus-visible:ring-primary"
                    data-testid="input-search-team"
                  />
                </div>
                <Button
                  onClick={handleDownloadCsv}
                  className="h-8 gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  data-testid="button-download-csv"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV
                </Button>
              </div>
            </div>

            {/* Position quick filter */}
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Position
              </span>
              {(["all", ...POSITIONS.map((p) => p.key)] as PositionFilter[]).map(
                (p) => {
                  const label =
                    p === "all"
                      ? "All"
                      : POSITIONS.find((x) => x.key === p)!.label;
                  const active = position === p;
                  return (
                    <button
                      key={p}
                      onClick={() => setPosition(p)}
                      data-testid={`filter-position-${p}`}
                      className={cn(
                        "shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors",
                        active
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border bg-muted/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          {/* ─── Summary cards ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary ? (
              <>
                <SummaryCard
                  label="Easiest QB Matchup"
                  row={summary.qb}
                  pos="qb"
                  variant="easy"
                />
                <SummaryCard
                  label="Easiest RB Matchup"
                  row={summary.rb}
                  pos="rb"
                  variant="easy"
                />
                <SummaryCard
                  label="Easiest WR Matchup"
                  row={summary.wr}
                  pos="wr"
                  variant="easy"
                />
                <SummaryCard
                  label="Toughest Overall Defense"
                  row={summary.toughest}
                  pos="off"
                  variant="tough"
                />
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-8 w-16" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </div>
              ))
            )}
          </div>

          {/* ─── Microcopy ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Higher FPA means a more favorable fantasy matchup.{" "}
              <span className="text-foreground/80">Rank 32</span> is the easiest
              matchup. <span className="text-foreground/80">Rank 1</span> is the
              toughest.
            </p>
            <p className="inline-flex items-center gap-1.5 text-[11px] text-primary/80">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Preseason baseline active. Current-season data blends in after Week
              1.
            </p>
          </div>

          {/* ─── Error state ─────────────────────────────────────────── */}
          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center">
              <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
              <p className="mt-3 text-sm font-medium text-foreground">
                Unable to load matchup data. Please try refreshing the page.
              </p>
            </div>
          ) : (
            <>
              {/* ─── Desktop table ─────────────────────────────────── */}
              <div className="sc-fpa-table hidden overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/30 md:block">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th
                          className="sticky left-0 z-10 cursor-pointer select-none bg-muted/40 px-4 py-3 text-left font-semibold hover:text-foreground"
                          onClick={() => handleSort("team")}
                        >
                          Team <SortIcon field="team" />
                        </th>
                        {visiblePositions.map((pos) => (
                          <PositionHeader
                            key={pos}
                            pos={pos}
                            sortIcon={SortIcon}
                            onSort={handleSort}
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {isLoading ? (
                        Array.from({ length: 12 }).map((_, i) => (
                          <tr key={i}>
                            <td className="sticky left-0 z-10 bg-card px-4 py-3">
                              <Skeleton className="h-6 w-28" />
                            </td>
                            {Array.from({
                              length: visiblePositions.length * 2,
                            }).map((__, j) => (
                              <td key={j} className="px-3 py-3">
                                <Skeleton className="ml-auto h-6 w-12" />
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : processedRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={tableColSpan}
                            className="px-4 py-10 text-center text-sm text-muted-foreground"
                          >
                            No teams match your search.
                          </td>
                        </tr>
                      ) : (
                        processedRows.map((row) => (
                          <tr
                            key={row.teamAbbr}
                            className="group transition-colors hover:bg-primary/[0.04]"
                            data-testid={`row-team-${row.teamAbbr}`}
                          >
                            <td className="sticky left-0 z-10 bg-card px-4 py-2.5 transition-colors group-hover:bg-[hsl(222_20%_11%)]">
                              <div className="flex items-center gap-2.5">
                                <TeamLogo abbr={row.teamAbbr} />
                                <div className="leading-tight">
                                  <div className="font-bold tracking-tight">
                                    {row.teamAbbr}
                                  </div>
                                  <div className="hidden text-[11px] text-muted-foreground lg:block">
                                    {row.team}
                                  </div>
                                </div>
                              </div>
                            </td>
                            {visiblePositions.map((pos) => (
                              <PositionCells
                                key={pos}
                                pos={pos}
                                row={row}
                                showBadge={position !== "all"}
                              />
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ─── Mobile team cards ─────────────────────────────── */}
              <div className="space-y-3 md:hidden">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <Skeleton className="h-7 w-32" />
                      <Skeleton className="mt-3 h-5 w-full" />
                      <Skeleton className="mt-2 h-5 w-full" />
                    </div>
                  ))
                ) : processedRows.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                    No teams match your search.
                  </div>
                ) : (
                  processedRows.map((row) => (
                    <MobileTeamCard
                      key={row.teamAbbr}
                      row={row}
                      positions={visiblePositions}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {/* ─── Footer methodology ──────────────────────────────────── */}
          {data?.methodology && (
            <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground/70">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Methodology
              </span>{" "}
              · {data.methodology}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ControlGroup({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 cursor-help text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="hidden h-6 w-px bg-border lg:block" />;
}

function Chips<T extends string>({
  value,
  onChange,
  options,
  disabledTooltip,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  disabledTooltip?: string;
}) {
  return (
    <div className="inline-flex rounded-lg bg-muted/40 p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        const btn = (
          <button
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            data-testid={`chip-${opt.value}`}
            className={cn(
              "rounded-[7px] px-2.5 py-1 text-xs font-semibold transition-all",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : opt.disabled
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
        if (opt.disabled && disabledTooltip) {
          return (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{btn}</span>
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                {disabledTooltip}
              </TooltipContent>
            </Tooltip>
          );
        }
        return <span key={opt.value}>{btn}</span>;
      })}
    </div>
  );
}

function SummaryCard({
  label,
  row,
  pos,
  variant,
}: {
  label: string;
  row: Row;
  pos: PositionKey;
  variant: "easy" | "tough";
}) {
  const rank = rankOf(row, pos);
  const fpa = fpaOf(row, pos);
  const posLabel = pos.toUpperCase();
  const accent = variant === "tough" ? "text-[hsl(6_78%_64%)]" : "text-primary";
  return (
    <div
      className={cn(
        "sc-fpa-card group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40",
        "hover:shadow-[0_0_0_1px_hsl(43_96%_56%/0.25),0_8px_24px_-8px_hsl(43_96%_56%/0.25)]",
      )}
    >
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wider",
          accent,
        )}
      >
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <TeamLogo abbr={row.teamAbbr} size={32} />
        <span className="text-2xl font-extrabold tracking-tight">
          {row.teamAbbr}
        </span>
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{fpa.toFixed(1)}</span>{" "}
        {posLabel} FPA
        <span className="mx-1.5 text-border">·</span>
        <span className={accent}>
          {ordinal(rank)} vs {posLabel}
        </span>
      </div>
    </div>
  );
}

const POS_TOOLTIP =
  "Higher FPA means an easier matchup. Rank 32 allows the most fantasy points; Rank 1 allows the fewest.";

function PositionHeader({
  pos,
  sortIcon: SortIcon,
  onSort,
}: {
  pos: PositionKey;
  sortIcon: (props: { field: SortField }) => React.ReactElement;
  onSort: (f: SortField) => void;
}) {
  const label = pos.toUpperCase();
  const isOff = pos === "off";
  return (
    <>
      <th
        className={cn(
          "cursor-pointer select-none px-3 py-3 text-right font-semibold hover:text-foreground",
          isOff && "bg-primary/[0.06]",
        )}
        onClick={() => onSort(`${pos}Rank` as SortField)}
      >
        {label} Rank <SortIcon field={`${pos}Rank` as SortField} />
      </th>
      <th
        className={cn(
          "cursor-pointer select-none border-r border-border/40 px-3 py-3 text-right font-semibold hover:text-foreground",
          isOff && "border-r-0 bg-primary/[0.06] text-foreground",
        )}
        onClick={() => onSort(`${pos}Fpa` as SortField)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              {label} FPA <SortIcon field={`${pos}Fpa` as SortField} />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            {POS_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </th>
    </>
  );
}

function PositionCells({
  pos,
  row,
  showBadge,
}: {
  pos: PositionKey;
  row: Row;
  showBadge: boolean;
}) {
  const rank = rankOf(row, pos);
  const fpa = fpaOf(row, pos);
  const isOff = pos === "off";
  return (
    <>
      <td className={cn("px-3 py-2.5 text-right", isOff && "bg-primary/[0.04]")}>
        <div className="flex items-center justify-end gap-2">
          {showBadge && <TierBadge rank={rank} />}
          <RankChip rank={rank} />
        </div>
      </td>
      <td
        className={cn(
          "border-r border-border/40 px-3 py-2.5 text-right font-mono tabular-nums",
          isOff
            ? "border-r-0 bg-primary/[0.04] font-bold text-foreground"
            : "font-medium",
        )}
      >
        {fpa.toFixed(1)}
      </td>
    </>
  );
}

function MobileTeamCard({
  row,
  positions,
}: {
  row: Row;
  positions: PositionKey[];
}) {
  const overall = overallLabel(row.offRank);
  const overallTier = getTier(row.offRank);
  return (
    <div
      className="sc-fpa-mobile-card rounded-xl border border-border bg-card p-4"
      data-testid={`mobile-card-${row.teamAbbr}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TeamLogo abbr={row.teamAbbr} size={36} />
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight">
              {row.teamAbbr}
            </div>
            <div className="text-[11px] text-muted-foreground">{row.team}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Overall
          </div>
          <div
            className={cn("text-sm font-bold", overallTier.pill.split(" ")[0])}
          >
            {overall}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
        {positions
          .filter((p) => p !== "off")
          .map((pos) => {
            const rank = rankOf(row, pos);
            const fpa = fpaOf(row, pos);
            return (
              <div
                key={pos}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="w-8 font-bold text-muted-foreground">
                  {pos.toUpperCase()}
                </span>
                <span className="flex-1 font-mono tabular-nums text-foreground">
                  {fpa.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Rank {rank}
                </span>
                <TierBadge rank={rank} />
              </div>
            );
          })}
      </div>
    </div>
  );
}
