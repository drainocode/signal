"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ExternalLink, Globe, Mail, Phone, ArrowLeft } from "lucide-react";
import { useAuth } from "@clerk/nextjs";

import { ScoreBadge } from "@/components/ui/score-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

interface BusinessProfile {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  vertical: string | null;
  google_rating: number | null;
  review_count: number | null;
  google_maps_url: string | null;
  pipeline_status: string;
}

interface ReadinessScore {
  readiness_score: number;
  tech_gap_score: number | null;
  hiring_signal_score: number | null;
  digital_presence_score: number | null;
  review_health_score: number | null;
  operational_score: number | null;
  benchmark_percentile: number | null;
  benchmark_region: string | null;
  score_rationale: string | null;
}

interface Qualification {
  is_franchise: boolean | null;
  is_pe_backed: boolean | null;
  owner_operated_likelihood: string | null;
  estimated_employee_range: string | null;
}

interface Enrichment {
  has_contact_form: boolean | null;
  form_auto_reply: boolean | null;
  has_google_ads: boolean | null;
  has_meta_ads: boolean | null;
  review_response_rate: number | null;
  tech_stack: {
    detected: string[];
    missing: string[];
    has_booking: boolean;
    has_chat: boolean;
    has_review_platform: boolean;
  } | null;
}

interface SignalEvent {
  id: string;
  signal_type: string;
  signal_category: string;
  signal_content: string;
  severity: string;
  impact_score: number | null;
  detected_at: string;
}

interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  is_primary_contact: boolean | null;
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

function ScoreDimension({
  label,
  value,
  weight,
}: {
  label: string;
  value: number | null;
  weight: string;
}) {
  if (value === null) return null;
  const pct = Math.round((value / 10) * 100);
  const color =
    value >= 7
      ? "bg-emerald-500"
      : value >= 5
        ? "bg-amber-500"
        : "bg-muted-foreground/30";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60">{weight}</span>
          <span className="font-medium tabular-nums">{value}/10</span>
        </div>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-muted-foreground shrink-0 text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const companyId = params.id;

  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [score, setScore] = useState<ReadinessScore | null>(null);
  const [qualification, setQualification] = useState<Qualification | null>(null);
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);
  const [signals, setSignals] = useState<SignalEvent[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCore = useCallback(async () => {
    const supabase = createClient();
    const [businessRes, scoreRes, qualRes, enrichRes, signalsRes, contactsRes] =
      await Promise.all([
        supabase.from("businesses").select("*").eq("id", companyId).single(),
        supabase.from("readiness_scores").select("*").eq("business_id", companyId).maybeSingle(),
        supabase.from("qualification_results").select("*").eq("business_id", companyId).maybeSingle(),
        supabase.from("enrichment_data").select("*").eq("business_id", companyId).maybeSingle(),
        supabase.from("signal_events").select("*").eq("business_id", companyId).order("detected_at", { ascending: false }).limit(20),
        supabase.from("contacts").select("*").eq("business_id", companyId).order("is_primary_contact", { ascending: false }),
      ]);

    if (businessRes.error || !businessRes.data) {
      setError("Business not found");
      setLoading(false);
      return;
    }

    setBusiness(businessRes.data as BusinessProfile);
    setScore(scoreRes.data as ReadinessScore | null);
    setQualification(qualRes.data as Qualification | null);
    setEnrichment(enrichRes.data as Enrichment | null);
    setSignals((signalsRes.data || []) as SignalEvent[]);
    setContacts((contactsRes.data || []) as Contact[]);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (isLoaded && isSignedIn) void fetchCore();
    else if (isLoaded && !isSignedIn) setLoading(false);
  }, [isLoaded, isSignedIn, fetchCore]);

  if (!isLoaded || loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !business) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-6">
          <p className="text-muted-foreground text-sm">{error ?? "Business not found"}</p>
        </div>
      </div>
    );
  }

  const tierLabel =
    score?.benchmark_percentile !== null && score?.benchmark_percentile !== undefined
      ? score.benchmark_percentile >= 80
        ? "Prime target"
        : score.benchmark_percentile >= 60
          ? "Strong candidate"
          : score.benchmark_percentile >= 40
            ? "Moderate target"
            : "Lower priority"
      : null;

  const tierClass =
    tierLabel === "Prime target"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tierLabel === "Strong candidate"
        ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
        : tierLabel === "Moderate target"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-muted text-muted-foreground";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {/* Back button */}
        <button
          type="button"
          onClick={() => router.back()}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
              {business.website && (
                <a
                  href={business.website}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
                >
                  <Globe className="h-3 w-3" />
                  {(() => {
                    try {
                      return new URL(business.website).hostname.replace("www.", "");
                    } catch {
                      return business.website;
                    }
                  })()}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {business.city && (
                <span>· {[business.city, business.state].filter(Boolean).join(", ")}</span>
              )}
              {business.vertical && (
                <span>· {business.vertical.replace(/_/g, " ")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tierLabel && (
              <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${tierClass}`}>
                {tierLabel}
              </span>
            )}
            {score && <ScoreBadge score={score.readiness_score} />}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Left column */}
          <div className="space-y-6">
            {/* Score breakdown */}
            {score && (
              <section className="border-border rounded-lg border p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Readiness score</h2>
                  <div className="flex items-center gap-2">
                    {score.benchmark_percentile !== null && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {score.benchmark_percentile}th percentile
                        {score.benchmark_region ? ` in ${score.benchmark_region}` : ""}
                      </span>
                    )}
                    <ScoreBadge score={score.readiness_score} />
                  </div>
                </div>
                <div className="space-y-3">
                  <ScoreDimension label="Tech stack gap" value={score.tech_gap_score} weight="30%" />
                  <ScoreDimension label="Hiring signals" value={score.hiring_signal_score} weight="25%" />
                  <ScoreDimension label="Digital presence" value={score.digital_presence_score} weight="20%" />
                  <ScoreDimension label="Review health" value={score.review_health_score} weight="15%" />
                  <ScoreDimension label="Operations" value={score.operational_score} weight="10%" />
                </div>
                {score.score_rationale && (
                  <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-xs leading-relaxed">
                    {score.score_rationale}
                  </p>
                )}
              </section>
            )}

            {/* Signals */}
            {signals.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Signals ({signals.length})</h2>
                <div className="border-border overflow-hidden rounded-lg border">
                  {signals.map((s, i) => (
                    <div
                      key={s.id}
                      className={`flex items-start gap-3 px-4 py-3 ${i < signals.length - 1 ? "border-border border-b" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{formatSignalType(s.signal_type)}</span>
                          <span
                            className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                              s.severity === "high"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : s.severity === "medium"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {s.severity}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                          {s.signal_content}
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {timeAgo(s.detected_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Tech stack */}
            {enrichment?.tech_stack && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Tech stack</h2>
                <div className="border-border space-y-3 rounded-lg border p-4">
                  {enrichment.tech_stack.detected.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
                        Detected
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enrichment.tech_stack.detected.map((t) => (
                          <span
                            key={t}
                            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md px-2 py-0.5 text-xs font-medium"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {enrichment.tech_stack.missing.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
                        Missing (PE upside)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enrichment.tech_stack.missing.map((t) => (
                          <span
                            key={t}
                            className="bg-red-500/10 text-red-700 dark:text-red-400 rounded-md px-2 py-0.5 text-xs font-medium capitalize"
                          >
                            {t.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 pt-1">
                    {[
                      { label: "Online booking", value: enrichment.tech_stack.has_booking },
                      { label: "Chat widget", value: enrichment.tech_stack.has_chat },
                      { label: "Review platform", value: enrichment.tech_stack.has_review_platform },
                    ].map(({ label, value }) => (
                      <span
                        key={label}
                        className={`text-xs ${value ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                      >
                        {value ? "✓" : "✗"} {label}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Business details */}
            <section className="border-border rounded-lg border">
              <div className="border-border border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Business details</h2>
              </div>
              <div className="divide-border divide-y px-4">
                {business.google_rating && (
                  <InfoRow
                    label="Rating"
                    value={<span>★ {business.google_rating} ({business.review_count} reviews)</span>}
                  />
                )}
                {qualification?.estimated_employee_range && (
                  <InfoRow label="Employees" value={qualification.estimated_employee_range} />
                )}
                {qualification?.owner_operated_likelihood && (
                  <InfoRow
                    label="Owner-operated"
                    value={<span className="capitalize">{qualification.owner_operated_likelihood} likelihood</span>}
                  />
                )}
                {enrichment?.review_response_rate !== null &&
                  enrichment?.review_response_rate !== undefined && (
                    <InfoRow label="Review response" value={`${enrichment.review_response_rate}%`} />
                  )}
                {enrichment?.has_google_ads !== null &&
                  enrichment?.has_google_ads !== undefined && (
                    <InfoRow
                      label="Google Ads"
                      value={enrichment.has_google_ads ? "Active" : "Not running"}
                    />
                  )}
                {enrichment?.has_meta_ads !== null &&
                  enrichment?.has_meta_ads !== undefined && (
                    <InfoRow
                      label="Meta Ads"
                      value={enrichment.has_meta_ads ? "Active" : "Not running"}
                    />
                  )}
                {enrichment?.has_contact_form !== null &&
                  enrichment?.has_contact_form !== undefined && (
                    <InfoRow
                      label="Contact form"
                      value={
                        enrichment.has_contact_form
                          ? enrichment.form_auto_reply
                            ? "Yes (auto-reply on)"
                            : "Yes (no auto-reply)"
                          : "None"
                      }
                    />
                  )}
                {qualification?.is_franchise !== null &&
                  qualification?.is_franchise !== undefined && (
                    <InfoRow
                      label="Franchise"
                      value={qualification.is_franchise ? "Yes" : "No"}
                    />
                  )}
                {qualification?.is_pe_backed !== null &&
                  qualification?.is_pe_backed !== undefined && (
                    <InfoRow
                      label="PE-backed"
                      value={qualification.is_pe_backed ? "Yes" : "No"}
                    />
                  )}
                <InfoRow
                  label="Pipeline"
                  value={<span className="capitalize">{business.pipeline_status}</span>}
                />
              </div>
            </section>

            {/* Contacts */}
            {contacts.length > 0 && (
              <section className="border-border rounded-lg border">
                <div className="border-border border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">Contacts ({contacts.length})</h2>
                </div>
                <div className="divide-border divide-y">
                  {contacts.map((c) => (
                    <div key={c.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{c.name}</p>
                          {c.title && (
                            <p className="text-muted-foreground text-xs">{c.title}</p>
                          )}
                        </div>
                        {c.is_primary_contact && (
                          <span className="bg-primary/10 text-primary shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                          >
                            <Mail className="h-3 w-3" />
                            {c.email}
                          </a>
                        )}
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                          >
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </a>
                        )}
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                            LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Google Maps */}
            {business.google_maps_url && (
              <a
                href={business.google_maps_url}
                target="_blank"
                rel="noreferrer"
                className="border-border hover:bg-muted/50 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View on Google Maps
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
