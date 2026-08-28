"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { PriorityCallout } from "@/components/ui/priority-callout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  CampaignCompany,
  CompanyEnrichmentData,
} from "@/lib/types/campaign";

const LINK_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface CompanyDetailProps {
  company: CampaignCompany;
  onRefresh?: (companyId: string) => void;
  isRefreshing?: boolean;
}

export function CompanyDetail({ company }: CompanyDetailProps) {
  const data = company.enrichment_data as CompanyEnrichmentData | undefined;
  const [showAllJobs, setShowAllJobs] = useState(false);

  if (!data || !("enrichedAt" in data)) {
    return (
      <div className="text-muted-foreground px-4 py-4 text-center text-sm">
        No enrichment data yet. Ask the agent to run enrichment on this target.
      </div>
    );
  }

  const hiring = data.hiring;
  const jobsToShow = hiring
    ? showAllJobs ? hiring.jobs : hiring.jobs.slice(0, 10)
    : [];

  const tractus = (data as Record<string, unknown>)._tractus as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4 px-4 py-4">
      {/* Priority callout + enriched date */}
      <div className="flex items-start justify-between gap-3">
        <PriorityCallout
          score={company.relevance_score}
          reason={company.score_reason}
          className="flex-1"
        />
        {data.enrichedAt && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            Enriched {formatDate(data.enrichedAt)}
          </span>
        )}
      </div>

      {/* Acquisition Signals */}
      {tractus && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Signals</h4>
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                {
                  label: "Tech Gap",
                  score: tractus.tech_gap_score as number | null,
                  detail: tractus.tech_gap_detected
                    ? "No field service, scheduling, or CRM software detected. Deploying ServiceTitan or similar post-acquisition could drive 15-25% margin expansion."
                    : "Some digital infrastructure present. Moderate tech gap opportunity.",
                },
                {
                  label: "Hiring Signals",
                  score: tractus.hiring_signal_score as number | null,
                  detail: (tractus.hiring_signal_score as number ?? 0) >= 8
                    ? "Actively hiring across service technician and operational roles — strong growth momentum."
                    : "Moderate hiring activity detected.",
                },
                {
                  label: "Digital Presence",
                  score: tractus.digital_presence_score as number | null,
                  detail: (tractus.digital_presence_score as number ?? 0) >= 7
                    ? "Active digital footprint including paid ads and social channels."
                    : "Limited digital marketing and online presence. Post-acquisition improvement opportunity.",
                },
                {
                  label: "Review Health",
                  score: tractus.review_health_score as number | null,
                  detail: [
                    tractus.google_rating ? `${tractus.google_rating} stars` : null,
                    tractus.review_count ? `${tractus.review_count} reviews` : null,
                    (tractus.review_health_score as number ?? 0) >= 8
                      ? "Exceptional customer loyalty and word-of-mouth dominance."
                      : "Solid review presence.",
                  ].filter(Boolean).join(" · "),
                },
              ] as { label: string; score: number | null; detail: string }[]
            )
              .filter((s) => s.score !== null)
              .map((signal) => (
                <div key={signal.label} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                      {signal.label}
                    </h5>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      (signal.score ?? 0) >= 8
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : (signal.score ?? 0) >= 6
                          ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                          : "bg-muted text-muted-foreground",
                    )}>
                      {signal.score}/10
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{signal.detail}</p>
                </div>
              ))}

            {tractus.years_in_business && (
              <div className="space-y-1">
                <h5 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Succession Signal
                </h5>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {tractus.years_in_business as number} years in business
                  {tractus.owner_operated === "high"
                    ? " · High owner-operated likelihood — classic succession opportunity."
                    : "."}
                </p>
              </div>
            )}

            {tractus.score_rationale && (
              <div className="space-y-1 md:col-span-2">
                <h5 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Acquisition Rationale
                </h5>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {tractus.score_rationale as string}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Open positions — only populated by Signal's enrichment, empty for Tractus */}
      {hiring && hiring.jobs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Open positions ({hiring.jobs.length})
            </h4>
            {hiring.careersUrl && (
              <a
                href={hiring.careersUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors",
                  LINK_FOCUS,
                )}
              >
                View careers page
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {jobsToShow.map((job, i) => (
              <div key={i} className="border-border rounded-md border px-2.5 py-2 text-xs">
                <p className="font-medium">{job.title}</p>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {job.department && <span>{job.department}</span>}
                  {job.department && job.location && <span className="text-muted-foreground/40">·</span>}
                  {job.location && <span>{job.location}</span>}
                </div>
              </div>
            ))}
          </div>
          {hiring.jobs.length > 10 && (
            <Button variant="ghost" size="xs" onClick={() => setShowAllJobs((v) => !v)}>
              {showAllJobs ? "Show fewer" : `Show ${hiring.jobs.length - 10} more`}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
