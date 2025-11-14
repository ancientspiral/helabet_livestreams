import { request } from "undici";
const BASE = "https://helabet.com";
// Stable, plausible browser UA
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15";
let X_HD; // current token from video.json response header
let lastWarmup = 0;
const COMMON_HEADERS = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "x-app-n": "__BETTING_APP__",
    "x-requested-with": "XMLHttpRequest",
};
const cookieStore = new Map();
const getOrigin = (url) => new URL(url).origin;
const getCookieHeader = (origin) => {
    const jar = cookieStore.get(origin);
    if (!jar || jar.size === 0) {
        return undefined;
    }
    return Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
};
const storeCookies = (origin, headers) => {
    const setCookie = headers["set-cookie"];
    if (!setCookie) {
        return;
    }
    const jar = cookieStore.get(origin) ?? new Map();
    const values = Array.isArray(setCookie) ? setCookie : [setCookie];
    values.forEach((cookie) => {
        const [pair] = cookie.split(";", 1);
        if (!pair) {
            return;
        }
        const index = pair.indexOf("=");
        if (index === -1) {
            return;
        }
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!name) {
            return;
        }
        jar.set(name, value);
    });
    cookieStore.set(origin, jar);
};
const headerValue = (headers, key) => {
    const value = headers[key];
    if (Array.isArray(value)) {
        return value[0];
    }
    return value ?? undefined;
};
const applyCookies = (headers, origin) => {
    const lower = Object.keys(headers).map((key) => key.toLowerCase());
    if (!lower.includes("cookie")) {
        const cookie = getCookieHeader(origin);
        if (cookie) {
            return { ...headers, Cookie: cookie };
        }
    }
    return headers;
};
const requestWithHeaders = async (url, headers, init) => {
    const origin = getOrigin(url);
    const finalHeaders = applyCookies({ ...headers }, origin);
    const response = await request(url, { ...init, headers: finalHeaders });
    const rawHeaders = response.headers;
    storeCookies(origin, rawHeaders);
    const hd = headerValue(rawHeaders, "x-hd");
    if (hd) {
        X_HD = hd;
    }
    return response;
};
function withXhd() {
    return X_HD ? { ...COMMON_HEADERS, "x-hd": X_HD } : { ...COMMON_HEADERS };
}
async function warmUp() {
    // throttle warm-up calls
    if (Date.now() - lastWarmup < 1500)
        return;
    lastWarmup = Date.now();
    // 1) visit live page (sets cookies in jar)
    await requestWithHeaders(`${BASE}/en/live?platform_type=desktop`, {
        ...COMMON_HEADERS,
    });
    // 2) request video.json and capture x-hd header (JWT)
    await requestWithHeaders(`${BASE}/bff-api/config/video.json`, {
        ...COMMON_HEADERS,
    });
}
function buildUrl(path, params) {
    const u = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
    if (params)
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined)
                u.searchParams.set(k, String(v));
        }
    return u.toString();
}
async function getJson(url) {
    const res = await requestWithHeaders(url, withXhd());
    if (res.statusCode === 406) {
        const err = new Error("406");
        err.code = 406;
        throw err;
    }
    if (res.statusCode >= 400) {
        const body = await res.body.text();
        throw new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`);
    }
    return res.body.json();
}
async function getWithWarmup(url) {
    await warmUp();
    try {
        return await getJson(url);
    }
    catch (e) {
        if (e?.code === 406) {
            await warmUp();
            return await getJson(url);
        }
        throw e;
    }
}
// ---- Public helpers used by Express routes ----
export async function apiGetTopGamesStatZip() {
    const url = buildUrl("/service-api/LiveFeed/GetTopGamesStatZip", {
        lng: "en",
        antisports: 66,
        partner: 237,
    });
    return getWithWarmup(url);
}
export async function apiGetSportsShortZip() {
    const url = buildUrl("/service-api/LiveFeed/GetSportsShortZip", {
        lng: "en",
        gr: 766,
        country: 147,
        partner: 237,
        virtualSports: true,
        groupChamps: true,
    });
    return getWithWarmup(url);
}
export async function apiGetTopChampsZip() {
    const url = buildUrl("/service-api/LiveFeed/WebGetTopChampsZip", {
        lng: "en",
        gr: 766,
        country: 147,
    });
    return getWithWarmup(url);
}
export async function apiGet1x2_VZip() {
    const url = buildUrl("/service-api/LiveFeed/Get1x2_VZip", {
        count: 40,
        lng: "en",
        gr: 766,
        mode: 4,
        country: 147,
        partner: 237,
        virtualSports: true,
        noFilterBlockEvent: true,
    });
    return getWithWarmup(url);
}
export async function apiGetChampZip(champId) {
    const url = buildUrl("/service-api/LiveFeed/GetChampZip", {
        champ: champId,
        lng: "en",
        partner: 237,
        country: 147,
        groupChamps: true,
    });
    return getWithWarmup(url);
}
export async function apiCinema(videoId) {
    const res = await requestWithHeaders(`${BASE}/cinema`, {
        ...withXhd(),
        Origin: BASE,
        "Content-Type": "application/json",
    }, {
        method: "POST",
        body: JSON.stringify({
            AppId: 3,
            AppVer: "1025",
            VpcVer: "1.0.17",
            Language: "en",
            Token: "",
            VideoId: videoId,
        }),
    });
    if (res.statusCode >= 400) {
        const t = await res.body.text();
        throw new Error(`cinema ${res.statusCode}: ${t.slice(0, 300)}`);
    }
    return res.body.json();
}
