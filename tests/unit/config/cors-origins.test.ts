import { describe, it, expect } from "vitest";
import {
  normalizeCorsOrigins,
  isOriginAllowed,
} from "../../../src/config/cors-origins.js";

describe("normalizeCorsOrigins", () => {
  it("splits comma-separated origins", () => {
    expect(
      normalizeCorsOrigins("http://localhost:3000,http://localhost:5173"),
    ).toEqual(["http://localhost:3000", "http://localhost:5173"]);
  });

  it("trims whitespace around each entry", () => {
    expect(
      normalizeCorsOrigins("  http://a.com ,  http://b.com  "),
    ).toEqual(["http://a.com", "http://b.com"]);
  });

  it("strips trailing slashes from each origin", () => {
    expect(
      normalizeCorsOrigins("http://localhost:5173/,http://localhost:3000//"),
    ).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });

  it("drops empty entries (consecutive commas, leading/trailing commas)", () => {
    expect(
      normalizeCorsOrigins("http://a.com,,http://b.com,"),
    ).toEqual(["http://a.com", "http://b.com"]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeCorsOrigins("")).toEqual([]);
    expect(normalizeCorsOrigins("   ")).toEqual([]);
  });

  it("preserves wildcard * as-is (does not strip slash from *)", () => {
    expect(normalizeCorsOrigins("*")).toEqual(["*"]);
    expect(normalizeCorsOrigins("http://a.com,*")).toEqual([
      "http://a.com",
      "*",
    ]);
  });

  it("allows wildcard when allowWildcard is true (default)", () => {
    expect(normalizeCorsOrigins("*")).toEqual(["*"]);
    expect(normalizeCorsOrigins("http://a.com,*")).toEqual([
      "http://a.com",
      "*",
    ]);
  });

  it("allows wildcard when allowWildcard=true explicitly", () => {
    expect(normalizeCorsOrigins("*", { allowWildcard: true })).toEqual(["*"]);
  });

  it("rejects wildcard when allowWildcard=false (production)", () => {
    expect(() =>
      normalizeCorsOrigins("*", { allowWildcard: false }),
    ).toThrow(/wildcard.*forbidden/i);

    expect(() =>
      normalizeCorsOrigins("http://a.com,*", { allowWildcard: false }),
    ).toThrow(/wildcard.*forbidden/i);
  });

  it("does not reject non-wildcard origins when allowWildcard=false", () => {
    expect(
      normalizeCorsOrigins("http://a.com,http://b.com", {
        allowWildcard: false,
      }),
    ).toEqual(["http://a.com", "http://b.com"]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["http://localhost:3000", "http://localhost:5173"];

  it("returns true for undefined origin (server-to-server, curl)", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it("returns true for exact match", () => {
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
  });

  it("returns true when request origin has trailing slash (normalized match)", () => {
    expect(isOriginAllowed("http://localhost:5173/", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173///", allowed)).toBe(true);
  });

  it("returns false for unlisted origin", () => {
    expect(isOriginAllowed("http://evil.com", allowed)).toBe(false);
  });

  it("returns true for any origin when wildcard is allowed", () => {
    expect(isOriginAllowed("http://anything.com", ["*"])).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", ["*"])).toBe(true);
  });

  it("returns false for empty allowed list except undefined origin", () => {
    expect(isOriginAllowed("http://localhost:5173", [])).toBe(false);
    expect(isOriginAllowed(undefined, [])).toBe(true);
  });

  it("CRITICAL: matches audit finding — REST and Socket.IO now use same rule", () => {
    // Simulates the exact scenario the audit flagged:
    // CORS_ORIGIN="http://localhost:5173/"
    const normalized = normalizeCorsOrigins("http://localhost:5173/");
    // Browser sends Origin without trailing slash
    expect(isOriginAllowed("http://localhost:5173", normalized)).toBe(true);
    // Browser sends Origin with trailing slash
    expect(isOriginAllowed("http://localhost:5173/", normalized)).toBe(true);
    // Both REST and Socket.IO use same rule → consistent behavior
  });
});
