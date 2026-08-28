"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ContactDetail } from "@/components/campaign/contact-detail";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { CampaignContact } from "@/lib/types/campaign";

interface PersonDrawerProps {
  contact: CampaignContact | null;
  onClose: () => void;
  onEnrich?: (contactId: string) => void | Promise<void>;
  onRemove?: (personId: string) => void | Promise<void>;
}

export function PersonDrawer({
  contact,
  onClose,
  onEnrich,
  onRemove,
}: PersonDrawerProps) {
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Reset the confirm state whenever the drawer opens a different person
  // (or closes) so the "Are you sure?" never carries over to a new card.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmingRemove(false);
  }, [contact?.person_id]);

  async function handleEnrich(id: string) {
    if (!onEnrich) return;
    setEnrichingId(id);
    try {
      await Promise.resolve(onEnrich(id));
    } finally {
      setEnrichingId(null);
    }
  }

  async function handleRemove() {
    if (!contact || !onRemove) return;
    setRemoving(true);
    try {
      await Promise.resolve(onRemove(contact.person_id));
      onClose();
    } finally {
      setRemoving(false);
      setConfirmingRemove(false);
    }
  }

  // Overlay an "in_progress" status on the contact during the local enrich
  // round-trip so ContactDetail shows its loading state immediately rather
  // than waiting for the parent's re-fetch to land.
  const displayContact: CampaignContact | null =
    contact && enrichingId === contact.id
      ? { ...contact, enrichment_status: "in_progress" }
      : contact;

  return (
    <Sheet open={contact !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto p-0 sm:max-w-lg">
        {displayContact && (
          <>
            <SheetHeader>
              <SheetTitle>{displayContact.name}</SheetTitle>
              {displayContact.title && (
                <SheetDescription>{displayContact.title}</SheetDescription>
              )}
            </SheetHeader>
            <div className="px-4 pb-6">
              <ContactDetail
                contact={displayContact}
                onRetry={onEnrich ? handleEnrich : undefined}
                variant="sidebar"
              />
            </div>

            {onRemove && (
              <div className="border-border/60 mt-auto border-t px-4 py-3">
                {confirmingRemove ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      Remove{" "}
                      <span className="font-medium">{displayContact.name}</span>{" "}
                      from this company?
                    </p>
                    <p className="text-muted-foreground text-xs">
                      They&apos;ll disappear from the org chart and this
                      campaign. The person record stays in your knowledge base
                      for future research.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingRemove(false)}
                        disabled={removing}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleRemove}
                        disabled={removing}
                      >
                        {removing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {removing ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingRemove(true)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove from company
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
