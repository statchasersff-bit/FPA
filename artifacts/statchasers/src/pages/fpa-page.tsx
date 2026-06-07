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
  Info,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
type PositionKey = "qb" | "rb" | "wr" | "te" | "off";

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
  // Subtle table-cell heatmap tint.
  heat: string;
};

function getTier(rank: number): Tier {
  if (rank <= 8)
    return {
      key: "tough",
      label: "Tough",
      pill: "text-[hsl(6_78%_64%)] bg-[hsl(6_72%_52%/0.12)] border-[hsl(6_72%_52%/0.28)]",
      dot: "bg-[hsl(6_78%_60%)]",
      heat: "bg-[hsl(6_72%_52%/0.07)]",
    };
  if (rank <= 16)
    return {
      key: "neutral",
      label: "Neutral",
      pill: "text-muted-foreground bg-white/[0.04] border-white/10",
      dot: "bg-muted-foreground",
      heat: "",
    };
  if (rank <= 24)
    return {
      key: "good",
      label: "Good",
      pill: "text-primary bg-primary/10 border-primary/30",
      dot: "bg-primary",
      heat: "bg-[hsl(43_96%_56%/0.09)]",
    };
  return {
    key: "smash",
    label: "Smash",
    pill: "text-[hsl(151_68%_56%)] bg-[hsl(151_60%_45%/0.12)] border-[hsl(151_60%_45%/0.30)]",
    dot: "bg-[hsl(151_68%_50%)]",
    heat: "bg-[hsl(151_60%_45%/0.10)]",
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

function rankOf(row: Row, pos: PositionKey): number {
  return row[`${pos}Rank` as keyof Row] as number;
}
function fpaOf(row: Row, pos: PositionKey): number {
  return row[`${pos}Fpa` as keyof Row] as number;
}

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
  const [format, setFormat] = useState<ScoringFormat>("ppr");
  const [view, setView] = useState<ViewMode>("adjusted");
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

  // Schedule-adjusted view is labeled "aFPA" in the table.
  const fpaLabel = view === "adjusted" ? "aFPA" : "FPA";

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Default: FPA fields high→low (easiest first), rank/team low→high.
      setSortDirection(field.endsWith("Fpa") ? "desc" : "asc");
    }
  };

  const processedRows = useMemo(() => {
    const field = sortField;
    return [...rows].sort((a, b) => {
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
  }, [rows, sortField, sortDirection]);

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
    a.download = `statchasers-fpa-${format}-${view}-preseason.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return (
        <ChevronsUpDown className="ml-1 inline-block h-3.5 w-3.5 text-muted-foreground/40" />
      );
    return sortDirection === "asc" ? (
      <ChevronUp className="ml-1 inline-block h-3.5 w-3.5 text-primary" />
    ) : (
      <ChevronDown className="ml-1 inline-block h-3.5 w-3.5 text-primary" />
    );
  };

  // All position blocks are always shown.
  const visiblePositions: PositionKey[] = ["qb", "rb", "wr", "te", "off"];

  // Rank columns and tier badges are hidden to keep the wide table readable.
  const showRank = false;
  const tableColSpan = 1 + visiblePositions.length * (showRank ? 2 : 1);

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

        <div className="relative mx-auto max-w-[1400px] space-y-6 px-[4.8px] py-6 md:px-[9.6px] md:py-8">
          {/* ─── Control panel ───────────────────────────────────────── */}
          <div className="sc-fpa-controls sticky top-0 z-30 -mx-[4.8px] space-y-3 border-y border-border bg-card/85 px-[4.8px] py-3 shadow-lg shadow-black/20 ring-1 ring-primary/10 backdrop-blur-md md:mx-0 md:rounded-xl md:border md:px-4">
            {/* Controls row: segmented controls + CSV */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
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

              <Button
                onClick={handleDownloadCsv}
                className="ml-auto h-8 shrink-0 gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="button-download-csv"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download CSV</span>
                <span className="sm:hidden">CSV</span>
              </Button>
            </div>

            {/* Bottom row: preseason baseline notice */}
            <div className="border-t border-border/50 pt-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed">
                <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-[hsl(220_47%_24%)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[hsl(220_47%_24%)]" />
                  Preseason Baseline Active:
                </span>
                <span className="text-muted-foreground">
                  Using 2025 full-season data and late-season trends until 2026
                  sample sizes become reliable.
                </span>
                <button
                  onClick={() => setShowMethodology(!showMethodology)}
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-[hsl(220_47%_24%)] hover:text-[hsl(220_47%_34%)]"
                  data-testid="button-toggle-methodology"
                >
                  <Info className="h-3 w-3" />
                  How it works
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      showMethodology && "rotate-180",
                    )}
                  />
                </button>
              </div>
              {showMethodology && (
                <ul className="mt-2.5 grid gap-2 border-t border-border/40 pt-2.5 text-xs text-muted-foreground sm:grid-cols-2">
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
                      <tr className="border-b border-border bg-gradient-to-r from-[#0B1F3A] to-[#132A4A] text-[11px] uppercase tracking-wider text-background">
                        <th
                          className="sticky left-0 z-10 cursor-pointer select-none bg-[#0B1F3A] px-4 py-3 text-left font-semibold hover:text-primary"
                          onClick={() => handleSort("team")}
                        >
                          Team <SortIcon field="team" />
                        </th>
                        {visiblePositions.map((pos) => (
                          <PositionHeader
                            key={pos}
                            pos={pos}
                            fpaLabel={fpaLabel}
                            showRank={showRank}
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
                              length: visiblePositions.length * (showRank ? 2 : 1),
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
                            className="group transition-colors hover:bg-[hsl(210_40%_98%)]"
                            data-testid={`row-team-${row.teamAbbr}`}
                          >
                            <td className="sticky left-0 z-10 bg-card px-4 py-2.5 transition-colors group-hover:bg-[hsl(210_40%_98%)]">
                              <div className="flex items-center gap-2.5">
                                <TeamLogo abbr={row.teamAbbr} />
                                <div className="leading-tight">
                                  <div className="text-[15px] font-extrabold leading-none tracking-tight text-foreground">
                                    {row.teamAbbr}
                                  </div>
                                  <div className="mt-0.5 hidden text-[11px] font-medium tracking-wide text-muted-foreground/70 lg:block">
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
                                showRank={showRank}
                                showBadge={false}
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
                  : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
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

const POS_TOOLTIP =
  "Higher FPA means an easier matchup. Rank 32 allows the most fantasy points; Rank 1 allows the fewest.";

function PositionHeader({
  pos,
  fpaLabel,
  showRank,
  sortIcon: SortIcon,
  onSort,
}: {
  pos: PositionKey;
  fpaLabel: string;
  showRank: boolean;
  sortIcon: (props: { field: SortField }) => React.ReactElement;
  onSort: (f: SortField) => void;
}) {
  const label = pos.toUpperCase();
  const isOff = pos === "off";
  return (
    <>
      {showRank && (
        <th
          className={cn(
            "cursor-pointer select-none px-3 py-3 text-right font-semibold hover:text-primary",
            isOff && "bg-primary/[0.06]",
          )}
          onClick={() => onSort(`${pos}Rank` as SortField)}
        >
          {label} Rank <SortIcon field={`${pos}Rank` as SortField} />
        </th>
      )}
      <th
        className={cn(
          "cursor-pointer select-none border-r border-border/40 px-3 py-3 text-right font-semibold hover:text-primary",
          isOff && "border-r-0 bg-primary/[0.06] text-background",
        )}
        onClick={() => onSort(`${pos}Fpa` as SortField)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              {label} {fpaLabel} <SortIcon field={`${pos}Fpa` as SortField} />
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
  showRank,
  showBadge,
}: {
  pos: PositionKey;
  row: Row;
  showRank: boolean;
  showBadge: boolean;
}) {
  const rank = rankOf(row, pos);
  const fpa = fpaOf(row, pos);
  const isOff = pos === "off";
  const heat = getTier(rank).heat;
  return (
    <>
      {showRank && (
        <td className={cn("px-3 py-2.5 text-right", heat)}>
          <div className="flex items-center justify-end gap-2">
            {showBadge && <TierBadge rank={rank} />}
            <RankChip rank={rank} />
          </div>
        </td>
      )}
      <td
        className={cn(
          "border-r border-border/40 px-3 py-2.5 text-right font-mono tabular-nums",
          heat,
          isOff ? "border-r-0 font-bold text-foreground" : "font-medium",
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
            const heat = getTier(rank).heat;
            return (
              <div
                key={pos}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm",
                  heat,
                )}
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
