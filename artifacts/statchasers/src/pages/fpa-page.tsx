import { useState, useMemo } from "react";
import { useGetNflFpa, getGetNflFpaQueryKey, getDownloadNflFpaUrl } from "@workspace/api-client-react";
import { Download, ArrowUp, ArrowDown, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type SortField = 'team' | 'qbRank' | 'qbFpa' | 'rbRank' | 'rbFpa' | 'wrRank' | 'wrFpa' | 'teRank' | 'teFpa' | 'offFpa';
type SortDirection = 'asc' | 'desc';

export default function FpaPage() {
  const [format, setFormat] = useState<'standard' | 'half' | 'ppr'>('half');
  const [view, setView] = useState<'raw' | 'adjusted'>('adjusted');
  const season = 2026;

  const [sortField, setSortField] = useState<SortField>('offFpa');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const { data, isLoading, error } = useGetNflFpa(
    { season, format, view },
    { query: { queryKey: getGetNflFpaQueryKey({ season, format, view }) } }
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedRows = useMemo(() => {
    if (!data?.rows) return [];
    
    return [...data.rows].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      return 0;
    });
  }, [data?.rows, sortField, sortDirection]);

  const handleDownloadCsv = () => {
    const url = getDownloadNflFpaUrl({ season, format, view });
    window.open(url, '_blank');
  };

  // Interpolate color from green (tough) to red (easy) based on rank (1-32)
  const getRankColor = (rank: number) => {
    const minRank = 1;
    const maxRank = 32;
    // 120 = green, 0 = red
    const maxHue = 120;
    const minHue = 0;
    
    const rankFactor = Math.max(0, Math.min(1, (maxRank - rank) / (maxRank - minRank)));
    const hue = minHue + (maxHue - minHue) * rankFactor;
    
    return `hsl(${hue}, 90%, 45%)`;
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp className="w-4 h-4 inline-block ml-1" /> : <ChevronDown className="w-4 h-4 inline-block ml-1" />;
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground p-4 md:p-8">
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight">Fantasy Points Allowed</h1>
              {data?.isPreseason && (
                <Badge variant="outline" className="border-primary text-primary font-mono text-xs uppercase" data-testid="badge-preseason">
                  Preseason
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground font-mono text-sm tracking-wide">
              By Position &middot; {season} &middot; {data?.isPreseason ? 'Preseason Baseline' : 'Regular Season'}
            </p>
          </div>
          
          <Button variant="outline" onClick={handleDownloadCsv} data-testid="button-download-csv" className="font-mono text-xs self-start md:self-auto border-border hover:bg-muted">
            <Download className="w-4 h-4 mr-2" />
            CSV EXPORT
          </Button>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-card border border-border p-4 rounded-md">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Scoring</span>
            <ToggleGroup type="single" value={format} onValueChange={(v) => v && setFormat(v as any)} className="bg-muted p-1 rounded-sm">
              <ToggleGroupItem value="standard" aria-label="Standard" className="text-xs font-mono px-3 py-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7" data-testid="toggle-scoring-standard">STD</ToggleGroupItem>
              <ToggleGroupItem value="half" aria-label="Half-PPR" className="text-xs font-mono px-3 py-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7" data-testid="toggle-scoring-half">0.5 PPR</ToggleGroupItem>
              <ToggleGroupItem value="ppr" aria-label="PPR" className="text-xs font-mono px-3 py-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7" data-testid="toggle-scoring-ppr">PPR</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="w-px h-6 bg-border hidden sm:block"></div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Mode</span>
            <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as any)} className="bg-muted p-1 rounded-sm">
              <ToggleGroupItem value="raw" aria-label="Raw FPA" className="text-xs font-mono px-3 py-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7" data-testid="toggle-view-raw">RAW</ToggleGroupItem>
              <ToggleGroupItem value="adjusted" aria-label="Adjusted FPA" className="text-xs font-mono px-3 py-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7" data-testid="toggle-view-adjusted">ADJUSTED</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {/* Table */}
        <Card className="border-border bg-card overflow-hidden rounded-md shadow-lg shadow-black/20">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs font-mono text-muted-foreground uppercase bg-muted/50 border-b border-border">
                <tr>
                  <th className="sticky left-0 bg-card z-10 p-3 border-r border-border hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('team')}>
                    Team <SortIcon field="team" />
                  </th>
                  
                  <th className="p-3 text-right hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('qbRank')}>QB Rnk <SortIcon field="qbRank" /></th>
                  <th className="p-3 text-right border-r border-border/50 hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('qbFpa')}>QB FPA <SortIcon field="qbFpa" /></th>
                  
                  <th className="p-3 text-right hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('rbRank')}>RB Rnk <SortIcon field="rbRank" /></th>
                  <th className="p-3 text-right border-r border-border/50 hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('rbFpa')}>RB FPA <SortIcon field="rbFpa" /></th>
                  
                  <th className="p-3 text-right hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('wrRank')}>WR Rnk <SortIcon field="wrRank" /></th>
                  <th className="p-3 text-right border-r border-border/50 hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('wrFpa')}>WR FPA <SortIcon field="wrFpa" /></th>
                  
                  <th className="p-3 text-right hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('teRank')}>TE Rnk <SortIcon field="teRank" /></th>
                  <th className="p-3 text-right border-r border-border/50 hover:bg-muted/80 cursor-pointer select-none" onClick={() => handleSort('teFpa')}>TE FPA <SortIcon field="teFpa" /></th>
                  
                  <th className="p-3 text-right font-bold text-foreground hover:bg-muted/80 cursor-pointer select-none bg-primary/5" onClick={() => handleSort('offFpa')}>
                    OFF FPA <SortIcon field="offFpa" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="sticky left-0 bg-card z-10 p-3 border-r border-border"><Skeleton className="h-5 w-24" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-8 ml-auto" /></td>
                      <td className="p-3 border-r border-border/50"><Skeleton className="h-5 w-12 ml-auto" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-8 ml-auto" /></td>
                      <td className="p-3 border-r border-border/50"><Skeleton className="h-5 w-12 ml-auto" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-8 ml-auto" /></td>
                      <td className="p-3 border-r border-border/50"><Skeleton className="h-5 w-12 ml-auto" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-8 ml-auto" /></td>
                      <td className="p-3 border-r border-border/50"><Skeleton className="h-5 w-12 ml-auto" /></td>
                      <td className="p-3 bg-primary/5"><Skeleton className="h-5 w-12 ml-auto" /></td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-destructive">
                      <Alert variant="destructive" className="inline-block max-w-md text-left">
                        <AlertTitle>Failed to load data</AlertTitle>
                        <AlertDescription>There was an error fetching the FPA data. Please try again.</AlertDescription>
                      </Alert>
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row, idx) => (
                    <tr key={row.teamAbbr} className="hover:bg-muted/30 transition-colors" data-testid={`row-team-${row.teamAbbr}`}>
                      <td className="sticky left-0 bg-card z-10 p-3 border-r border-border group-hover:bg-muted/80">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-4 text-xs">{idx + 1}</span>
                          <span className="font-semibold text-foreground tracking-tight">{row.teamAbbr}</span>
                          <span className="text-xs text-muted-foreground hidden lg:inline">{row.team}</span>
                        </div>
                      </td>
                      
                      <td className="p-3 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-opacity-20 text-xs font-bold" style={{ backgroundColor: getRankColor(row.qbRank) + '30', color: getRankColor(row.qbRank) }}>
                          {row.qbRank}
                        </span>
                      </td>
                      <td className="p-3 text-right border-r border-border/50 font-medium">{row.qbFpa.toFixed(1)}</td>
                      
                      <td className="p-3 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-opacity-20 text-xs font-bold" style={{ backgroundColor: getRankColor(row.rbRank) + '30', color: getRankColor(row.rbRank) }}>
                          {row.rbRank}
                        </span>
                      </td>
                      <td className="p-3 text-right border-r border-border/50 font-medium">{row.rbFpa.toFixed(1)}</td>
                      
                      <td className="p-3 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-opacity-20 text-xs font-bold" style={{ backgroundColor: getRankColor(row.wrRank) + '30', color: getRankColor(row.wrRank) }}>
                          {row.wrRank}
                        </span>
                      </td>
                      <td className="p-3 text-right border-r border-border/50 font-medium">{row.wrFpa.toFixed(1)}</td>
                      
                      <td className="p-3 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-opacity-20 text-xs font-bold" style={{ backgroundColor: getRankColor(row.teRank) + '30', color: getRankColor(row.teRank) }}>
                          {row.teRank}
                        </span>
                      </td>
                      <td className="p-3 text-right border-r border-border/50 font-medium">{row.teFpa.toFixed(1)}</td>
                      
                      <td className="p-3 text-right font-bold text-foreground bg-primary/5">{row.offFpa.toFixed(1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Methodology Note */}
        {data?.methodology && (
          <Card className="border-border bg-muted/20">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Methodology: {data.dataMode}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground pb-4">
              <p>{data.methodology}</p>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
