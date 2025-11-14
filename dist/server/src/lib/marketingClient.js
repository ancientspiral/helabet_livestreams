import { fetch } from "undici";
const DEFAULT_MARKETING_BASE = "https://cpservm.com/gateway/marketing";
const DEFAULT_CACHE_TTL_MS = 5_000;
const sanitizeBaseUrl = (value) => {
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
    }
    catch (error) {
        console.warn(`[marketing] invalid MARKETING_API_BASE "${trimmed}" — fallback ${DEFAULT_MARKETING_BASE}`, error?.message ?? String(error));
        return DEFAULT_MARKETING_BASE;
    }
};
export class MarketingClient {
    auth;
    fetchImpl;
    baseUrl;
    cacheTtlMs;
    config;
    cache = new Map();
    inflight = new Map();
    constructor(config, auth, fetchImpl = fetch) {
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
    usesTypesFilter() {
        return (this.config.types ?? []).length > 0;
    }
    usesVidsFilter() {
        return (this.config.vids ?? []).length > 0;
    }
    describeBaseQuery(applyFilters = false) {
        const params = this.buildBaseQuery({}, applyFilters);
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            search.append(key, value);
        });
        return search.toString();
    }
    async getSports() {
        const query = {
            Ref: this.config.ref,
            Lng: this.config.language,
        };
        const cacheKey = this.buildCacheKey("/datafeed/directories/api/v2/sports", query);
        const result = await this.fetchWithCache(cacheKey, this.cacheTtlMs, () => this.performRequest("/datafeed/directories/api/v2/sports", query));
        const items = Array.isArray(result.data?.items) ? result.data.items : [];
        console.log("[marketing] sports count:", items.length);
        return items;
    }
    async getSportEventsLive(params) {
        return this.fetchSportEvents("/datafeed/live/api/v2/sportevents", params, "live");
    }
    async getSportEventsPrematch(params) {
        return this.fetchSportEvents("/datafeed/prematch/api/v2/sportevents", params, "prematch");
    }
    buildCacheKey(path, params) {
        const search = new URLSearchParams();
        Object.entries(params)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([key, value]) => {
            search.append(key, value);
        });
        return `${path}?${search.toString()}`;
    }
    buildBaseQuery(overrides, applyFilters = true) {
        const params = {
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
    async fetchWithCache(key, ttlMs, fetcher) {
        const now = Date.now();
        const existing = this.cache.get(key);
        if (existing && existing.expiresAt > now) {
            console.log("[marketing] cache hit", key);
            return { data: existing.data, status: existing.status, source: "cache" };
        }
        console.log("[marketing] cache miss", key);
        let inflight = this.inflight.get(key);
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
        }
        finally {
            this.inflight.delete(key);
        }
    }
    async performRequest(path, searchParams) {
        const url = new URL(path.startsWith("/") ? `${this.baseUrl}${path}` : `${this.baseUrl}/${path}`);
        Object.entries(searchParams).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
        const attempt = async (forceRefresh) => {
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
                console.warn("[marketing-auth] 401 from", url.pathname, "-- refreshing token");
                this.auth.invalidate();
                return attempt(true);
            }
            if (!response.ok) {
                console.warn("[marketing] request failed", response.status, response.statusText, text.slice(0, 200));
                throw new Error(`[marketing] request failed ${response.status} ${response.statusText}`);
            }
            let payload;
            try {
                payload = text ? JSON.parse(text) : {};
            }
            catch (error) {
                console.warn("[marketing] invalid JSON", url.pathname, text.slice(0, 200), error);
                throw new Error("[marketing] invalid JSON response");
            }
            return { data: payload, status: response.status };
        };
        return attempt(false);
    }
    async fetchSportEvents(path, params, feed) {
        const sportIds = params.sportIds?.filter((value) => Number.isFinite(value)) ?? [];
        if (sportIds.length === 0) {
            return [];
        }
        const overrides = {
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
        const result = await this.fetchWithCache(cacheKey, this.cacheTtlMs, () => this.performRequest(path, query));
        const items = Array.isArray(result.data?.items) ? result.data.items : [];
        const firstSport = items[0]?.sportId ?? null;
        const statusLabel = result.source === "cache" ? `${result.status} (cache)` : `${result.status}`;
        console.log("[marketing] GET sportevents", `feed=${feed}`, `batch=${params.label ?? "-"}`, `status=${statusLabel}`, `size=${items.length}`, `firstSport=${firstSport ?? "n/a"}`);
        return items;
    }
}
