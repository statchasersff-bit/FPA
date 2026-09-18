import { useState, useMemo } from "react";
import {
  useGetNflFpa,
  getGetNflFpaQueryKey,
} from "@workspace/api-client-react";
import {
  Download,
  ChevronDown,
  Info,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
// Rank 1 = easiest (most pts allowed). Rank 32 = toughest (fewest pts allowed).

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
      key: "smash",
      label: "Smash",
      pill: "text-[hsl(151_68%_56%)] bg-[hsl(151_60%_45%/0.12)] border-[hsl(151_60%_45%/0.30)]",
      dot: "bg-[hsl(151_68%_50%)]",
      heat: "bg-[hsl(151_60%_45%/0.10)]",
    };
  if (rank <= 16)
    return {
      key: "good",
      label: "Good",
      pill: "text-primary bg-primary/10 border-primary/30",
      dot: "bg-primary",
      heat: "",
    };
  if (rank <= 24)
    return {
      key: "neutral",
      label: "Neutral",
      pill: "text-muted-foreground bg-white/[0.04] border-white/10",
      dot: "bg-muted-foreground",
      heat: "bg-[hsl(43_96%_56%/0.09)]",
    };
  return {
    key: "tough",
    label: "Tough",
    pill: "text-[hsl(6_78%_64%)] bg-[hsl(6_72%_52%/0.12)] border-[hsl(6_72%_52%/0.28)]",
    dot: "bg-[hsl(6_78%_60%)]",
    heat: "bg-[hsl(6_72%_52%/0.07)]",
  };
}

// ─── Team logos (ESPN CDN with abbreviation fallback) ────────────────────────

const ESPN_ABBR: Record<string, string> = { WAS: "wsh" };

function TeamLogo({ abbr, className }: { abbr: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const slug = ESPN_ABBR[abbr] ?? abbr.toLowerCase();
  // Sizing comes from `className` (defaults to 28px) so callers can shrink it
  // responsively on smaller screens.
  const sizeCls = className ?? "h-7 w-7";
  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground ring-1 ring-white/10",
          sizeCls,
        )}
      >
        {abbr.slice(0, 3)}
      </div>
    );
  }
  return (
    <img
      src={`https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`}
      alt={abbr}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-contain", sizeCls)}
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

// ─── Scoring settings dropdown ────────────────────────────────────────────────
// Mirrors the scoring rules applied in the ingest pipeline (api-server
// scoreRow). The per-reception value is the only rule that varies by format.

const RECEPTION_BY_FORMAT: Record<ScoringFormat, string> = {
  standard: "0",
  half: "0.5",
  ppr: "1",
};

const FORMAT_LABEL: Record<ScoringFormat, string> = {
  standard: "Standard",
  half: "Half PPR",
  ppr: "PPR",
};

// Consolidated "Methodology" popover: FPA + Adjusted FPA explanations plus the
// preseason baseline schedule — replaces the old inline explainer rows.
function MethodologyInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          data-testid="button-methodology"
        >
          <Info className="h-3.5 w-3.5" />
          Methodology
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Methodology
          </span>
        </div>
        <div className="max-h-96 space-y-3 overflow-y-auto px-3 py-3">
          <section>
            <h4 className="text-[11px] font-bold text-foreground">
              What are Fantasy Points Allowed?
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Fantasy Points Allowed measures how good or bad each NFL defense is
              at limiting fantasy production to its opponents. The higher the FPA
              value, the more fantasy points the team gives up; the lower the
              value, the fewer points it allows.
            </p>
          </section>
          <section>
            <h4 className="text-[11px] font-bold text-foreground">
              What is Adjusted FPA (aFPA)?
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Adjusted FPA takes raw FPA and corrects it for strength of
              schedule. A defense that has faced stronger-than-average offenses
              has its number nudged down, while one that has faced weaker
              offenses is nudged up — so every team is measured as if it played a
              neutral schedule, making matchups easier to compare.
            </p>
          </section>
          <section>
            <h4 className="text-[11px] font-bold text-foreground">
              Preseason baseline
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Using 2025 full-season data until 2026 sample sizes become
              reliable.
            </p>
            <ul className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
              {[
                ["Preseason", "100% 2025 full season"],
                ["Weeks 1–4", "Blended baseline and 2026 data"],
                ["Week 5+", "Mostly current-season data"],
                ["Week 12+", "Rolling 10-week data"],
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
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScoringSettings({ format }: { format: ScoringFormat }) {
  const rules: { group: string; items: [string, string][] }[] = [
    {
      group: "Passing",
      items: [
        ["Yards", "0.04 / yd"],
        ["Touchdown", "4"],
        ["Interception", "−1"],
        ["2-pt conversion", "2"],
      ],
    },
    {
      group: "Rushing",
      items: [
        ["Yards", "0.1 / yd"],
        ["Touchdown", "6"],
        ["2-pt conversion", "2"],
      ],
    },
    {
      group: "Receiving",
      items: [
        ["Reception", `${RECEPTION_BY_FORMAT[format]} / catch`],
        ["Yards", "0.1 / yd"],
        ["Touchdown", "6"],
        ["2-pt conversion", "2"],
      ],
    },
    {
      group: "Misc",
      items: [
        ["Fumble lost", "−2"],
        ["Special-teams TD", "6"],
      ],
    },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          data-testid="button-scoring-settings"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Scoring settings
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Scoring rules
          </span>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {FORMAT_LABEL[format]}
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto px-3 py-2.5">
          {rules.map(({ group, items }) => (
            <div key={group} className="mb-2.5 last:mb-0">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </div>
              <dl className="space-y-1">
                {items.map(([label, value]) => {
                  const isReception = label === "Reception";
                  return (
                    <div
                      key={label}
                      className={cn(
                        "flex items-center justify-between text-xs",
                        isReception && "font-semibold text-primary",
                      )}
                    >
                      <dt
                        className={cn(
                          "text-muted-foreground",
                          isReception && "text-primary",
                        )}
                      >
                        {label}
                      </dt>
                      <dd className="font-mono tabular-nums text-foreground">
                        {value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          Only the per-reception value changes with the selected scoring format.
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FpaPage() {
  const [format, setFormat] = useState<ScoringFormat>("ppr");
  const [view, setView] = useState<ViewMode>("adjusted");
  const season = 2026;

  const [sortField, setSortField] = useState<SortField>("offFpa");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const { data, isLoading, error } = useGetNflFpa(
    { season, format, view },
    { query: { queryKey: getGetNflFpaQueryKey({ season, format, view }) } },
  );

  // Attach a client-side OFF rank (1 = easiest = highest offFpa).
  const rows: Row[] = useMemo(() => {
    if (!data?.rows) return [];
    const base = data.rows as Omit<Row, "offRank">[];
    const offOrder = [...base].sort((a, b) => b.offFpa - a.offFpa);
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

  const isSorted = (field: SortField) => sortField === field;

  // All position blocks are always shown.
  const visiblePositions: PositionKey[] = ["qb", "rb", "wr", "te", "off"];

  // Rank columns and tier badges are hidden to keep the wide table readable.
  const showRank = false;
  const tableColSpan = 1 + visiblePositions.length * (showRank ? 2 : 1);

  return (
    <div className="sc-fpa-page min-h-[100dvh] bg-background text-foreground">
      <div className="relative">

        <div className="relative mx-auto max-w-[1400px] space-y-4 px-[5px] py-6 md:py-8">
          {/* ─── Control panel ───────────────────────────────────────── */}
          <div className="sc-fpa-controls -mx-[5px] space-y-2 px-[5px] py-2.5 md:mx-0 md:px-4">
            {/* Row 1 — filters + export */}
            <div className="sc-fpa-controls__top flex flex-wrap items-center gap-x-4 gap-y-2">
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

              <div className="sc-fpa-csv-wrap ml-auto hidden md:block">
                <Button
                  onClick={handleDownloadCsv}
                  className="sc-fpa-download-btn h-8 shrink-0 gap-1.5 rounded-lg border border-border bg-transparent px-3 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
                  data-testid="button-download-csv"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </div>
            </div>

            {/* Row 2 — model status + utilities */}
            <div className="sc-fpa-utility flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/50 pt-2">
              <div className="sc-fpa-status flex items-center gap-x-3 max-[640px]:hidden">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                  data-testid="chip-baseline-status"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Baseline Active
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Preseason model
                </span>
              </div>

              <div className="sc-fpa-actions ml-auto flex items-center gap-2">
                <MethodologyInfo />
                <ScoringSettings format={format} />
              </div>
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
            <div>
              {/* Mobile only: baseline status sits directly above the table,
                  top-left (on desktop it lives in the controls panel's Row 2). */}
              <div className="mb-2 hidden w-full items-center justify-between max-[640px]:flex">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                  data-testid="chip-baseline-status-mobile"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Baseline Active
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Preseason model
                </span>
              </div>

              {/* ─── Table ─────────────────────────────────────────── */}
              <div className="sc-fpa-table [container-type:inline-size]">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse border border-border text-sm">
                    <thead>
                      <tr className="border-b border-border bg-gradient-to-r from-[#0B1F3A] to-[#132A4A] text-[11px] uppercase tracking-wider text-background">
                        <th
                          className={cn(
                            // Slightly smaller on mobile so the Team header sits
                            // closer to (just above) the metric column headers.
                            "cursor-pointer select-none bg-[#0B1F3A] px-4 pr-6 py-1.5 text-left font-semibold hover:text-primary max-[640px]:text-[clamp(9.5px,2.5cqi,12px)]",
                            isSorted("team") && "text-primary",
                          )}
                          onClick={() => handleSort("team")}
                        >
                          Team
                        </th>
                        {visiblePositions.map((pos) => (
                          <PositionHeader
                            key={pos}
                            pos={pos}
                            fpaLabel={fpaLabel}
                            showRank={showRank}
                            isSorted={isSorted}
                            onSort={handleSort}
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {isLoading ? (
                        Array.from({ length: 12 }).map((_, i) => (
                          <tr key={i}>
                            <td className="bg-card px-4 py-3">
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
                            <td className="bg-card px-4 pr-6 py-0.5 transition-colors group-hover:bg-[hsl(210_40%_98%)]">
                              <div className="flex items-center gap-2.5">
                                <span className="inline-flex shrink-0">
                                  <TeamLogo
                                    abbr={row.teamAbbr}
                                    className="h-6 w-6 max-[440px]:h-[22px] max-[440px]:w-[22px]"
                                  />
                                </span>
                                <div className="leading-tight">
                                  <div className="text-[15px] font-extrabold leading-none tracking-tight text-foreground max-[640px]:text-[13px] max-[440px]:text-[12px]">
                                    {row.teamAbbr}
                                  </div>
                                  <div className="mt-0.5 hidden text-[11px] font-medium tracking-wide text-muted-foreground/70 sm:block">
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
            </div>
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
    <div className="sc-fpa-control-group flex items-center gap-2">
      <span className="sc-fpa-control-label inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
    <div
      className={cn(
        "sc-fpa-segmented inline-flex rounded-lg bg-muted/40 p-0.5",
        options.length === 3 && "sc-fpa-segmented--three",
        options.length === 2 && "sc-fpa-segmented--two",
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        const btn = (
          <button
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            data-testid={`chip-${opt.value}`}
            className={cn(
              "sc-fpa-chip rounded-[7px] px-2.5 py-1 text-xs font-semibold transition-all",
              active && "is-active",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : opt.disabled
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : "bg-black/[0.05] text-muted-foreground hover:bg-black/[0.09] hover:text-foreground",
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
  "Higher FPA means an easier matchup. Rank 1 allows the most fantasy points; Rank 32 allows the fewest.";

function PositionHeader({
  pos,
  fpaLabel,
  showRank,
  isSorted,
  onSort,
}: {
  pos: PositionKey;
  fpaLabel: string;
  showRank: boolean;
  isSorted: (field: SortField) => boolean;
  onSort: (f: SortField) => void;
}) {
  const label = pos.toUpperCase();
  const isOff = pos === "off";
  return (
    <>
      {showRank && (
        <th
          className={cn(
            "cursor-pointer select-none px-2 py-1.5 text-right font-semibold hover:text-primary",
            isOff && "bg-primary/[0.06]",
            isSorted(`${pos}Rank` as SortField) && "text-primary",
          )}
          onClick={() => onSort(`${pos}Rank` as SortField)}
        >
          {label} Rank
        </th>
      )}
      <th
        className={cn(
          // Fluid size so the metric columns shrink up to 25% (11px → 8.25px)
          // as the table's available width tightens, avoiding horizontal scroll.
          "cursor-pointer select-none border-r border-border/40 px-2 py-1.5 text-right text-[clamp(8.25px,2.2cqi,11px)] font-semibold hover:text-primary",
          isOff && "border-r-0 bg-primary/[0.06] text-background",
          isSorted(`${pos}Fpa` as SortField) && "text-primary",
        )}
        onClick={() => onSort(`${pos}Fpa` as SortField)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              {label}{" "}
              <span className="normal-case max-[640px]:block">{fpaLabel}</span>
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
        <td className={cn("px-2 py-0.5 text-right", heat)}>
          <div className="flex items-center justify-end gap-2">
            {showBadge && <TierBadge rank={rank} />}
            <RankChip rank={rank} />
          </div>
        </td>
      )}
      <td
        className={cn(
          // Fluid size so the metric numbers shrink up to 25% (14px → 10.5px)
          // as the table's available width tightens, avoiding horizontal scroll.
          "border-r border-border/40 px-2 py-0.5 text-right font-mono text-[clamp(10.5px,2.8cqi,14px)] tabular-nums",
          heat,
          isOff ? "border-r-0 font-bold text-foreground" : "font-medium",
        )}
      >
        {fpa.toFixed(1)}
      </td>
    </>
  );
}

