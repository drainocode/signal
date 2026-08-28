import { describe, expect, it, vi } from "vitest";

// reactflow CSS import explodes under vitest -- stub it before importing the
// component under test.
vi.mock("reactflow/dist/style.css", () => ({}));
vi.mock("reactflow", () => ({
  default: () => null,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

import {
  buildLayout,
  type OrgChartPerson,
} from "@/components/company/org-chart";

function person(
  partial: Partial<OrgChartPerson> & { id: string; name: string },
): OrgChartPerson {
  return {
    id: partial.id,
    name: partial.name,
    title: partial.title ?? null,
    department: partial.department ?? null,
    seniority: partial.seniority ?? null,
    linkedin_url: null,
    work_email: null,
    outreach_status: null,
    role_summary: null,
    enrichment_status: null,
  };
}

describe("buildLayout", () => {
  it("returns empty layout for empty input", () => {
    const result = buildLayout([]);
    expect(result.nodes).toEqual([]);
    expect(result.cells).toEqual([]);
    expect(result.totalWidth).toBe(0);
    expect(result.totalHeight).toBe(0);
  });

  it("builds nodes for each person plus row/column labels and cell backdrops", () => {
    const result = buildLayout([
      person({
        id: "p1",
        name: "Paul",
        department: "Engineering",
        seniority: "founder",
      }),
      person({
        id: "p2",
        name: "Eli",
        department: "Engineering",
        seniority: "head",
      }),
      person({
        id: "p3",
        name: "Lindsay",
        department: "GTM",
        seniority: "head",
      }),
    ]);

    const personIds = result.nodes
      .filter((n) => n.type === "person")
      .map((n) => n.id);
    expect(personIds.sort()).toEqual(["p1", "p2", "p3"]);

    const colLabels = result.nodes
      .filter((n) => n.type === "colLabel")
      .map((n) => (n.data as { label: string }).label);
    expect(colLabels).toContain("Engineering");
    expect(colLabels).toContain("GTM");

    const rowLabels = result.nodes
      .filter((n) => n.type === "rowLabel")
      .map((n) => (n.data as { label: string }).label);
    expect(rowLabels).toEqual(["Founders", "Heads"]);
  });

  it("hides empty tiers (no Leads row when no leads exist)", () => {
    const result = buildLayout([
      person({ id: "p1", name: "A", department: "Eng", seniority: "founder" }),
      person({ id: "p2", name: "B", department: "Eng", seniority: "ic" }),
    ]);
    const rowLabels = result.nodes
      .filter((n) => n.type === "rowLabel")
      .map((n) => (n.data as { label: string }).label);
    expect(rowLabels).toEqual(["Founders", "ICs"]);
  });

  it("orders departments by headcount desc with Unclassified pinned last", () => {
    const result = buildLayout([
      person({ id: "1", name: "A", department: "Design", seniority: "ic" }),
      person({
        id: "2",
        name: "B",
        department: "Engineering",
        seniority: "ic",
      }),
      person({
        id: "3",
        name: "C",
        department: "Engineering",
        seniority: "ic",
      }),
      person({
        id: "4",
        name: "D",
        department: "Engineering",
        seniority: "ic",
      }),
      person({ id: "5", name: "E", department: null, seniority: "ic" }),
    ]);
    const colLabels = result.nodes
      .filter((n) => n.type === "colLabel")
      .map((n) => (n.data as { label: string }).label);
    expect(colLabels).toEqual(["Engineering", "Design", "Unclassified"]);
  });

  it("places founders above heads vertically", () => {
    const result = buildLayout([
      person({ id: "head", name: "H", department: "Eng", seniority: "head" }),
      person({
        id: "founder",
        name: "F",
        department: "Eng",
        seniority: "founder",
      }),
    ]);
    const founder = result.nodes.find((n) => n.id === "founder")!;
    const head = result.nodes.find((n) => n.id === "head")!;
    expect(founder.position.y).toBeLessThan(head.position.y);
  });

  it("buckets people without a seniority into the Unclassified tier (rendered last)", () => {
    const result = buildLayout([
      person({ id: "f", name: "F", department: "Eng", seniority: "founder" }),
      person({ id: "u", name: "U", department: "Eng", seniority: null }),
    ]);
    const rowLabels = result.nodes
      .filter((n) => n.type === "rowLabel")
      .map((n) => (n.data as { label: string }).label);
    expect(rowLabels).toEqual(["Founders", "Unclassified"]);
  });

  it("emits a cell rect for every (tier, dept) combination, even empty ones", () => {
    const result = buildLayout([
      person({ id: "1", name: "A", department: "Eng", seniority: "founder" }),
      person({ id: "2", name: "B", department: "GTM", seniority: "ic" }),
    ]);
    // 2 tiers (founder, ic) × 2 departments (Eng, GTM) = 4 cells, two empty.
    expect(result.cells.length).toBe(4);
    const tiers = new Set(result.cells.map((c) => c.tier));
    const depts = new Set(result.cells.map((c) => c.department));
    expect(tiers).toEqual(new Set(["founder", "ic"]));
    expect(depts).toEqual(new Set(["Eng", "GTM"]));
  });
});
