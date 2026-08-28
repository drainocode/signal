"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface MandateRow {
  id: string;
  name: string;
  vertical: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  target_count: number;
  contact_count: number;
  verified_email_count: number;
  outreach_sent: number;
  top_score: number | null;
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    completed: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    draft: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
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

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  const cls = score >= 8
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : score >= 7 ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

export default function MandatesIndexPage() {
  const router = useRouter();
  const [mandates, setMandates] = useState<MandateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchMandates = async () => {
    try {
      const res = await fetch("/api/mandates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as MandateRow[];
      if (mountedRef.current) {
        setMandates(data);
        setLoading(false);
      }
    } catch (err) {
      console.error("[mandates-page] fetch failed:", err);
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchMandates();
    return () => { mountedRef.current = false; };
  }, []);

  const handleDelete = async (mandate: MandateRow) => {
    setDeletingId(mandate.id);
    try {
      const res = await fetch(`/api/mandates/${mandate.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMandates((prev) => prev.filter((m) => m.id !== mandate.id));
      toast.success(`Deleted "${mandate.name}"`);
    } catch (err) {
      toast.error("Failed to delete mandate");
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">All Mandates</h1>
            <p className="text-muted-foreground text-sm">
              Active acquisition mandates. Click a mandate to open it.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
          </div>
        ) : mandates.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No mandates yet</p>
            <p className="text-muted-foreground text-xs">
              Start a conversation and ask the agent to find acquisition targets.
            </p>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-medium">Mandate</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">Status</th>
                  <th className="hidden px-4 py-2.5 text-center font-medium md:table-cell">Targets</th>
                  <th className="hidden px-4 py-2.5 text-center font-medium md:table-cell">Decision Makers</th>
                  <th className="hidden px-4 py-2.5 text-center font-medium lg:table-cell">Verified Emails</th>
                  <th className="hidden px-4 py-2.5 text-center font-medium lg:table-cell">Outreach sent</th>
                  <th className="px-4 py-2.5 text-center font-medium">Top score</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Updated</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {mandates.map((mandate) => (
                  <tr
                    key={mandate.id}
                    onClick={() => router.push(`/campaigns/${mandate.id}`)}
                    className="border-border hover:bg-muted/30 border-b last:border-b-0 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{mandate.name}</div>
                      {mandate.vertical && (
                        <div className="text-muted-foreground text-xs capitalize">{mandate.vertical}</div>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <StatusPill status={mandate.status} />
                    </td>
                    <td className="hidden px-4 py-3 text-center tabular-nums md:table-cell">
                      {mandate.target_count || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-center tabular-nums md:table-cell">
                      {mandate.contact_count || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-center tabular-nums lg:table-cell">
                      {mandate.verified_email_count || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-center tabular-nums lg:table-cell">
                      {mandate.outreach_sent || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ScorePill score={mandate.top_score} />
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-3 text-right text-xs tabular-nums md:table-cell">
                      {timeAgo(mandate.updated_at)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Delete mandate"
                              disabled={deletingId === mandate.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DialogContent>
                          <DialogTitle>Delete mandate</DialogTitle>
                          <DialogDescription>
                            This will permanently delete &quot;{mandate.name}&quot; and all its linked targets. This cannot be undone.
                          </DialogDescription>
                          <DialogFooter>
                            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                            <Button
                              variant="destructive"
                              onClick={() => handleDelete(mandate)}
                              disabled={deletingId === mandate.id}
                            >
                              {deletingId === mandate.id ? "Deleting..." : "Delete"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
