const HELABET_VIDEO_ENDPOINT = "/service-api/LiveFeed/Get1x2_VZip?count=200&lng=en&gr=766&mode=4&country=147&partner=237&virtualSports=true&noFilterBlockEvent=true";
const normalizeId = (value) => {
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
const registerIds = (lookup, ids, meta) => {
    ids.forEach((id) => {
        const key = normalizeId(id);
        if (!key)
            return;
        const existing = lookup.get(key);
        if (existing) {
            if (!existing.videoId && meta.videoId) {
                existing.videoId = meta.videoId;
            }
            if (!existing.sgi && meta.sgi) {
                existing.sgi = meta.sgi;
            }
            return;
        }
        lookup.set(key, { ...meta });
    });
};
export async function fetchHelabetLiveData(session) {
    try {
        const response = await session.helabetRequest(HELABET_VIDEO_ENDPOINT, { method: "GET" });
        if (!response.ok) {
            console.warn("[helabet-live][warn]", "live feed request failed", response.status, response.statusText);
            return null;
        }
        const payload = (await response.json());
        const matches = Array.isArray(payload?.Value) ? payload.Value : [];
        const lookup = new Map();
        matches.forEach((match) => {
            if (!match || typeof match !== "object") {
                return;
            }
            const videoId = typeof match.VI === "string" && match.VI.trim() ? match.VI.trim() : null;
            const sgi = typeof match.SGI === "string" && match.SGI.trim() ? match.SGI.trim() : null;
            if (!videoId && !sgi) {
                return;
            }
            const ids = [
                match.I,
                match.ZP,
                match.CI,
                match.Id,
                match.matchId,
                match.VI,
            ];
            registerIds(lookup, ids, { videoId, sgi });
        });
        return {
            lookup,
            matches,
        };
    }
    catch (error) {
        console.warn("[helabet-live][error]", error?.message ?? String(error));
        return null;
    }
}
