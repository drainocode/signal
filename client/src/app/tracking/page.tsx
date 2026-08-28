"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TogglePill } from "@/components/ui/toggle-pill";
import { ScoreBadge } from "@/components/ui/score-badge";
import { StatCard } from "@/components/ui/stat-card";
import { createClient } from "@/lib/supabase/client";

type ViewMode = "all" | "prime" | "by-dimension";

interface BenchmarkRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  score: number;
  benchmark_percentile: number | null;
  tech_gap: number | null;
  hiring: number | null;
  digital: number | null;
  review_health: number | null;
  operations: number | null;
  score_rationale: string | null;
}

interface BenchmarkStats {
  count: number;
  average: number;
  prime_targets: number;
  tech_gap_avg: number;
}

function DimensionBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round((value / 10) * 100);
  const color = value >= 7 ? "bg-emerald-500" : value >= 5 ? "bg-amber-500" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center justify-center gap-1.5">
      <div className="bg-muted h-1.5 w-10 overflow-hidden rounded-full">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted-foreground min-w-[1.5rem] text-right text-xs tabular-nums">{value}</span>
    </div>
  );
}

function TierBadge({ percentile }: { percentile: number | null }) {
  if (percentile === null) return <span className="text-muted-foreground text-xs">—</span>;
  const { label, className } =
    percentile >= 80
      ? { label: "Prime target", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" }
      : percentile >= 60
        ? { label: "Strong", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" }
        : percentile >= 40
          ? { label: "Moderate", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" }
          : { label: "Lower priority", className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export default function BenchmarkPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center gap-2 p-4 md:p-6">
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    }>
      <BenchmarkPageContent />
    </Suspense>
  );
}

function BenchmarkPageContent() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [vertical, setVertical] = useState("");
  const [state, setState] = useState("");
  const [minScore, setMinScore] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [stats, setStats] = useState<BenchmarkStats | null>(null);
  const [verticals, setVerticals] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!isLoaded || !isSignedIn) return;
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("businesses")
        .select("vertical, state")
        .eq("pipeline_status", "scored");
      if (!mountedRef.current || !data) return;
      setVerticals([...new Set(data.map((b) => b.vertical).filter(Boolean))].sort() as string[]);
      setStates([...new Set(data.map((b) => b.state).filter(Boolean))].sort() as string[]);
    };
    load();
    return () => { mountedRef.current = false; };
  }, [isLoaded, isSignedIn]);

  const fetchData = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("businesses")
      .select(`
        id, name, city, state, vertical,
        readiness_scores (
          readiness_score, tech_gap_score, hiring_signal_score,
          digital_presence_score, review_health_score, operational_score,
          benchmark_percentile, score_rationale
        )
      `)
      .eq("pipeline_status", "scored");

    if (vertical) query = query.eq("vertical", vertical);
    if (state) query = query.eq("state", state);

    const { data } = await query;
    if (!mountedRef.current) return;

    const mapped: BenchmarkRow[] = (data || [])
      .map((b) => {
        const rs = Array.isArray(b.readiness_scores) ? b.readiness_scores[0] : b.readiness_scores;
        return {
          id: b.id,
          name: b.name,
          city: b.city,
          state: b.state,
          score: rs?.readiness_score || 0,
          benchmark_percentile: rs?.benchmark_percentile ?? null,
          tech_gap: rs?.tech_gap_score ?? null,
          hiring: rs?.hiring_signal_score ?? null,
          digital: rs?.digital_presence_score ?? null,
          review_health: rs?.review_health_score ?? null,
          operations: rs?.operational_score ?? null,
          score_rationale: rs?.score_rationale ?? null,
        };
      })
      .filter((b) => b.score > 0)
      .filter((b) => !minScore || b.score >= parseFloat(minScore))
      .sort((a, b) => b.score - a.score);

    if (mapped.length > 0) {
      const scores = mapped.map((b) => b.score);
      const techGaps = mapped.map((b) => b.tech_gap || 0);
      setStats({
        count: mapped.length,
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        prime_targets: mapped.filter((b) => b.score >= 8).length,
        tech_gap_avg: Math.round((techGaps.reduce((a, b) => a + b, 0) / techGaps.length) * 10) / 10,
      });
    } else {
      setStats(null);
    }

    setRows(mapped);
    setLoading(false);
  }, [isLoaded, isSignedIn, vertical, state, minScore]);

  useEffect(() => {
    mountedRef.current = true;
    if (isLoaded && isSignedIn) void fetchData();
    else if (isLoaded && !isSignedIn) setLoading(false);
  }, [isLoaded, isSignedIn, fetchData]);

  const displayRows = viewMode === "prime" ? rows.filter((r) => r.score >= 8) : rows;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Benchmark report</h1>
          <p className="text-muted-foreground text-sm">
            Compare acquisition targets within a vertical and region. Click any row to view the full company profile.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full max-w-xs">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Vertical</label>
            <Select
              value={vertical}
              onValueChange={setVertical}
              placeholder="All verticals"
              items={[{ value: "", label: "All verticals" }, ...verticals.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))]}
            />
          </div>
          <div className="w-full max-w-xs">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Region</label>
            <Select
              value={state}
              onValueChange={setState}
              placeholder="All regions"
              items={[{ value: "", label: "All regions" }, ...states.map((s) => ({ value: s, label: s }))]}
            />
          </div>
          <div className="w-full max-w-[160px]">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Min score</label>
            <Select
              value={minScore}
              onValueChange={setMinScore}
              placeholder="Any"
              items={[
                { value: "", label: "Any" },
                { value: "5", label: "5+" },
                { value: "6", label: "6+" },
                { value: "7", label: "7+" },
                { value: "8", label: "8+" },
              ]}
            />
          </div>
        </div>

        <Separator />

        {!isLoaded || loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No scored businesses found</p>
            <p className="text-muted-foreground text-xs">Run the scoring pipeline to see benchmark data here.</p>
          </div>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Companies" value={stats.count} size="sm" />
                <StatCard label="Avg score" value={`${stats.average}/10`} size="sm" />
                <StatCard label="Prime targets" value={stats.prime_targets} sublabel="score ≥ 8" size="sm" />
                <StatCard label="Tech gap avg" value={stats.tech_gap_avg} sublabel="highest dimension" size="sm" />
              </div>
            )}

            <div className="flex gap-1.5">
              <TogglePill active={viewMode === "all"} onClick={() => setViewMode("all")}>All companies</TogglePill>
              <TogglePill active={viewMode === "prime"} onClick={() => setViewMode("prime")}>Prime targets</TogglePill>
              <TogglePill active={viewMode === "by-dimension"} onClick={() => setViewMode("by-dimension")}>By dimension</TogglePill>
            </div>

            <div className="border-border overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border bg-muted/50 border-b">
                    <th className="px-3 py-2.5 text-left text-xs font-medium w-8">#</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium">Company</th>
                    <th className="px-3 py-2.5 text-center text-xs font-medium">Score</th>
                    {viewMode === "by-dimension" ? (
                      <>
                        <th className="px-3 py-2.5 text-center text-xs font-medium">Tech gap</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium">Hiring</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium">Digital</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium hidden md:table-cell">Review</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium hidden md:table-cell">Ops</th>
                      </>
                    ) : (
                      <th className="px-3 py-2.5 text-left text-xs font-medium hidden md:table-cell">Rationale</th>
                    )}
                    <th className="px-3 py-2.5 text-center text-xs font-medium">Tier</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium">%ile</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/companies/${row.id}`)}
                      className="border-border hover:bg-muted/30 border-b last:border-b-0 cursor-pointer transition-colors"
                    >
                      <td className="text-muted-foreground px-3 py-2.5 text-xs tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-muted-foreground text-xs">{[row.city, row.state].filter(Boolean).join(", ")}</div>
                      </td>
                      <td className="px-3 py-2.5 text-center"><ScoreBadge score={row.score} /></td>
                      {viewMode === "by-dimension" ? (
                        <>
                          <td className="px-3 py-2.5"><DimensionBar value={row.tech_gap} /></td>
                          <td className="px-3 py-2.5"><DimensionBar value={row.hiring} /></td>
                          <td className="px-3 py-2.5"><DimensionBar value={row.digital} /></td>
                          <td className="px-3 py-2.5 hidden md:table-cell"><DimensionBar value={row.review_health} /></td>
                          <td className="px-3 py-2.5 hidden md:table-cell"><DimensionBar value={row.operations} /></td>
                        </>
                      ) : (
                        <td className="text-muted-foreground px-3 py-2.5 hidden max-w-xs md:table-cell">
                          <p className="line-clamp-2 text-xs">{row.score_rationale || "—"}</p>
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-center"><TierBadge percentile={row.benchmark_percentile} /></td>
                      <td className="text-muted-foreground px-3 py-2.5 text-right text-xs tabular-nums">
                        {row.benchmark_percentile !== null ? `${row.benchmark_percentile}th` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-muted-foreground text-xs">
              Score dimensions: tech gap 30% · hiring signals 25% · digital presence 20% · review health 15% · operations 10%. Higher score = more PE acquisition upside.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
