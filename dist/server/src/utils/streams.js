const BUCKET_ORDER = [
    "today",
    "tomorrow",
    "this-week",
    "next-week",
    "this-month",
    "next-month",
    "later",
];
export const DEFAULT_TIME_ZONE = "Africa/Lagos";
const DEFAULT_REGION_TZ = DEFAULT_TIME_ZONE;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const getZonedDateParts = (date, timeZone = DEFAULT_REGION_TZ) => {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const formatted = formatter.format(date); // YYYY-MM-DD
    const [year, month, day] = formatted.split("-").map((value) => Number.parseInt(value, 10));
    return { year, month, day };
};
const getZonedMidnight = (date, timeZone = DEFAULT_REGION_TZ) => {
    const { year, month, day } = getZonedDateParts(date, timeZone);
    return new Date(Date.UTC(year, month - 1, day));
};
const getIsoWeek = (dateUtc) => {
    const tmp = new Date(dateUtc.getTime());
    const day = tmp.getUTCDay() || 7; // 1 (Mon) .. 7 (Sun)
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
    return {
        year: tmp.getUTCFullYear(),
        week: weekNo,
    };
};
export const deriveScheduleBucket = (isoString, now = new Date(), timeZone = DEFAULT_REGION_TZ) => {
    if (!isoString)
        return "today";
    const target = new Date(isoString);
    if (Number.isNaN(target.getTime())) {
        return "today";
    }
    const currentMidnight = getZonedMidnight(now, timeZone);
    const targetMidnight = getZonedMidnight(target, timeZone);
    const diffDays = Math.round((targetMidnight.getTime() - currentMidnight.getTime()) / MS_PER_DAY);
    if (diffDays <= 0) {
        return "today";
    }
    if (diffDays === 1) {
        return "tomorrow";
    }
    const targetWeek = getIsoWeek(targetMidnight);
    const currentWeek = getIsoWeek(currentMidnight);
    if (targetWeek.year === currentWeek.year &&
        targetWeek.week === currentWeek.week) {
        return "this-week";
    }
    if (targetWeek.year === currentWeek.year &&
        targetWeek.week === currentWeek.week + 1) {
        return "next-week";
    }
    const targetYMD = getZonedDateParts(target, timeZone);
    const currentYMD = getZonedDateParts(now, timeZone);
    const monthDiff = (targetYMD.year - currentYMD.year) * 12 +
        (targetYMD.month - currentYMD.month);
    if (monthDiff === 0) {
        return "this-month";
    }
    if (monthDiff === 1) {
        return "next-month";
    }
    return "later";
};
export const scheduleBucketOrder = () => [...BUCKET_ORDER];
export const formatDatetimeLocal = (isoString) => {
    if (!isoString)
        return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime()))
        return "";
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    const local = new Date(date.getTime() - offsetMs);
    return local.toISOString().slice(0, 16);
};
export const generateStreamId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `stream-${Date.now()}`;
};
const zonedFormatterCache = new Map();
const getZonedFormatter = (timeZone) => {
    const existing = zonedFormatterCache.get(timeZone);
    if (existing) {
        return existing;
    }
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    zonedFormatterCache.set(timeZone, formatter);
    return formatter;
};
const extractPart = (parts, type) => {
    const found = parts.find((part) => part.type === type);
    return found ? Number.parseInt(found.value, 10) : 0;
};
export const zonedDateTimeMs = (date, timeZone = DEFAULT_REGION_TZ) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 0;
    }
    const formatter = getZonedFormatter(timeZone);
    const parts = formatter.formatToParts(date);
    const year = extractPart(parts, "year");
    const month = extractPart(parts, "month");
    const day = extractPart(parts, "day");
    const hour = extractPart(parts, "hour");
    const minute = extractPart(parts, "minute");
    const second = extractPart(parts, "second");
    return Date.UTC(year, month - 1, day, hour, minute, second, 0);
};
export const isPastInTimeZone = (date, reference = new Date(), timeZone = DEFAULT_REGION_TZ) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return true;
    }
    return zonedDateTimeMs(date, timeZone) < zonedDateTimeMs(reference, timeZone);
};
