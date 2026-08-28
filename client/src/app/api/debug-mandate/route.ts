// src/app/api/debug-mandate/route.ts
// TEMPORARY debug route — delete after diagnosing
// Visit: /api/debug-mandate?id=YOUR_MANDATE_ID

import { getSupabaseAndUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mandateId = searchParams.get("id");

  if (!mandateId) {
    return Response.json({ error: "Pass ?id=mandate_uuid" }, { status: 400 });
  }

  const ctx = await getSupabaseAndUser();
  if (!ctx) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { supabase } = ctx;

  // Step 1: mandate
  const { data: mandate, error: mandateErr } = await supabase
    .from("mandates")
    .select("id, name, vertical, regions, thesis, icp, status")
    .eq("id", mandateId)
    .single();

  // Step 2: mandate_businesses
  const { data: mbRows, error: mbErr } = await supabase
    .from("mandate_businesses")
    .select("id, business_id, relevance_score, status")
    .eq("mandate_id", mandateId);

  const bizIds = (mbRows ?? []).map((r: { business_id: string }) => r.business_id);

  // Step 3: businesses
  const { data: bizRows, error: bizErr } = bizIds.length > 0
    ? await supabase.from("businesses").select("id, name, city, state, vertical, pipeline_status").in("id", bizIds)
    : { data: [], error: null };

  // Step 4: enrichment_data
  const { data: enrichRows, error: enrichErr } = bizIds.length > 0
    ? await supabase.from("enrichment_data").select("business_id, website_title, enriched_at").in("business_id", bizIds)
    : { data: [], error: null };

  // Step 5: readiness_scores
  const { data: rsRows, error: rsErr } = bizIds.length > 0
    ? await supabase.from("readiness_scores").select("business_id, readiness_score, tech_gap_score").in("business_id", bizIds)
    : { data: [], error: null };

  // Step 6: contacts
  const { data: contactRows, error: contactErr } = bizIds.length > 0
    ? await supabase.from("contacts").select("id, business_id, name, email, email_verified").in("business_id", bizIds).limit(10)
    : { data: [], error: null };

  return Response.json({
    mandate: { data: mandate, error: mandateErr?.message },
    mandate_businesses: { count: mbRows?.length ?? 0, bizIds, error: mbErr?.message },
    businesses: { count: bizRows?.length ?? 0, sample: bizRows?.slice(0, 2), error: bizErr?.message },
    enrichment_data: { count: enrichRows?.length ?? 0, error: enrichErr?.message },
    readiness_scores: { count: rsRows?.length ?? 0, sample: rsRows?.slice(0, 2), error: rsErr?.message },
    contacts: { count: contactRows?.length ?? 0, sample: contactRows?.slice(0, 2), error: contactErr?.message },
  });
}
