"use client";

import { useState } from "react";
import { ChevronDown, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";
import { cn } from "@/lib/utils";
import type { Campaign } from "@/lib/types/campaign";

interface CampaignHeaderProps {
  campaign: Campaign;
  contactCount: number;
  companyCount: number;
  onDataChanged: () => void;
  onProfileChanged: (profileId: string | null) => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function DraftOutreachButton({ campaignName }: { campaignName: string }) {
  const { openAgentWith } = useCampaign();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        openAgentWith(
          `Draft acquisition outreach emails for all contacts in the "${campaignName}" mandate.`,
        )
      }
    >
      <Mail className="mr-1.5 h-3.5 w-3.5" />
      Draft Outreach
    </Button>
  );
}

export function CampaignHeader({
  campaign,
  contactCount,
  companyCount,
  onDataChanged: _onDataChanged,
  onProfileChanged: _onProfileChanged,
}: CampaignHeaderProps) {
  const [expanded, setExpanded] = useState(true);
  const icp = campaign.icp ?? {};
  const offering = campaign.offering ?? {};

  const summaryChips: string[] = [];
  if (icp.industry) summaryChips.push(icp.industry);
  if (icp.geography) summaryChips.push(icp.geography);
  if (icp.companySize) summaryChips.push(icp.companySize);

  const hasTargetProfile = summaryChips.length > 0;
  const hasThesis = !!offering.valueProposition;
  const hasDetails = hasTargetProfile || hasThesis;

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {campaign.name}
          </h1>
          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>
              {contactCount}{" "}
              {contactCount === 1 ? "decision maker" : "decision makers"}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>
              {companyCount} {companyCount === 1 ? "target" : "targets"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DraftOutreachButton campaignName={campaign.name} />
        </div>
      </div>

      {/* Collapsible brief */}
      {hasDetails && (
        <div className="border-border overflow-hidden rounded-lg border">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
          >
            <span className="text-muted-foreground shrink-0 text-xs font-medium uppercase tracking-wide">
              Brief
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {summaryChips.map((chip, i) => (
                <span
                  key={i}
                  className="bg-foreground/8 text-foreground inline-flex rounded-md px-2 py-0.5 text-xs"
                >
                  {chip}
                </span>
              ))}
              {!summaryChips.length && (
                <span className="text-muted-foreground text-xs">
                  Target profile and investment thesis
                </span>
              )}
            </div>
            <ChevronDown
              className={cn(
                "text-muted-foreground size-4 shrink-0 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>

          {expanded && (
            <div className="border-border bg-muted/30 grid gap-6 border-t p-4 md:grid-cols-2 md:p-5">
              {hasTargetProfile && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Target Profile</h3>
                  <div className="space-y-3">
                    {icp.industry && <Field label="Vertical" value={icp.industry} />}
                    {icp.geography && <Field label="Geography" value={icp.geography} />}
                    {icp.companySize && <Field label="Employee range" value={icp.companySize} />}
                  </div>
                </section>
              )}
              {hasThesis && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Investment Thesis</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {offering.valueProposition}
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
