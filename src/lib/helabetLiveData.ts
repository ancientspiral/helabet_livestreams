import { HelabetSession } from "../helabetSession.js";

export type HelabetLiveMatch = {
  VI?: string | null;
  SGI?: string | null;
  I?: number | string | null;
  ZP?: number | string | null;
  CI?: number | string | null;
  Id?: number | string | null;
  matchId?: number | string | null;
  LI?: number | string | null;
  SI?: number | string | null;
  SE?: string | null;
  LE?: string | null;
  L?: string | null;
  [key: string]: unknown;
};

export type HelabetVideoMeta = {
  videoId: string | null;
  sgi: string | null;
};

export type HelabetVideoLookup = Map<string, HelabetVideoMeta>;

export type HelabetLiveData = {
  lookup: HelabetVideoLookup;
  matches: HelabetLiveMatch[];
};

const HELABET_VIDEO_ENDPOINT =
  "/service-api/LiveFeed/Get1x2_VZip?count=200&lng=en&gr=766&mode=4&country=147&partner=237&virtualSports=true&noFilterBlockEvent=true";

const normalizeId = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? String(value) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
      return String(numeric);
    }
    return trimmed;
  }
  return null;
};

const registerIds = (
  lookup: HelabetVideoLookup,
  ids: Array<number | string | null | undefined>,
  meta: HelabetVideoMeta,
) => {
  ids.forEach((id) => {
    const key = normalizeId(id);
    if (!key) return;
    const existing = lookup.get(key);
    if (existing) {
      if (!existing.videoId && meta.videoId) {
        existing.videoId = meta.videoId;
      }
      if (!existing.sgi && meta.sgi) {
        existing.sgi = meta.sgi;
      }
      return;
    }
    lookup.set(key, { ...meta });
  });
};

export async function fetchHelabetLiveData(
  session: HelabetSession,
): Promise<HelabetLiveData | null> {
  try {
    const response = await session.helabetRequest(HELABET_VIDEO_ENDPOINT, { method: "GET" });
    if (!response.ok) {
      console.warn(
        "[helabet-live][warn]",
        "live feed request failed",
        response.status,
        response.statusText,
      );
      return null;
    }
    const payload = (await response.json()) as { Value?: HelabetLiveMatch[] };
    const matches = Array.isArray(payload?.Value) ? payload.Value : [];
    const lookup: HelabetVideoLookup = new Map();
    matches.forEach((match) => {
      if (!match || typeof match !== "object") {
        return;
      }
      const videoId =
        typeof match.VI === "string" && match.VI.trim() ? match.VI.trim() : null;
      const sgi =
        typeof match.SGI === "string" && match.SGI.trim() ? match.SGI.trim() : null;
      if (!videoId && !sgi) {
        return;
      }
      const ids = [
        match.I,
        match.ZP,
        match.CI,
        match.Id,
        match.matchId,
        match.VI,
      ];
      registerIds(lookup, ids, { videoId, sgi });
    });
    return {
      lookup,
      matches,
    };
  } catch (error) {
    console.warn(
      "[helabet-live][error]",
      (error as Error)?.message ?? String(error),
    );
    return null;
  }
}
