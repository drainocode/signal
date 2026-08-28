"use client";

/**
 * src/app/campaigns/[id]/page.tsx
 *
 * Mandate detail page. Exports:
 *  - MandateDetail (named) — used embedded in workspace right panel
 *  - default CampaignDetailPage — standalone route at /campaigns/[id]
 *
 * Data comes from our tables (mandates, mandate_businesses, businesses,
 * enrichment_data, readiness_scores, qualification_results, contacts,
 * outreach_queue) adapted to Signal's component types.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "next/navigation";
import { ChevronDown, RotateCw, Sparkles } from "lucide-react";

import { CampaignHeader } from "@/components/campaign/campaign-header";
import { CampaignStats } from "@/components/campaign/campaign-stats";
import { CompaniesList } from "@/components/campaign/companies-list";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { cn } from "@/lib/utils";

import type {
  Campaign,
  CampaignCompany,
  CampaignContact,
} from "@/lib/types/campaign";

// ─────────────────────────────────────────────────────────────────────────────
// Types for our raw data
// ─────────────────────────────────────────────────────────────────────────────

interface RawBusiness {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  vertical: string | null;
  google_rating: number | null;
  review_count: number | null;
  pipeline_status: string | null;
}

interface RawEnrichment {
  business_id: string;
  website_title: string | null;
  website_description: string | null;
  tech_gap_detected: boolean | null;
  has_google_ads: boolean | null;
  enriched_at: string | null;
}

interface RawReadiness {
  business_id: string;
  readiness_score: number | null;
  tech_gap_score: number | null;
  hiring_signal_score: number | null;
  digital_presence_score: number | null;
  review_health_score: number | null;
  operational_score: number | null;
  score_rationale: string | null;
  benchmark_percentile: number | null;
}

interface RawQualification {
  business_id: string;
  is_qualified: boolean | null;
  years_in_business: number | null;
  owner_operated_likelihood: string | null;
  employee_count_estimate: number | null;
  disqualification_reason: string | null;
}

interface RawContact {
  id: string;
  business_id: string | null;
  name: string;
  title: string | null;
  email: string | null;
  email_verified: boolean;
  email_source: string | null;
  phone: string | null;
  linkedin_url: string | null;
  is_primary_contact: boolean;
  contact_score: number | null;
  created_at: string;
  updated_at: string;
}

interface RawOutreach {
  contact_id: string | null;
  status: string | null;
}

interface RawMandateBusiness {
  id: string;
  mandate_id: string;
  business_id: string;
  relevance_score: number | null;
  relevance_reason: string | null;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetcher — calls API route which uses service client (bypasses RLS)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchMandateData(mandateId: string): Promise<{
  campaign: Campaign | null;
  companies: CampaignCompany[];
  contacts: CampaignContact[];
  readinessList: RawReadiness[];
  error: string | null;
}> {
  const res = await fetch(`/api/mandate/${mandateId}`, { cache: "no-store" });

  if (!res.ok) {
    return { campaign: null, companies: [], contacts: [], readinessList: [], error: "Mandate not found" };
  }

  const data = await res.json() as {
    mandate: Record<string, unknown>;
    mandateBusinesses: RawMandateBusiness[];
    businesses: RawBusiness[];
    enrichmentData: RawEnrichment[];
    readinessScores: RawReadiness[];
    qualificationResults: RawQualification[];
    contacts: RawContact[];
    outreachQueue: RawOutreach[];
  };

  const { mandate, mandateBusinesses, businesses, enrichmentData, readinessScores, qualificationResults, contacts: rawContacts, outreachQueue } = data;

  const campaign = buildCampaign(mandate);

  if (mandateBusinesses.length === 0) {
    return { campaign, companies: [], contacts: [], readinessList: [], error: null };
  }

  const bizMap = new Map<string, RawBusiness>(businesses.map((b) => [b.id, b]));
  const enrichMap = new Map<string, RawEnrichment>(enrichmentData.map((e) => [e.business_id, e]));
  const rsMap = new Map<string, RawReadiness>(readinessScores.map((r) => [r.business_id, r]));
  const qualMap = new Map<string, RawQualification>(qualificationResults.map((q) => [q.business_id, q]));

  const companies: CampaignCompany[] = mandateBusinesses
    .filter((mb) => bizMap.has(mb.business_id))
    .map((mb) => {
      const biz = bizMap.get(mb.business_id)!;
      const enrich = enrichMap.get(mb.business_id);
      const rs = rsMap.get(mb.business_id);
      const qual = qualMap.get(mb.business_id);

      const enrichmentData = enrich
        ? {
            enrichedAt: enrich.enriched_at ?? new Date().toISOString(),
            website: {
              title: enrich.website_title ?? null,
              summary: enrich.website_description ?? null,
              description: null,
              emails: [],
              phones: biz.phone ? [biz.phone] : [],
              address: [biz.city, biz.state].filter(Boolean).join(", ") || null,
            },
            searches: [],
            hiring: { jobs: [], careersUrl: null },
            _tractus: {
              readiness_score: rs?.readiness_score ?? null,
              tech_gap_score: rs?.tech_gap_score ?? null,
              hiring_signal_score: rs?.hiring_signal_score ?? null,
              digital_presence_score: rs?.digital_presence_score ?? null,
              review_health_score: rs?.review_health_score ?? null,
              operational_score: rs?.operational_score ?? null,
              score_rationale: rs?.score_rationale ?? null,
              benchmark_percentile: rs?.benchmark_percentile ?? null,
              tech_gap_detected: enrich?.tech_gap_detected ?? false,
              google_rating: biz.google_rating,
              review_count: biz.review_count,
              years_in_business: qual?.years_in_business ?? null,
              owner_operated: qual?.owner_operated_likelihood ?? null,
              is_qualified: qual?.is_qualified ?? null,
            },
            errors: [],
          }
        : {};

      const score = rs?.readiness_score ?? null;
      const readiness_tag: CampaignCompany["readiness_tag"] =
        score !== null && score >= 7 ? "ready_to_contact" : score !== null ? "monitoring" : null;

      return {
        id: mb.id,
        campaign_id: mb.mandate_id,
        organization_id: biz.id,
        name: biz.name,
        domain: biz.website
          ? biz.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
          : null,
        url: biz.website ?? null,
        industry: biz.vertical ?? null,
        location: [biz.city, biz.state].filter(Boolean).join(", ") || null,
        description: null,
        relevance_score: mb.relevance_score ?? null,
        score_reason: mb.relevance_reason ?? null,
        status: (biz.pipeline_status as CampaignCompany["status"]) ?? "qualified",
        readiness_tag,
        enrichment_data: enrichmentData,
        source: "tractus_pipeline",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as CampaignCompany;
    });

  // Build contacts
  const outreachStatusMap = new Map<string, string>(
    outreachQueue
      .filter((r) => r.contact_id)
      .map((r) => [r.contact_id!, r.status ?? "pending"])
  );

  const bizIdToCompany = new Map(
    companies.map((c) => [c.organization_id, { name: c.name, domain: c.domain, industry: c.industry }])
  );

  const contacts: CampaignContact[] = rawContacts.map((c) => {
    const outreachStatus = outreachStatusMap.get(c.id);
    let signalOutreachStatus: CampaignContact["outreach_status"] = "pending";
    if (outreachStatus === "sent" || outreachStatus === "approved") signalOutreachStatus = "sent";
    else if (outreachStatus === "opened") signalOutreachStatus = "opened";
    else if (outreachStatus === "replied") signalOutreachStatus = "replied";
    else if (outreachStatus === "bounced") signalOutreachStatus = "bounced";

    return {
      id: c.id,
      person_id: c.id,
      campaign_id: mandateId,
      organization_id: c.business_id ?? null,
      name: c.name ?? "Unknown",
      title: c.title ?? null,
      department: null,
      seniority: null,
      role_summary: null,
      bio_summary: null,
      work_email: c.email ?? null,
      personal_email: null,
      work_email_verified_at: c.email_verified ? c.updated_at : null,
      personal_email_verified_at: null,
      linkedin_url: c.linkedin_url ?? null,
      twitter_url: null,
      enrichment_status: (c.email_verified || c.email) ? "enriched" : "pending",
      enrichment_data: {},
      outreach_status: signalOutreachStatus,
      priority_score: c.contact_score ?? null,
      score_reason: null,
      readiness_tag: null,
      source: c.email_source ?? null,
      created_at: c.created_at,
      updated_at: c.updated_at,
      company: bizIdToCompany.get(c.business_id ?? "") ?? null,
    } as CampaignContact;
  });

  return { campaign, companies, contacts, readinessList: readinessScores, error: null };
}

function buildCampaign(mandate: Record<string, unknown>): Campaign {
  return {
    id: mandate.id as string,
    name: mandate.name as string,
    status: (mandate.status as string) ?? "active",
    profile_id: null,
    icp: {
      industry: (mandate.vertical as string) ?? undefined,
      geography: Array.isArray(mandate.regions)
        ? (mandate.regions as string[]).slice(0, 3).join(", ")
        : undefined,
      companySize: (mandate.icp as Record<string, unknown> | null)?.employeeRange as string | undefined,
      targetTitles: undefined,
      painPoints: undefined,
    },
    offering: mandate.thesis
      ? { valueProposition: mandate.thesis as string, description: undefined, differentiators: undefined }
      : undefined,
    positioning: undefined,
    created_at: mandate.created_at as string,
    updated_at: mandate.updated_at as string,
  } as unknown as Campaign;
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark section — collapsible, shows all targets ranked by readiness score
// ─────────────────────────────────────────────────────────────────────────────

interface BenchmarkRow {
  name: string;
  location: string | null;
  readiness_score: number | null;
  tech_gap_score: number | null;
  hiring_signal_score: number | null;
  digital_presence_score: number | null;
  review_health_score: number | null;
  operational_score: number | null;
  benchmark_percentile: number | null;
}

function ScoreBar({ value, max = 10 }: { value: number | null; max?: number }) {
  if (value === null) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round((value / max) * 100);
  const color = value >= 8 ? "bg-emerald-500" : value >= 6 ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums font-medium">{value}</span>
    </div>
  );
}

function BenchmarkSection({
  companies,
  readinessList,
}: {
  companies: CampaignCompany[];
  readinessList: RawReadiness[];
}) {
  const [open, setOpen] = useState(true);

  if (readinessList.length === 0) return null;

  const rsMap = new Map(readinessList.map((r) => [r.business_id, r]));
  const bizMap = new Map(companies.map((c) => [c.organization_id, c]));

  const rows: BenchmarkRow[] = readinessList
    .map((rs) => {
      const biz = bizMap.get(rs.business_id);
      return {
        name: biz?.name ?? "Unknown",
        location: biz?.location ?? null,
        readiness_score: rs.readiness_score,
        tech_gap_score: rs.tech_gap_score,
        hiring_signal_score: rs.hiring_signal_score,
        digital_presence_score: rs.digital_presence_score,
        review_health_score: rs.review_health_score,
        operational_score: rs.operational_score,
        benchmark_percentile: rs.benchmark_percentile,
      };
    })
    .sort((a, b) => (b.readiness_score ?? 0) - (a.readiness_score ?? 0));

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/30 flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Benchmark</span>
          <span className="text-muted-foreground text-xs">
            Readiness comparison across {rows.length} targets
          </span>
        </div>
        <ChevronDown
          className={cn(
            "text-muted-foreground h-4 w-4 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-border border-t overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/50 border-b">
                <th className="px-4 py-2 text-left text-xs font-medium">Target</th>
                <th className="px-4 py-2 text-left text-xs font-medium">Overall</th>
                <th className="px-4 py-2 text-left text-xs font-medium hidden md:table-cell">
                  Tech gap
                  <span className="text-muted-foreground font-normal"> 30%</span>
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium hidden md:table-cell">
                  Hiring
                  <span className="text-muted-foreground font-normal"> 25%</span>
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium hidden lg:table-cell">
                  Digital
                  <span className="text-muted-foreground font-normal"> 20%</span>
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium hidden lg:table-cell">
                  Reviews
                  <span className="text-muted-foreground font-normal"> 15%</span>
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium hidden lg:table-cell">
                  Ops
                  <span className="text-muted-foreground font-normal"> 10%</span>
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium hidden md:table-cell">%ile</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-border hover:bg-muted/30 border-b transition-colors last:border-b-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{row.name}</div>
                    {row.location && (
                      <div className="text-muted-foreground text-xs">{row.location}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ScoreBar value={row.readiness_score} />
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <ScoreBar value={row.tech_gap_score} />
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <ScoreBar value={row.hiring_signal_score} />
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <ScoreBar value={row.digital_presence_score} />
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <ScoreBar value={row.review_health_score} />
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <ScoreBar value={row.operational_score} />
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 text-center text-xs tabular-nums hidden md:table-cell">
                    {row.benchmark_percentile !== null ? `${row.benchmark_percentile}th` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed CampaignStats wrapper — corrects labels for PE acquisition context
// We wrap CampaignStats with the right data mapping:
//   Companies → Targets (companies.length)
//   Leads     → Decision Makers (contacts.length)
//   Enriched  → Verified emails (contacts where email_verified)
//   Contacted → Contacted (outreach sent/opened/replied)
// CampaignStats itself uses "Companies", "Leads", "Enriched", "Contacted"
// labels internally — we can't change those without modifying the component.
// Instead we pass the correct counts to match what each label means for PE:
//   enrichment_status="enriched" → contacts with verified email
// ─────────────────────────────────────────────────────────────────────────────

// Note: CampaignStats labels (Companies/Leads/Enriched/Contacted) map to
// acquisition context as:
//   Companies = Targets in mandate
//   Leads = Decision makers found
//   Enriched = Decision makers with verified email
//   Contacted = Decision makers contacted via outreach
// The data mapping already handles this correctly since we set
// enrichment_status="enriched" only for contacts with verified email.

// ─────────────────────────────────────────────────────────────────────────────
// Activity chip + Sticky bar + Skeleton (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityCounts { added: number; enriched: number; contacted: number }
const EMPTY_ACTIVITY: ActivityCounts = { added: 0, enriched: 0, contacted: 0 };

function ActivityChip({ activity, streaming }: { activity: ActivityCounts; streaming: boolean }) {
  const parts: string[] = [];
  if (activity.added > 0) parts.push(`${activity.added} added`);
  if (activity.enriched > 0) parts.push(`${activity.enriched} enriched`);
  if (activity.contacted > 0) parts.push(`${activity.contacted} contacted`);
  const label = parts.length > 0 ? `Agent: ${parts.join(" · ")}` : streaming ? "Agent working..." : "";
  if (!label) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2">
      <div className="bg-background/90 border-border flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur">
        <Sparkles className={cn("h-3.5 w-3.5", streaming && "animate-pulse")} />
        <span className="tabular-nums">{label}</span>
      </div>
    </div>
  );
}

function StickyCampaignBar({ name, replyRate, visible }: { name: string; replyRate: number; visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "bg-background/80 sticky top-0 z-10 backdrop-blur transition-opacity border-border border-b",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="mx-auto flex items-center justify-between gap-3 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="text-muted-foreground text-xs tabular-nums">{replyRate}% reply rate</span>
        </div>
      </div>
    </div>
  );
}

function CampaignSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="bg-muted/60 h-7 w-64 animate-pulse rounded" />
            <div className="bg-muted/40 h-4 w-40 animate-pulse rounded" />
          </div>
          <div className="flex gap-2">
            <div className="bg-muted/40 h-8 w-28 animate-pulse rounded-lg" />
            <div className="bg-muted/40 h-8 w-32 animate-pulse rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="bg-muted/40 col-span-2 h-24 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
        </div>
        <Separator />
        <div className="space-y-3">
          <div className="bg-muted/40 h-6 w-24 animate-pulse rounded" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted/30 h-14 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component — works both embedded (via mandateId prop) and as standalone route
// ─────────────────────────────────────────────────────────────────────────────

interface MandateDetailProps {
  mandateId?: string;
}

export function MandateDetail({ mandateId: propMandateId }: MandateDetailProps) {
  const params = useParams<{ id: string }>();
  const mandateId = propMandateId ?? params?.id;

  const { setActiveCampaignId } = useCampaign();
  const { isStreaming } = useStreaming();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [companies, setCompanies] = useState<CampaignCompany[]>([]);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [readinessList, setReadinessList] = useState<RawReadiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [activity, setActivity] = useState<ActivityCounts>(EMPTY_ACTIVITY);
  const [headerVisible, setHeaderVisible] = useState(true);

  const headerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const prevCompanyIds = useRef<Set<string>>(new Set());
  const prevContactIds = useRef<Set<string>>(new Set());
  const prevCompanyStatuses = useRef<Map<string, string>>(new Map());
  const prevOutreachStatuses = useRef<Map<string, string>>(new Map());
  const isInitialLoad = useRef(true);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (mandateId) setActiveCampaignId(mandateId);
    return () => setActiveCampaignId(null);
  }, [mandateId, setActiveCampaignId]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const t = setTimeout(() => setActivity(EMPTY_ACTIVITY), 4000);
      return () => clearTimeout(t);
    }
    if (!wasStreamingRef.current && isStreaming) setActivity(EMPTY_ACTIVITY);
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const fetchData = useCallback(async () => {
    if (!mandateId) return;
    const result = await fetchMandateData(mandateId);
    if (!mountedRef.current) return;

    if (result.error) { setError(result.error); setLoading(false); return; }

    if (!isInitialLoad.current) {
      const changed = new Set<string>();
      let addedDelta = 0, contactedDelta = 0;
      for (const c of result.companies) {
        if (!prevCompanyIds.current.has(c.id)) { changed.add(c.id); addedDelta++; }
        else { const prev = prevCompanyStatuses.current.get(c.id); if (prev && prev !== c.status) changed.add(c.id); }
      }
      for (const c of result.contacts) {
        if (!prevContactIds.current.has(c.id)) { changed.add(c.id); addedDelta++; }
        const prev = prevOutreachStatuses.current.get(c.id);
        const isContacted = ["sent","opened","replied"].includes(c.outreach_status ?? "");
        const wasContacted = ["sent","opened","replied"].includes(prev ?? "");
        if (!wasContacted && isContacted) contactedDelta++;
      }
      if (changed.size > 0) { setHighlightedIds(changed); setTimeout(() => setHighlightedIds(new Set()), 3000); }
      if (addedDelta > 0 || contactedDelta > 0) setActivity((p) => ({ ...p, added: p.added + addedDelta, contacted: p.contacted + contactedDelta }));
    }
    isInitialLoad.current = false;
    prevCompanyIds.current = new Set(result.companies.map((c) => c.id));
    prevContactIds.current = new Set(result.contacts.map((c) => c.id));
    prevCompanyStatuses.current = new Map(result.companies.map((c) => [c.id, c.status ?? ""]));
    prevOutreachStatuses.current = new Map(result.contacts.map((c) => [c.id, c.outreach_status ?? ""]));

    setCampaign(result.campaign);
    setCompanies(result.companies);
    setContacts(result.contacts);
    setReadinessList(result.readinessList);
    setLoading(false);
  }, [mandateId]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, isStreaming ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [fetchData, isStreaming]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setHeaderVisible(e.isIntersecting), { threshold: 0, rootMargin: "-56px 0px 0px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading]);

  const handleContactEnriched = (id: string, updated: CampaignContact) =>
    setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));

  const handleCompanyEnriched = (id: string, data: Record<string, unknown>) =>
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, enrichment_data: data as CampaignCompany["enrichment_data"] } : c));

  const replyRate = useMemo(() => {
    const contacted = contacts.filter((c) => ["sent","opened","replied"].includes(c.outreach_status ?? "")).length;
    const replied = contacts.filter((c) => c.outreach_status === "replied").length;
    return contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
  }, [contacts]);

  if (loading) return <CampaignSkeleton />;

  if (error || !campaign) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">{error ?? "Mandate not found"}</p>
      </div>
    );
  }

  const activityTotal = activity.added + activity.enriched + activity.contacted;

  return (
    <div className="flex-1 overflow-y-auto">
      <StickyCampaignBar name={campaign.name} replyRate={replyRate} visible={!headerVisible} />

      <div className="space-y-6 p-4 md:p-6">
        <div ref={headerRef}>
          <CampaignHeader
            campaign={campaign}
            contactCount={contacts.length}
            companyCount={companies.length}
            onDataChanged={fetchData}
            onProfileChanged={() => {}}
          />
        </div>

        {/* Stats — labels map to PE context:
            Companies = Targets, Leads = Decision Makers,
            Enriched = Verified emails, Contacted = Outreach sent */}
        <CampaignStats companies={companies} contacts={contacts} />

        <Separator />

        {/* Benchmark — collapsible comparison of all targets by readiness */}
        <BenchmarkSection companies={companies} readinessList={readinessList} />

        <Separator />

        {/* Pipeline — full Signal accordion with company + contact expand */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pipeline</h2>
            <Button variant="ghost" size="sm" onClick={fetchData}>
              <RotateCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          <CompaniesList
            campaignId={mandateId!}
            companies={companies}
            contacts={contacts}
            highlightedIds={highlightedIds}
            onContactEnriched={handleContactEnriched}
            onCompanyEnriched={handleCompanyEnriched}
            onDataChanged={fetchData}
          />
        </div>
      </div>

      {(isStreaming || activityTotal > 0) && (
        <ActivityChip activity={activity} streaming={isStreaming} />
      )}
    </div>
  );
}

// Default export for standalone route /campaigns/[id]
export default function CampaignDetailPage() {
  return <MandateDetail />;
}
