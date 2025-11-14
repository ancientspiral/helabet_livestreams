export interface LeagueSummary {
  li: number;
  name?: string;
}

export interface StreamMatch {
  matchId: number;
  leagueId: number;
  sportId: number;
  nameHome: string;
  nameAway: string;
  startTs: number;
  videoId: string;
  odds?: {
    w1: number;
    w2: number;
    x?: number;
  } | null;
}

export interface ResolveResponse {
  url: string;
  ttlHintSec: number;
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

const RESOLVE_DEFAULT_TTL = 90;
const RESOLVE_SAFETY_MARGIN_MS = 10_000;

type ResolveCacheEntry = {
  value: ResolveResponse;
  expiresAt: number;
};

const resolveCache = new Map<string, ResolveCacheEntry>();
const resolveInflight = new Map<string, Promise<ResolveResponse>>();

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let message = "request_failed";
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          message?: string;
          error?: string;
        };
        message = parsed.message ?? parsed.error ?? message;
      } catch {
        // ignore JSON parse issues
      }
    }

    const error = new Error(message) as Error & {
      status?: number;
      body?: string;
    };
    error.status = response.status;
    if (raw) {
      error.body = raw.slice(0, 200);
    }
    throw error;
  }
  return response.json() as Promise<T>;
};

export const fetchMatchesWithVideo = async (
  leagueId: number,
): Promise<{ matches: StreamMatch[]; warning?: string }> => {
  const response = await fetch(`/api/league/${leagueId}/matches`, {
    headers: jsonHeaders,
    credentials: "include",
  });
  return handleResponse<{ matches: StreamMatch[]; warning?: string }>(
    response,
  );
};

export const fetchLeagues = async (): Promise<LeagueSummary[]> => {
  const response = await fetch("/api/leagues", {
    headers: jsonHeaders,
    credentials: "include",
  });
  const payload = await handleResponse<{ leagues: LeagueSummary[] }>(response);
  return payload.leagues ?? [];
};

export const fetchLiveMatches = async (): Promise<{
  matches: StreamMatch[];
  warnings: string[];
}> => {
  const response = await fetch("/api/hlb/service-api/LiveFeed/GetTopGamesStatZip?lng=en&antisports=66&partner=237", {
    headers: jsonHeaders,
    credentials: "include",
  });
  return handleResponse<{ matches: StreamMatch[]; warnings: string[] }>(
    response,
  );
};

export const resolveM3U8 = async (
  videoId?: string | null,
  sgi?: string | null,
): Promise<ResolveResponse> => {
  const normalizedVideoId =
    typeof videoId === "string" ? videoId.trim() : "";
  const normalizedSgi =
    typeof sgi === "string" && sgi.trim() ? sgi.trim() : undefined;
  const cacheKey = `${normalizedVideoId}::${normalizedSgi ?? ""}`;
  const now = Date.now();
  const cached = resolveCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const ttlHintSec = Math.max(1, Math.floor((cached.expiresAt - now) / 1000));
    return {
      url: cached.value.url,
      ttlHintSec,
    };
  }
  if (cached) {
    resolveCache.delete(cacheKey);
  }

  const pending = resolveInflight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: jsonHeaders,
        credentials: "include",
        body: JSON.stringify({
          videoId: normalizedVideoId,
          sgi: normalizedSgi,
        }),
      });
      const payload = await handleResponse<ResolveResponse>(response);
      if (!payload?.url) {
        throw new Error("resolve_failed");
      }

      let ttl = RESOLVE_DEFAULT_TTL;
      if (typeof payload.ttlHintSec === "number" && Number.isFinite(payload.ttlHintSec)) {
        ttl = payload.ttlHintSec;
      } else if (typeof payload.ttlHintSec === "string") {
        const parsedTtl = Number.parseFloat(payload.ttlHintSec);
        if (Number.isFinite(parsedTtl) && parsedTtl > 0) {
          ttl = parsedTtl;
        }
      }
      const value: ResolveResponse = {
        url: payload.url,
        ttlHintSec: ttl,
      };

      const rawExpiry = Date.now() + ttl * 1000 - RESOLVE_SAFETY_MARGIN_MS;
      const expiresAt = rawExpiry > Date.now()
        ? rawExpiry
        : Date.now() + Math.max(5_000, Math.floor(ttl * 500));
      resolveCache.set(cacheKey, { value, expiresAt });

      return value;
    } finally {
      resolveInflight.delete(cacheKey);
    }
  })();

  resolveInflight.set(cacheKey, promise);
  return promise;
};
