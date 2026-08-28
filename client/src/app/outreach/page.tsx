"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  classifyDraft,
  type DraftRow,
} from "@/components/outreach/outreach-drafts-panel";
import { ReadyToSendHero } from "@/components/outreach/ready-to-send-hero";
import { OutreachTabs } from "@/components/outreach/outreach-tabs";

export interface SequenceRow {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name: string;
  enrolled: number;
  waiting: number;
  sent: number;
  replied: number;
}

export interface EnrollmentCard {
  id: string;
  sequence_id: string;
  person_id: string;
  campaign_people_id: string;
  current_step: number;
  status: string;
  next_send_at: string | null;
  person_name: string;
  person_title: string | null;
  company_name: string | null;
  outreach_status: string | null;
  sequence_name: string;
}

export default function OutreachPage() {
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentCard[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const supabase = createClient();

    const [
      seqsRes,
      enrollmentCountsRes,
      enrollmentsRes,
      draftsRes,
      stepRowsRes,
    ] = await Promise.all([
      // sequences joined with mandates (our campaign_id points to mandates)
      supabase
        .from("sequences")
        .select("id, name, status, campaign_id, mandates(name)")
        .order("created_at", { ascending: false }),

      // enrollment counts per sequence
      supabase.from("sequence_enrollments").select("sequence_id, status"),

      // active enrollments with person and company
      supabase
        .from("sequence_enrollments")
        .select(
          `
          id, sequence_id, person_id, campaign_people_id,
          current_step, status, next_send_at,
          people(name, title, organization_id, organizations(name)),
          campaign_people(outreach_status),
          sequences(name)
        `,
        )
        .in("status", ["waiting", "queued", "active", "replied"])
        .order("updated_at", { ascending: false }),

      // pending drafts for review
      supabase
        .from("email_drafts")
        .select(
          `
          id, subject, to_email, review_status, status, sent_at,
          enrollment_id, sequence_step_id,
          sequence_enrollments(next_send_at, sequence_id),
          sequence_steps(step_number),
          sequences(name),
          people(name, title, organizations(name))
        `,
        )
        .in("status", ["draft"])
        .order("created_at", { ascending: false })
        .limit(200),

      // step counts per sequence
      supabase.from("sequence_steps").select("sequence_id, step_number"),
    ]);

    if (!mountedRef.current) return;

    const seqs = seqsRes.data ?? [];
    const enrollmentRows = enrollmentCountsRes.data ?? [];
    const cards = enrollmentsRes.data ?? [];
    const rawDrafts = draftsRes.data ?? [];

    // Sequence counts
    const countsBySeq = new Map<
      string,
      { enrolled: number; waiting: number; sent: number; replied: number }
    >();
    for (const e of enrollmentRows) {
      const prev = countsBySeq.get(e.sequence_id) ?? {
        enrolled: 0,
        waiting: 0,
        sent: 0,
        replied: 0,
      };
      prev.enrolled++;
      if (e.status === "waiting" || e.status === "queued") prev.waiting++;
      if (e.status === "active") prev.sent++;
      if (e.status === "replied") prev.replied++;
      countsBySeq.set(e.sequence_id, prev);
    }

    // Total steps per sequence
    const totalStepsBySeq = new Map<string, number>();
    for (const s of stepRowsRes.data ?? []) {
      const cur = totalStepsBySeq.get(s.sequence_id) ?? 0;
      if (s.step_number > cur) totalStepsBySeq.set(s.sequence_id, s.step_number);
    }

    // Build SequenceRow array
    const sequenceRows: SequenceRow[] = seqs.map((s) => {
      const counts = countsBySeq.get(s.id) ?? {
        enrolled: 0,
        waiting: 0,
        sent: 0,
        replied: 0,
      };
      const mandate = s.mandates as unknown as { name: string } | null;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        campaign_id: s.campaign_id,
        campaign_name: mandate?.name ?? "Unknown",
        ...counts,
      };
    });

    // Build EnrollmentCard array
    const enrollmentCards: EnrollmentCard[] = cards.map((c) => {
      const person = c.people as unknown as {
        name: string;
        title: string | null;
        organization_id: string | null;
        organizations: { name: string } | null;
      } | null;
      const cp = c.campaign_people as unknown as {
        outreach_status: string;
      } | null;
      const seq = c.sequences as unknown as { name: string } | null;
      return {
        id: c.id,
        sequence_id: c.sequence_id,
        person_id: c.person_id,
        campaign_people_id: c.campaign_people_id,
        current_step: c.current_step,
        status: c.status,
        next_send_at: c.next_send_at,
        person_name: person?.name ?? "Unknown",
        person_title: person?.title ?? null,
        company_name: person?.organizations?.name ?? null,
        outreach_status: cp?.outreach_status ?? null,
        sequence_name: seq?.name ?? "",
      };
    });

    // Build DraftRow array — has_inbox always true for Model A
    const draftRows: DraftRow[] = rawDrafts.map((d) => {
      const person = d.people as unknown as {
        name: string;
        title: string | null;
        organizations: { name: string } | null;
      } | null;
      const enrollment = d.sequence_enrollments as unknown as {
        next_send_at: string | null;
        sequence_id: string | null;
      } | null;
      const step = d.sequence_steps as unknown as {
        step_number: number;
      } | null;
      const seq = d.sequences as unknown as { name: string } | null;
      const sequenceId = enrollment?.sequence_id ?? null;

      return {
        id: d.id,
        subject: d.subject ?? "",
        to_email: d.to_email ?? "",
        review_status: d.review_status as DraftRow["review_status"],
        status: d.status ?? "draft",
        person_name: person?.name ?? "Unknown",
        person_title: person?.title ?? null,
        company_name: person?.organizations?.name ?? null,
        sequence_id: sequenceId,
        sequence_name: seq?.name ?? null,
        next_send_at: enrollment?.next_send_at ?? null,
        step_number: step?.step_number ?? 1,
        total_steps: sequenceId ? (totalStepsBySeq.get(sequenceId) ?? 1) : 1,
        enrollment_id: d.enrollment_id ?? null,
        has_inbox: true, // Model A — always true, inbox configured via env
      };
    });

    setSequences(sequenceRows);
    setEnrollments(enrollmentCards);
    setDrafts(draftRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Poll every 10s while tab visible
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(load, 10_000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    if (document.visibilityState === "visible") start();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [load]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
            <p className="text-muted-foreground text-sm">
              Acquisition outreach across all mandates.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : sequences.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No outreach sequences yet</p>
            <p className="text-muted-foreground text-xs">
              Open a mandate and ask the agent to set up acquisition outreach.
            </p>
          </div>
        ) : (
          <>
            <ReadyToSendHero
              drafts={drafts.filter((d) => classifyDraft(d) === "ready")}
              onRefresh={load}
            />
            <OutreachTabs
              drafts={drafts}
              sequences={sequences}
              enrollments={enrollments}
              onRefresh={load}
            />
          </>
        )}
      </div>
    </div>
  );
}
