/**
 * lib/tools/tractus-tools.ts
 * Complete tool suite for the Tractus acquisition intelligence agent.
 * Uses service role client — tools run outside Clerk request context.
 */

import { tool } from "ai";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DISCOVERY — query businesses from the backend pipeline
// ─────────────────────────────────────────────────────────────────────────────

export const getBusinesses = tool({
  description:
    "Search and filter acquisition targets from the Tractus pipeline. Returns businesses with readiness scores and qualification data. Use this as the PRIMARY tool for finding acquisition targets — the backend has already discovered, enriched, and scored these businesses. Always call this first before any other discovery tool.",
  inputSchema: z.object({
    vertical: z
      .string()
      .optional()
      .describe("Industry vertical e.g. 'hvac', 'plumbing', 'dental', 'roofing'"),
    state: z
      .string()
      .optional()
      .describe("US state abbreviation e.g. 'TX', 'FL' or full name 'Texas'"),
    city: z.string().optional().describe("City name to filter by"),
    minScore: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .describe("Minimum readiness score 0-10. Use 7 for high priority, 8 for prime targets."),
    pipelineStatus: z
      .enum(["discovered", "qualified", "enriched", "scored", "contacted"])
      .optional()
      .describe("Filter by pipeline stage. 'scored' returns fully processed businesses."),
    qualifiedOnly: z
      .boolean()
      .optional()
      .describe("If true, only return LMM-qualified businesses"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20),
    offset: z.number().int().default(0),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    let query = supabase
      .from("businesses")
      .select(
        `id, name, website, phone, city, state, vertical,
        google_rating, review_count, pipeline_status, is_spending_on_ads,
        readiness_scores (
          readiness_score, tech_gap_score, hiring_signal_score,
          digital_presence_score, review_health_score, operational_score,
          benchmark_percentile, score_rationale, scored_at
        ),
        qualification_results (
          is_qualified, qualification_score, years_in_business,
          owner_operated_likelihood, employee_count_estimate,
          is_franchise, is_pe_backed, disqualification_reason
        )`,
      )
      .order("updated_at", { ascending: false });

    if (input.vertical) query = query.ilike("vertical", `%${input.vertical}%`);
    if (input.state)
      query = query.or(
        `state.ilike.%${input.state}%,state.eq.${input.state.toUpperCase()}`,
      );
    if (input.city) query = query.ilike("city", `%${input.city}%`);
    if (input.pipelineStatus) query = query.eq("pipeline_status", input.pipelineStatus);
    query = query.range(input.offset, input.offset + input.limit - 1);

    const { data, error } = await query;
    if (error) return { error: error.message, businesses: [] };

    let results = (data || []).map((b) => {
      const rs = Array.isArray(b.readiness_scores)
        ? b.readiness_scores[0]
        : b.readiness_scores;
      const qr = Array.isArray(b.qualification_results)
        ? b.qualification_results[0]
        : b.qualification_results;
      return {
        id: b.id,
        name: b.name,
        website: b.website,
        phone: b.phone,
        city: b.city,
        state: b.state,
        vertical: b.vertical,
        google_rating: b.google_rating,
        review_count: b.review_count,
        pipeline_status: b.pipeline_status,
        is_spending_on_ads: b.is_spending_on_ads,
        readiness_score: rs?.readiness_score ?? null,
        tech_gap_score: rs?.tech_gap_score ?? null,
        hiring_signal_score: rs?.hiring_signal_score ?? null,
        digital_presence_score: rs?.digital_presence_score ?? null,
        review_health_score: rs?.review_health_score ?? null,
        operational_score: rs?.operational_score ?? null,
        benchmark_percentile: rs?.benchmark_percentile ?? null,
        score_rationale: rs?.score_rationale ?? null,
        is_qualified: qr?.is_qualified ?? null,
        qualification_score: qr?.qualification_score ?? null,
        years_in_business: qr?.years_in_business ?? null,
        owner_operated_likelihood: qr?.owner_operated_likelihood ?? null,
        employee_count_estimate: qr?.employee_count_estimate ?? null,
        is_franchise: qr?.is_franchise ?? false,
        is_pe_backed: qr?.is_pe_backed ?? false,
        disqualification_reason: qr?.disqualification_reason ?? null,
      };
    });

    if (input.minScore !== undefined)
      results = results.filter(
        (b) => b.readiness_score !== null && b.readiness_score >= input.minScore!,
      );
    if (input.qualifiedOnly)
      results = results.filter((b) => b.is_qualified === true);

    results.sort((a, b) => (b.readiness_score ?? 0) - (a.readiness_score ?? 0));

    return { businesses: results, total: results.length };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. BUSINESS DETAIL
// ─────────────────────────────────────────────────────────────────────────────

export const getBusinessDetail = tool({
  description:
    "Get the full acquisition intelligence profile for a specific business — enrichment data, readiness score breakdown, qualification details, signal events, and contacts.",
  inputSchema: z.object({
    businessId: z.string().uuid(),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    const [bizRes, enrichRes, scoreRes, qualRes, signalsRes, contactsRes] =
      await Promise.all([
        supabase.from("businesses").select("*").eq("id", input.businessId).single(),
        supabase.from("enrichment_data").select("*").eq("business_id", input.businessId).single(),
        supabase.from("readiness_scores").select("*").eq("business_id", input.businessId).single(),
        supabase.from("qualification_results").select("*").eq("business_id", input.businessId).single(),
        supabase
          .from("signal_events")
          .select("id, signal_type, signal_category, severity, signal_content, impact_score, detected_at")
          .eq("business_id", input.businessId)
          .order("detected_at", { ascending: false })
          .limit(10),
        supabase
          .from("contacts")
          .select("id, name, title, email, email_verified, phone, linkedin_url, is_primary_contact, contact_score")
          .eq("business_id", input.businessId)
          .order("is_primary_contact", { ascending: false }),
      ]);

    if (bizRes.error || !bizRes.data) return { error: "Business not found" };

    return {
      business: bizRes.data,
      enrichment: enrichRes.data ?? null,
      readiness_score: scoreRes.data ?? null,
      qualification: qualRes.data ?? null,
      signals: signalsRes.data ?? [],
      contacts: contactsRes.data ?? [],
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONTACTS
// ─────────────────────────────────────────────────────────────────────────────

export const getContacts = tool({
  description:
    "Get decision makers and owners from the Tractus pipeline. Filter by business, mandate, email verification, or primary contact status.",
  inputSchema: z.object({
    businessId: z.string().uuid().optional(),
    mandateId: z.string().uuid().optional(),
    verifiedOnly: z.boolean().default(false),
    primaryOnly: z.boolean().default(false),
    limit: z.number().int().default(20),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    let bizIds: string[] | null = null;

    if (input.mandateId) {
      const { data: mbData } = await supabase
        .from("mandate_businesses")
        .select("business_id")
        .eq("mandate_id", input.mandateId)
        .eq("status", "active");
      bizIds = (mbData || []).map((r) => r.business_id);
      if (bizIds.length === 0) return { contacts: [], total: 0 };
    }

    let query = supabase
      .from("contacts")
      .select(
        `id, business_id, name, title, email, email_verified, email_source,
        phone, linkedin_url, is_primary_contact, contact_score,
        businesses ( name, city, state, vertical )`,
      )
      .limit(input.limit)
      .order("is_primary_contact", { ascending: false });

    if (input.businessId) query = query.eq("business_id", input.businessId);
    if (bizIds) query = query.in("business_id", bizIds);
    if (input.verifiedOnly) query = query.eq("email_verified", true);
    if (input.primaryOnly) query = query.eq("is_primary_contact", true);

    const { data, error } = await query;
    if (error) return { error: error.message, contacts: [] };
    return { contacts: data ?? [], total: data?.length ?? 0 };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SIGNAL EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export const getSignalEvents = tool({
  description:
    "Get acquisition intelligence signals detected by the backend pipeline — hiring activity, digital presence changes, review patterns, leadership signals.",
  inputSchema: z.object({
    businessId: z.string().uuid().optional(),
    mandateId: z.string().uuid().optional(),
    category: z.enum(["hiring", "digital", "reviews", "leadership", "all"]).default("all"),
    severity: z.enum(["high", "medium", "low", "all"]).default("all"),
    limit: z.number().int().default(20),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    let bizIds: string[] | null = null;
    if (input.mandateId) {
      const { data: mbData } = await supabase
        .from("mandate_businesses")
        .select("business_id")
        .eq("mandate_id", input.mandateId)
        .eq("status", "active");
      bizIds = (mbData || []).map((r) => r.business_id);
      if (bizIds.length === 0) return { signals: [], total: 0 };
    }

    let query = supabase
      .from("signal_events")
      .select(
        `id, business_id, signal_type, signal_category, signal_source,
        signal_content, severity, impact_score, detected_at,
        businesses ( name, city, state, vertical )`,
      )
      .order("detected_at", { ascending: false })
      .limit(input.limit);

    if (input.businessId) query = query.eq("business_id", input.businessId);
    if (bizIds) query = query.in("business_id", bizIds);
    if (input.category !== "all") query = query.eq("signal_category", input.category);
    if (input.severity !== "all") query = query.eq("severity", input.severity);

    const { data, error } = await query;
    if (error) return { error: error.message, signals: [] };
    return { signals: data ?? [], total: data?.length ?? 0 };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PIPELINE STATS
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStats = tool({
  description:
    "Get high-level stats across the entire Tractus pipeline — total businesses discovered, qualified, scored, contacts found, signals detected.",
  inputSchema: z.object({}),
  execute: async () => {
    const supabase = getServiceClient();

    const [bizRes, qualRes, scoreRes, contactRes, signalRes, outreachRes] =
      await Promise.all([
        supabase.from("businesses").select("pipeline_status"),
        supabase.from("qualification_results").select("is_qualified").eq("is_qualified", true),
        supabase.from("readiness_scores").select("readiness_score"),
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase.from("signal_events").select("signal_category"),
        supabase.from("outreach_queue").select("status"),
      ]);

    const scores = (scoreRes.data || []).map((s) => s.readiness_score).filter(Boolean);
    const avgScore =
      scores.length > 0
        ? Math.round((scores.reduce((a: number, b: number) => a + b, 0) / scores.length) * 10) / 10
        : null;

    const outreachByStatus: Record<string, number> = {};
    for (const row of outreachRes.data || []) {
      outreachByStatus[row.status] = (outreachByStatus[row.status] ?? 0) + 1;
    }

    const signalsByCategory: Record<string, number> = {};
    for (const row of signalRes.data || []) {
      signalsByCategory[row.signal_category] =
        (signalsByCategory[row.signal_category] ?? 0) + 1;
    }

    const statusCounts: Record<string, number> = {};
    for (const row of bizRes.data || []) {
      statusCounts[row.pipeline_status] = (statusCounts[row.pipeline_status] ?? 0) + 1;
    }

    return {
      businesses: {
        total: (bizRes.data || []).length,
        by_status: statusCounts,
        qualified: (qualRes.data || []).length,
        scored: scores.length,
        prime_targets: scores.filter((s) => s >= 8).length,
        high_priority: scores.filter((s) => s >= 7).length,
        avg_readiness_score: avgScore,
      },
      contacts: { total: contactRes.count ?? 0 },
      signals: { total: (signalRes.data || []).length, by_category: signalsByCategory },
      outreach: outreachByStatus,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. BENCHMARK
// ─────────────────────────────────────────────────────────────────────────────

export const getBenchmark = tool({
  description:
    "Compare acquisition targets within a vertical and region by readiness score dimensions. Can scope to a specific mandate.",
  inputSchema: z.object({
    vertical: z.string().optional(),
    state: z.string().optional(),
    mandateId: z.string().uuid().optional(),
    limit: z.number().int().default(20),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    let bizIds: string[] | null = null;
    if (input.mandateId) {
      const { data: mbData } = await supabase
        .from("mandate_businesses")
        .select("business_id")
        .eq("mandate_id", input.mandateId)
        .eq("status", "active");
      bizIds = (mbData || []).map((r) => r.business_id);
      if (bizIds.length === 0) return { businesses: [], stats: null };
    }

    let query = supabase
      .from("businesses")
      .select(
        `id, name, city, state, vertical,
        readiness_scores (
          readiness_score, tech_gap_score, hiring_signal_score,
          digital_presence_score, review_health_score, operational_score,
          benchmark_percentile, score_rationale
        )`,
      )
      .limit(input.limit);

    if (bizIds) query = query.in("id", bizIds);
    else query = query.eq("pipeline_status", "scored");
    if (input.vertical) query = query.ilike("vertical", `%${input.vertical}%`);
    if (input.state) query = query.ilike("state", `%${input.state}%`);

    const { data, error } = await query;
    if (error) return { error: error.message };

    const results = (data || [])
      .map((b) => {
        const rs = Array.isArray(b.readiness_scores) ? b.readiness_scores[0] : b.readiness_scores;
        return {
          id: b.id,
          name: b.name,
          city: b.city,
          state: b.state,
          vertical: b.vertical,
          readiness_score: rs?.readiness_score ?? 0,
          tech_gap_score: rs?.tech_gap_score ?? null,
          hiring_signal_score: rs?.hiring_signal_score ?? null,
          digital_presence_score: rs?.digital_presence_score ?? null,
          review_health_score: rs?.review_health_score ?? null,
          operational_score: rs?.operational_score ?? null,
          benchmark_percentile: rs?.benchmark_percentile ?? null,
          score_rationale: rs?.score_rationale ?? null,
        };
      })
      .filter((b) => b.readiness_score > 0)
      .sort((a, b) => b.readiness_score - a.readiness_score);

    const scores = results.map((r) => r.readiness_score);
    const stats =
      scores.length > 0
        ? {
            count: scores.length,
            average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
            prime_targets: scores.filter((s) => s >= 8).length,
            high_priority: scores.filter((s) => s >= 7).length,
          }
        : null;

    return { businesses: results, stats };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MANDATES
// ─────────────────────────────────────────────────────────────────────────────

export const createMandate = tool({
  description:
    "Create a new acquisition mandate with a vertical, target regions, investment thesis, and ICP criteria.",
  inputSchema: z.object({
    name: z.string(),
    vertical: z.string(),
    regions: z.array(z.string()),
    thesis: z.string().optional(),
    minScore: z.number().min(0).max(10).default(6),
    icp: z
      .object({
        minRevenue: z.string().optional(),
        maxRevenue: z.string().optional(),
        employeeRange: z.string().optional(),
        dealType: z.enum(["platform", "add-on", "either"]).optional().default("either"),
        ownerOperated: z.boolean().optional().default(true),
        excludeFranchises: z.boolean().optional().default(true),
        excludePeBacked: z.boolean().optional().default(true),
      })
      .optional(),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("mandates")
      .insert({
        name: input.name,
        vertical: input.vertical,
        regions: input.regions,
        thesis: input.thesis ?? null,
        min_score: input.minScore,
        icp: input.icp ?? {},
        is_active: true,
        status: "active",
      })
      .select()
      .single();

    if (error) return { error: error.message };
    return { mandate: data, message: `Mandate "${input.name}" created.` };
  },
});

export const getMandate = tool({
  description: "Get a mandate with its linked businesses.",
  inputSchema: z.object({ mandateId: z.string().uuid() }),
  execute: async (input) => {
    const supabase = getServiceClient();
    const [mandateRes, businessesRes] = await Promise.all([
      supabase.from("mandates").select("*").eq("id", input.mandateId).single(),
      supabase
        .from("mandate_businesses")
        .select(
          `id, relevance_score, relevance_reason, status, added_at,
          businesses (
            id, name, city, state, vertical, website, google_rating,
            readiness_scores ( readiness_score, benchmark_percentile, score_rationale )
          )`,
        )
        .eq("mandate_id", input.mandateId)
        .eq("status", "active")
        .order("relevance_score", { ascending: false }),
    ]);

    if (mandateRes.error) return { error: "Mandate not found" };
    return {
      mandate: mandateRes.data,
      businesses: businessesRes.data ?? [],
      business_count: businessesRes.data?.length ?? 0,
    };
  },
});

export const listMandates = tool({
  description: "List all acquisition mandates.",
  inputSchema: z.object({ activeOnly: z.boolean().default(true) }),
  execute: async (input) => {
    const supabase = getServiceClient();
    let query = supabase.from("mandates").select("*").order("updated_at", { ascending: false });
    if (input.activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) return { error: error.message, mandates: [] };

    const ids = (data || []).map((m) => m.id);
    const { data: counts } = await supabase
      .from("mandate_businesses")
      .select("mandate_id")
      .in("mandate_id", ids)
      .eq("status", "active");

    const countMap = new Map<string, number>();
    for (const row of counts || []) {
      countMap.set(row.mandate_id, (countMap.get(row.mandate_id) ?? 0) + 1);
    }

    return {
      mandates: (data || []).map((m) => ({ ...m, business_count: countMap.get(m.id) ?? 0 })),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ADD BUSINESSES TO MANDATE
// ─────────────────────────────────────────────────────────────────────────────

export const addBusinessToMandate = tool({
  description:
    "Add one or more businesses to a mandate with relevance scores and reasoning.",
  inputSchema: z.object({
    mandateId: z.string().uuid(),
    businesses: z
      .array(
        z.object({
          businessId: z.string().uuid(),
          relevanceScore: z.number().min(1).max(10),
          relevanceReason: z.string(),
        }),
      )
      .min(1)
      .max(20),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();
    const rows = input.businesses.map((b) => ({
      mandate_id: input.mandateId,
      business_id: b.businessId,
      relevance_score: b.relevanceScore,
      relevance_reason: b.relevanceReason,
      status: "active",
    }));

    const { data, error } = await supabase
      .from("mandate_businesses")
      .upsert(rows, { onConflict: "mandate_id,business_id" })
      .select();

    if (error) return { error: error.message };
    await supabase
      .from("mandates")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", input.mandateId);

    return { added: data?.length ?? 0, message: `Added ${data?.length ?? 0} businesses to mandate.` };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. MANDATE SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

export const getMandateSummary = tool({
  description: "Get performance stats for a mandate — business count, scores, contacts, outreach.",
  inputSchema: z.object({ mandateId: z.string().uuid() }),
  execute: async (input) => {
    const supabase = getServiceClient();

    const { data: mbData } = await supabase
      .from("mandate_businesses")
      .select("business_id, relevance_score")
      .eq("mandate_id", input.mandateId)
      .eq("status", "active");

    const bizIds = (mbData || []).map((r) => r.business_id);
    if (bizIds.length === 0)
      return { mandate_id: input.mandateId, business_count: 0, contact_count: 0, avg_score: null, prime_targets: 0, outreach_stats: { pending: 0, approved: 0, sent: 0, opened: 0, replied: 0 } };

    const [scoreRes, contactRes, outreachRes] = await Promise.all([
      supabase.from("readiness_scores").select("readiness_score").in("business_id", bizIds),
      supabase.from("contacts").select("id", { count: "exact", head: true }).in("business_id", bizIds),
      supabase.from("outreach_queue").select("status").eq("mandate_id", input.mandateId),
    ]);

    const scores = (scoreRes.data || []).map((s) => s.readiness_score).filter(Boolean);
    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((a: number, b: number) => a + b, 0) / scores.length) * 10) / 10
      : null;

    const outreachCounts = { pending: 0, approved: 0, sent: 0, opened: 0, replied: 0 };
    for (const row of outreachRes.data || []) {
      if (row.status in outreachCounts)
        outreachCounts[row.status as keyof typeof outreachCounts]++;
    }

    return {
      mandate_id: input.mandateId,
      business_count: bizIds.length,
      contact_count: contactRes.count ?? 0,
      avg_score: avgScore,
      prime_targets: scores.filter((s) => s >= 8).length,
      high_priority: scores.filter((s) => s >= 7).length,
      outreach_stats: outreachCounts,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. OUTREACH
// ─────────────────────────────────────────────────────────────────────────────

export const createOutreachSequence = tool({
  description:
    "Create an outreach sequence for a mandate. Writes to both outreach_sequences and Signal's sequences table so the outreach review UI works. Follow immediately with draftAcquisitionEmails, passing the signal_sequence_id from the response.",
  inputSchema: z.object({
    mandateId: z.string().uuid(),
    name: z.string(),
    totalSteps: z.number().int().min(1).max(5).default(3),
    userId: z.string().optional().describe("Clerk user ID — pass from request context if available"),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();
 
    // 1. Write to our outreach_sequences table
    const { data: ourSeq, error: ourErr } = await supabase
      .from("outreach_sequences")
      .insert({
        mandate_id: input.mandateId,
        name: input.name,
        status: "draft",
        total_steps: input.totalSteps,
      })
      .select()
      .single();
    if (ourErr) return { error: ourErr.message };
 
    // 2. Write to Signal's sequences table (what the outreach page reads)
    const { data: signalSeq, error: signalErr } = await supabase
      .from("sequences")
      .insert({
        campaign_id: input.mandateId,
        name: input.name,
        status: "draft",
        user_id: input.userId ?? "system",
      })
      .select()
      .single();
    if (signalErr) return { error: signalErr.message };
 
    // 3. Create sequence_steps — step 1 sends immediately, follow-ups 7 days apart
    const stepRows = Array.from({ length: input.totalSteps }, (_, i) => ({
      sequence_id: signalSeq.id,
      step_number: i + 1,
      delay_days: i === 0 ? 0 : 7,
      delay_hours: 0,
      condition: i === input.totalSteps - 1 ? "no_reply" : "always",
    }));
    await supabase.from("sequence_steps").insert(stepRows);
 
    return {
      sequence: ourSeq,
      signal_sequence_id: signalSeq.id,
      message: `Sequence "${input.name}" created with ${input.totalSteps} steps. Now call draftAcquisitionEmails with mandateId="${input.mandateId}" and signalSequenceId="${signalSeq.id}".`,
    };
  },
});

export const draftAcquisitionEmails = tool({
  description:
    "Generate personalized acquisition outreach emails for ALL steps of a sequence for all contacts in a mandate. Drafts every step (initial + follow-ups + breakup) in one call. Writes to both outreach_queue AND email_drafts so the /outreach/review UI shows all emails grouped by contact with delay connectors between steps.",
  inputSchema: z.object({
    mandateId: z.string().uuid(),
    sequenceId: z.string().uuid().optional().describe("outreach_sequences ID"),
    signalSequenceId: z.string().uuid().optional().describe("Signal sequences ID — from signal_sequence_id in createOutreachSequence response"),
    senderName: z.string(),
    senderTitle: z.string(),
    firmName: z.string().optional().describe("PE firm name e.g. 'Atlantic Capital'"),
    thesis: z.string().optional(),
    userId: z.string().optional(),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();
 
    // Get all sequence steps so we can link email_drafts correctly
    let allStepRows: Array<{ id: string; step_number: number }> = [];
    let totalSteps = 3;
    if (input.signalSequenceId) {
      const { data: steps } = await supabase
        .from("sequence_steps")
        .select("id, step_number")
        .eq("sequence_id", input.signalSequenceId)
        .order("step_number");
      allStepRows = steps ?? [];
      totalSteps = allStepRows.length || 3;
    }
 
    // Get all businesses in mandate with contacts and enrichment
    const { data: mbData } = await supabase
      .from("mandate_businesses")
      .select(
        `business_id, relevance_score, relevance_reason,
        businesses (
          id, name, city, state, vertical, website, google_rating, review_count,
          enrichment_data ( website_title, website_description, tech_gap_detected, has_google_ads ),
          readiness_scores ( readiness_score, score_rationale, hiring_signal_score, tech_gap_score ),
          signal_events ( signal_type, signal_category, signal_content, severity, impact_score, detected_at ),
          qualification_results ( years_in_business, owner_operated_likelihood, employee_count_estimate ),
          contacts ( id, name, title, email, email_verified, is_primary_contact )
        )`,
      )
      .eq("mandate_id", input.mandateId)
      .eq("status", "active");
 
    if (!mbData || mbData.length === 0) {
      return { error: "No businesses in this mandate. Add businesses first with addBusinessToMandate." };
    }
 
    const drafted: Array<{ business: string; contact: string; email: string; steps: number }> = [];
    const skipped: Array<{ business: string; reason: string }> = [];
 
    for (const mb of mbData) {
      const biz = Array.isArray(mb.businesses) ? mb.businesses[0] : mb.businesses;
      if (!biz) continue;
 
      type BizContact = { id: string; name: string; title?: string | null; email: string; email_verified: boolean; is_primary_contact: boolean };
      const contacts = ((biz as { contacts?: BizContact[] }).contacts || [])
        .filter((c) => c.email && (c.email_verified || c.is_primary_contact));
 
      if (contacts.length === 0) {
        skipped.push({ business: (biz as { name: string }).name, reason: "No verified email found" });
        continue;
      }
 
      type BizShape = {
        id: string; name: string; city: string | null; state: string | null; vertical: string;
        google_rating: number | null; review_count: number | null; website: string | null;
        enrichment_data?: { tech_gap_detected?: boolean } | Array<{ tech_gap_detected?: boolean }>;
        readiness_scores?: { readiness_score?: number; score_rationale?: string; hiring_signal_score?: number; tech_gap_score?: number } | Array<{ readiness_score?: number; score_rationale?: string; hiring_signal_score?: number; tech_gap_score?: number }>;
        signal_events?: Array<{ signal_content: string; impact_score: number | null }>;
        qualification_results?: { years_in_business?: number | null } | Array<{ years_in_business?: number | null }>;
      };
      const b = biz as BizShape;
 
      const qual = Array.isArray(b.qualification_results) ? b.qualification_results[0] : b.qualification_results;
      const enrichment = Array.isArray(b.enrichment_data) ? b.enrichment_data[0] : b.enrichment_data;
      const rs = Array.isArray(b.readiness_scores) ? b.readiness_scores[0] : b.readiness_scores;
      const topSignal = ((b.signal_events || []) as Array<{ signal_content: string; impact_score: number | null }>)
        .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))[0];
      const primaryContact = contacts.find((c) => c.is_primary_contact) || contacts[0];
 
      // ── Personalisation hooks — ranked by signal strength ─────────────────
      type ScoredHook = { text: string; score: number };
      const rankedHooks: ScoredHook[] = [];
 
      if (topSignal?.signal_content) {
        rankedHooks.push({
          text: topSignal.signal_content.slice(0, 140),
          score: (topSignal as { impact_score?: number | null }).impact_score ?? 5,
        });
      }
      if (enrichment?.tech_gap_detected) {
        rankedHooks.push({ text: `running a largely manual operation with significant upside through technology`, score: 9 });
      }
      const hiringScore = rs?.hiring_signal_score ?? 0;
      if (hiringScore >= 7) {
        rankedHooks.push({ text: `actively growing your team`, score: hiringScore });
      }
      if (qual?.years_in_business && qual.years_in_business >= 15) {
        rankedHooks.push({ text: `${qual.years_in_business} years building ${b.name}`, score: 7 });
      } else if (qual?.years_in_business) {
        rankedHooks.push({ text: `${qual.years_in_business} years in the ${verticalLabel(b.vertical)} space`, score: 5 });
      }
      if (b.google_rating && b.review_count && b.review_count >= 50) {
        rankedHooks.push({ text: `${b.google_rating}-star reputation across ${b.review_count} customer reviews`, score: 6 });
      }
      rankedHooks.sort((a, b) => b.score - a.score);
      const hooks = rankedHooks.map((h) => h.text);
 
      const vLabel = verticalLabel(b.vertical);
      const signOff = [input.senderName, [input.senderTitle, input.firmName].filter(Boolean).join(", ")].filter(Boolean).join("\n");
      const firstName = primaryContact.name?.split(" ")[0] ?? "there";
      const firmPrefix = input.firmName ? `${input.firmName} — ` : "";
      const location = [b.city, b.state].filter(Boolean).join(", ");
      const locationStr = location || (b.state ?? "the region");
 
      const leadHook = hooks[0]
        ? `I came across ${b.name} and noticed ${hooks[0]}.`
        : `I came across ${b.name} while researching ${vLabel} operators in ${b.state ?? "the region"}.`;
      const supportingHook = hooks[1]
        ? `I also noted ${hooks[1]} — that kind of track record is exactly what we look for.`
        : `Businesses with ${b.name}'s profile are exactly what we focus on.`;
 
      const aiReasoning = [rs?.score_rationale, hooks[0] ? `Lead hook: ${hooks[0]}` : null].filter(Boolean).join(" — ") || null;
 
      // ── Upsert organization ───────────────────────────────────────────────
      let orgId: string | null = null;
      const { data: existingOrg } = await supabase.from("organizations").select("id").eq("business_id", b.id).maybeSingle();
      if (existingOrg) {
        orgId = existingOrg.id;
      } else {
        let domain: string | null = null;
        try { domain = b.website ? new URL(b.website).hostname.replace("www.", "") : null; } catch { /* skip */ }
        const { data: newOrg } = await supabase.from("organizations").insert({
          business_id: b.id, name: b.name, domain, url: b.website,
          industry: b.vertical, location: locationStr,
        }).select("id").single();
        orgId = newOrg?.id ?? null;
      }
      if (orgId) {
        await supabase.from("campaign_organizations").upsert({
          campaign_id: input.mandateId, organization_id: orgId,
          relevance_score: mb.relevance_score, score_reason: mb.relevance_reason, status: "active",
        }, { onConflict: "campaign_id,organization_id" });
      }
 
      // ── Upsert person ─────────────────────────────────────────────────────
      let personId: string | null = null;
      const { data: existingPerson } = await supabase.from("people").select("id").eq("contact_id", primaryContact.id).maybeSingle();
      if (existingPerson) {
        personId = existingPerson.id;
      } else {
        const { data: newPerson } = await supabase.from("people").insert({
          contact_id: primaryContact.id, organization_id: orgId,
          name: primaryContact.name, title: primaryContact.title ?? null,
          work_email: primaryContact.email,
          work_email_confidence: primaryContact.email_verified ? 0.99 : 0.7,
          enrichment_status: "enriched", user_id: input.userId ?? "system",
        }).select("id").single();
        personId = newPerson?.id ?? null;
      }
      if (!personId) {
        skipped.push({ business: b.name, reason: "Failed to create person record" });
        continue;
      }
 
      // ── Upsert campaign_people ─────────────────────────────────────────────
      let campaignPeopleId: string | null = null;
      const { data: existingCp } = await supabase.from("campaign_people").select("id").eq("campaign_id", input.mandateId).eq("person_id", personId).maybeSingle();
      if (existingCp) {
        campaignPeopleId = existingCp.id;
      } else {
        const { data: newCp } = await supabase.from("campaign_people").insert({
          campaign_id: input.mandateId, person_id: personId,
          outreach_status: "not_contacted",
          priority_score: rs?.readiness_score ?? null,
          score_reason: rs?.score_rationale ?? null,
        }).select("id").single();
        campaignPeopleId = newCp?.id ?? null;
      }
 
      // ── Upsert sequence_enrollment ────────────────────────────────────────
      let enrollmentId: string | null = null;
      if (input.signalSequenceId) {
        const { data: existingEnroll } = await supabase.from("sequence_enrollments").select("id").eq("sequence_id", input.signalSequenceId).eq("person_id", personId).maybeSingle();
        if (existingEnroll) {
          enrollmentId = existingEnroll.id;
        } else {
          const { data: newEnroll } = await supabase.from("sequence_enrollments").insert({
            sequence_id: input.signalSequenceId, person_id: personId,
            campaign_people_id: campaignPeopleId, current_step: 1, status: "waiting",
          }).select("id").single();
          enrollmentId = newEnroll?.id ?? null;
        }
      }
 
      // ── Draft ALL steps for this contact ──────────────────────────────────
      let stepsWritten = 0;
      for (let stepNum = 1; stepNum <= totalSteps; stepNum++) {
        const stepRow = allStepRows.find((s) => s.step_number === stepNum);
 
        let subject: string;
        let emailBodyText: string;
 
        if (stepNum === 1) {
          subject = `${firmPrefix}${b.name} — Ownership Transition Conversation`;
          emailBodyText = [
            `Hi ${firstName},`,
            ``,
            leadHook,
            ``,
            `We work with ${vLabel} business owners in ${locationStr} who are exploring ownership transitions — whether that is a full exit, a partial sale, or simply understanding what options exist. We are not brokers. We work directly with owners and move quietly.`,
            ``,
            `Would you be open to a brief conversation? No agenda, just a chance to learn more about your plans.`,
            ``,
            `Best,`,
            signOff,
          ].join("\n");
        } else if (stepNum === totalSteps) {
          // Final step — breakup email
          subject = `${b.name} — One Last Note`;
          emailBodyText = [
            `Hi ${firstName},`,
            ``,
            `I have reached out a couple of times — I will keep this brief.`,
            ``,
            `If the timing is not right or you are simply not interested, I completely understand. I will not follow up again.`,
            ``,
            `If that ever changes and you want to explore your options, feel free to reach out directly.`,
            ``,
            `Wishing you continued success.`,
            ``,
            signOff,
          ].join("\n");
        } else {
          // Middle follow-up steps
          subject = `Re: ${b.name} — Following Up`;
          emailBodyText = [
            `Hi ${firstName},`,
            ``,
            `I wanted to follow up on my note from last week. I understand you are busy running the business.`,
            ``,
            supportingHook,
            ``,
            `Even if the timing is not right today, many owners find it valuable just to understand their options. There is no obligation in a conversation.`,
            ``,
            `Would a 15-minute call work this week?`,
            ``,
            `Best,`,
            signOff,
          ].join("\n");
        }
 
        const bodyHtml = emailBodyText
          .split("\n\n").map((p) => p.trim()).filter(Boolean)
          .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
 
        // Write to outreach_queue
        await supabase.from("outreach_queue").insert({
          business_id: b.id, contact_id: primaryContact.id,
          mandate_id: input.mandateId, sequence_id: input.sequenceId ?? null,
          subject, email_body: emailBodyText,
          personalisation_hooks: hooks, sequence_step: stepNum, status: "pending",
        });
 
        // Write to email_drafts
        if (input.signalSequenceId && personId) {
          await supabase.from("email_drafts").insert({
            sequence_id: input.signalSequenceId,
            sequence_step_id: stepRow?.id ?? null,
            enrollment_id: enrollmentId,
            person_id: personId,
            campaign_id: input.mandateId,
            campaign_people_id: campaignPeopleId,
            user_id: input.userId ?? "system",
            to_email: primaryContact.email,
            subject, body_html: bodyHtml, body_text: emailBodyText,
            ai_reasoning: stepNum === 1 ? aiReasoning : null,
            review_status: "pending", status: "draft",
          });
        }
 
        stepsWritten++;
      }
 
      drafted.push({ business: b.name, contact: primaryContact.name, email: primaryContact.email, steps: stepsWritten });
    }
 
    // Mark sequence active
    if (input.signalSequenceId && drafted.length > 0) {
      await supabase.from("sequences").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", input.signalSequenceId);
    }
 
    return {
      drafted: drafted.length,
      total_steps: totalSteps,
      skipped: skipped.length,
      skipped_details: skipped,
      drafted_details: drafted,
      signal_sequence_id: input.signalSequenceId ?? null,
      message: `Drafted ${drafted.length * totalSteps} emails (${totalSteps} steps × ${drafted.length} contacts).${skipped.length > 0 ? ` ${skipped.length} skipped — no verified email.` : ""}`,
    };
  },
});

// Helper — properly case vertical label
function verticalLabel(vertical: string): string {
  return (vertical ?? "")
    .split(" ")
    .map((w: string) => {
      if (["hvac", "ac", "it", "seo", "roi"].includes(w.toLowerCase())) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}
 

export const getOutreachQueue = tool({
  description: "Get outreach emails in the queue. Filter by mandate and status.",
  inputSchema: z.object({
    mandateId: z.string().uuid().optional(),
    status: z.enum(["pending", "approved", "sent", "opened", "replied", "bounced", "all"]).default("pending"),
    limit: z.number().int().default(20),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    let query = supabase
      .from("outreach_queue")
      .select(
        `id, subject, email_body, status, sequence_step,
        personalisation_hooks, created_at, sent_at, opened_at, replied_at,
        businesses ( name, city, state, vertical ),
        contacts ( name, title, email )`,
      )
      .order("created_at", { ascending: false })
      .limit(input.limit);

    if (input.mandateId) query = query.eq("mandate_id", input.mandateId);
    if (input.status !== "all") query = query.eq("status", input.status);

    const { data, error } = await query;
    if (error) return { error: error.message, emails: [] };
    return { emails: data ?? [], total: data?.length ?? 0 };
  },
});

export const approveBulkOutreach = tool({
  description: "Approve all pending email drafts for a mandate. Call only after user confirms.",
  inputSchema: z.object({
    mandateId: z.string().uuid(),
    sequenceStep: z.number().int().optional(),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();

    let query = supabase
      .from("outreach_queue")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("mandate_id", input.mandateId)
      .eq("status", "pending");

    if (input.sequenceStep) query = query.eq("sequence_step", input.sequenceStep);

    const { data, error } = await query.select("id");
    if (error) return { error: error.message };
    return { approved: data?.length ?? 0, message: `${data?.length ?? 0} emails approved and ready to send from /outreach.` };
  },
});

export const updateBusinessStatus = tool({
  description: "Update the pipeline status of a business.",
  inputSchema: z.object({
    businessId: z.string().uuid(),
    status: z.enum(["discovered", "qualified", "enriched", "scored", "contacted", "rejected"]),
  }),
  execute: async (input) => {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from("businesses")
      .update({ pipeline_status: input.status, updated_at: new Date().toISOString() })
      .eq("id", input.businessId);

    if (error) return { error: error.message };
    return { success: true, status: input.status };
  },
});
