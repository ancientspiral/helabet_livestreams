import { describe, it, expect, beforeEach, vi } from "vitest";

describe("resolve helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("derives ttl from url token", async () => {
    const { deriveTtlFromUrl } = await import("../src/routes/resolve");
    const futureMs = Date.now() + 5 * 60 * 1000 + 30_000;
    const ttl = deriveTtlFromUrl(`https://edge.example.com/live/master.m3u8?t=${futureMs}`);
    expect(ttl).toBeGreaterThanOrEqual(30);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("returns null when url without token", async () => {
    const { deriveTtlFromUrl } = await import("../src/routes/resolve");
    const ttl = deriveTtlFromUrl("https://edge.example.com/live/master.m3u8");
    expect(ttl).toBeNull();
  });
});
