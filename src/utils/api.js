import {
  generateStreamId,
  deriveScheduleBucket,
  DEFAULT_TIME_ZONE,
} from "./streams.js";

const SPORT_ID_SLUGS = {
  1: "football",
  2: "ice hockey",
  3: "basketball",
  4: "tennis",
  5: "baseball",
  6: "volleyball",
  7: "rugby",
  8: "esports",
};

const slugifySportName = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  return raw
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

const TIME_ZONE = DEFAULT_TIME_ZONE;


export const mapSportIdToSlug = (value, fallbackName) => {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) {
    const mapped = SPORT_ID_SLUGS[numeric];
    if (mapped) {
      return mapped;
    }
    const fallbackSlug = slugifySportName(fallbackName);
    return fallbackSlug ?? `sport-${numeric}`;
  }
  const fallbackSlug = slugifySportName(fallbackName);
  return fallbackSlug ?? "sports";
};

export const normalizeOdds = (odds) => {
  if (!odds) return null;

  const hasNewStructure =
    typeof odds.w1 === "number" ||
    typeof odds.w2 === "number" ||
    typeof odds.x === "number";

  if (hasNewStructure) {
    const normalized = {};
    if (typeof odds.w1 === "number" && !Number.isNaN(odds.w1))
      normalized.w1 = odds.w1;
    if (typeof odds.w2 === "number" && !Number.isNaN(odds.w2))
      normalized.w2 = odds.w2;
    if (typeof odds.x === "number" && !Number.isNaN(odds.x))
      normalized.x = odds.x;
    if (
      typeof normalized.w1 !== "number" ||
      typeof normalized.w2 !== "number"
    ) {
      return null;
    }
    return normalized;
  }

  const legacy = {};
  if (typeof odds.home === "number" && !Number.isNaN(odds.home))
    legacy.w1 = odds.home;
  if (typeof odds.away === "number" && !Number.isNaN(odds.away))
    legacy.w2 = odds.away;
  if (typeof odds.totalOver === "number" && !Number.isNaN(odds.totalOver))
    legacy.x = odds.totalOver;

  if (typeof legacy.w1 !== "number" || typeof legacy.w2 !== "number") {
    return null;
  }

  return legacy;
};

export const normalizeStream = (stream, fallbackOrigin = "custom") => {
  if (!stream) return null;
  const normalized = { ...stream };

  normalized.id = normalized.id || generateStreamId();
  normalized.title = normalized.title?.trim() || "Untitled stream";
  normalized.sport = normalized.sport
    ? String(normalized.sport).toLowerCase()
    : "sports";

  if (normalized.dateISO) {
    const parsed = new Date(normalized.dateISO);
    normalized.dateISO = Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString();
  } else {
    normalized.dateISO = null;
  }

  normalized.when = deriveScheduleBucket(normalized.dateISO, undefined, TIME_ZONE);
  normalized.odds = normalizeOdds(normalized.odds);
  normalized.status = normalized.status || "live";
  normalized.frame = normalized.frame?.trim() || "";
  normalized.description = normalized.description || "";
  normalized.origin = normalized.origin || fallbackOrigin;
  normalized.hasStream = Boolean(normalized.videoId || normalized.sgi || normalized.frame);
  normalized.bucket = normalized.when;

  return normalized;
};

export const buildMatchTitle = (home, away) => {
  const homeName = typeof home === "string" ? home.trim() : "";
  const awayName = typeof away === "string" ? away.trim() : "";
  if (homeName && awayName) {
    return `${homeName} vs ${awayName}`;
  }
  return homeName || awayName || "Live stream";
};

export const formatDescription = (sport, title) => {
  const readableSport = sport.replace(/-/g, " ");
  return `Live ${readableSport} stream: ${title}.`;
};

export const timestampToISO = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    const date = new Date(
      value > 1_000_000_000_000 ? value : value * 1000,
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(numeric)) {
      return timestampToISO(numeric);
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
};

export const parseOddComponent = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const extractOdds1x2 = (entries = []) => {
  const result = {};
  const filtered = entries.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (entry.G !== undefined && entry.G !== 1) return false;
    if (entry.GS !== undefined && entry.GS !== 1) return false;
    return true;
  });

  for (const entry of filtered) {
    if (!entry || typeof entry !== "object") continue;
    const value = parseOddComponent(
      entry.C ?? entry.V ?? entry.value ?? entry.Odd,
    );
    if (value === null) {
      continue;
    }
    if (entry?.T === 1) {
      result.w1 = value;
    } else if (entry?.T === 2) {
      result.x = value;
    } else if (entry?.T === 3) {
      result.w2 = value;
    }
  }

  return result;
};

export const toNumber = (value, fallback = null) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

export const toTimestampMs = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const extractScoreboardPhase = (match) => {
  const sc = match?.SC ?? null;
  const inspect = (node) => {
    if (!node || typeof node !== "object") return null;
    const phase = node.CPS ?? node.cps;
    if (typeof phase === "string" && phase.trim()) {
      return phase.trim();
    }
    return null;
  };

  if (Array.isArray(sc)) {
    for (const entry of sc) {
      const phase = inspect(entry);
      if (phase) return phase;
    }
    return null;
  }

  return inspect(sc);
};

const LIVE_PHASE_RE = /(half|period|quarter|set|inning|frame|live|running|overtime|injury|extra|playing)/i;
const NOT_LIVE_PHASE_RE = /(finished|ended|final|ft|full time|closed|suspended|postponed|cancelled|delayed|void)/i;

export const isLikelyLivePhase = (phase) => {
  if (!phase) return false;
  if (NOT_LIVE_PHASE_RE.test(phase)) {
    return false;
  }
  return LIVE_PHASE_RE.test(phase);
};

export const mapMatchToStream = (match) => {
  if (!match || typeof match !== "object") {
    return null;
  }

  const helabetHome = match.O1E || match.O1 || match.nameHome || match.home;
  const helabetAway = match.O2E || match.O2 || match.nameAway || match.away;
  const rawOdds = Array.isArray(match.E) ? extractOdds1x2(match.E) : match.odds;

  const viRaw = match.VI ?? match.VideoId ?? null;
  const sgiRaw = match.SGI ?? match.STI ?? match.sgi ?? null;
  const fallbackVideoId =
    typeof match.videoId === "string" && match.videoId.trim()
      ? match.videoId.trim()
      : null;
  const vi =
    typeof viRaw === "string" && viRaw.trim() ? viRaw.trim() : null;
  const sgi =
    typeof sgiRaw === "string" && sgiRaw.trim() ? sgiRaw.trim() : null;
  if (!vi && !sgi && !fallbackVideoId) {
    return null;
  }
  const videoId = vi ?? fallbackVideoId ?? null;
  if (!videoId && !sgi) {
    return null;
  }
  const videoSource = vi
    ? "vi"
    : fallbackVideoId
      ? "other"
      : sgi
        ? "sgi"
        : "other";
  const matchId =
    match.CI ?? match.Id ?? match.matchId ?? match.id ?? match.VI ?? null;
  const sportId = match.SI ?? match.sportId ?? match.sport ?? null;
  const sportNameRaw =
    match.SE ??
    match.SN ??
    match.sportName ??
    match.sportTitle ??
    match.sportLabel ??
    null;
  const leagueId = match.LI ?? match.leagueId ?? null;
  const start = match.S ?? match.startTs ?? match.date ?? match.start ?? null;
  const startMs = toTimestampMs(start);
  const nowMs = Date.now();
  const scoreboardPhase = extractScoreboardPhase(match);
  const livePhase = isLikelyLivePhase(scoreboardPhase);
  const graceMs = 2 * 60 * 60 * 1000;

  let status = "live";
  if (typeof startMs === "number") {
    if (startMs > nowMs && !livePhase) {
      status = "upcoming";
    } else if (nowMs - startMs > graceMs && !livePhase) {
      return null;
    }
  } else if (!livePhase && (videoId || sgi)) {
    status = "live";
  }

  if (livePhase) {
    status = "live";
  }

  const dateISO = startMs
    ? new Date(startMs).toISOString()
    : timestampToISO(start);

  if (status === "upcoming" && !dateISO) {
    // Cannot schedule upcoming items without a start time.
    return null;
  }

  const sport = mapSportIdToSlug(sportId, sportNameRaw);
  const title = buildMatchTitle(helabetHome, helabetAway);
  const baseId =
    typeof matchId === "number" && Number.isFinite(matchId)
      ? `helabet-${matchId}`
      : typeof matchId === "string" && matchId
        ? `helabet-${matchId}`
        : videoId ?? sgi ?? undefined;

  const hasOdds =
    rawOdds &&
    typeof rawOdds.w1 === "number" &&
    Number.isFinite(rawOdds.w1) &&
    typeof rawOdds.w2 === "number" &&
    Number.isFinite(rawOdds.w2);

  const odds = hasOdds
    ? {
        w1: rawOdds.w1,
        w2: rawOdds.w2,
        ...(typeof rawOdds.x === "number" && !Number.isNaN(rawOdds.x)
          ? { x: rawOdds.x }
          : {}),
      }
    : null;

  const startTimeMs =
    typeof startMs === "number"
      ? startMs
      : dateISO
        ? new Date(dateISO).getTime()
        : null;

  return normalizeStream(
    {
      id: baseId || generateStreamId(),
      title,
      sport,
      status,
      dateISO,
      startTimeMs,
      videoId,
      videoSource,
      sgi,
      odds,
      description: formatDescription(sport, title),
      leagueId,
      matchId,
      scoreboardPhase,
      origin: "api",
    },
    "api",
  );
};
