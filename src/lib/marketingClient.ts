import { fetch } from "undici";
import { MarketingAuth } from "./marketingAuth.js";

type FetchLike = typeof fetch;

const DEFAULT_MARKETING_BASE = "https://cpservm.com/gateway/marketing";
const DEFAULT_CACHE_TTL_MS = 5_000;

const sanitizeBaseUrl = (value?: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_MARKETING_BASE;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(`Unsupported protocol: ${parsed.protocol}`);
    }
    return trimmed.replace(/\/+$/, "");
  } catch (error) {
    console.warn(
      `[marketing] invalid MARKETING_API_BASE "${trimmed}" — fallback ${DEFAULT_MARKETING_BASE}`,
      (error as Error)?.message ?? String(error),
    );
    return DEFAULT_MARKETING_BASE;
  }
};

export interface MarketingClientConfig {
  baseUrl: string;
  ref: string;
  language: string;
  periods: string[];
  cacheTtlMs?: number;
  groupId?: string;
  countryId?: string;
  partnerLink?: string;
  types?: string[];
  vids?: string[];
  oddsIds?: string[];
  oddsScheme?: string;
}

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
  status: number;
};

type CacheResult<T> = {
  data: T;
  status: number;
  source: "cache" | "network";
};

type MarketingListResponse<T> = {
  items?: T[];
};

export type MarketingSport = {
  id?: number | null;
  sportId?: number | null;
  name?: string | null;
  nameLocalization?: string | null;
  title?: string | null;
};

export type MarketingSportEvent = {
  sportEventId?: number;
  mainConstSportEventId?: number;
  constSportEventId?: number;
  lineConstId?: number;
  tournamentId?: number;
  sportId?: number;
  subSportId?: number;
  tournamentNameLocalization?: string;
  opponent1NameLocalization?: string;
  opponent2NameLocalization?: string;
  startDate?: number;
  link?: string;
  oddsLocalization?: Array<{
    type?: number;
    parameter?: number;
    oddsMarket?: number;
    display?: string;
    isBlocked?: boolean;
  }>;
  hasVideo?: boolean;
  waitingLive?: boolean;
  matchInfoObject?: Record<string, unknown>;
  stadiumInfoObject?: Record<string, unknown>;
  statGameId?: string | number | null;
  currentPeriodName?: string | null;
  period?: number;
  vid?: number;
  type?: number;
  helabetVideoId?: string | null;
  helabetSgi?: string | null;
};

export interface SportEventsParams {
  sportIds: number[];
  periodsOverride?: string[];
  label?: string;
  applyFilters?: boolean;
  gtStartSec?: number;
  ltStartSec?: number;
}

export class MarketingClient {
  private readonly auth: MarketingAuth;

  private readonly fetchImpl: FetchLike;

  private readonly baseUrl: string;

  private readonly cacheTtlMs: number;

  private readonly config: Required<
    Pick<MarketingClientConfig, "ref" | "language" | "periods">
  > &
    Omit<MarketingClientConfig, "ref" | "language" | "periods">;

  private cache = new Map<string, CacheEntry<unknown>>();

  private inflight = new Map<string, Promise<{ data: unknown; status: number }>>();

  constructor(
    config: MarketingClientConfig,
    auth: MarketingAuth,
    fetchImpl: FetchLike = fetch,
  ) {
    this.auth = auth;
    this.fetchImpl = fetchImpl;
    this.baseUrl = sanitizeBaseUrl(config.baseUrl);
    this.cacheTtlMs =
      typeof config.cacheTtlMs === "number" && Number.isFinite(config.cacheTtlMs)
        ? Math.max(1_000, config.cacheTtlMs)
        : DEFAULT_CACHE_TTL_MS;

    this.config = {
      ...config,
      ref: config.ref?.trim() || "1",
      language: config.language?.trim() || "en",
      periods: Array.isArray(config.periods) && config.periods.length
        ? config.periods
        : ["0", "1", "2"],
      types: (config.types ?? []).filter(Boolean),
      vids: (config.vids ?? []).filter(Boolean),
      oddsIds: (config.oddsIds ?? []).filter(Boolean),
      oddsScheme: config.oddsScheme?.trim() || "",
    };
  }

  usesTypesFilter(): boolean {
    return (this.config.types ?? []).length > 0;
  }

  usesVidsFilter(): boolean {
    return (this.config.vids ?? []).length > 0;
  }

  describeBaseQuery(applyFilters = false): string {
    const params = this.buildBaseQuery({}, applyFilters);
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      search.append(key, value);
    });
    return search.toString();
  }

  async getSports(): Promise<MarketingSport[]> {
    const query: Record<string, string> = {
      Ref: this.config.ref,
      Lng: this.config.language,
    };
    const cacheKey = this.buildCacheKey("/datafeed/directories/api/v2/sports", query);
    const result = await this.fetchWithCache<MarketingListResponse<MarketingSport>>(
      cacheKey,
      this.cacheTtlMs,
      () =>
        this.performRequest<MarketingListResponse<MarketingSport>>(
          "/datafeed/directories/api/v2/sports",
          query,
        ),
    );
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    console.log("[marketing] sports count:", items.length);
    return items;
  }

  async getSportEventsLive(params: SportEventsParams): Promise<MarketingSportEvent[]> {
    return this.fetchSportEvents("/datafeed/live/api/v2/sportevents", params, "live");
  }

  async getSportEventsPrematch(
    params: SportEventsParams,
  ): Promise<MarketingSportEvent[]> {
    return this.fetchSportEvents(
      "/datafeed/prematch/api/v2/sportevents",
      params,
      "prematch",
    );
  }

  private buildCacheKey(path: string, params: Record<string, string>): string {
    const search = new URLSearchParams();
    Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([key, value]) => {
        search.append(key, value);
      });
    return `${path}?${search.toString()}`;
  }

  private buildBaseQuery(
    overrides: Record<string, string>,
    applyFilters = true,
  ): Record<string, string> {
    const params: Record<string, string> = {
      Ref: this.config.ref,
      Lng: this.config.language,
    };
    if (this.config.groupId) {
      params.gr = this.config.groupId;
    }
    if (this.config.countryId) {
      params.cnt = this.config.countryId;
    }
    if (this.config.partnerLink) {
      params.partnerLink = this.config.partnerLink;
    }
    if (this.config.periods.length) {
      params.Periods = this.config.periods.join(",");
    }
    if (applyFilters && this.config.types && this.config.types.length) {
      params.Types = this.config.types.join(",");
    }
    if (applyFilters && this.config.vids && this.config.vids.length) {
      params.Vids = this.config.vids.join(",");
    }
    if (this.config.oddsIds && this.config.oddsIds.length) {
      params.OddsIds = this.config.oddsIds.join(",");
    }
    if (this.config.oddsScheme) {
      params.SchemeOfGettingOddsOperations = this.config.oddsScheme;
    }
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      params[key] = String(value);
    });
    return params;
  }

  private async fetchWithCache<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<{ data: T; status: number }>,
  ): Promise<CacheResult<T>> {
    const now = Date.now();
    const existing = this.cache.get(key) as CacheEntry<T> | undefined;
    if (existing && existing.expiresAt > now) {
      console.log("[marketing] cache hit", key);
      return { data: existing.data, status: existing.status, source: "cache" };
    }
    console.log("[marketing] cache miss", key);

    let inflight = this.inflight.get(key) as Promise<{ data: T; status: number }> | undefined;
    if (!inflight) {
      inflight = fetcher();
      this.inflight.set(key, inflight);
    }

    try {
      const result = await inflight;
      this.cache.set(key, {
        data: result.data,
        status: result.status,
        expiresAt: now + ttlMs,
      });
      return { ...result, source: "network" };
    } finally {
      this.inflight.delete(key);
    }
  }

  private async performRequest<T>(
    path: string,
    searchParams: Record<string, string>,
  ): Promise<{ data: T; status: number }> {
    const url = new URL(
      path.startsWith("/") ? `${this.baseUrl}${path}` : `${this.baseUrl}/${path}`,
    );
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const attempt = async (forceRefresh: boolean): Promise<{ data: T; status: number }> => {
      const token = await this.auth.getBearer(forceRefresh);
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const text = await response.text();

      if (response.status === 401 && !forceRefresh) {
        console.warn(
          "[marketing-auth] 401 from",
          url.pathname,
          "-- refreshing token",
        );
        this.auth.invalidate();
        return attempt(true);
      }

      if (!response.ok) {
        console.warn(
          "[marketing] request failed",
          response.status,
          response.statusText,
          text.slice(0, 200),
        );
        throw new Error(
          `[marketing] request failed ${response.status} ${response.statusText}`,
        );
      }

      let payload: T;
      try {
        payload = text ? (JSON.parse(text) as T) : ({} as T);
      } catch (error) {
        console.warn(
          "[marketing] invalid JSON",
          url.pathname,
          text.slice(0, 200),
          error,
        );
        throw new Error("[marketing] invalid JSON response");
      }

      return { data: payload, status: response.status };
    };

    return attempt(false);
  }

  private async fetchSportEvents(
    path: string,
    params: SportEventsParams,
    feed: "live" | "prematch",
  ): Promise<MarketingSportEvent[]> {
    const sportIds = params.sportIds?.filter((value) => Number.isFinite(value)) ?? [];
    if (sportIds.length === 0) {
      return [];
    }
    const overrides: Record<string, string> = {
      SportIds: sportIds.join(","),
    };
    if (params.periodsOverride?.length) {
      overrides.Periods = params.periodsOverride.join(",");
    }
    if (typeof params.gtStartSec === "number") {
      overrides.gtStart = Math.max(0, Math.floor(params.gtStartSec)).toString();
    }
    if (typeof params.ltStartSec === "number") {
      overrides.ltStart = Math.max(0, Math.floor(params.ltStartSec)).toString();
    }
    const query = this.buildBaseQuery(overrides, Boolean(params.applyFilters));
    const cacheKey = this.buildCacheKey(path, query);

    const result = await this.fetchWithCache<MarketingListResponse<MarketingSportEvent>>(
      cacheKey,
      this.cacheTtlMs,
      () => this.performRequest<MarketingListResponse<MarketingSportEvent>>(path, query),
    );

    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    const firstSport = items[0]?.sportId ?? null;
    const statusLabel =
      result.source === "cache" ? `${result.status} (cache)` : `${result.status}`;
    console.log(
      "[marketing] GET sportevents",
      `feed=${feed}`,
      `batch=${params.label ?? "-"}`,
      `status=${statusLabel}`,
      `size=${items.length}`,
      `firstSport=${firstSport ?? "n/a"}`,
    );
    return items;
  }
}
