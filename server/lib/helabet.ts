import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import {
  fetchWithRetry as fetchWithRetryHttp,
  headersCommon,
  mergeHeaders,
  readCache,
  writeCache,
} from "./http.js";

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
  raw?: Record<string, unknown>;
}

export interface ResolveResult {
  url: string;
  streamId?: string;
  ttlHintSec: number;
  raw?: Record<string, unknown>;
}

export interface ChampionSummary {
  li: number;
  name: string;
  sportId: number;
  sportName?: string;
}

type FetchMethod = "GET" | "POST";

interface HelabetRequestOptions {
  pathname: string;
  searchParams?: URLSearchParams;
  method?: FetchMethod;
  body?: unknown;
  cookies?: string;
  headers?: Record<string, string>;
}

const DEFAULTS = {
  HELABET_BASE: "https://helabet.com",
  HELABET_PARTNER: "237",
  HELABET_COUNTRY: "147",
  HELABET_LANG: "en",
  APP_ID: "3",
  APP_VER: "1025",
  VPC_VER: "1.0.17",
  SERVER_TIMEOUT_MS: "5000",
  RESOLVE_TTL_HINT: "90",
} as const;

const RESOLVE_CACHE = new Map<
  string,
  { result: ResolveResult; expiresAt: number }
>();
const RESOLVE_BREAKER = new Map<
  string,
  { failures: number; blockedUntil: number }
>();
const LEAGUE_BREAKER = new Map<number, { failures: number; blockedUntil: number }>();
const TOP_GAMES_BREAKER: { blockedUntil: number; warning?: string | null } = {
  blockedUntil: 0,
  warning: null,
};

const leaguesPath = path.resolve(process.cwd(), "server/data/leagues.json");
const matchesPath = path.resolve(process.cwd(), "server/data/matches.json");
const DEMO_STREAM_PREFIX = "demo-";
const DEMO_STREAM_URL =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const SPORT_FILTER = (() => {
  const raw = getOptionalEnv("HELABET_SPORT_FILTER");
  if (!raw) {
    return [1, 2, 3, 4];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const normalized = parsed
        .map((value) => {
          const numeric =
            typeof value === "number"
              ? value
              : typeof value === "string"
                ? Number.parseInt(value, 10)
                : NaN;
          return Number.isFinite(numeric) ? numeric : null;
        })
        .filter((value) => value !== null) as number[];
      if (normalized.length > 0) {
        return normalized;
      }
    }
  } catch (error) {
    console.warn("[helabet] Failed to parse HELABET_SPORT_FILTER", (error as Error)?.message);
  }
  return [1, 2, 3, 4];
})();
const MAX_REMOTE_CHAMPIONS = 64;

const getEnv = (key: keyof typeof DEFAULTS) =>
  process.env[key] ?? DEFAULTS[key];

function getOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

const configureProxy = () => {
  const proxyUrl = getOptionalEnv("HELABET_HTTP_PROXY");
  if (proxyUrl) {
    try {
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
      console.log("[helabet] Using outbound proxy:", proxyUrl);
    } catch (error) {
      console.warn("[helabet] Failed to configure proxy", (error as Error)?.message);
    }
  }
};

configureProxy();

const SPORT_GROUP_MAP: Record<number, number> | null = (() => {
  const raw = getOptionalEnv("HELABET_GROUP_MAP");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const normalized: Record<number, number> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const sportId = Number.parseInt(key, 10);
      if (!Number.isNaN(sportId) && Number.isFinite(value)) {
        normalized[sportId] = value;
      }
    });
    return Object.keys(normalized).length > 0 ? normalized : null;
  } catch (error) {
    console.warn("[helabet] Failed to parse HELABET_GROUP_MAP", (error as Error)?.message);
    return null;
  }
})();

const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[^\x20-\x7E]/g, "");

const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (typeof value === "string") {
      const sanitized = sanitizeHeaderValue(value);
      if (sanitized) {
        result[key] = sanitized;
      }
    }
  });
  return result;
};

const getHeaderOverrides = (): Record<string, string> | null => {
  const raw = getOptionalEnv("HELABET_HEADER_OVERRIDES");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const normalized: Record<string, string> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof key === "string" && typeof value === "string" && key.trim()) {
        normalized[key.trim().toLowerCase()] = value;
      }
    });
    return Object.keys(normalized).length > 0 ? normalized : null;
  } catch (error) {
    console.warn("[helabet] Failed to parse HELABET_HEADER_OVERRIDES", (error as Error)?.message);
    return null;
  }
};

const HEADER_OVERRIDES = getHeaderOverrides();

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
};

const parseStartTimestamp = (input: unknown): number => {
  if (typeof input === "number") {
    if (input > 1_000_000_000_000) {
      return input;
    }
    return input * 1000;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return 0;
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(numeric)) {
      if (trimmed.length === 10) {
        return numeric * 1000;
      }
      if (trimmed.length === 13) {
        return numeric;
      }
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const parseOutcomeValue = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("C" in record) return parseOutcomeValue(record.C);
    if ("V" in record) return parseOutcomeValue(record.V);
    if ("value" in record) return parseOutcomeValue(record.value);
    if ("Odd" in record) return parseOutcomeValue(record.Odd);
  }
  return null;
};

const parseOddsArray = (entries: unknown): StreamMatch["odds"] => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  const [home, draw, away] = entries;
  const w1 = parseOutcomeValue(home);
  const x = parseOutcomeValue(draw);
  const w2 = parseOutcomeValue(away);
  if (w1 === null || w2 === null) {
    return null;
  }
  const odds: StreamMatch["odds"] = { w1, w2 };
  if (x !== null) {
    odds.x = x;
  }
  return odds;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const collectChampions = (
  node: unknown,
  sportId: number,
  bucket: ChampionSummary[],
) => {
  if (!isRecord(node)) {
    return;
  }
  const li = toNumber(node.LI ?? node.li);
  const nameSource =
    typeof node.L === "string"
      ? node.L
      : typeof node.LR === "string"
        ? node.LR
        : typeof node.Name === "string"
          ? node.Name
          : "";
  const name = nameSource.trim();
  if (li > 0 && !bucket.some((entry) => entry.li === li)) {
    bucket.push({
      li,
      name: name || `Champion ${li}`,
      sportId,
      sportName:
        typeof node.SN === "string"
          ? node.SN.trim()
          : undefined,
    });
  }
  const childCollections = [];
  if (Array.isArray(node.SC)) {
    childCollections.push(...node.SC);
  }
  if (Array.isArray(node.SG)) {
    childCollections.push(...node.SG);
  }
  childCollections.forEach((child) =>
    collectChampions(child, sportId, bucket),
  );
};

const fetchChampionsForSport = async (
  sportId: number,
  cookies?: string,
): Promise<ChampionSummary[]> => {
  const mappedGroupId = SPORT_GROUP_MAP?.[sportId];
  if (mappedGroupId) {
    const params = new URLSearchParams({
      lng: getEnv("HELABET_LANG"),
      gr: String(mappedGroupId),
      country: getEnv("HELABET_COUNTRY"),
    });
    try {
      const payload = await requestHelabet<{ Value?: unknown[] }>({
        pathname: "/service-api/LiveFeed/WebGetTopChampsZip",
        searchParams: params,
        cookies,
      });
      const bucket: ChampionSummary[] = [];
      const entries = Array.isArray(payload?.Value) ? payload?.Value : [];
      entries.forEach((item) => collectChampions(item, sportId, bucket));
      return bucket;
    } catch (error) {
      console.warn("fetchWebTopChampsZip failed", {
        sportId,
        group: mappedGroupId,
        message: (error as Error)?.message,
      });
    }
  }

  const params = new URLSearchParams({
    sport: String(sportId),
    lng: getEnv("HELABET_LANG"),
    partner: getEnv("HELABET_PARTNER"),
    country: getEnv("HELABET_COUNTRY"),
    virtualSports: "true",
    groupChamps: "true",
  });

  try {
    const payload = await requestHelabet<{ Value?: unknown[] }>({
      pathname: "/service-api/LiveFeed/GetChampsZip",
      searchParams: params,
      cookies,
    });
    const bucket: ChampionSummary[] = [];
    const entries = Array.isArray(payload?.Value) ? payload?.Value : [];
    entries.forEach((item) => collectChampions(item, sportId, bucket));
    return bucket;
  } catch (error) {
    console.warn("fetchChampsZip failed", {
      sportId,
      message: (error as Error)?.message,
    });
    return [];
  }
};

const buildHelabetUrl = (pathname: string, searchParams?: URLSearchParams) => {
  const base = getEnv("HELABET_BASE");
  const url = new URL(pathname, base);
  if (searchParams) {
    searchParams.forEach((value, key) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
  }
  return url;
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveCookies = (incoming?: string): string | undefined => {
  if (incoming && incoming.trim()) {
    return incoming;
  }
  return getOptionalEnv("HELABET_COOKIE");
};

const requestHelabet = async <T>(
  options: HelabetRequestOptions,
): Promise<T> => {
  const timeoutMs = Number.parseInt(getEnv("SERVER_TIMEOUT_MS"), 10) || 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { pathname, searchParams, method = "GET", body, cookies, headers } =
      options;

    const url = buildHelabetUrl(pathname, searchParams);
    const helabetBase = new URL(getEnv("HELABET_BASE"));
    const resolvedUserAgent =
      headers?.["user-agent"] ??
      getOptionalEnv("HELABET_USER_AGENT") ??
      "curl/8.7.1";
    const isSafariUserAgent =
      /Safari/i.test(resolvedUserAgent) && !/Chrome/i.test(resolvedUserAgent);
    const resolvedOrigin = getOptionalEnv("HELABET_ORIGIN");
    const resolvedReferer = getOptionalEnv("HELABET_REFERER");
    const resolvedAccept =
      headers?.accept ?? getOptionalEnv("HELABET_ACCEPT") ?? "*/*";
    const resolvedAcceptLanguage =
      headers?.["accept-language"] ??
      getOptionalEnv("HELABET_ACCEPT_LANGUAGE") ??
      "en-US,en;q=0.9";

    const defaultHeaders: Record<string, string> = {
      accept: resolvedAccept,
      "accept-language": resolvedAcceptLanguage,
      "user-agent": resolvedUserAgent,
      "accept-encoding": "gzip, deflate, br",
    };
    if (resolvedOrigin) {
      defaultHeaders.origin = resolvedOrigin;
    }
    if (resolvedReferer) {
      defaultHeaders.referer = resolvedReferer;
    }
    if (!isSafariUserAgent) {
      const defaultSecUa =
        getOptionalEnv("HELABET_SEC_CH_UA") ??
        '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
      defaultHeaders["sec-ch-ua"] = defaultSecUa;
      defaultHeaders["sec-ch-ua-mobile"] =
        getOptionalEnv("HELABET_SEC_CH_UA_MOBILE") ?? "?0";
      defaultHeaders["sec-ch-ua-platform"] =
        getOptionalEnv("HELABET_SEC_CH_UA_PLATFORM") ?? '"Windows"';
      if (getOptionalEnv("HELABET_PRIORITY")) {
        defaultHeaders.priority = getOptionalEnv("HELABET_PRIORITY")!;
      }
    }
    if (getOptionalEnv("HELABET_SEC_FETCH_SITE")) {
      defaultHeaders["sec-fetch-site"] =
        getOptionalEnv("HELABET_SEC_FETCH_SITE")!;
    }
    if (getOptionalEnv("HELABET_SEC_FETCH_MODE")) {
      defaultHeaders["sec-fetch-mode"] =
        getOptionalEnv("HELABET_SEC_FETCH_MODE")!;
    }
    if (getOptionalEnv("HELABET_SEC_FETCH_DEST")) {
      defaultHeaders["sec-fetch-dest"] =
        getOptionalEnv("HELABET_SEC_FETCH_DEST")!;
    }
    if (getOptionalEnv("HELABET_X_REQUESTED_WITH")) {
      defaultHeaders["x-requested-with"] =
        getOptionalEnv("HELABET_X_REQUESTED_WITH")!;
    }
    if (getOptionalEnv("HELABET_IS_SRV")) {
      defaultHeaders["is-srv"] = getOptionalEnv("HELABET_IS_SRV")!;
    }
    const customHeaders: Record<string, string> = {};
    const hdToken = getOptionalEnv("HELABET_X_HD");
    if (hdToken) customHeaders["x-hd"] = hdToken;
    const appName = getOptionalEnv("HELABET_APP_NAME");
    if (appName) {
      customHeaders["x-app-n"] = appName;
      customHeaders["x-svc-source"] = appName;
    }
    const effectiveCookies = resolveCookies(cookies);
    const baseHeaders: Record<string, string> = {
      ...defaultHeaders,
      ...customHeaders,
      ...(effectiveCookies ? { cookie: effectiveCookies } : {}),
      ...headers,
    };
    if (HEADER_OVERRIDES) {
      Object.entries(HEADER_OVERRIDES).forEach(([key, value]) => {
        baseHeaders[key] = value;
      });
    }
    if (body) {
      baseHeaders["content-type"] = "application/json";
    }
    const finalHeaders = sanitizeHeaders(baseHeaders);

    const attemptFetch = async (): Promise<Response> => {
      return fetch(url, {
        method,
        headers: finalHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    };

    const maxAttempts = 2;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      try {
        const response = await attemptFetch();
        if (!response.ok) {
          const errorBody = await response
            .text()
            .catch(() => "");
          const snippet = errorBody ? errorBody.slice(0, 200) : "";
          const error = new Error(
            `Helabet request failed: ${response.status} ${response.statusText}${
              snippet ? ` ${snippet}` : ""
            }`,
          );
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }
        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt >= maxAttempts) {
          break;
        }
        await delay(150 + Math.random() * 150);
      }
    }

    throw lastError;
  } finally {
    clearTimeout(timer);
  }
};

export const loadLeagues = async (
  cookies?: string,
): Promise<ChampionSummary[]> => {
  const sourceUrl = process.env.LEAGUES_SOURCE_URL;
  if (sourceUrl) {
    try {
      const response = await fetch(sourceUrl, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Failed to load leagues: ${response.status}`);
      }
      return (await response.json()) as ChampionSummary[];
    } catch (error) {
      console.warn("Failed to load remote leagues", (error as Error)?.message);
    }
  }

  try {
    const remoteResults = await Promise.all(
      SPORT_FILTER.map((sportId) => fetchChampionsForSport(sportId, cookies)),
    );
    const combined = remoteResults.flat();
    if (combined.length > 0) {
      const deduped = new Map<number, ChampionSummary>();
      combined.forEach((entry) => {
        if (!deduped.has(entry.li)) {
          deduped.set(entry.li, entry);
        }
      });
      return Array.from(deduped.values()).slice(0, MAX_REMOTE_CHAMPIONS);
    }
  } catch (error) {
    console.warn("Failed to aggregate champs", (error as Error)?.message);
  }

  try {
    const raw = await readFile(leaguesPath, "utf-8");
    return JSON.parse(raw) as ChampionSummary[];
  } catch (error) {
    console.warn("Failed to load local leagues", (error as Error)?.message);
    return [];
  }
};

export const fetchMatchesWithVideo = async (
  leagueId: number,
  cookies?: string,
): Promise<{ matches: StreamMatch[]; warning?: string }> => {
  const now = Date.now();
  const breaker = LEAGUE_BREAKER.get(leagueId);
  if (breaker && breaker.blockedUntil > now) {
    const fallback = await loadFallbackMatches();
    const matched = fallback.filter((match) => match.leagueId === leagueId);
    if (matched.length > 0) {
      return { matches: matched, warning: "fallback_cached" };
    }
    return { matches: [], warning: "upstream_failed" };
  }

  const params = new URLSearchParams({
    champ: String(leagueId),
    lng: getEnv("HELABET_LANG"),
    partner: getEnv("HELABET_PARTNER"),
    country: getEnv("HELABET_COUNTRY"),
    groupChamps: "true",
  });

  try {
    const payload = await requestHelabet<{ Value?: { G?: unknown[] } }>({
      pathname: "/service-api/LiveFeed/GetChampZip",
      searchParams: params,
      cookies,
    });

    const matchesRaw = Array.isArray(payload?.Value?.G)
      ? payload.Value?.G
      : [];

    const matches = matchesRaw
      .map((item) => mapStreamMatch(item, leagueId))
      .filter((entry): entry is StreamMatch => Boolean(entry?.videoId));

    return { matches };
  } catch (error) {
    const message = (error as Error)?.message;
    console.warn("fetchMatchesWithVideo failed", {
      leagueId,
      message,
    });

    const failures = (breaker?.failures ?? 0) + 1;
    const backoffMs = Math.min(10 * 60 * 1000, 1000 * 2 ** Math.min(failures, 6));
    LEAGUE_BREAKER.set(leagueId, {
      failures,
      blockedUntil: now + backoffMs,
    });

    const fallback = await loadFallbackMatches();
    const matched = fallback.filter((match) => match.leagueId === leagueId);
    if (matched.length > 0) {
      return { matches: matched, warning: "fallback_data" };
    }

    return { matches: [], warning: "upstream_failed" };
  }
};

const buildSearchQuery = (text: string): URLSearchParams => {
  const params = new URLSearchParams({
    limit: getOptionalEnv("HELABET_SEARCH_LIMIT") ?? "50",
    lng: getEnv("HELABET_LANG"),
    mode: getOptionalEnv("HELABET_SEARCH_MODE") ?? "4",
    userId: getOptionalEnv("HELABET_SEARCH_USER_ID") ?? "0",
    strict: getOptionalEnv("HELABET_SEARCH_STRICT") ?? "true",
    country: getEnv("HELABET_COUNTRY"),
    text,
  });
  return params;
};

export const searchLiveMatches = async (
  text: string,
  cookies?: string,
): Promise<unknown> => {
  const params = buildSearchQuery(text);
  return requestHelabet<{ Value?: unknown }>({
    pathname: "/service-api/LiveFeed/Web_SearchZip",
    searchParams: params,
    cookies,
  });
};

export const searchLineMatches = async (
  text: string,
  cookies?: string,
): Promise<unknown> => {
  const params = buildSearchQuery(text);
  return requestHelabet<{ Value?: unknown }>({
    pathname: "/service-api/LineFeed/Web_SearchZip",
    searchParams: params,
    cookies,
  });
};

const collectChampionIdsFromNode = (
  node: unknown,
  target: Set<number>,
): void => {
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  const li = toNumber(record.LI);
  if (li > 0) {
    target.add(li);
  }
  if (Array.isArray(record.SG)) {
    (record.SG as unknown[]).forEach((child) =>
      collectChampionIdsFromNode(child, target),
    );
  }
  if (Array.isArray(record.SC)) {
    (record.SC as unknown[]).forEach((child) =>
      collectChampionIdsFromNode(child, target),
    );
  }
};

const fetchChampionIdsForSport = async (
  sportId: number,
  cookies?: string,
): Promise<{ ids: number[]; warning?: string }> => {
  const mappedGroupId = SPORT_GROUP_MAP?.[sportId];
  if (mappedGroupId) {
    const params = new URLSearchParams({
      lng: getEnv("HELABET_LANG"),
      gr: String(mappedGroupId),
      country: getEnv("HELABET_COUNTRY"),
    });
    try {
      const payload = await requestHelabet<{ Value?: unknown[] }>({
        pathname: "/service-api/LiveFeed/WebGetTopChampsZip",
        searchParams: params,
        cookies,
      });
      const values = Array.isArray(payload?.Value) ? payload?.Value : [];
      const ids = new Set<number>();
      values.forEach((entry) => collectChampionIdsFromNode(entry, ids));
      if (ids.size > 0) {
        return { ids: Array.from(ids) };
      }
    } catch (error) {
      const message = (error as Error)?.message ?? "fetch_failed";
      console.warn("fetchChampionIdsForSport web fallback failed", {
        sportId,
        group: mappedGroupId,
        message,
      });
    }
  }

  const params = new URLSearchParams({
    sport: String(sportId),
    lng: getEnv("HELABET_LANG"),
    partner: getEnv("HELABET_PARTNER"),
    country: getEnv("HELABET_COUNTRY"),
    virtualSports: "true",
    groupChamps: "true",
  });
  try {
    const payload = await requestHelabet<{ Value?: unknown[] }>({
      pathname: "/service-api/LiveFeed/GetChampsZip",
      searchParams: params,
      cookies,
    });
    const values = Array.isArray(payload?.Value) ? payload?.Value : [];
    const ids = new Set<number>();
    values.forEach((entry) => collectChampionIdsFromNode(entry, ids));
    return { ids: Array.from(ids) };
  } catch (error) {
    const message = (error as Error)?.message ?? "fetch_failed";
    console.warn("fetchChampionIdsForSport failed", { sportId, message });
    return { ids: [], warning: message };
  }
};

const fetchTopGamesChampionIds = async (
  cookies?: string,
): Promise<{ ids: number[]; warning?: string }> => {
  const enabledRaw = getOptionalEnv("HELABET_ENABLE_TOP_GAMES");
  if (enabledRaw && ["false", "0", "no"].includes(enabledRaw.toLowerCase())) {
    return { ids: [] };
  }

  const now = Date.now();
  if (TOP_GAMES_BREAKER.blockedUntil > now) {
    return {
      ids: [],
      warning:
        TOP_GAMES_BREAKER.warning ??
        `top_games_blocked_${TOP_GAMES_BREAKER.blockedUntil - now}`,
    };
  }

  const params = new URLSearchParams({
    lng: getEnv("HELABET_LANG"),
    partner: getEnv("HELABET_PARTNER"),
    antisports: getOptionalEnv("HELABET_ANTISPORTS") ?? "66",
  });
  try {
    const payload = await requestHelabet<{ Value?: unknown[] }>({
      pathname: "/service-api/LiveFeed/GetTopGamesStatZip",
      searchParams: params,
      cookies,
    });
    const values = Array.isArray(payload?.Value) ? payload?.Value : [];
    TOP_GAMES_BREAKER.blockedUntil = 0;
    TOP_GAMES_BREAKER.warning = null;
    const ids = new Set<number>();
    values.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const record = entry as Record<string, unknown>;
      const primaryId = toNumber(record.LI ?? record.CI);
      if (primaryId > 0) {
        ids.add(primaryId);
      }
      if (Array.isArray(record.AVZ)) {
        (record.AVZ as unknown[]).forEach((alt) => {
          if (!alt || typeof alt !== "object") return;
          const altRecord = alt as Record<string, unknown>;
          const altId = toNumber(altRecord.CI);
          if (altId > 0) {
            ids.add(altId);
          }
        });
      }
    });
    return { ids: Array.from(ids) };
  } catch (error) {
    const message = (error as Error)?.message ?? "fetch_failed";
    console.warn("fetchTopGamesChampionIds failed", { message });
    TOP_GAMES_BREAKER.blockedUntil = Date.now() + 5 * 60 * 1000;
    TOP_GAMES_BREAKER.warning = message;
    return { ids: [], warning: message };
  }
};

export const fetchLiveMatches = async (
  cookies?: string,
): Promise<{ matches: StreamMatch[]; warnings: string[] }> => {
  const championIdSet = new Set<number>();
  const warnings: string[] = [];

  const { ids: topIds, warning: topWarning } =
    await fetchTopGamesChampionIds(cookies);
  if (topWarning) {
    warnings.push(`top_games:${topWarning}`);
  }
  topIds.forEach((id) => championIdSet.add(id));

  for (const sportId of SPORT_FILTER) {
    const { ids, warning } = await fetchChampionIdsForSport(sportId, cookies);
    if (warning) {
      warnings.push(`sport:${sportId}:${warning}`);
    }
    ids.forEach((id) => championIdSet.add(id));
  }

  if (championIdSet.size === 0) {
    return { matches: [], warnings };
  }

  const matches: StreamMatch[] = [];
  const seenMatchIds = new Set<number>();

  for (const champId of championIdSet) {
    const { matches: champMatches, warning } = await fetchMatchesWithVideo(
      champId,
      cookies,
    );
    if (warning) {
      warnings.push(`champ:${champId}:${warning}`);
    }
    champMatches.forEach((match) => {
      if (match?.matchId && !seenMatchIds.has(match.matchId)) {
        seenMatchIds.add(match.matchId);
        matches.push(match);
      }
    });
  }

  return { matches, warnings };
};

export const mapStreamMatch = (
  match: unknown,
  fallbackLeagueId?: number,
): StreamMatch | null => {
  if (!match || typeof match !== "object") {
    return null;
  }
  const record = match as Record<string, unknown>;
  const videoIdRaw = record.VI ?? record.VideoId;
  const videoId =
    typeof videoIdRaw === "string"
      ? videoIdRaw.trim()
      : typeof videoIdRaw === "number"
        ? String(videoIdRaw)
        : "";

  if (!videoId) {
    return null;
  }

  const nameHome =
    typeof record.O1 === "string"
      ? record.O1.trim()
      : typeof record.Home === "string"
        ? record.Home.trim()
        : "";
  const nameAway =
    typeof record.O2 === "string"
      ? record.O2.trim()
      : typeof record.Away === "string"
        ? record.Away.trim()
        : "";

  const matchId = toNumber(record.CI ?? record.ID ?? record.GameId);
  const sportId = toNumber(record.SE ?? record.SportId);
  const leagueId = toNumber(record.LI ?? fallbackLeagueId ?? 0);
  const startTs = parseStartTimestamp(record.S ?? record.Start ?? record.ST);
  const odds = parseOddsArray(record.E);

  return {
    matchId,
    leagueId,
    sportId,
    nameHome,
    nameAway,
    startTs,
    videoId,
    odds,
    raw: record,
  };
};

let fallbackMatchesCache: StreamMatch[] | null = null;

const loadFallbackMatches = async (): Promise<StreamMatch[]> => {
  if (fallbackMatchesCache) {
    return fallbackMatchesCache;
  }
  try {
    const raw = await readFile(matchesPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      fallbackMatchesCache = [];
      return fallbackMatchesCache;
    }

    fallbackMatchesCache = parsed
      .map((item) => mapStreamMatch(item, item?.leagueId))
      .filter((value): value is StreamMatch => Boolean(value?.videoId));

    return fallbackMatchesCache;
  } catch (error) {
    console.warn("Failed to load fallback matches", (error as Error)?.message);
    fallbackMatchesCache = [];
    return fallbackMatchesCache;
  }
};

const extractStreamId = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  const match = url.match(/\/(\d+)\/1\/mediaplaylist\.m3u8/i);
  if (match) {
    return match[1];
  }
  return undefined;
};

export const resolveVideoStream = async (
  videoId: string,
  cookies?: string,
): Promise<ResolveResult> => {
  if (videoId.startsWith(DEMO_STREAM_PREFIX)) {
    const result: ResolveResult = {
      url: DEMO_STREAM_URL,
      streamId: videoId,
      ttlHintSec: 300,
    };
    RESOLVE_CACHE.set(videoId, {
      result,
      expiresAt: Date.now() + 300 * 1000,
    });
    return result;
  }

  const ttlHint = Number.parseInt(getEnv("RESOLVE_TTL_HINT"), 10) || 90;
  const now = Date.now();

  const cached = RESOLVE_CACHE.get(videoId);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const breaker = RESOLVE_BREAKER.get(videoId);
  if (breaker && breaker.blockedUntil > now) {
    throw new Error("resolve_circuit_open");
  }

  try {
    const response = await requestHelabet<{ URL?: string; [key: string]: unknown }>({
      pathname: "/cinema",
      method: "POST",
      body: {
        AppId: Number.parseInt(getEnv("APP_ID"), 10),
        AppVer: getEnv("APP_VER"),
        VpcVer: getEnv("VPC_VER"),
        Language: getEnv("HELABET_LANG"),
        Token: "",
        VideoId: videoId,
      },
      cookies,
    });

    const url = typeof response.URL === "string" ? response.URL : "";
    if (!url) {
      throw new Error("resolve_failed");
    }

    const result: ResolveResult = {
      url,
      streamId: extractStreamId(url),
      ttlHintSec: ttlHint,
      raw: response,
    };

    RESOLVE_CACHE.set(videoId, {
      result,
      expiresAt: now + ttlHint * 1000,
    });
    RESOLVE_BREAKER.delete(videoId);

    return result;
  } catch (error) {
    const failures = (breaker?.failures ?? 0) + 1;
    const backoffMs = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
    RESOLVE_BREAKER.set(videoId, {
      failures,
      blockedUntil: now + backoffMs,
    });
    throw error;
  }
};

export class HelabetProxyError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HelabetProxyError";
    this.status = status;
    this.details = details;
  }
}

const sanitizeBaseUrl = (value: string | undefined, fallback: string): string => {
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    const normalized = url.toString().replace(/\/+$/, "");
    return normalized || fallback;
  } catch {
    return fallback;
  }
};

const HELABET_BASE_URL = sanitizeBaseUrl(
  getOptionalEnv("HELABET_BASE"),
  "https://helabet.com",
);

const HELABET_BFF_URL = sanitizeBaseUrl(
  getOptionalEnv("HELABET_BFF"),
  `${HELABET_BASE_URL}/service-api`,
);

const HELABET_PARTNER_ID =
  getOptionalEnv("HELABET_PARTNER") ?? DEFAULTS.HELABET_PARTNER;
const HELABET_LANGUAGE =
  getOptionalEnv("HELABET_LNG") ?? getEnv("HELABET_LANG");
const HELABET_COUNTRY_CODE = getOptionalEnv("HELABET_COUNTRY");

const champsCacheKey = (sport: number, virtual: boolean): string =>
  `champs:${sport}:${virtual ? 1 : 0}:${HELABET_COUNTRY_CODE ?? "all"}`;
const champCacheKey = (champ: number): string =>
  `champ:${champ}:${HELABET_COUNTRY_CODE ?? "all"}`;
const streamCacheKey = (videoId: string): string => `stream:${videoId}`;

const requestHelabetJson = async <T>(
  url: URL,
  init: RequestInit,
  context: string,
): Promise<T> => {
  const response = await fetchWithRetryHttp(url, init, 3);
  const text = await response.text();

  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        throw new HelabetProxyError(
          502,
          `${context}_invalid_json`,
          (error as Error)?.message ?? text,
        );
      }
    }
  }

  if (!response.ok) {
    throw new HelabetProxyError(
      response.status,
      `${context}_upstream_error`,
      parsed ?? text,
    );
  }

  return (parsed ?? {}) as T;
};

const buildGetUrl = (pathname: string, params: URLSearchParams): URL => {
  const base = pathname.startsWith("/service-api")
    ? HELABET_BASE_URL
    : HELABET_BFF_URL;
  const url = new URL(
    pathname.startsWith("/")
      ? pathname
      : `/service-api/${pathname.replace(/^\//, "")}`,
    base,
  );
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return url;
};

const createCinemaUrl = (): URL =>
  new URL("/cinema", HELABET_BASE_URL.replace(/\/+$/, "") + "/");

export const apiGetChampsZip = async (
  sport: number,
  virtual: boolean,
): Promise<unknown> => {
  const cacheKey = champsCacheKey(sport, virtual);
  const cached = readCache<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    sport: String(sport),
    lng: HELABET_LANGUAGE,
    partner: HELABET_PARTNER_ID,
    groupChamps: "true",
  });

  if (virtual) {
    params.set("virtualSports", "true");
  }
  if (HELABET_COUNTRY_CODE) {
    params.set("country", HELABET_COUNTRY_CODE);
  }

  const url = buildGetUrl("/service-api/LiveFeed/GetChampsZip", params);

  const headers = headersCommon();
  const payload = await requestHelabetJson<unknown>(
    url,
    {
      method: "GET",
      headers,
    },
    "get_champs",
  );

  writeCache(cacheKey, payload, 15_000);
  return payload;
};

export const apiGetChampZip = async (champ: number): Promise<unknown> => {
  const cacheKey = champCacheKey(champ);
  const cached = readCache<unknown>(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    champ: String(champ),
    lng: HELABET_LANGUAGE,
    partner: HELABET_PARTNER_ID,
    groupChamps: "true",
  });

  if (HELABET_COUNTRY_CODE) {
    params.set("country", HELABET_COUNTRY_CODE);
  }

  const url = buildGetUrl("/service-api/LiveFeed/GetChampZip", params);

  const headers = headersCommon();
  const payload = await requestHelabetJson<unknown>(
    url,
    {
      method: "GET",
      headers,
    },
    "get_champ",
  );

  writeCache(cacheKey, payload, 10_000);
  return payload;
};

export const apiGetCinemaUrl = async (
  videoId: string,
): Promise<{ url: string }> => {
  const cacheKey = streamCacheKey(videoId);
  const cached = readCache<{ url: string }>(cacheKey);
  if (cached) {
    return cached;
  }

  const url = createCinemaUrl();
  const headers = mergeHeaders(headersCommon(), {
    "Content-Type": "application/json",
  });

  const body = JSON.stringify({
    AppId: 3,
    AppVer: "1025",
    VpcVer: "1.0.17",
    Language: HELABET_LANGUAGE,
    Token: "",
    VideoId: videoId,
  });

  const payload = await requestHelabetJson<{ URL?: string }>(
    url,
    {
      method: "POST",
      headers,
      body,
    },
    "get_stream",
  );

  const streamUrl = typeof payload.URL === "string" ? payload.URL : "";
  if (!streamUrl) {
    throw new HelabetProxyError(502, "stream_url_missing", payload);
  }

  const result = { url: streamUrl };
  writeCache(cacheKey, result, 45_000);
  return result;
};
