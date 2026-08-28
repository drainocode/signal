"use client";

import { ExternalLink, Linkedin, Mail, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignContact } from "@/lib/types/campaign";

const LINK_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

interface ContactDetailProps {
  contact: CampaignContact;
  onRetry?: (contactId: string) => void;
  variant?: "wide" | "sidebar";
}

export function ContactDetail({ contact, variant = "wide" }: ContactDetailProps) {
  const isSidebar = variant === "sidebar";
  const containerClass = isSidebar
    ? "space-y-3 px-4 pb-4 pt-2"
    : "space-y-4 py-4";

  const email = contact.work_email;
  const emailVerified = !!contact.work_email_verified_at;
  const linkedin = contact.linkedin_url;

  const outreachStatusLabel: Record<string, { label: string; cls: string }> = {
    pending: { label: "Not contacted", cls: "bg-muted text-muted-foreground" },
    sent: { label: "Email sent", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
    opened: { label: "Email opened", cls: "bg-purple-500/10 text-purple-700 dark:text-purple-400" },
    replied: { label: "Replied", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
    bounced: { label: "Bounced", cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
  };
  const outreachBadge = outreachStatusLabel[contact.outreach_status ?? "pending"] ?? outreachStatusLabel.pending;

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{contact.name}</p>
          {contact.title && (
            <p className="text-muted-foreground text-sm">{contact.title}</p>
          )}
        </div>
        <span className={cn("inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", outreachBadge.cls)}>
          {outreachBadge.label}
        </span>
      </div>

      {/* Contact info */}
      <div className="space-y-2">
        {email ? (
          <div className="flex items-center gap-2">
            {emailVerified
              ? <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              : <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            }
            <a
              href={`mailto:${email}`}
              className={cn("truncate font-mono text-sm hover:underline", LINK_FOCUS)}
            >
              {email}
            </a>
            <span className={cn(
              "shrink-0 text-xs",
              emailVerified ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}>
              {emailVerified ? "Verified" : "Unverified"}
            </span>
          </div>
        ) : (
          <div className="text-muted-foreground flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="text-sm">No email found</span>
          </div>
        )}

        {linkedin && (
          <div className="flex items-center gap-2">
            <Linkedin className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <a
              href={linkedin.startsWith("http") ? linkedin : `https://linkedin.com/in/${linkedin.replace(/^\//, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "text-muted-foreground hover:text-foreground text-sm transition-colors hover:underline",
                LINK_FOCUS,
              )}
            >
              LinkedIn profile
              <ExternalLink className="ml-1 inline h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* Priority score */}
      {contact.priority_score !== null && contact.priority_score !== undefined && (
        <div className="border-border border-t pt-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Contact score
            </span>
            <span className={cn(
              "text-sm font-semibold tabular-nums",
              contact.priority_score >= 8
                ? "text-emerald-600 dark:text-emerald-400"
                : contact.priority_score >= 6
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-muted-foreground",
            )}>
              {contact.priority_score}/10
            </span>
          </div>
        </div>
      )}

      {/* No data fallback */}
      {!email && !linkedin && (
        <p className="text-muted-foreground text-sm">
          No contact information found. Reach this owner via direct call or through a broker.
        </p>
      )}
    </div>
  );
}
