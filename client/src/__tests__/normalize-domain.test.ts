import { describe, expect, it } from "vitest";

import { normalizeDomain } from "@/lib/services/knowledge-base";

describe("normalizeDomain", () => {
  it("collapses subdomains to apex", () => {
    expect(normalizeDomain("docs.mintlify.com")).toBe("mintlify.com");
    expect(normalizeDomain("blog.example.com")).toBe("example.com");
    expect(normalizeDomain("a.b.c.example.com")).toBe("example.com");
  });

  it("strips protocol, www, paths, and lowercases", () => {
    expect(normalizeDomain("https://www.example.com/path")).toBe("example.com");
    expect(normalizeDomain("HTTP://Example.COM/")).toBe("example.com");
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("preserves multi-level country TLDs (eTLD+1)", () => {
    expect(normalizeDomain("www.example.co.uk")).toBe("example.co.uk");
    expect(normalizeDomain("sub.example.com.au")).toBe("example.com.au");
    expect(normalizeDomain("companieshouse.gov.uk")).toBe(
      "companieshouse.gov.uk",
    );
  });

  it("does not collapse private PSL suffixes like github.io", () => {
    expect(normalizeDomain("foo.github.io")).toBe("foo.github.io");
    expect(normalizeDomain("user.vercel.app")).toBe("user.vercel.app");
  });

  it("falls back to cleaned input for IPs and single-label hosts", () => {
    expect(normalizeDomain("192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeDomain("localhost")).toBe("localhost");
  });

  it("idempotent on already-normalized apex", () => {
    expect(normalizeDomain("mintlify.com")).toBe("mintlify.com");
  });
});
