import { Response } from "undici";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sampleMatchPayload = {
  CI: 123,
  LI: 456,
  SE: 1,
  O1: "Team A",
  O2: "Team B",
  S: 1_700_000_000,
  VI: "vid-123",
};

describe("helabet mapper", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("maps raw match with VI to StreamMatch", async () => {
    const { mapStreamMatch } = await import("../server/lib/helabet");
    const result = mapStreamMatch(sampleMatchPayload, 789);
    expect(result).toEqual(
      expect.objectContaining({
        matchId: 123,
        leagueId: 456,
        sportId: 1,
        nameHome: "Team A",
        nameAway: "Team B",
        videoId: "vid-123",
      }),
    );
  });

  it("returns null when video id missing", async () => {
    const { mapStreamMatch } = await import("../server/lib/helabet");
    const result = mapStreamMatch({ ...sampleMatchPayload, VI: "" }, 789);
    expect(result).toBeNull();
  });
});

describe("resolve cache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached result within TTL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          URL: "https://edge1.xmediaget.com/9999/1/mediaplaylist.m3u8",
        }),
        { status: 200 },
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = mockFetch as any;

    const { resolveVideoStream } = await import("../server/lib/helabet");

    const first = await resolveVideoStream("video-1");
    expect(first.url).toContain("mediaplaylist");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = await resolveVideoStream("video-1");
    expect(second.url).toEqual(first.url);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("end-to-end flow", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.HELABET_BASE;
  });

  it("fetches matches and resolves stream", async () => {
    process.env.HELABET_BASE = "https://helabet.com";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      );

      if (url.pathname.includes("GetChampZip")) {
        return new Response(
          JSON.stringify({ Value: { G: [sampleMatchPayload] } }),
          { status: 200 },
        );
      }

      if (url.pathname === "/cinema") {
        return new Response(
          JSON.stringify({ URL: "https://edge1.xmediaget.com/4444/1/mediaplaylist.m3u8" }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = fetchMock as any;

    const { fetchMatchesWithVideo, resolveVideoStream } = await import(
      "../server/lib/helabet"
    );

    const { matches } = await fetchMatchesWithVideo(456);
    expect(matches).toHaveLength(1);
    expect(matches[0].videoId).toBe("vid-123");

    const resolved = await resolveVideoStream("vid-123");
    expect(resolved.url).toContain("mediaplaylist.m3u8");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const secondCall = fetchMock.mock.calls[1] as [
      RequestInfo | URL,
      RequestInit?,
    ];
    expect(String(firstCall[0])).toContain("GetChampZip");
    expect(firstCall[1]?.method).toBe("GET");
    expect(String(secondCall[0])).toContain("/cinema");
    expect(secondCall[1]?.method).toBe("POST");
  });
});
