/**
 * src/app/api/mandates/route.ts
 * Returns all mandates with aggregated counts.
 * Uses service client to bypass RLS.
 */

import { getServiceClient } from "@/lib/supabase/service-client";

export async function GET() {
  const supabase = getServiceClient();

  const { data: mandates, error } = await supabase
    .from("mandates")
    .select("id, name, vertical, status, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error || !mandates) {
    return Response.json({ error: "Failed to fetch mandates" }, { status: 500 });
  }

  if (mandates.length === 0) {
    return Response.json([]);
  }

  const ids = mandates.map((m) => m.id);

  // Fetch mandate_businesses and contacts in parallel
  const [mbRes, contactsRes, outreachRes, scoresRes] = await Promise.all([
    supabase
      .from("mandate_businesses")
      .select("mandate_id, business_id")
      .in("mandate_id", ids)
      .eq("status", "active"),
    supabase
      .from("contacts")
      .select("id, business_id, email_verified"),
    supabase
      .from("outreach_queue")
      .select("mandate_id, status")
      .in("mandate_id", ids)
      .in("status", ["sent", "opened", "replied"]),
    supabase
      .from("readiness_scores")
      .select("business_id, readiness_score"),
  ]);

  // Build business_id → mandate_id map
  const bizToMandate = new Map<string, string>();
  const targetCounts = new Map<string, number>();
  for (const row of mbRes.data ?? []) {
    bizToMandate.set(row.business_id, row.mandate_id);
    targetCounts.set(row.mandate_id, (targetCounts.get(row.mandate_id) ?? 0) + 1);
  }

  // Build readiness scores map
  const rsMap = new Map<string, number>();
  for (const row of scoresRes.data ?? []) {
    rsMap.set(row.business_id, row.readiness_score ?? 0);
  }

  // Count contacts and verified emails per mandate
  const contactCounts = new Map<string, number>();
  const verifiedCounts = new Map<string, number>();
  for (const contact of contactsRes.data ?? []) {
    const mandateId = bizToMandate.get(contact.business_id ?? "");
    if (!mandateId) continue;
    contactCounts.set(mandateId, (contactCounts.get(mandateId) ?? 0) + 1);
    if (contact.email_verified) {
      verifiedCounts.set(mandateId, (verifiedCounts.get(mandateId) ?? 0) + 1);
    }
  }

  // Count outreach sent per mandate
  const outreachCounts = new Map<string, number>();
  for (const row of outreachRes.data ?? []) {
    outreachCounts.set(row.mandate_id, (outreachCounts.get(row.mandate_id) ?? 0) + 1);
  }

  // Top readiness score per mandate
  const topScores = new Map<string, number>();
  for (const [bizId, mandateId] of bizToMandate.entries()) {
    const score = rsMap.get(bizId);
    if (score !== undefined) {
      const current = topScores.get(mandateId) ?? 0;
      if (score > current) topScores.set(mandateId, score);
    }
  }

  const result = mandates.map((m) => ({
    id: m.id,
    name: m.name,
    vertical: m.vertical ?? null,
    status: m.status ?? "active",
    created_at: m.created_at,
    updated_at: m.updated_at,
    target_count: targetCounts.get(m.id) ?? 0,
    contact_count: contactCounts.get(m.id) ?? 0,
    verified_email_count: verifiedCounts.get(m.id) ?? 0,
    outreach_sent: outreachCounts.get(m.id) ?? 0,
    top_score: topScores.has(m.id) ? topScores.get(m.id)! : null,
  }));

  return Response.json(result);
}
