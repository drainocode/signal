"use client";

import { Fragment, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";

import { ContactDetail } from "@/components/campaign/contact-detail";
import {
  enrichmentStatusStyles,
  type EnrichmentStatus,
} from "@/lib/status-styles";
import type { CampaignContact } from "@/lib/types/campaign";

interface ContactsTableProps {
  contacts: CampaignContact[];
  onContactEnriched: (contactId: string, data: CampaignContact) => void;
}

export function ContactsTable({
  contacts,
  onContactEnriched: _onContactEnriched,
}: ContactsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (contacts.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        No decision makers found. Stage 3 contact discovery did not find a verified owner email. Reach out via direct call or LinkedIn.
      </div>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[540px] text-sm">
        <thead>
          <tr className="border-border bg-muted/50 border-b">
            <th className="w-8 px-3 py-2.5" />
            <th className="px-3 py-2.5 text-left font-medium">Name</th>
            <th className="px-3 py-2.5 text-left font-medium">Title</th>
            <th className="px-3 py-2.5 text-left font-medium">Email</th>
            <th className="px-3 py-2.5 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => {
            const isExpanded = expandedIds.has(contact.id);
            const enrichment =
              enrichmentStatusStyles[
                contact.enrichment_status as EnrichmentStatus
              ] ?? enrichmentStatusStyles.pending;

            return (
              <Fragment key={contact.id}>
                <tr
                  className="border-border hover:bg-muted/30 cursor-pointer border-b transition-colors last:border-b-0"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpand(contact.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpand(contact.id);
                    }
                  }}
                >
                  <td className="px-3 py-2.5">
                    <ChevronRight
                      className={`text-muted-foreground h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{contact.name}</span>
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url.startsWith("http") ? contact.linkedin_url : `https://linkedin.com/in/${contact.linkedin_url.replace(/^\//, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 text-sm">
                    {contact.title || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {contact.work_email || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full ${enrichment.className}`} />
                      {enrichment.label}
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-border border-b last:border-b-0">
                    <td colSpan={5} className="bg-muted/20 px-4">
                      <ContactDetail contact={contact} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
