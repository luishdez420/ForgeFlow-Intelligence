import { describe, expect, it } from "vitest";

import { hashContent, validateOriginUrl } from "../src/provenance.js";

describe("provenance utilities", () => {
  it("produces deterministic SHA-256 hashes for equivalent structured content", () => {
    expect(hashContent({ b: 2, a: ["source", true] })).toBe(
      hashContent({ a: ["source", true], b: 2 }),
    );
    expect(hashContent("source body")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts safe HTTPS source URLs and rejects insecure credentials", () => {
    expect(validateOriginUrl("https://www.sec.gov/Archives/doc.html")).toBe(
      "https://www.sec.gov/Archives/doc.html",
    );
    expect(() => validateOriginUrl("http://www.sec.gov/Archives")).toThrow(
      "HTTPS",
    );
    expect(() => validateOriginUrl("https://token@example.com/filing")).toThrow(
      "credentials",
    );
  });
});
