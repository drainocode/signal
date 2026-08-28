/**
 * lib/tools/workspace-tool.ts
 *
 * ONE row per chat session for discovery flow.
 * Status is stored as a field inside the same row as intelligence.
 * The frontend reads status from the row and shows/hides the overlay.
 * When intelligence data arrives, status gets cleared automatically.
 */

import { tool } from "ai";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";

export const publishWorkspaceView = tool({
  description: `Push data to the right workspace panel. This drives what the user sees on the right side of the screen.

CRITICAL RULES:
1. There is only ONE workspace row per chat for discovery. Use viewType="intelligence" for BOTH status updates AND results — the same row holds everything.
2. When starting a new stage, call with viewType="intelligence" and set the "currentStage" field to show the animated overlay.
3. When you have real data, call with viewType="intelligence" and set the "businesses" array — this clears the overlay automatically.
4. For mandate: call with viewType="mandate" — this creates a SECOND tab (Mandate tab).
5. For outreach: call with viewType="outreach" — this creates a THIRD tab (Outreach tab).
6. NEVER call with viewType="status" — that view type is removed.
7. The chatId comes from the request body — always pass it.

Workflow example:
- Stage starts → publishWorkspaceView(viewType="intelligence", currentStage={stage:"Searching pipeline", progress:10})
- getBusinesses returns → publishWorkspaceView(viewType="intelligence", businesses=[...], summary={...}, currentStage=null)
- Stage 2 starts → publishWorkspaceView(viewType="intelligence", currentStage={stage:"Pulling enrichment", progress:40}, keep existing businesses)
- contacts ready → publishWorkspaceView(viewType="intelligence", contacts=[...], currentStage=null)
- Mandate created → publishWorkspaceView(viewType="mandate", mandateId="...", tabLabel="HVAC Dallas Mandate")
- Emails drafted → publishWorkspaceView(viewType="outreach", mandateId="...", tabLabel="Outreach Queue")`,

  inputSchema: z.object({
    chatId: z.string().describe("Chat session ID from the request body"),
    viewType: z.enum(["intelligence", "mandate", "outreach"]),
    tabLabel: z.string().describe("Label for this tab"),
    mandateId: z.string().uuid().optional(),

    // Current stage — shown as animated overlay when set, hidden when null
    currentStage: z.object({
      stage: z.string(),
      detail: z.string().optional(),
      progress: z.number().min(0).max(100).optional(),
    }).nullable().optional().describe("Set to show animated overlay. Set to null when real data is ready."),

    // Intelligence data — builds up progressively
    summary: z.object({
      total: z.number(),
      qualified: z.number(),
      prime_targets: z.number(),
      avg_score: z.number().nullable(),
    }).optional(),

    businesses: z.array(z.object({
      id: z.string(),
      name: z.string(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      vertical: z.string().nullable(),
      readiness_score: z.number().nullable(),
      benchmark_percentile: z.number().nullable(),
      is_qualified: z.boolean().nullable(),
      years_in_business: z.number().nullable(),
      owner_operated_likelihood: z.string().nullable(),
      google_rating: z.number().nullable(),
      review_count: z.number().nullable(),
      tech_gap_score: z.number().nullable(),
      hiring_signal_score: z.number().nullable(),
      score_rationale: z.string().nullable(),
    })).optional(),

    contacts: z.array(z.object({
      id: z.string(),
      name: z.string(),
      title: z.string().nullable(),
      business_name: z.string().nullable(),
      email: z.string().nullable(),
      email_verified: z.boolean(),
      is_primary_contact: z.boolean(),
    })).optional(),

    recommendation: z.string().nullable().optional(),
  }),

  execute: async (input) => {
    const supabase = getServiceClient();
    const now = new Date().toISOString();

    // For intelligence: always one row per chat. Fetch existing to merge data.
    if (input.viewType === "intelligence") {
      const { data: existing } = await supabase
        .from("workspace_views")
        .select("id, data")
        .eq("chat_id", input.chatId)
        .eq("view_type", "intelligence")
        .single();

      // Merge: keep existing businesses/contacts unless new ones provided
      const existingData = (existing?.data ?? {}) as Record<string, unknown>;
      const existingIntelligence = (existingData.intelligence ?? {}) as Record<string, unknown>;

      const mergedIntelligence = {
        ...existingIntelligence,
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.businesses !== undefined ? { businesses: input.businesses } : {}),
        ...(input.contacts !== undefined ? { contacts: input.contacts } : {}),
        ...(input.recommendation !== undefined ? { recommendation: input.recommendation } : {}),
      };

      const newData = {
        intelligence: mergedIntelligence,
        // currentStage drives the animated overlay
        // null means "show the data", non-null means "show the spinner"
        currentStage: input.currentStage ?? null,
      };

      if (existing) {
        const { error } = await supabase
          .from("workspace_views")
          .update({ tab_label: input.tabLabel, data: newData, updated_at: now })
          .eq("id", existing.id);
        if (error) return { error: error.message };
        return { success: true, action: "updated" };
      } else {
        const { count } = await supabase
          .from("workspace_views")
          .select("id", { count: "exact", head: true })
          .eq("chat_id", input.chatId);
        const { error } = await supabase
          .from("workspace_views")
          .insert({
            chat_id: input.chatId,
            view_type: "intelligence",
            tab_label: input.tabLabel,
            data: newData,
            mandate_id: null,
            sort_order: 0, // always first
            status: "active",
          });
        if (error) return { error: error.message };
        return { success: true, action: "created" };
      }
    }

    // For mandate/outreach: one row per mandate_id
    const { data: existing } = await supabase
      .from("workspace_views")
      .select("id")
      .eq("chat_id", input.chatId)
      .eq("view_type", input.viewType)
      .eq("mandate_id", input.mandateId ?? "")
      .single();

    if (existing) {
      const { error } = await supabase
        .from("workspace_views")
        .update({ tab_label: input.tabLabel, mandate_id: input.mandateId ?? null, updated_at: now })
        .eq("id", existing.id);
      if (error) return { error: error.message };
      return { success: true, action: "updated" };
    }

    const { count } = await supabase
      .from("workspace_views")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", input.chatId);

    const { error } = await supabase
      .from("workspace_views")
      .insert({
        chat_id: input.chatId,
        view_type: input.viewType,
        tab_label: input.tabLabel,
        data: {},
        mandate_id: input.mandateId ?? null,
        sort_order: count ?? 1,
        status: "active",
      });

    if (error) return { error: error.message };
    return { success: true, action: "created" };
  },
});
