import { NextResponse } from "next/server";
import { composeEmail } from "@/lib/email-composition/compose";
import { loadActiveEmailSkills } from "@/lib/email-composition/load-skills";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAndUser } from "@/lib/supabase/server";

export const maxDuration = 120;

interface Body {
  draftId?: string;
}

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = ctx;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Load the draft
  const { data: draft, error: draftErr } = await supabase
    .from("email_drafts")
    .select(
      "id, user_id, campaign_id, person_id, sequence_id, sequence_step_id, ai_reasoning, review_status, status",
    )
    .eq("id", body.draftId)
    .single();

  if (draftErr || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot regenerate a ${draft.status} email` },
      { status: 409 },
    );
  }

  if (draft.review_status !== "pending") {
    return NextResponse.json(
      { error: `Cannot regenerate a ${draft.review_status} email` },
      { status: 409 },
    );
  }

  // Load the person (Signal's people table)
  const { data: person } = await supabase
    .from("people")
    .select(
      "id, name, title, work_email, personal_email, organization_id, enrichment_data, contact_id",
    )
    .eq("id", draft.person_id)
    .single();

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  // Load the mandate (our mandates table, not Signal's campaigns)
  const { data: mandate } = await supabase
    .from("mandates")
    .select("name, vertical, regions, thesis, icp")
    .eq("id", draft.campaign_id)
    .single();

  // Load the organization (Signal's organizations table)
  type OrgRow = {
    name: string | null;
    domain: string | null;
    industry: string | null;
    enrichment_data: Record<string, unknown> | null;
  };
  let org: OrgRow | null = null;
  if (person.organization_id) {
    const { data } = await supabase
      .from("organizations")
      .select("name, domain, industry, enrichment_data")
      .eq("id", person.organization_id)
      .single();
    org = (data as OrgRow | null) ?? null;
  }

  // If org enrichment is sparse, also pull from our businesses table via contact_id
  if (org && !org.enrichment_data && person.contact_id) {
    const { data: contactRow } = await supabase
      .from("contacts")
      .select("business_id")
      .eq("id", person.contact_id)
      .single();

    if (contactRow?.business_id) {
      const { data: bizRow } = await supabase
        .from("enrichment_data")
        .select("website_title, website_description, tech_gap_detected")
        .eq("business_id", contactRow.business_id)
        .single();

      if (bizRow) {
        org = { ...org, enrichment_data: bizRow as Record<string, unknown> };
      }
    }
  }

  // Step info
  let stepNumber = 1;
  let totalSteps = 1;
  let condition = "always";

  if (draft.sequence_step_id && draft.sequence_id) {
    const { data: stepRow } = await supabase
      .from("sequence_steps")
      .select("step_number, condition")
      .eq("id", draft.sequence_step_id)
      .single();

    if (stepRow) {
      stepNumber = stepRow.step_number ?? 1;
      condition = stepRow.condition ?? "always";
    }

    const { count } = await supabase
      .from("sequence_steps")
      .select("*", { count: "exact", head: true })
      .eq("sequence_id", draft.sequence_id);

    totalSteps = count ?? 1;
  }

  const isFinal = stepNumber === totalSteps;

  // Load email skills
  const skills = await loadActiveEmailSkills(supabase, {
    userId: user.id,
    profileId: null,
    campaignId: draft.campaign_id,
  });

  // Build a synthetic sender profile from mandate context
  const senderProfile = {
    name: null as string | null,
    title: null as string | null,
    company: null as string | null,
    signature: null as string | null,
  };

  // Compose the email using our AI composition layer
  const composed = await composeEmail({
    skills,
    contact: {
      name: person.name ?? null,
      title: person.title ?? null,
      email: person.work_email ?? person.personal_email ?? "unknown@example.com",
      enrichmentData: (person.enrichment_data as Record<string, unknown>) ?? null,
    },
    company: org
      ? {
          name: org.name,
          domain: org.domain,
          industry: org.industry,
          enrichmentData: org.enrichment_data,
        }
      : null,
    step: {
      stepNumber,
      totalSteps,
      condition,
      isFinal,
    },
    campaign: {
      name: mandate?.name ?? "Acquisition Mandate",
      icp: (mandate?.icp as Record<string, unknown>) ?? null,
      offering: {
        valueProposition: mandate?.thesis ?? null,
        vertical: mandate?.vertical ?? null,
        geography: mandate?.regions?.join(", ") ?? null,
      },
      positioning: null,
    },
    senderProfile,
    triggerReason: (draft.ai_reasoning as string) ?? null,
  });

  if (!composed.ok) {
    return NextResponse.json(
      { error: composed.error || "Failed to regenerate email" },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("email_drafts")
    .update({
      subject: composed.email.subject,
      body_html: composed.email.bodyHtml,
      body_text: composed.email.bodyText ?? null,
      ai_reasoning: composed.email.aiReasoning ?? draft.ai_reasoning,
      updated_at: now,
    })
    .eq("id", draft.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    draftId: draft.id,
    subject: composed.email.subject,
    bodyHtml: composed.email.bodyHtml,
    bodyText: composed.email.bodyText ?? null,
    aiReasoning: composed.email.aiReasoning ?? null,
  });
}
