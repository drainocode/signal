import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted state so the vi.mock factory below can reach it without crashing
// on temporal-dead-zone access ordering.
const state = vi.hoisted(() => ({
  lastOrFilter: null as string | null,
  lastInClause: null as unknown[] | null,
  orphanPeople: [
    {
      id: "p1",
      name: "Alice Andersen",
      title: "Software Engineer",
      linkedin_url: "https://linkedin.com/in/alice",
      work_email: "alice@example.com",
    },
    {
      id: "p2",
      name: "Bob Brown",
      title: null,
      linkedin_url: null,
      work_email: null,
    },
  ],
  allowedLinks: [{ person_id: "p1" }, { person_id: "p2" }],
}));

vi.mock("@/lib/supabase/server", () => {
  function makeOrphansChain() {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.in = vi.fn((_col: string, ids: unknown[]) => {
      state.lastInClause = ids;
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.or = vi.fn((expr: string) => {
      state.lastOrFilter = expr;
      return Promise.resolve({ data: state.orphanPeople, error: null });
    });
    // Make the chain awaitable when .or() isn't called (no q param path).
    Object.defineProperty(chain, "then", {
      get() {
        return (
          resolve: (v: {
            data: typeof state.orphanPeople;
            error: null;
          }) => void,
        ) => resolve({ data: state.orphanPeople, error: null });
      },
      configurable: true,
    });
    return chain;
  }

  function makeLinksChain() {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() =>
      Promise.resolve({ data: state.allowedLinks, error: null }),
    );
    return chain;
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "campaign_people") return makeLinksChain();
      if (table === "people") return makeOrphansChain();
      throw new Error(`unexpected table: ${table}`);
    }),
  };

  return {
    getSupabaseAndUser: vi.fn().mockResolvedValue({
      supabase,
      user: { id: "user-1", email: "u@example.com" },
    }),
  };
});

import { GET } from "@/app/api/people/orphans/route";

afterEach(() => {
  state.lastOrFilter = null;
  state.lastInClause = null;
});

describe("GET /api/people/orphans", () => {
  it("returns the people list shape with no query", async () => {
    const res = await GET(new Request("http://test/api/people/orphans"));
    const body = (await res.json()) as { people: typeof state.orphanPeople };

    expect(res.status).toBe(200);
    expect(body.people).toHaveLength(2);
    expect(body.people[0]).toMatchObject({
      id: "p1",
      name: "Alice Andersen",
      title: "Software Engineer",
      work_email: "alice@example.com",
    });
    expect(body.people[0]).not.toHaveProperty("enrichment_data");
    expect(body.people[0]).not.toHaveProperty("organization_id");
  });

  it("returns empty for single-character queries (length guard)", async () => {
    const res = await GET(new Request("http://test/api/people/orphans?q=a"));
    const body = (await res.json()) as { people: unknown[] };
    expect(body.people).toEqual([]);
    expect(state.lastOrFilter).toBeNull();
  });

  it("forwards multi-char queries as case-insensitive substring filters", async () => {
    const res = await GET(
      new Request("http://test/api/people/orphans?q=alice"),
    );
    expect(res.status).toBe(200);
    expect(state.lastOrFilter).not.toBeNull();
    expect(state.lastOrFilter).toContain("name.ilike.%alice%");
    expect(state.lastOrFilter).toContain("title.ilike.%alice%");
    expect(state.lastOrFilter).toContain("linkedin_url.ilike.%alice%");
    expect(state.lastOrFilter).toContain("work_email.ilike.%alice%");
  });

  it("scopes to people the requesting user has touched via campaigns", async () => {
    await GET(new Request("http://test/api/people/orphans"));
    expect(state.lastInClause).toEqual(["p1", "p2"]);
  });
});
