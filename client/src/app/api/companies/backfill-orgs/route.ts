import { getSupabaseAndUser } from "@/lib/supabase/server";

export const maxDuration = 60;

interface PersonRow {
  id: string;
  enrichment_data: Record<string, unknown> | null;
}

interface OrgRow {
  id: string;
  name: string;
}

function extractCompanySignals(
  enrichment: Record<string, unknown> | null,
): string[] {
  if (!enrichment) return [];

  const signals = new Set<string>();

  // searchPeople stored its query string here.
  const searchQuery = enrichment.searchQuery;
  if (typeof searchQuery === "string") signals.add(searchQuery);

  const linkedin = enrichment.linkedin as
    | { profileInfo?: { headline?: string } | null }
    | undefined;
  const headline = linkedin?.profileInfo?.headline;
  if (typeof headline === "string") signals.add(headline);

  // Raw LinkedIn search result title -- e.g. "Paul Klein - Founder of Browserbase"
  const rawTitle = enrichment.rawTitle;
  if (typeof rawTitle === "string") signals.add(rawTitle);

  return [...signals];
}

function findOrgMatch(signals: string[], orgs: OrgRow[]): string | null {
  const text = signals.join(" \n ").toLowerCase();
  if (!text) return null;

  let best: { id: string; len: number } | null = null;
  for (const org of orgs) {
    const name = org.name.toLowerCase().trim();
    if (name.length < 3) continue;
    if (text.includes(name)) {
      if (!best || name.length > best.len) {
        best = { id: org.id, len: name.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * One-off cleanup: re-link people that landed in the knowledge base with
 * organization_id = null. Looks at each person's enrichment_data for company
 * name signals and matches against existing organizations.
 *
 * Idempotent: safe to run multiple times. Only touches rows that are still
 * orphaned and only updates organization_id when a confident match is found.
 */
export async function POST() {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { data: orgs, error: orgsErr } = await supabase
    .from("organizations")
    .select("id, name");

  if (orgsErr) {
    return Response.json({ error: orgsErr.message }, { status: 500 });
  }

  const { data: orphans, error: peopleErr } = await supabase
    .from("people")
    .select("id, enrichment_data")
    .is("organization_id", null)
    .limit(500);

  if (peopleErr) {
    return Response.json({ error: peopleErr.message }, { status: 500 });
  }

  const orgList = (orgs ?? []) as OrgRow[];
  const rows = (orphans ?? []) as PersonRow[];

  let linked = 0;
  const unmatched: string[] = [];

  for (const row of rows) {
    const signals = extractCompanySignals(row.enrichment_data);
    const orgId = findOrgMatch(signals, orgList);
    if (!orgId) {
      unmatched.push(row.id);
      continue;
    }
    const { error: updErr } = await supabase
      .from("people")
      .update({ organization_id: orgId })
      .eq("id", row.id);
    if (!updErr) linked += 1;
  }

  return Response.json({
    scanned: rows.length,
    linked,
    unmatched: unmatched.length,
  });
}
