import { deriveScheduleBucket } from "./streams.js";

const LIVE_FEED_REMOTE_BASE =
  "https://helabet.com/service-api/LiveFeed/GetTopGamesStatZip";
const LIVE_FEED_QUERY = "?lng=en&antisports=66&partner=237";
const DEFAULT_PROXY_ENDPOINT = `/api/live-feed${LIVE_FEED_QUERY}`;

export const LIVE_FEED_ENDPOINT =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_LIVE_FEED_URL) ||
  DEFAULT_PROXY_ENDPOINT;

export const LIVE_FEED_REMOTE_URL = `${LIVE_FEED_REMOTE_BASE}${LIVE_FEED_QUERY}`;

const SPORT_TYPE_MAP = {
  1: "football",
  2: "ice hockey",
  3: "basketball",
  4: "tennis",
  5: "baseball",
  6: "volleyball",
  7: "rugby",
};

const SPORT_NAME_MAP = {
  "ice-hockey": "ice hockey",
};

const safeTrim = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeSportType = (type) => {
  if (type === null || type === undefined) {
    return "sports";
  }

  const numeric = Number.parseInt(type, 10);
  if (!Number.isNaN(numeric) && SPORT_TYPE_MAP[numeric]) {
    return SPORT_TYPE_MAP[numeric];
  }

  const normalized = safeTrim(String(type))
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (SPORT_NAME_MAP[normalized]) {
    return SPORT_NAME_MAP[normalized];
  }

  return normalized || "sports";
};

const parseOutcomeValue = (value) => {
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
    if ("C" in value) return parseOutcomeValue(value.C);
    if ("V" in value) return parseOutcomeValue(value.V);
    if ("value" in value) return parseOutcomeValue(value.value);
    if ("Odd" in value) return parseOutcomeValue(value.Odd);
  }

  return null;
};

const parseOddsArray = (entries) => {
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

  const odds = { w1, w2 };
  if (x !== null) {
    odds.x = x;
  }

  return odds;
};

const parseStartDate = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const trimmed = safeTrim(String(value));
  if (!trimmed) return null;

  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) {
    return new Date(direct).toISOString();
  }

  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const hours = Number.parseInt(timeMatch[1], 10);
    const minutes = Number.parseInt(timeMatch[2], 10);
    const seconds = Number.parseInt(timeMatch[3] || "0", 10);
    if (
      Number.isInteger(hours) &&
      Number.isInteger(minutes) &&
      Number.isInteger(seconds)
    ) {
      const candidate = new Date();
      candidate.setHours(hours, minutes, seconds, 0);
      return candidate.toISOString();
    }
  }

  return null;
};

const buildTitle = (home, away) => {
  const homeName = safeTrim(home);
  const awayName = safeTrim(away);
  if (!homeName && !awayName) return "";
  if (!homeName) return awayName;
  if (!awayName) return homeName;
  return `${homeName} vs ${awayName}`;
};

const buildDescription = (sport, startLabel, title) => {
  const readableSport = sport.replace(/-/g, " ");
  if (startLabel) {
    return `Live ${readableSport} stream: ${title}. Kick-off at ${startLabel}.`;
  }
  return `Live ${readableSport} stream: ${title}.`;
};

export const transformLiveFeed = (payload) => {
  const matches = Array.isArray(payload?.Value) ? payload.Value : [];

  return matches
    .map((entry, index) => {
      const id = entry?.CI ? String(entry.CI) : `live-${index}`;
      const sport = normalizeSportType(entry?.SE);
      const title = buildTitle(entry?.O1, entry?.O2);
      if (!title) return null;

      const dateISO = parseStartDate(entry?.S);
      const odds = parseOddsArray(entry?.E);
      const startLabel = dateISO
        ? new Date(dateISO).toLocaleString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
          })
        : "";

      return {
        id,
        sport,
        title,
        status: "live",
        frame: "",
        dateISO,
        when: deriveScheduleBucket(dateISO),
        odds,
        description: buildDescription(sport, startLabel, title),
        origin: "api",
      };
    })
    .filter(Boolean);
};
