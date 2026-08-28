"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  SquarePen,
  Target,
  Loader2,
  ChevronRight,
  Briefcase,
  Mail,
  X,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { loadChat, saveChat } from "@/lib/services/chat-history";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "intelligence" | "mandate" | "outreach";
type MobileTab = "chat" | "workspace";

interface WorkspaceView {
  id: string;
  view_type: string;
  tab_label: string;
  mandate_id: string | null;
  updated_at: string;
  data: {
    status?: { stage: string; detail?: string; progress?: number };
    intelligence?: {
      summary?: { total: number; qualified: number; prime_targets: number; avg_score: number | null };
      businesses?: Array<{
        id: string; name: string; city: string | null; state: string | null;
        vertical: string | null; readiness_score: number | null;
        benchmark_percentile: number | null; is_qualified: boolean | null;
        years_in_business: number | null; owner_operated_likelihood: string | null;
        google_rating: number | null; review_count: number | null;
        tech_gap_score: number | null; hiring_signal_score: number | null;
        score_rationale: string | null;
      }>;
      contacts?: Array<{
        id: string; name: string; title: string | null; business_name: string | null;
        email: string | null; email_verified: boolean; is_primary_contact: boolean;
      }>;
      recommendation?: string;
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status overlay — animated, shown over the active tab while agent works
// Not a tab itself
// ─────────────────────────────────────────────────────────────────────────────

function StatusOverlay({ stage, detail, progress }: {
  stage: string; detail?: string; progress?: number;
}) {
  const [dotIdx, setDotIdx] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setDotIdx((n) => (n + 1) % 4), 500);
    return () => clearInterval(i);
  }, []);
  const dots = ["", ".", "..", "..."];

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-background/80 backdrop-blur-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="border-primary/20 absolute h-20 w-20 animate-ping rounded-full border-2" style={{ animationDuration: "2s" }} />
        <div className="border-primary/40 absolute h-14 w-14 animate-pulse rounded-full border-2" />
        <div className="bg-primary/10 border-primary/60 flex h-9 w-9 items-center justify-center rounded-full border-2">
          <Target className="text-primary h-4 w-4" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-base font-semibold">
          {stage}{dots[dotIdx]}
        </p>
        {detail && <p className="text-muted-foreground mt-1 text-sm">{detail}</p>}
      </div>
      {progress !== undefined && (
        <div className="w-48">
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-center text-xs tabular-nums">{progress}%</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence panel content
// ─────────────────────────────────────────────────────────────────────────────

function IntelligenceContent({ data }: { data: WorkspaceView["data"]["intelligence"] }) {
  const [section, setSection] = useState<"targets" | "contacts">("targets");

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Gathering intelligence...</p>
      </div>
    );
  }

  const businesses = data.businesses ?? [];
  const contacts = data.contacts ?? [];

  function ScoreDot({ score }: { score: number | null }) {
    if (score === null) return <span className="text-muted-foreground text-xs">—</span>;
    const color = score >= 8 ? "bg-emerald-500" : score >= 7 ? "bg-blue-500" : score >= 6 ? "bg-amber-500" : "bg-muted-foreground/40";
    return (
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
        <span className="tabular-nums font-semibold">{score}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Stats row */}
      {data.summary && (
        <div className="border-border grid grid-cols-4 divide-x border-b">
          {[
            { label: "Discovered", value: data.summary.total },
            { label: "Qualified", value: data.summary.qualified },
            { label: "Prime (8+)", value: data.summary.prime_targets },
            { label: "Avg score", value: data.summary.avg_score !== null ? `${data.summary.avg_score}/10` : "—" },
          ].map((s) => (
            <div key={s.label} className="px-4 py-3 text-center">
              <div className="text-xl font-bold tabular-nums">{s.value}</div>
              <div className="text-muted-foreground text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Section switcher */}
      <div className="border-border flex items-center gap-1 border-b px-4 py-2">
        <button
          type="button"
          onClick={() => setSection("targets")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            section === "targets" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/50",
          )}
        >
          Targets ({businesses.length})
        </button>
        {contacts.length > 0 && (
          <button
            type="button"
            onClick={() => setSection("contacts")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              section === "contacts" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            Decision Makers ({contacts.length})
          </button>
        )}
      </div>

      {/* Targets table */}
      {section === "targets" && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="border-border sticky top-0 border-b bg-muted/80 backdrop-blur">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium w-8">#</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium">Company</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium">Score</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium">%ile</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium hidden md:table-cell">Tech gap</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium hidden md:table-cell">Hiring</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium hidden lg:table-cell">Owner signal</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b, i) => (
                <tr key={b.id} className="border-border hover:bg-muted/30 border-b transition-colors">
                  <td className="text-muted-foreground px-4 py-2.5 text-xs tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{b.name}</div>
                    <div className="text-muted-foreground text-xs">{[b.city, b.state].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className="px-4 py-2.5 text-center"><ScoreDot score={b.readiness_score} /></td>
                  <td className="text-muted-foreground px-4 py-2.5 text-center text-xs tabular-nums">
                    {b.benchmark_percentile !== null ? `${b.benchmark_percentile}th` : "—"}
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-2.5 text-center text-xs tabular-nums md:table-cell">
                    {b.tech_gap_score ?? "—"}
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-2.5 text-center text-xs tabular-nums md:table-cell">
                    {b.hiring_signal_score ?? "—"}
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-2.5 text-xs lg:table-cell">
                    {b.years_in_business
                      ? `${b.years_in_business}y · ${b.owner_operated_likelihood ?? "unknown"}`
                      : "—"}
                  </td>
                </tr>
              ))}
              {businesses.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-4 py-8 text-center text-sm">
                    Loading targets...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Contacts table */}
      {section === "contacts" && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="border-border sticky top-0 border-b bg-muted/80 backdrop-blur">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium">Title</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium hidden md:table-cell">Company</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium">Email</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium">Verified</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-border hover:bg-muted/30 border-b transition-colors">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="text-muted-foreground px-4 py-2.5 text-xs">{c.title ?? "—"}</td>
                  <td className="text-muted-foreground hidden px-4 py-2.5 text-xs md:table-cell">{c.business_name ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                      c.email_verified
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {c.email_verified ? "Verified" : "Unverified"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recommendation */}
      {data.recommendation && (
        <div className="border-border border-t bg-muted/20 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
            Agent Recommendation
          </p>
          <p className="text-sm leading-relaxed">{data.recommendation}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mandate content — renders live mandate detail directly (not a summary card)
// ─────────────────────────────────────────────────────────────────────────────

function MandateContent({ mandateId }: { mandateId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{
    mandate: { id: string; name: string; vertical: string; thesis: string | null; regions: string[] };
    businesses: Array<{
      id: string; name: string; city: string | null; state: string | null;
      relevance_score: number | null; relevance_reason: string | null;
      readiness_score: number | null;
    }>;
    contacts: Array<{
      id: string; name: string; title: string | null; email: string | null;
      email_verified: boolean; business_name: string | null;
    }>;
    outreach_count: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const supabase = createClient();

    const fetch = async () => {
      const [mandateRes, mbRes, outreachRes] = await Promise.all([
        supabase.from("mandates").select("id, name, vertical, thesis, regions").eq("id", mandateId).single(),
        supabase.from("mandate_businesses")
          .select(`
            relevance_score, relevance_reason,
            businesses (
              id, name, city, state,
              readiness_scores ( readiness_score )
            )
          `)
          .eq("mandate_id", mandateId)
          .eq("status", "active")
          .order("relevance_score", { ascending: false }),
        supabase.from("outreach_queue")
          .select("id", { count: "exact", head: true })
          .eq("mandate_id", mandateId),
      ]);

      if (!mountedRef.current) return;
      if (!mandateRes.data) return;

      const businesses = (mbRes.data || []).map((mb) => {
        const biz = Array.isArray(mb.businesses) ? mb.businesses[0] : mb.businesses;
        const rs = biz
          ? (Array.isArray((biz as { readiness_scores?: unknown }).readiness_scores)
            ? (biz as { readiness_scores: Array<{ readiness_score: number | null }> }).readiness_scores[0]
            : (biz as { readiness_scores?: { readiness_score: number | null } }).readiness_scores)
          : null;
        return {
          id: (biz as { id: string })?.id ?? "",
          name: (biz as { name: string })?.name ?? "Unknown",
          city: (biz as { city: string | null })?.city ?? null,
          state: (biz as { state: string | null })?.state ?? null,
          relevance_score: mb.relevance_score ?? null,
          relevance_reason: mb.relevance_reason ?? null,
          readiness_score: rs?.readiness_score ?? null,
        };
      });

      // Get contacts for these businesses
      const bizIds = businesses.map((b) => b.id).filter(Boolean);
      let contacts: Array<{ id: string; name: string; title: string | null; email: string | null; email_verified: boolean; business_name: string | null }> = [];
      if (bizIds.length > 0) {
        const { data: contactData } = await supabase
          .from("contacts")
          .select("id, name, title, email, email_verified, businesses ( name )")
          .in("business_id", bizIds)
          .eq("is_primary_contact", true);
        contacts = (contactData || []).map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title ?? null,
          email: c.email ?? null,
          email_verified: c.email_verified ?? false,
          business_name: (Array.isArray(c.businesses) ? c.businesses[0] : c.businesses)?.name ?? null,
        }));
      }

      if (!mountedRef.current) return;
      setData({
        mandate: mandateRes.data as { id: string; name: string; vertical: string; thesis: string | null; regions: string[] },
        businesses,
        contacts,
        outreach_count: outreachRes.count ?? 0,
      });
      setLoading(false);
    };

    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [mandateId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const { mandate, businesses, contacts, outreach_count } = data;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Mandate header */}
      <div className="border-border border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{mandate.name}</h2>
            <p className="text-muted-foreground mt-0.5 text-xs capitalize">
              {mandate.vertical}
              {mandate.regions?.length > 0 ? ` · ${mandate.regions.slice(0, 2).join(", ")}` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/campaigns/${mandateId}`)}>
            Full workspace
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
        {mandate.thesis && (
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed border-t pt-2">{mandate.thesis}</p>
        )}
      </div>

      {/* Stats */}
      <div className="border-border grid grid-cols-3 divide-x border-b">
        {[
          { label: "Targets", value: businesses.length },
          { label: "Decision Makers", value: contacts.length },
          { label: "Outreach drafts", value: outreach_count },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3 text-center">
            <div className="text-xl font-bold tabular-nums">{s.value}</div>
            <div className="text-muted-foreground text-xs">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Businesses in mandate */}
      <div className="flex-1 overflow-auto">
        <div className="border-border border-b bg-muted/50 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline</span>
        </div>
        <table className="w-full text-sm">
          <thead className="border-border border-b">
            <tr className="bg-muted/30">
              <th className="px-4 py-2.5 text-left text-xs font-medium">Company</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium">Readiness</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium hidden md:table-cell">Relevance</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium hidden lg:table-cell">Reason</th>
            </tr>
          </thead>
          <tbody>
            {businesses.map((b) => (
              <tr key={b.id} className="border-border hover:bg-muted/30 border-b transition-colors">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{b.name}</div>
                  <div className="text-muted-foreground text-xs">{[b.city, b.state].filter(Boolean).join(", ")}</div>
                </td>
                <td className="px-4 py-2.5 text-center">
                  {b.readiness_score !== null ? (
                    <span className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                      b.readiness_score >= 8 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : b.readiness_score >= 7 ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {b.readiness_score}
                    </span>
                  ) : "—"}
                </td>
                <td className="text-muted-foreground hidden px-4 py-2.5 text-center text-xs tabular-nums md:table-cell">
                  {b.relevance_score ?? "—"}
                </td>
                <td className="text-muted-foreground hidden px-4 py-2.5 text-xs lg:table-cell max-w-xs">
                  <span className="line-clamp-2">{b.relevance_reason ?? "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Decision makers */}
        {contacts.length > 0 && (
          <>
            <div className="border-border border-b border-t bg-muted/50 px-4 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decision Makers</span>
            </div>
            <table className="w-full text-sm">
              <thead className="border-border border-b">
                <tr className="bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-xs font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium hidden md:table-cell">Title</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium">Company</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium">Email</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-border hover:bg-muted/30 border-b transition-colors">
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="text-muted-foreground hidden px-4 py-2.5 text-xs md:table-cell">{c.title ?? "—"}</td>
                    <td className="text-muted-foreground px-4 py-2.5 text-xs">{c.business_name ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.email ?? "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                        c.email_verified
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {c.email_verified ? "Verified" : "Unverified"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Outreach content
// ─────────────────────────────────────────────────────────────────────────────

function OutreachContent({ mandateId }: { mandateId: string }) {
  const router = useRouter();
  const [emails, setEmails] = useState<Array<{
    id: string; subject: string; status: string; sequence_step: number;
    business_name: string; contact_name: string; contact_email: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const fetch = async () => {
      const { data } = await supabase
        .from("outreach_queue")
        .select(`id, subject, status, sequence_step, businesses ( name ), contacts ( name, email )`)
        .eq("mandate_id", mandateId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!mountedRef.current) return;
      setEmails((data || []).map((e) => ({
        id: e.id,
        subject: e.subject ?? "",
        status: e.status ?? "pending",
        sequence_step: e.sequence_step ?? 1,
        business_name: (Array.isArray(e.businesses) ? e.businesses[0] : e.businesses)?.name ?? "—",
        contact_name: (Array.isArray(e.contacts) ? e.contacts[0] : e.contacts)?.name ?? "—",
        contact_email: (Array.isArray(e.contacts) ? e.contacts[0] : e.contacts)?.email ?? null,
      })));
      setLoading(false);
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [mandateId]);

  const pending = emails.filter((e) => e.status === "pending").length;
  const sent = emails.filter((e) => e.status === "sent").length;
  const replied = emails.filter((e) => e.status === "replied").length;

  const statusStyle: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    approved: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    sent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    opened: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    replied: "bg-green-500/10 text-green-700 dark:text-green-400",
  };

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="text-muted-foreground h-5 w-5 animate-spin" /></div>;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-border border-b px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums">{emails.length}</div>
            <div className="text-muted-foreground text-xs">Total</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums text-amber-600">{pending}</div>
            <div className="text-muted-foreground text-xs">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums text-emerald-600">{sent}</div>
            <div className="text-muted-foreground text-xs">Sent</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums text-green-600">{replied}</div>
            <div className="text-muted-foreground text-xs">Replied</div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.push("/outreach")}>
          Review all
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="border-border sticky top-0 border-b bg-muted/80 backdrop-blur">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium">Target</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium hidden md:table-cell">Contact</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium">Subject</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium">Step</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id} className="border-border hover:bg-muted/30 border-b transition-colors">
                <td className="px-4 py-2.5 font-medium">{e.business_name}</td>
                <td className="text-muted-foreground hidden px-4 py-2.5 text-xs md:table-cell">{e.contact_name}</td>
                <td className="text-muted-foreground px-4 py-2.5 text-xs max-w-xs"><span className="line-clamp-1">{e.subject}</span></td>
                <td className="text-muted-foreground px-4 py-2.5 text-center text-xs tabular-nums">{e.sequence_step}</td>
                <td className="px-4 py-2.5">
                  <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize", statusStyle[e.status] ?? "bg-muted text-muted-foreground")}>
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr><td colSpan={5} className="text-muted-foreground px-4 py-8 text-center text-sm">No emails yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace panel — right side
// ─────────────────────────────────────────────────────────────────────────────

function WorkspacePanel({ chatId, isStreaming }: { chatId: string; isStreaming: boolean }) {
  const [views, setViews] = useState<WorkspaceView[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("intelligence");
  const [status, setStatus] = useState<WorkspaceView["data"]["status"] | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const supabase = createClient();

    const fetch = async () => {
      const { data } = await supabase
        .from("workspace_views")
        .select("*")
        .eq("chat_id", chatId)
        .eq("status", "active")
        .order("sort_order", { ascending: true });

      if (!mountedRef.current || !data) return;

      const allViews = data as WorkspaceView[];

      // Separate status (overlay) from content views
      const statusView = allViews.find((v) => v.view_type === "status");
      const contentViews = allViews.filter((v) => v.view_type !== "status");

      setStatus(statusView?.data.status ?? null);
      setViews(contentViews);

      // Auto-switch to mandate tab when mandate view appears
      setActiveTab((prev) => {
        const hasMandate = contentViews.some((v) => v.view_type === "mandate");
        const hasOutreach = contentViews.some((v) => v.view_type === "outreach");
        if (hasOutreach && prev !== "outreach") return "outreach";
        if (hasMandate && prev === "intelligence") return "mandate";
        return prev;
      });
    };

    fetch();
    const interval = setInterval(fetch, isStreaming ? 1500 : 5000);
    return () => clearInterval(interval);
  }, [chatId, isStreaming]);

  const intelligenceView = views.find((v) => v.view_type === "intelligence");
  const mandateView = views.find((v) => v.view_type === "mandate");
  const outreachView = views.find((v) => v.view_type === "outreach");

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; available: boolean }> = [
    {
      id: "intelligence",
      label: intelligenceView?.tab_label ?? "Intelligence",
      icon: <Target className="h-3.5 w-3.5" />,
      available: true, // always show
    },
    {
      id: "mandate",
      label: mandateView?.tab_label ?? "Mandate",
      icon: <Briefcase className="h-3.5 w-3.5" />,
      available: !!mandateView,
    },
    {
      id: "outreach",
      label: outreachView?.tab_label ?? "Outreach",
      icon: <Mail className="h-3.5 w-3.5" />,
      available: !!outreachView,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Browser-style tab bar */}
      <div className="border-border flex items-end gap-0 border-b bg-muted/30 px-2 pt-1">
        {tabs.filter((t) => t.available).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group relative flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-2 text-xs font-medium transition-all",
              activeTab === tab.id
                ? "border-border bg-background text-foreground shadow-sm z-10 -mb-px"
                : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {tab.icon}
            <span className="max-w-[120px] truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content — relative so status overlay can be absolute */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Status overlay — appears over content while agent is working */}
        {(isStreaming && status) && (
          <StatusOverlay
            stage={status.stage}
            detail={status.detail}
            progress={status.progress}
          />
        )}

        {/* Intelligence tab */}
        {activeTab === "intelligence" && (
          !intelligenceView ? (
            <div className="flex flex-1 items-center justify-center">
              {isStreaming ? null : (
                <div className="text-center">
                  <Target className="text-muted-foreground mx-auto h-8 w-8" />
                  <p className="text-muted-foreground mt-3 text-sm">
                    Results will appear here as the agent works.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <IntelligenceContent data={intelligenceView.data.intelligence} />
          )
        )}

        {/* Mandate tab */}
        {activeTab === "mandate" && mandateView?.mandate_id && (
          <MandateContent mandateId={mandateView.mandate_id} />
        )}

        {/* Outreach tab */}
        {activeTab === "outreach" && outreachView?.mandate_id && (
          <OutreachContent mandateId={outreachView.mandate_id} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resizable divider
// ─────────────────────────────────────────────────────────────────────────────

function ResizableDivider({ onResize }: { onResize: (deltaX: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      onResize(e.clientX - lastX.current);
      lastX.current = e.clientX;
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative z-10 w-1 cursor-col-resize"
    >
      <div className="absolute inset-y-0 left-0 w-px bg-border transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
      {/* Grab handle indicator */}
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatView
// ─────────────────────────────────────────────────────────────────────────────

function ChatView({
  chatId,
  initialMessages,
  initialTitle,
  autoSendText,
}: {
  chatId: string;
  initialMessages: UIMessage[];
  initialTitle?: string | null;
  autoSendText?: string;
}) {
  const [input, setInput] = useState("");
  const { activeCampaignId } = useCampaign();
  const { register, isStreaming } = useStreaming();
  const { userId } = useAuth();
  const router = useRouter();
  const didAutoSend = useRef(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [chatWidthPct, setChatWidthPct] = useState(38);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-collapse sidebar on mount
  const { setOpen, setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpen(false);
    setOpenMobile(false);
  }, [setOpen, setOpenMobile]);

  const { messages, sendMessage, status, stop } = useChat({
    id: chatId,
    messages: initialMessages,
    onFinish({ messages: allMessages }) {
      if (userId) {
        saveChat(createClient(), userId, chatId, allMessages, activeCampaignId ?? undefined);
      }
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isLoading) return register("chat");
  }, [isLoading, register]);

  const requestOptions = {
    body: {
      chatId,
      ...(activeCampaignId ? { mandateId: activeCampaignId } : {}),
    },
  };

  useEffect(() => {
    if (autoSendText && !didAutoSend.current) {
      didAutoSend.current = true;
      sendMessage({ text: autoSendText }, requestOptions);
      // Remove ?q= from URL so page refresh doesn't re-send
      router.replace(`/chat/${chatId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendText]);

  const onSubmit = () => {
    if (!input.trim()) return;
    sendMessage({ text: input }, requestOptions);
    setInput("");
  };

  const handleSuggestionClick = (text: string) => {
    sendMessage({ text }, requestOptions);
  };

  const handleResize = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setChatWidthPct((prev) => Math.min(60, Math.max(20, prev + pct)));
  }, []);

  return (
    <>
      {/* Desktop */}
      <div ref={containerRef} className="hidden min-h-0 flex-1 md:flex">
        {/* Chat panel */}
        <div className="flex min-w-0 flex-col" style={{ width: `${chatWidthPct}%` }}>
          <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-2">
            <span className="min-w-0 truncate text-sm font-medium">
              {initialTitle?.trim() || "New conversation"}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => router.push("/")}>
              <SquarePen className="h-4 w-4" />
            </Button>
          </div>
          <ChatMessages messages={messages} isLoading={isLoading} onSuggestionClick={handleSuggestionClick} />
          <ChatInput input={input} isLoading={isLoading} onInputChange={setInput} onSubmit={onSubmit} onStop={stop} />
        </div>

        <ResizableDivider onResize={handleResize} />

        {/* Workspace panel */}
        <div className="flex min-w-0 flex-col" style={{ width: `${100 - chatWidthPct}%` }}>
          <WorkspacePanel chatId={chatId} isStreaming={isStreaming} />
        </div>
      </div>

      {/* Mobile */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <div className="border-border flex border-b">
          {(["chat", "workspace"] as MobileTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={cn(
                "flex flex-1 items-center justify-center py-2.5 text-sm font-medium capitalize transition-colors",
                mobileTab === tab ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        {mobileTab === "chat" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatMessages messages={messages} isLoading={isLoading} onSuggestionClick={handleSuggestionClick} />
            <ChatInput input={input} isLoading={isLoading} onInputChange={setInput} onSubmit={onSubmit} onStop={stop} />
          </div>
        ) : (
          <WorkspacePanel chatId={chatId} isStreaming={isStreaming} />
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page loader
// ─────────────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { id: chatId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const autoSendText = searchParams.get("q") ?? undefined;
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [initialTitle, setInitialTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadChat(createClient(), chatId).then((chat) => {
      if (cancelled) return;
      setInitialMessages(chat?.messages ?? []);
      setInitialTitle((chat as { title?: string | null } | null)?.title ?? null);
    });
    return () => { cancelled = true; };
  }, [chatId]);

  if (initialMessages === null) {
    return (
      <div className="bg-background flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <ChatView
      chatId={chatId}
      initialMessages={initialMessages}
      initialTitle={initialTitle}
      autoSendText={autoSendText}
    />
  );
}
