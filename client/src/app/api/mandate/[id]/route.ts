/**
 * src/app/api/mandate/[id]/route.ts
 * 
 * Returns all data needed for the mandate detail page.
 * Uses service role client to bypass RLS — same pattern as the tools.
 */

import { getServiceClient } from "@/lib/supabase/service-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: mandateId } = await params;
  if (!mandateId) {
    return Response.json({ error: "mandateId required" }, { status: 400 });
  }

  const supabase = getServiceClient();

  // Step 1: mandate
  const { data: mandate, error: mandateErr } = await supabase
    .from("mandates")
    .select("id, name, vertical, regions, thesis, icp, status, created_at, updated_at")
    .eq("id", mandateId)
    .single();

  if (mandateErr || !mandate) {
    return Response.json({ error: "Mandate not found" }, { status: 404 });
  }

  // Step 2: mandate_businesses
  const { data: mbRows, error: mbError } = await supabase
    .from("mandate_businesses")
    .select("id, mandate_id, business_id, relevance_score, relevance_reason, status")
    .eq("mandate_id", mandateId)
    .eq("status", "active")
    .order("relevance_score", { ascending: false });

  if (mbError) {
    return Response.json({ error: "mandate_businesses query failed", detail: mbError.message, mandateId }, { status: 500 });
  }

  console.log("[mandate-api] mandate_businesses rows:", mbRows?.length ?? 0, "for mandateId:", mandateId);

  const bizIds = (mbRows ?? []).map((r: { business_id: string }) => r.business_id).filter(Boolean);

  if (bizIds.length === 0) {
    return Response.json({ mandate, mandateBusinesses: [], businesses: [], enrichmentData: [], readinessScores: [], qualificationResults: [], contacts: [], outreachQueue: [] });
  }

  // Step 3: parallel fetches for all related data
  const [bizRes, enrichRes, rsRes, qualRes, contactsRes] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, website, phone, city, state, vertical, google_rating, review_count, pipeline_status")
      .in("id", bizIds),
    supabase
      .from("enrichment_data")
      .select("business_id, website_title, website_description, tech_gap_detected, has_google_ads, enriched_at")
      .in("business_id", bizIds),
    supabase
      .from("readiness_scores")
      .select("business_id, readiness_score, tech_gap_score, hiring_signal_score, digital_presence_score, review_health_score, operational_score, score_rationale, benchmark_percentile")
      .in("business_id", bizIds),
    supabase
      .from("qualification_results")
      .select("business_id, is_qualified, years_in_business, owner_operated_likelihood, employee_count_estimate, disqualification_reason")
      .in("business_id", bizIds),
    supabase
      .from("contacts")
      .select("id, business_id, name, title, email, email_verified, email_source, phone, linkedin_url, is_primary_contact, contact_score, created_at, updated_at")
      .in("business_id", bizIds)
      .order("is_primary_contact", { ascending: false }),
  ]);

  // Step 4: outreach queue for these contacts
  const contactIds = (contactsRes.data ?? []).map((c: { id: string }) => c.id);
  const { data: outreachRows } = contactIds.length > 0
    ? await supabase
        .from("outreach_queue")
        .select("contact_id, status")
        .eq("mandate_id", mandateId)
        .in("contact_id", contactIds)
    : { data: [] };

  return Response.json({
    mandate,
    mandateBusinesses: mbRows ?? [],
    businesses: bizRes.data ?? [],
    enrichmentData: enrichRes.data ?? [],
    readinessScores: rsRes.data ?? [],
    qualificationResults: qualRes.data ?? [],
    contacts: contactsRes.data ?? [],
    outreachQueue: outreachRows ?? [],
  });
}
