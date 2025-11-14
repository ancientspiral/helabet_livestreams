const DEFAULT_PERIODS = ["0", "1", "2"];
const DEFAULT_MAX_BATCH = 25;
const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_UPCOMING_DAYS = 30;
const DEFAULT_LIVE_LOOKBACK_MINUTES = 60;
const DEFAULT_PREMATCH_LOOKAHEAD_MINUTES = 7 * 24 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const parseCommaList = (value) => {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};
const parseBoolean = (value, fallback = false) => {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
        return true;
    }
    if (normalized === "0" || normalized === "false") {
        return false;
    }
    return fallback;
};
const parseNumber = (value, fallback = 0) => {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};
export const loadMarketingEnvConfig = (env = process.env) => {
    const periods = parseCommaList(env.MARKETING_API_PERIODS);
    const cacheTtlMs = Math.max(1_000, parseNumber(env.MARKETING_API_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS));
    const oddsScheme = env.MARKETING_API_ODDS_SCHEME?.trim() || "Get1X2Odds";
    const oddsIds = parseCommaList(env.MARKETING_API_ODDS_IDS);
    const upcomingDays = Math.max(1, parseNumber(env.MARKETING_API_UPCOMING_DAYS, DEFAULT_UPCOMING_DAYS));
    const liveLookbackMinutes = Math.max(0, parseNumber(env.MARKETING_API_LIVE_LOOKBACK_MINUTES, DEFAULT_LIVE_LOOKBACK_MINUTES));
    const prematchLookaheadMinutes = Math.max(1, parseNumber(env.MARKETING_API_PREMATCH_LOOKAHEAD_MINUTES, DEFAULT_PREMATCH_LOOKAHEAD_MINUTES));
    return {
        baseUrl: env.MARKETING_API_BASE?.trim() || "https://cpservm.com/gateway/marketing",
        authUrl: env.MARKETING_API_AUTH_URL?.trim() || "https://cpservm.com/gateway/token",
        clientId: env.MARKETING_API_CLIENT_ID?.trim(),
        clientSecret: env.MARKETING_API_CLIENT_SECRET?.trim(),
        ref: env.MARKETING_API_REF?.trim() || "1",
        language: env.MARKETING_API_LANG?.trim() || "en",
        groupId: env.MARKETING_API_GROUP?.trim() || undefined,
        countryId: env.MARKETING_API_COUNTRY?.trim() || undefined,
        partnerLink: env.MARKETING_API_PARTNER_LINK?.trim() || undefined,
        periods: periods.length ? periods : DEFAULT_PERIODS,
        types: parseCommaList(env.MARKETING_API_TYPES),
        vids: parseCommaList(env.MARKETING_API_VIDS),
        maxBatchSize: Math.max(1, parseNumber(env.MARKETING_API_MAX_SPORTS_PER_REQUEST, DEFAULT_MAX_BATCH)),
        videoOnly: parseBoolean(env.MARKETING_API_VIDEO_ONLY, false),
        cacheTtlMs,
        oddsIds,
        oddsScheme,
        upcomingWindowMs: upcomingDays * MS_PER_DAY,
        liveLookbackMs: liveLookbackMinutes * MS_PER_MINUTE,
        prematchLookaheadMs: prematchLookaheadMinutes * MS_PER_MINUTE,
    };
};
