import { describe, it, expect } from "vitest";

describe("player page route", () => {
  it("renders html shell with bootstrap script", async () => {
    const { renderPlayerPage } = await import("../src/routes/playerPage");
    const html = renderPlayerPage();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("player-video");
    expect(html).toContain("Loading stream");
    expect(html).toContain("/api/resolve");
  });
});
