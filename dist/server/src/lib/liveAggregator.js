import { buildMatchTitle, formatDescription, mapMatchToStream } from "../utils/api.js";
import { DEFAULT_TIME_ZONE, deriveScheduleBucket, generateStreamId, } from "../utils/streams.js";
import { fetchHelabetLiveData, } from "./helabetLiveData.js";
const TTL_MS = 15_000;
const UPCOMING_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_UPCOMING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIVE_LOOKBACK_MS = 60 * 60 * 1000;
const DEFAULT_PREMATCH_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const EXCLUDED_SPORT_KEYWORDS = ["virtual", "lotto", "lottery"];
const buildHelabetSportFilter = () => {
    const raw = process.env.HELABET_EXTRA_SPORTS;
    if (!raw) {
        return null;
    }
    const entries = raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
    return entries.length ? new Set(entries) : null;
};
const HELABET_EXTRA_SPORTS = buildHelabetSportFilter();
const normalizeSportName = (sport) => {
    const raw = sport?.nameLocalization ??
        sport?.name ??
        sport?.title ??
        (sport?.sportId ?? sport?.id ?? "sports");
    return typeof raw === "string" && raw.trim().length > 0
        ? raw.trim()
        : "sports";
};
const convertHelabetMatchToStream = (match) => {
    const normalized = mapMatchToStream(match);
    if (!normalized || (!normalized.videoId && !normalized.sgi)) {
        return null;
    }
    const startIso = normalized.dateISO ?? null;
    const preferredKey = normalizeLookupKey(match.VI ?? match.CI ?? match.ZP ?? match.Id ?? match.matchId) ??
        normalized.id;
    return {
        id: normalized.id,
        matchKey: preferredKey ?? normalized.id,
        title: normalized.title,
        sport: normalized.sport,
        status: normalized.status,
        dateISO: startIso,
        startISO: startIso,
        startTimeMs: normalized.startTimeMs ?? (startIso ? new Date(startIso).getTime() : null),
        bucket: normalized.bucket ?? normalized.when ?? "today",
        when: normalized.when ?? normalized.bucket ?? "today",
        videoId: normalized.videoId ?? null,
        sgi: normalized.sgi ?? null,
        hasStream: true,
        odds: normalized.odds ?? null,
        leagueId: normalized.leagueId ??
            (typeof match.LI === "number" && Number.isFinite(match.LI) ? match.LI : null),
        matchId: preferredKey ??
            normalizeLookupKey(match.I) ??
            normalizeLookupKey(match.ZP) ??
            normalized.matchId ??
            null,
        description: normalized.description ?? "",
        origin: "helabet",
        scoreboardPhase: normalized.scoreboardPhase ?? null,
        source: "helabet",
        feedSource: "live",
        sportId: normalized.sportId ??
            (typeof match.SI === "number" && Number.isFinite(match.SI) ? match.SI : null),
        sportName: normalized.sportName ?? (typeof match.SE === "string" ? match.SE : null),
        leagueName: normalized.leagueName ??
            (typeof match.LE === "string" && match.LE.trim()
                ? match.LE
                : typeof match.L === "string"
                    ? match.L
                    : null),
        videoSource: "helabet",
        link: normalized.link ?? null,
    };
};
const mergeHelabetStreams = (base, matches, options = {}) => {
    if (!matches.length) {
        return base;
    }
    const allowNewEntries = options.allowNewEntries ?? true;
    const result = [...base];
    const byKey = new Map();
    const byVideoId = new Set();
    result.forEach((entry) => {
        const key = entry.matchKey ?? entry.id;
        if (key) {
            byKey.set(key, entry);
        }
        if (entry.videoId) {
            byVideoId.add(entry.videoId);
        }
    });
    matches.forEach((match) => {
        const stream = convertHelabetMatchToStream(match);
        if (!stream) {
            return;
        }
        if (HELABET_EXTRA_SPORTS && !HELABET_EXTRA_SPORTS.has(stream.sport)) {
            return;
        }
        const key = stream.matchKey ?? stream.id;
        if (key && byKey.has(key)) {
            const existing = byKey.get(key);
            if (existing) {
                if (!existing.videoId && stream.videoId) {
                    existing.videoId = stream.videoId;
                }
                if (!existing.sgi && stream.sgi) {
                    existing.sgi = stream.sgi;
                }
                if (stream.videoId || stream.sgi) {
                    existing.hasStream = true;
                    existing.videoSource = "helabet";
                }
                existing.hasStream = Boolean(existing.videoId || existing.sgi);
            }
            return;
        }
        if (stream.videoId && byVideoId.has(stream.videoId)) {
            return;
        }
        if (!allowNewEntries) {
            return;
        }
        result.push(stream);
        if (key) {
            byKey.set(key, stream);
        }
        if (stream.videoId) {
            byVideoId.add(stream.videoId);
        }
    });
    return result;
};
const shouldExcludeSport = (sport) => {
    const name = normalizeSportName(sport).toLowerCase();
    return EXCLUDED_SPORT_KEYWORDS.some((keyword) => name.includes(keyword));
};
const toSlug = (value) => value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
const pickOdds = (odds) => {
    if (!Array.isArray(odds) || odds.length === 0) {
        return null;
    }
    const mapped = {};
    odds.forEach((entry) => {
        const label = entry?.display?.trim().toUpperCase();
        if (!label || typeof entry?.oddsMarket !== "number") {
            return;
        }
        if (label === "W1" || label === "1") {
            mapped.w1 = entry.oddsMarket;
        }
        else if (label === "W2" || label === "2") {
            mapped.w2 = entry.oddsMarket;
        }
        else if (label === "X" || label === "DRAW") {
            mapped.x = entry.oddsMarket;
        }
    });
    if (typeof mapped.w1 !== "number" &&
        typeof mapped.w2 !== "number" &&
        typeof mapped.x !== "number") {
        return null;
    }
    return mapped;
};
const preferNext = (next, current) => {
    if (next.hasStream && !current.hasStream) {
        return true;
    }
    if (!next.hasStream && current.hasStream) {
        return false;
    }
    const score = (entry) => {
        let sum = 0;
        if (entry.hasStream)
            sum += 4;
        if (entry.feedSource === "live")
            sum += 2;
        if (entry.odds)
            sum += 3;
        if (entry.status === "live")
            sum += 1;
        if (entry.dateISO)
            sum += 0.5;
        if (entry.bucket === "today")
            sum += 0.25;
        if (entry.bucket === "tomorrow")
            sum += 0.2;
        return sum;
    };
    return score(next) > score(current);
};
const mergeEntries = (primary, secondary) => {
    if (!primary.odds && secondary.odds) {
        primary.odds = secondary.odds;
    }
    if (!primary.link && secondary.link) {
        primary.link = secondary.link;
    }
    if (!primary.hasStream && secondary.hasStream) {
        primary.hasStream = true;
        primary.videoSource = secondary.videoSource;
        primary.feedSource = secondary.feedSource;
    }
    if (!primary.dateISO && secondary.dateISO) {
        primary.dateISO = secondary.dateISO;
        primary.startISO = secondary.startISO;
        primary.startTimeMs = secondary.startTimeMs;
        primary.bucket = secondary.bucket;
        primary.when = secondary.when;
    }
    if (!primary.sportName && secondary.sportName) {
        primary.sportName = secondary.sportName;
    }
    if (!primary.leagueName && secondary.leagueName) {
        primary.leagueName = secondary.leagueName;
    }
    if (!primary.description && secondary.description) {
        primary.description = secondary.description;
    }
    return primary;
};
const dedupe = (items) => {
    const byKey = new Map();
    items.forEach((entry) => {
        const key = entry.matchKey ?? entry.id;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, entry);
            return;
        }
        const preferEntry = preferNext(entry, existing) ? entry : existing;
        const other = preferEntry === entry ? existing : entry;
        const merged = mergeEntries({ ...preferEntry }, other);
        byKey.set(key, merged);
    });
    return Array.from(byKey.values());
};
const buildSummary = (entries) => {
    const summary = {
        totalAll: entries.length,
        totalWithStream: entries.filter((entry) => entry.hasStream).length,
        sports: {},
    };
    entries.forEach((entry) => {
        const key = entry.sport ?? "unknown";
        summary.sports[key] = (summary.sports[key] ?? 0) + 1;
    });
    return summary;
};
const chunk = (values, size) => {
    if (size <= 0) {
        return [values];
    }
    const result = [];
    for (let i = 0; i < values.length; i += size) {
        result.push(values.slice(i, i + size));
    }
    return result;
};
const buildMatchKey = (event, fallbackTitle) => {
    const mainConst = event.mainConstSportEventId ??
        null;
    if (mainConst) {
        return `const-${mainConst}`;
    }
    const constId = event.constSportEventId ??
        event.lineConstId ??
        null;
    if (constId) {
        return `const-${constId}`;
    }
    if (event.link) {
        return `link-${event.link}`;
    }
    const startToken = typeof event.startDate === "number" && Number.isFinite(event.startDate)
        ? new Date(event.startDate * 1000).toISOString().slice(0, 16)
        : "nostart";
    const sluggedTitle = fallbackTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (event.sportEventId) {
        return `sport-${event.sportEventId}-${startToken}`;
    }
    return `title-${sluggedTitle}-${startToken}`;
};
const normalizeLookupKey = (value) => {
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
const collectEventLookupKeys = (event) => {
    const keys = new Set();
    const candidates = [
        event.sportEventId,
        event.mainConstSportEventId,
        event.constSportEventId,
        event.lineConstId,
        event.statGameId,
    ];
    candidates.forEach((candidate) => {
        const normalized = normalizeLookupKey(candidate);
        if (normalized) {
            keys.add(normalized);
        }
    });
    if (event.link) {
        const match = event.link.match(/(\d{6,})/g);
        if (match) {
            match.forEach((value) => {
                const normalized = normalizeLookupKey(value);
                if (normalized) {
                    keys.add(normalized);
                }
            });
        }
    }
    return Array.from(keys);
};
const applyHelabetOverride = (event, lookup) => {
    const keys = collectEventLookupKeys(event);
    for (const key of keys) {
        const meta = lookup.get(key);
        if (meta && (meta.videoId || meta.sgi)) {
            if (meta.videoId) {
                event.helabetVideoId = meta.videoId;
            }
            if (meta.sgi) {
                event.helabetSgi = meta.sgi;
            }
            event.hasVideo = true;
            return true;
        }
    }
    return false;
};
const deriveVideoId = (event) => {
    const candidates = [
        event.constSportEventId,
        event.mainConstSportEventId,
        event.lineConstId,
        event.statGameId,
        event.sportEventId,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            return String(candidate);
        }
        if (typeof candidate === "string" && candidate.trim()) {
            const numeric = Number.parseInt(candidate.trim(), 10);
            if (Number.isFinite(numeric) && numeric > 0) {
                return String(numeric);
            }
            return candidate.trim();
        }
    }
    return null;
};
const normalizeEvent = (event, sportLookup, feedSource, requireVideo) => {
    const sportId = typeof event.sportId === "number" && Number.isFinite(event.sportId)
        ? event.sportId
        : null;
    const sportEntry = sportId ? sportLookup.get(sportId) : undefined;
    const sportName = normalizeSportName(sportEntry);
    const sportSlug = toSlug(sportName);
    const startMs = typeof event.startDate === "number" && Number.isFinite(event.startDate)
        ? event.startDate * 1000
        : null;
    const startISO = startMs ? new Date(startMs).toISOString() : null;
    const bucket = startISO
        ? deriveScheduleBucket(startISO, undefined, DEFAULT_TIME_ZONE)
        : "today";
    const title = buildMatchTitle(event.opponent1NameLocalization, event.opponent2NameLocalization);
    const helabetVideoId = typeof event.helabetVideoId === "string" && event.helabetVideoId.trim()
        ? event.helabetVideoId.trim()
        : null;
    const helabetSgi = typeof event.helabetSgi === "string" && event.helabetSgi.trim()
        ? event.helabetSgi.trim()
        : null;
    const fallbackVideoId = event.hasVideo && event.sportEventId !== undefined && event.sportEventId !== null
        ? deriveVideoId(event)
        : null;
    const finalVideoId = helabetVideoId ?? fallbackVideoId ?? null;
    const finalSgi = helabetSgi ?? null;
    const hasStream = Boolean(finalVideoId || finalSgi);
    if (requireVideo && !hasStream) {
        return null;
    }
    const nowMs = Date.now();
    const status = (() => {
        if (startMs === null) {
            return hasStream ? "live" : "upcoming";
        }
        if (startMs - nowMs > 0) {
            return "upcoming";
        }
        if (nowMs - startMs > UPCOMING_GRACE_MS && !hasStream) {
            return "finished";
        }
        return event.waitingLive ? "upcoming" : "live";
    })();
    const odds = pickOdds(event.oddsLocalization);
    const description = formatDescription(sportSlug, title);
    const id = event.sportEventId !== undefined && event.sportEventId !== null
        ? `marketing-${event.sportEventId}-${feedSource}`
        : generateStreamId();
    const matchKey = buildMatchKey(event, title);
    const videoId = finalVideoId;
    return {
        id,
        matchKey,
        title,
        sport: sportSlug,
        status,
        dateISO: startISO,
        startISO,
        startTimeMs: startMs,
        bucket,
        when: bucket,
        videoId,
        sgi: finalSgi,
        hasStream,
        odds,
        leagueId: event.tournamentId ?? null,
        matchId: event.constSportEventId ??
            event.mainConstSportEventId ??
            event.sportEventId ??
            null,
        description,
        origin: "marketing",
        scoreboardPhase: event.currentPeriodName ?? null,
        source: "marketing",
        feedSource,
        sportId,
        sportName,
        leagueName: event.tournamentNameLocalization ?? null,
        videoSource: helabetVideoId || helabetSgi
            ? "helabet"
            : finalVideoId
                ? "marketing"
                : "none",
        link: event.link ?? null,
    };
};
const buildRawBySport = (events, sportLookup) => {
    return events.reduce((acc, event) => {
        const sportId = typeof event.sportId === "number" && Number.isFinite(event.sportId)
            ? event.sportId
            : null;
        const sportName = sportId ? normalizeSportName(sportLookup.get(sportId)) : "unknown";
        acc[sportName] = (acc[sportName] ?? 0) + 1;
        return acc;
    }, {});
};
export class LiveAggregator {
    marketing;
    options;
    helabetSession;
    upcomingWindowMs;
    liveLookbackMs;
    prematchLookaheadMs;
    cache = null;
    inflight = null;
    lastDebug = null;
    constructor(marketing, options, helabetSession) {
        this.marketing = marketing;
        this.options = {
            maxBatchSize: Math.max(1, options.maxBatchSize),
            videoOnly: options.videoOnly ?? false,
            upcomingWindowMs: options.upcomingWindowMs,
            liveLookbackMs: options.liveLookbackMs,
            prematchLookaheadMs: options.prematchLookaheadMs,
        };
        this.helabetSession = helabetSession ?? null;
        this.upcomingWindowMs = Math.max(UPCOMING_GRACE_MS, options.upcomingWindowMs ?? DEFAULT_UPCOMING_WINDOW_MS);
        this.liveLookbackMs = Math.max(0, options.liveLookbackMs ?? DEFAULT_LIVE_LOOKBACK_MS);
        this.prematchLookaheadMs = Math.max(UPCOMING_GRACE_MS, options.prematchLookaheadMs ?? DEFAULT_PREMATCH_LOOKAHEAD_MS);
    }
    async getMatches(options = {}) {
        const includeAll = options.includeAll ?? false;
        const force = options.force ?? false;
        if (!force && this.cache && Date.now() - this.cache.updatedAt < TTL_MS) {
            return includeAll ? this.cache.all : this.cache.streams;
        }
        if (!force && this.inflight) {
            const pending = await this.inflight;
            return includeAll ? pending.all : pending.streams;
        }
        this.inflight = this.fetchAndNormalize()
            .then((result) => {
            this.cache = result;
            return result;
        })
            .finally(() => {
            this.inflight = null;
        });
        const resolved = await this.inflight;
        return includeAll ? resolved.all : resolved.streams;
    }
    async getDebugSnapshot(force = false) {
        if (force) {
            await this.getMatches({ includeAll: true, force: true });
        }
        else if (!this.cache) {
            await this.getMatches({ includeAll: true });
        }
        return (this.lastDebug ?? {
            sportsCount: 0,
            sportIds: [],
            batches: 0,
            eventsTotal: 0,
            bySport: {},
            sample: [],
        });
    }
    async fetchAndNormalize() {
        const sports = await this.marketing.getSports();
        const filteredSports = sports.filter((sport) => !shouldExcludeSport(sport));
        const excluded = sports
            .filter((sport) => shouldExcludeSport(sport))
            .map((sport) => normalizeSportName(sport));
        const sportLookup = new Map();
        filteredSports.forEach((sport) => {
            const id = (typeof sport.sportId === "number" && Number.isFinite(sport.sportId)
                ? sport.sportId
                : undefined) ??
                (typeof sport.id === "number" && Number.isFinite(sport.id)
                    ? sport.id
                    : undefined);
            if (typeof id === "number") {
                sportLookup.set(id, sport);
            }
        });
        console.log("[seed:MarketingSports]", {
            sports: sports.length,
            usable: sportLookup.size,
            excluded,
        });
        const sportIds = Array.from(sportLookup.keys()).sort((a, b) => a - b);
        if (sportIds.length === 0) {
            this.lastDebug = {
                sportsCount: 0,
                sportIds: [],
                batches: 0,
                eventsTotal: 0,
                bySport: {},
                sample: [],
            };
            return {
                all: [],
                streams: [],
                summary: { totalAll: 0, totalWithStream: 0, sports: {} },
                updatedAt: Date.now(),
            };
        }
        const batches = chunk(sportIds, this.options.maxBatchSize);
        const rawEvents = [];
        const helabetData = this.helabetSession ? await fetchHelabetLiveData(this.helabetSession) : null;
        const helabetLookup = helabetData?.lookup ?? null;
        const helabetMatches = helabetData?.matches ?? [];
        const shouldApplyFilters = this.marketing.usesTypesFilter() || this.marketing.usesVidsFilter();
        const fetchWithFallback = async (source, batch, label) => {
            const baseParams = {
                sportIds: batch,
                label,
            };
            const now = Date.now();
            if (source === "live") {
                baseParams.gtStartSec = Math.floor(Math.max(0, now - this.liveLookbackMs) / 1000);
            }
            else {
                baseParams.gtStartSec = Math.floor(now / 1000);
                baseParams.ltStartSec = Math.floor((now + this.prematchLookaheadMs) / 1000);
            }
            const fetcher = source === "live"
                ? this.marketing.getSportEventsLive.bind(this.marketing)
                : this.marketing.getSportEventsPrematch.bind(this.marketing);
            let events = await fetcher({ ...baseParams, applyFilters: false });
            if (events.length === 0 && shouldApplyFilters) {
                events = await fetcher({ ...baseParams, applyFilters: true });
            }
            return events;
        };
        for (let index = 0; index < batches.length; index += 1) {
            const batch = batches[index];
            try {
                const label = `${index + 1}/${batches.length}`;
                const [liveEvents, prematchEvents] = await Promise.all([
                    fetchWithFallback("live", batch, label),
                    fetchWithFallback("prematch", batch, label),
                ]);
                const applyOverrides = (event) => {
                    if (helabetLookup && helabetLookup.size > 0) {
                        applyHelabetOverride(event, helabetLookup);
                    }
                    return event;
                };
                liveEvents.forEach((event) => rawEvents.push({ event: applyOverrides(event), source: "live" }));
                prematchEvents.forEach((event) => rawEvents.push({ event: applyOverrides(event), source: "prematch" }));
            }
            catch (error) {
                console.warn("[marketing] batch fetch failed", batch.join(","), error?.message ?? String(error));
            }
        }
        if (rawEvents.length === 0) {
            console.warn("[marketing] empty response set", {
                query: this.marketing.describeBaseQuery(false),
                appliedTypes: this.marketing.usesTypesFilter(),
                appliedVids: this.marketing.usesVidsFilter(),
                sportIds,
            });
        }
        console.log("[seed:MarketingEvents]", {
            batches: batches.length,
            events: rawEvents.length,
            bySport: buildRawBySport(rawEvents.map((entry) => entry.event), sportLookup),
        });
        const mapped = rawEvents
            .map(({ event, source }) => normalizeEvent(event, sportLookup, source, this.options.videoOnly))
            .filter((entry) => Boolean(entry));
        const deduped = dedupe(mapped);
        const filtered = deduped.filter((entry) => {
            if (!entry.startISO) {
                return true;
            }
            const now = Date.now();
            return (entry.startTimeMs === null ||
                (entry.startTimeMs >= now - UPCOMING_GRACE_MS &&
                    entry.startTimeMs <= now + this.upcomingWindowMs));
        });
        const mergedWithHelabet = helabetMatches.length > 0
            ? mergeHelabetStreams(filtered, helabetMatches, { allowNewEntries: true })
            : filtered;
        mergedWithHelabet.forEach((entry) => {
            entry.hasStream = Boolean(entry.videoId || entry.sgi);
        });
        const nowMs = Date.now();
        const marketingTodayEntries = mergedWithHelabet.filter((entry) => entry.origin === "marketing" && entry.bucket === "today");
        const helabetLiveEntries = mergedWithHelabet.filter((entry) => {
            if (entry.origin !== "helabet" || entry.status !== "live") {
                return false;
            }
            if (entry.startTimeMs === null) {
                return true;
            }
            return entry.startTimeMs >= nowMs - this.liveLookbackMs;
        });
        const helabetUpcomingEntries = mergedWithHelabet.filter((entry) => {
            if (entry.origin !== "helabet" || entry.status !== "upcoming") {
                return false;
            }
            if (entry.startTimeMs === null) {
                return false;
            }
            return entry.startTimeMs >= nowMs && entry.startTimeMs <= nowMs + this.upcomingWindowMs;
        });
        const scheduleEntries = dedupe([
            ...marketingTodayEntries,
            ...helabetLiveEntries,
            ...helabetUpcomingEntries,
        ]).filter((entry) => entry.hasStream);
        const streams = mergedWithHelabet.filter((entry) => entry.hasStream);
        const summary = buildSummary(scheduleEntries);
        const bySportStreams = streams.reduce((acc, entry) => {
            acc[entry.sport] = (acc[entry.sport] ?? 0) + 1;
            return acc;
        }, {});
        console.log("[live-aggregator ALL]", {
            total: scheduleEntries.length,
            bySport: summary.sports,
        });
        console.log("[live-aggregator STREAMS]", {
            total: streams.length,
            bySport: bySportStreams,
        });
        this.lastDebug = {
            sportsCount: sportLookup.size,
            sportIds,
            batches: batches.length,
            eventsTotal: scheduleEntries.length,
            bySport: summary.sports,
            sample: rawEvents.slice(0, 2).map((entry) => entry.event),
        };
        return {
            all: scheduleEntries,
            streams,
            summary,
            updatedAt: Date.now(),
        };
    }
}
