import type { Request, Response } from "express";
import { HelabetSession } from "../helabetSession.js";

type ResolvePayload = {
  url: string;
  ttlHintSec: number;
};

type CacheEntry = {
  value: ResolvePayload;
  expiresAt: number;
};

type AttemptResult =
  | { kind: "success"; payload: ResolvePayload }
  | { kind: "http"; status: number; snippet?: string }
  | { kind: "no_stream"; snippet?: string }
  | { kind: "network"; error: Error };

const DEFAULT_TTL_SEC = 300;
const TTL_MIN_SEC = 30;
const DEMO_STREAM_PREFIX = "demo-";
const DEMO_STREAM_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ResolvePayload>>();
const cooldowns = new Map<string, number>();

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const normalizeTtl = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TTL_SEC;
};

const makeCacheKey = (videoId: string, sgi?: string | null) =>
  `${videoId}::${sgi ?? ""}`;

export const deriveTtlFromUrl = (rawUrl?: string | null): number | null => {
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    const token = parsed.searchParams.get("t");
    if (!token) {
      return null;
    }
    const expiryMs = Number.parseInt(token, 10);
    if (!Number.isFinite(expiryMs)) {
      return null;
    }
    const remainingMs = Math.max(0, expiryMs - Date.now() - 30_000);
    const remainingSec = Math.floor(remainingMs / 1000);
    if (!Number.isFinite(remainingSec)) {
      return null;
    }
    return Math.max(TTL_MIN_SEC, remainingSec);
  } catch {
    return null;
  }
};

const buildResolvePayload = (url: string, ttlSource?: unknown): ResolvePayload => {
  const fallbackTtl = ttlSource !== undefined ? extractTtl(ttlSource) : DEFAULT_TTL_SEC;
  const ttlHintSec = deriveTtlFromUrl(url) ?? fallbackTtl;
  return {
    url,
    ttlHintSec: normalizeTtl(ttlHintSec),
  };
};

const getCached = (cacheKey: string): ResolvePayload | null => {
  const entry = cache.get(cacheKey);
  if (!entry) {
    return null;
  }
  const remainingMs = entry.expiresAt - Date.now();
  if (remainingMs > 0) {
    return {
      url: entry.value.url,
      ttlHintSec: Math.max(1, Math.floor(remainingMs / 1000)),
    };
  }
  cache.delete(cacheKey);
  return null;
};

const storeCache = (cacheKey: string, payload: ResolvePayload): void => {
  const ttlSec = normalizeTtl(payload.ttlHintSec);
  const marginMs = 5_000;
  const expiresAtCandidate = Date.now() + ttlSec * 1000 - marginMs;
  const expiresAt =
    expiresAtCandidate > Date.now()
      ? expiresAtCandidate
      : Date.now() + Math.max(3_000, Math.floor((ttlSec * 1000) / 2));
  cache.set(cacheKey, {
    value: { url: payload.url, ttlHintSec: ttlSec },
    expiresAt,
  });
};

const sanitizeSnippet = (value?: string) => {
  if (!value) return "";
  return value.replace(/\\s+/g, " ").slice(0, 200);
};

const logResolve = (
  stage: string,
  method: string,
  url: string,
  status: number,
  snippet?: string,
) => {
  const prefix = status >= 200 && status < 400 ? "[resolve]" : "[resolve][warn]";
  const body = snippet ? ` ${sanitizeSnippet(snippet)}` : "";
  console.log(`${prefix} ${stage} ${method} ${url} -> ${status}${body}`);
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const findM3u8Urls = (
  value: unknown,
  results: string[],
  seen: WeakSet<object>,
) => {
  if (!value || typeof value === "boolean" || typeof value === "number") {
    return;
  }
  if (typeof value === "string") {
    if (value.includes(".m3u8")) {
      results.push(decodeHtml(value.trim()));
    }
    return;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry) => findM3u8Urls(entry, results, seen));
      return;
    }
    Object.values(value).forEach((entry) =>
      findM3u8Urls(entry, results, seen),
    );
  }
};

const pickM3u8 = (urls: string[]): string | null => {
  if (!urls.length) {
    return null;
  }
  const normalized = urls
    .map((url) => url.trim())
    .filter((url) => url.includes(".m3u8"));
  if (!normalized.length) {
    return null;
  }
  const master = normalized.find((url) => /master|main/i.test(url));
  return master ?? normalized[0];
};

const findFirstNumber = (
  value: unknown,
  key: string,
  seen: WeakSet<object>,
): number | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (!Array.isArray(value) && key in (value as Record<string, unknown>)) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number.parseFloat(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  const values = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  for (const entry of values) {
    const result = findFirstNumber(entry, key, seen);
    if (result !== null) {
      return result;
    }
  }
  return null;
};

const findFirstString = (
  value: unknown,
  key: string,
  seen: WeakSet<object>,
): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (!Array.isArray(value) && key in (value as Record<string, unknown>)) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const values = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  for (const entry of values) {
    const result = findFirstString(entry, key, seen);
    if (result) {
      return result;
    }
  }
  return null;
};

const extractTtl = (payload: unknown): number => {
  const numberKeys = [
    "ttlHintSec",
    "ttl",
    "expiresIn",
    "ttlSec",
    "ttl_seconds",
  ];
  for (const key of numberKeys) {
    const value = findFirstNumber(payload, key, new WeakSet());
    if (value !== null && value > 0) {
      return normalizeTtl(value);
    }
  }

  const expiresAtKeys = ["expiresAt", "expiry", "expireAt", "expires_at"];
  for (const key of expiresAtKeys) {
    const iso = findFirstString(payload, key, new WeakSet());
    if (iso) {
      const ts = Date.parse(iso);
      if (Number.isFinite(ts)) {
        const diffSec = Math.floor((ts - Date.now()) / 1000);
        if (diffSec > 0) {
          return normalizeTtl(diffSec);
        }
      }
    }
  }

  return DEFAULT_TTL_SEC;
};

const extractJsonBlobs = (html: string): unknown[] => {
  const blobs: unknown[] = [];
  const nextDataRegex =
    /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = nextDataRegex.exec(html)) !== null) {
    try {
      blobs.push(JSON.parse(decodeHtml(match[1])));
    } catch {
      // ignore invalid JSON
    }
  }

  const windowRegex =
    /window\.(?:__NUXT__|INITIAL_STATE)\s*=\s*(\{[\s\S]*?\});/g;
  while ((match = windowRegex.exec(html)) !== null) {
    try {
      blobs.push(JSON.parse(decodeHtml(match[1])));
    } catch {
      // ignore invalid JSON
    }
  }

  const dataStateRegex = /data-state="({[^"]+})"/g;
  while ((match = dataStateRegex.exec(html)) !== null) {
    try {
      blobs.push(JSON.parse(decodeHtml(match[1])));
    } catch {
      // ignore invalid JSON
    }
  }

  return blobs;
};

const attemptBffResolve = async (
  session: HelabetSession,
  videoId: string,
): Promise<AttemptResult> => {
  const path = `/bff-api/video/resolve?videoId=${encodeURIComponent(videoId)}`;
  try {
    const response = await session.helabetRequest(path, {
      method: "GET",
      retryOnAuth: true,
    });
    const text = await response.text();
    logResolve("bff", "GET", path, response.status, text);

    if (!response.ok) {
      return { kind: "http", status: response.status, snippet: text };
    }

    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    const urls: string[] = [];
    findM3u8Urls(payload, urls, new WeakSet());
    const url = pickM3u8(urls);
    if (!url) {
      return { kind: "no_stream", snippet: text };
    }

    return {
      kind: "success",
      payload: buildResolvePayload(url, payload),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { kind: "network", error: err };
  }
};

const attemptCinemaResolve = async (
  session: HelabetSession,
  videoId: string,
): Promise<AttemptResult> => {
  const path = "/cinema";
  const body = {
    AppId: 3,
    AppVer: "1025",
    VpcVer: "1.0.17",
    Language: "en",
    Token: "",
    VideoId: videoId,
    StreamId: videoId,
  };

  try {
    const response = await session.helabetRequest(path, {
      method: "POST",
      body,
      retryOnAuth: true,
    });
    const text = await response.text();
    logResolve("cinema", "POST", path, response.status, text);

    if (!response.ok) {
      return { kind: "http", status: response.status, snippet: text };
    }

    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (payload && typeof payload === "object") {
      const url = (payload as { URL?: string }).URL;
      if (typeof url === "string" && url.includes(".m3u8")) {
        return {
          kind: "success",
          payload: buildResolvePayload(url, payload),
        };
      }
    }

    const urls: string[] = [];
    findM3u8Urls(payload, urls, new WeakSet());
    const url = pickM3u8(urls);
    if (url) {
      return {
        kind: "success",
        payload: buildResolvePayload(url, payload),
      };
    }

    return { kind: "no_stream", snippet: text };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { kind: "network", error: err };
  }
};

const attemptHtmlResolve = async (
  session: HelabetSession,
  videoId?: string,
  sgi?: string,
): Promise<AttemptResult> => {
  const paths: string[] = [];
  if (videoId) {
    paths.push(`/en/cinema?vi=${encodeURIComponent(videoId)}`);
  }
  if (sgi) {
    paths.push(`/en/cinema?sgi=${encodeURIComponent(sgi)}`);
  }
  if (paths.length === 0) {
    return { kind: "no_stream" };
  }

  const httpErrors: { status: number; snippet?: string }[] = [];

  for (const path of paths) {
    try {
      const response = await session.helabetRequest(path, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,*/*",
        },
        retryOnAuth: true,
      });
      const text = await response.text();
      logResolve("html", "GET", path, response.status, text);

      if (!response.ok) {
        httpErrors.push({ status: response.status, snippet: text });
        continue;
      }

      const payloads = extractJsonBlobs(text);
      const urls: string[] = [];
      payloads.forEach((payload) =>
        findM3u8Urls(payload, urls, new WeakSet()),
      );
      if (!urls.length) {
        const fallbackMatches =
          text.match(/https?:[^"'<>\s]+\.m3u8[^"'<>\s]*/gi) ?? [];
        fallbackMatches.forEach((match) => urls.push(decodeHtml(match)));
      }

      const url = pickM3u8(urls);
      if (url) {
        return {
          kind: "success",
          payload: buildResolvePayload(url),
        };
      }
    } catch (error) {
      // ignore and try next path
    }
  }

  if (httpErrors.length) {
    const last = httpErrors[httpErrors.length - 1];
    return {
      kind: "http",
      status: last.status,
      snippet: last.snippet,
    };
  }

  return { kind: "no_stream" };
};

const executeResolve = async (
  session: HelabetSession,
  rawVideoId?: string | null,
  rawSgi?: string | null,
  cacheKey?: string,
): Promise<ResolvePayload> => {
  const videoId =
    typeof rawVideoId === "string" ? rawVideoId.trim() : "";
  const sgi =
    typeof rawSgi === "string" && rawSgi.trim() ? rawSgi.trim() : undefined;
  const cacheLabel = cacheKey ?? makeCacheKey(videoId, sgi);

  if (videoId.startsWith(DEMO_STREAM_PREFIX)) {
    const demoPayload = { url: DEMO_STREAM_URL, ttlHintSec: 300 };
    storeCache(cacheLabel, demoPayload);
    return demoPayload;
  }

  const attempts: AttemptResult[] = [];

  if (videoId) {
    const bffResult = await attemptBffResolve(session, videoId);
    attempts.push(bffResult);
    if (bffResult.kind === "success") {
      storeCache(cacheLabel, bffResult.payload);
      return bffResult.payload;
    }

    const cinemaResult = await attemptCinemaResolve(session, videoId);
    attempts.push(cinemaResult);
    if (cinemaResult.kind === "success") {
      storeCache(cacheLabel, cinemaResult.payload);
      return cinemaResult.payload;
    }
  }

  if (videoId || sgi) {
    const htmlResult = await attemptHtmlResolve(session, videoId || undefined, sgi);
    attempts.push(htmlResult);
    if (htmlResult.kind === "success") {
      storeCache(cacheLabel, htmlResult.payload);
      return htmlResult.payload;
    }
  }

  const httpFailures = attempts.filter(
    (attempt): attempt is Extract<AttemptResult, { kind: "http" }> =>
      attempt.kind === "http",
  );
  if (
    httpFailures.length > 0 &&
    httpFailures.every(
      (failure) => failure.status >= 400 && failure.status < 500,
    )
  ) {
    throw Object.assign(new Error("not_found"), {
      statusCode: 404,
      code: "not_found",
    });
  }

  if (httpFailures.some((failure) => failure.status >= 500)) {
    throw Object.assign(new Error("upstream_error"), {
      statusCode: 502,
      upstreamStatus: httpFailures[httpFailures.length - 1]?.status,
    });
  }

  if (attempts.some((attempt) => attempt.kind === "network")) {
    throw Object.assign(new Error("resolve_failed"), { statusCode: 503 });
  }

  throw Object.assign(new Error("resolve_failed"), { statusCode: 503 });
};

const getInflight = (
  session: HelabetSession,
  cacheKey: string,
  videoId: string,
  sgi?: string | null,
): Promise<ResolvePayload> => {
  const existing = inflight.get(cacheKey);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    const now = Date.now();
    const last = cooldowns.get(cacheKey);
    if (last && now - last < 1_000) {
      await delay(1_000 - (now - last));
    }
    cooldowns.set(cacheKey, Date.now());
    try {
      return await executeResolve(session, videoId, sgi, cacheKey);
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, promise);
  return promise;
};

const sendError = (
  res: Response,
  status: number,
  options: { code?: string; message?: string; upstreamStatus?: number } = {},
) => {
  if (status === 404) {
    res.status(404).json({ error: options.code ?? "not_found" });
    return;
  }
  if (status === 502 && options.upstreamStatus) {
    res.status(502).json({
      message: "upstream_error",
      status: options.upstreamStatus,
    });
    return;
  }
  res
    .status(status)
    .json({ message: options.message ?? "resolve_failed" });
};

/**
 * Verification checklist (manual):
 *  - DevTools → POST /api/resolve returns { url, ttlHintSec } with 200.
 *  - Network → Media tab shows .m3u8 + segment requests; video element plays.
 *  - /api/live/* aggregation calls enumerate all sports/champs (>= Helabet live count).
 *  - Home displays multi-sport live cards and Today/Tomorrow/This Week tabs without past events.
 *  - Stream page shows W1/X/W2 with full precision (no rounding).
 *  - On resolve failure, logs include attempt chain with upstream status/snippet.
 */
export function makeResolveHandler(session: HelabetSession) {
  return async function resolveHandler(req: Request, res: Response): Promise<void> {
    res.type("application/json");
    const rawVideoId = (req.body as { videoId?: unknown })?.videoId;
    const videoId =
      typeof rawVideoId === "string" ? rawVideoId.trim() : "";
    const rawSgi = (req.body as { sgi?: unknown })?.sgi;
    const sgi =
      typeof rawSgi === "string" && rawSgi.trim() ? rawSgi.trim() : undefined;

    if (!videoId && !sgi) {
      sendError(res, 400, { message: "missing_video_id" });
      return;
    }

    const cacheKey = makeCacheKey(videoId, sgi);
    const cached = getCached(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const payload = await getInflight(session, cacheKey, videoId, sgi);
      res.json(payload);
    } catch (error) {
      console.warn(
        "[resolve][error]",
        (error as Error)?.message ?? "resolve_failed",
      );
      const statusCode =
        (error as { statusCode?: number })?.statusCode ?? 503;
      const upstreamStatus = (error as { upstreamStatus?: number }).upstreamStatus;
      const code = (error as { code?: string })?.code;
      if (statusCode === 404) {
        sendError(res, 404, { code: code ?? "not_found" });
        return;
      }
      if (statusCode === 502) {
        sendError(res, 502, { upstreamStatus });
        return;
      }
      if (statusCode === 400) {
        sendError(res, 400, { message: code ?? "bad_request" });
        return;
      }
      sendError(res, 503, { message: "resolve_failed" });
    }
  };
}
