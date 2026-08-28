"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { TogglePill } from "@/components/ui/toggle-pill";
import { ScoreBadge } from "@/components/ui/score-badge";
import { createClient } from "@/lib/supabase/client";

type CategoryFilter = "all" | "hiring" | "digital" | "reviews" | "leadership";

const CATEGORIES: { label: string; value: CategoryFilter }[] = [
  { label: "All", value: "all" },
  { label: "Hiring", value: "hiring" },
  { label: "Digital", value: "digital" },
  { label: "Reviews", value: "reviews" },
  { label: "Leadership", value: "leadership" },
];

interface SignalEvent {
  id: string;
  signal_type: string;
  signal_category: string;
  signal_source: string | null;
  signal_content: string;
  severity: string;
  impact_score: number | null;
  detected_at: string;
  business: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    vertical: string | null;
    score: number | null;
  } | null;
}

function severityBadge(severity: string) {
  const styles: Record<string, string> = {
    high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${styles[severity] ?? styles.low}`}>
      {severity}
    </span>
  );
}

function categoryBadge(category: string) {
  const styles: Record<string, string> = {
    hiring: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    digital: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    reviews: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    leadership: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  };
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${styles[category] ?? "bg-muted text-muted-foreground"}`}>
      {category}
    </span>
  );
}

function formatSignalType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SignalsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center gap-2 p-4 md:p-6">
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    }>
      <SignalsPageContent />
    </Suspense>
  );
}

function SignalsPageContent() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [signals, setSignals] = useState<SignalEvent[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("signal_events")
      .select(`
        id, signal_type, signal_category, signal_source,
        signal_content, severity, impact_score, detected_at,
        business:businesses (
          id, name, city, state, vertical,
          readiness_scores ( readiness_score )
        )
      `)
      .order("detected_at", { ascending: false })
      .limit(200);

    if (!mountedRef.current) return;

    if (!error && data) {
      const mapped: SignalEvent[] = data.map((s) => {
        const biz = Array.isArray(s.business) ? s.business[0] : s.business;
        const rs = biz
          ? Array.isArray(biz.readiness_scores) ? biz.readiness_scores[0] : biz.readiness_scores
          : null;
        return {
          id: s.id,
          signal_type: s.signal_type,
          signal_category: s.signal_category,
          signal_source: s.signal_source,
          signal_content: s.signal_content,
          severity: s.severity,
          impact_score: s.impact_score,
          detected_at: s.detected_at,
          business: biz
            ? { id: biz.id, name: biz.name, city: biz.city, state: biz.state, vertical: biz.vertical, score: rs?.readiness_score ?? null }
            : null,
        };
      });
      setSignals(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (isLoaded && isSignedIn) void fetchSignals();
    else if (isLoaded && !isSignedIn) setLoading(false);
    return () => { mountedRef.current = false; };
  }, [isLoaded, isSignedIn, fetchSignals]);

  const filtered = activeCategory === "all" ? signals : signals.filter((s) => s.signal_category === activeCategory);
  const counts: Record<string, number> = { all: signals.length };
  for (const s of signals) { counts[s.signal_category] = (counts[s.signal_category] || 0) + 1; }

  if (!isLoaded || loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Signals</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Signals</h1>
          <p className="text-muted-foreground text-sm">
            Operational intelligence signals detected across all acquisition targets.
          </p>
        </div>

        <Separator />

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <TogglePill
              key={cat.value}
              active={activeCategory === cat.value}
              onClick={() => setActiveCategory(cat.value)}
            >
              {cat.label}
              {counts[cat.value] !== undefined && (
                <span className="ml-1 tabular-nums opacity-60">{counts[cat.value]}</span>
              )}
            </TogglePill>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No signals detected yet</p>
            <p className="text-muted-foreground text-xs">
              Run signal monitoring to detect hiring, digital, review, and leadership changes.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((signal) => (
              <div
                key={signal.id}
                onClick={() => signal.business?.id && router.push(`/companies/${signal.business.id}`)}
                className={`border-border bg-card flex flex-col gap-3 rounded-lg border p-4 transition-colors ${signal.business?.id ? "cursor-pointer hover:bg-muted/50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{formatSignalType(signal.signal_type)}</span>
                      {categoryBadge(signal.signal_category)}
                      {severityBadge(signal.severity)}
                    </div>
                    {signal.business && (
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className="font-medium text-foreground">{signal.business.name}</span>
                        {signal.business.city && (
                          <><span>·</span><span>{[signal.business.city, signal.business.state].filter(Boolean).join(", ")}</span></>
                        )}
                        {signal.business.vertical && (
                          <><span>·</span><span className="capitalize">{signal.business.vertical}</span></>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {signal.business?.score !== null && signal.business?.score !== undefined && (
                      <ScoreBadge score={signal.business.score} />
                    )}
                    <span className="text-muted-foreground text-xs tabular-nums">{timeAgo(signal.detected_at)}</span>
                  </div>
                </div>

                <p className="text-muted-foreground text-xs leading-relaxed">{signal.signal_content}</p>

                <div className="flex items-center gap-3">
                  {signal.signal_source && (
                    <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Source: {signal.signal_source.replace(/[[\]()]/g, "")}
                    </span>
                  )}
                  {signal.impact_score !== null && (
                    <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Impact: {signal.impact_score}/10
                    </span>
                  )}
                  {signal.business?.id && (
                    <span className="text-muted-foreground ml-auto text-[10px] uppercase tracking-wide">
                      View profile →
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
