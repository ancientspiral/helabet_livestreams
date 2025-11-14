import { fetch, Headers } from "undici";
import setCookie from "set-cookie-parser";
const HELABET_BASE_URL = "https://helabet.com";
const WARMUP_HTML_PATH = "/en/live?platform_type=desktop";
const WARMUP_SPA_PATH = "/sys-v3-host-app-front/en/live?platform_type=desktop";
const WARMUP_VIDEO_CFG_PATH = "/bff-api/config/video.json";
const WARMUP_REUSE_WINDOW_MS = 10 * 60 * 1000;
const RETRYABLE_STATUSES = [401, 403, 406];
export class HelabetSession {
    cookieJar = new Map();
    cookieMeta = new Map();
    lastWarmup = 0;
    warmupPromise = null;
    UA;
    APP_N;
    constructor(opts) {
        this.UA =
            opts?.ua?.trim() ||
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        this.APP_N = opts?.appN?.trim() || "__BETTING_APP__";
    }
    async warmUp(force = false) {
        const now = Date.now();
        if (!force && this.cookieJar.size > 0 && this.lastWarmup) {
            const age = now - this.lastWarmup;
            if (age < WARMUP_REUSE_WINDOW_MS) {
                return;
            }
        }
        if (this.warmupPromise) {
            return this.warmupPromise;
        }
        const run = (async () => {
            const headersBase = {
                "user-agent": this.UA,
            };
            await this.performWarmUpStep(WARMUP_HTML_PATH, {
                ...headersBase,
                accept: "text/html,application/xhtml+xml,*/*",
            });
            if (!this.cookieJar.has("SESSION")) {
                await this.performWarmUpStep(WARMUP_SPA_PATH, {
                    ...headersBase,
                    accept: "application/json, text/plain, */*",
                    "force-spa": "true",
                    "mf-render-mode": "json",
                    "x-app-n": "v3-nuxt2",
                });
            }
            await this.performWarmUpStep(WARMUP_VIDEO_CFG_PATH, {
                ...headersBase,
                accept: "application/json, text/plain, */*",
            });
            this.lastWarmup = Date.now();
        })();
        this.warmupPromise = run.finally(() => {
            this.warmupPromise = null;
        });
        return this.warmupPromise;
    }
    async helabetGet(pathWithQuery) {
        return this.helabetRequest(pathWithQuery, { method: "GET" });
    }
    async helabetRequest(pathWithQuery, options = {}) {
        if (this.cookieJar.size === 0) {
            try {
                await this.warmUp();
            }
            catch {
                // allow the request to surface errors upstream
            }
        }
        return this.executeRequest(pathWithQuery, options);
    }
    buildCookieHeader() {
        const now = Date.now();
        const pairs = [];
        for (const [name, value] of this.cookieJar.entries()) {
            const meta = this.cookieMeta.get(name);
            if (meta?.expiresAt && meta.expiresAt <= now) {
                this.cookieJar.delete(name);
                this.cookieMeta.delete(name);
                continue;
            }
            pairs.push(`${name}=${value}`);
        }
        return pairs.join("; ");
    }
    updateFromSetCookie(headers) {
        const headerWithGetSetCookie = headers;
        const rawSetCookie = typeof headerWithGetSetCookie.getSetCookie === "function"
            ? headerWithGetSetCookie.getSetCookie() ?? []
            : headers.get("set-cookie")
                ? [headers.get("set-cookie")]
                : [];
        if (rawSetCookie.length === 0) {
            return;
        }
        const parsed = setCookie.parse(rawSetCookie, { map: true });
        const now = Date.now();
        for (const [name, details] of Object.entries(parsed)) {
            if (!details) {
                continue;
            }
            const value = details.value?.trim() ?? "";
            const expiresAt = this.resolveCookieExpiry(details, now);
            if (value === "" ||
                details.maxAge === 0 ||
                (typeof expiresAt === "number" && expiresAt <= now)) {
                this.cookieJar.delete(name);
                this.cookieMeta.delete(name);
                continue;
            }
            this.cookieJar.set(name, value);
            this.cookieMeta.set(name, { expiresAt });
        }
    }
    resolveCookieExpiry(details, now) {
        if (typeof details.maxAge === "number") {
            return Number.isFinite(details.maxAge)
                ? now + details.maxAge * 1000
                : null;
        }
        if (typeof details.expires === "string") {
            const parsed = new Date(details.expires);
            return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
        }
        if (details.expires instanceof Date) {
            const ts = details.expires.getTime();
            return Number.isFinite(ts) ? ts : null;
        }
        return null;
    }
    async executeRequest(pathWithQuery, options) {
        const normalizedPath = pathWithQuery.startsWith("/")
            ? pathWithQuery
            : `/${pathWithQuery}`;
        const targetUrl = new URL(normalizedPath, HELABET_BASE_URL);
        const method = (options.method ?? "GET").toUpperCase();
        const rawOverrides = options.headers ? { ...options.headers } : {};
        const headers = new Headers();
        headers.set("accept", "application/json, text/plain, */*");
        headers.set("user-agent", this.UA);
        headers.set("x-app-n", this.APP_N);
        headers.set("x-requested-with", "XMLHttpRequest");
        headers.set("referer", `${HELABET_BASE_URL}${WARMUP_HTML_PATH}`);
        Object.entries(rawOverrides).forEach(([key, value]) => {
            headers.set(key, value);
        });
        const cookieHeader = this.buildCookieHeader();
        if (cookieHeader) {
            headers.set("cookie", cookieHeader);
        }
        let body;
        if (options.body !== undefined && options.body !== null) {
            if (typeof options.body === "string" ||
                options.body instanceof Uint8Array ||
                options.body instanceof ArrayBuffer) {
                body = options.body;
            }
            else {
                body = JSON.stringify(options.body);
                if (!headers.has("content-type")) {
                    headers.set("content-type", "application/json");
                }
            }
        }
        const attemptFetch = async () => {
            const response = await fetch(targetUrl, {
                method,
                headers,
                body,
            });
            this.updateFromSetCookie(response.headers);
            return response;
        };
        const retryOnAuth = options.retryOnAuth !== false;
        let response = await attemptFetch();
        if (retryOnAuth &&
            RETRYABLE_STATUSES.includes(response.status)) {
            try {
                await this.warmUp(true);
                response = await attemptFetch();
            }
            catch {
                // swallow and return original response
            }
        }
        return response;
    }
    async performWarmUpStep(path, headers) {
        const stepHeaders = { ...headers };
        const cookieHeader = this.buildCookieHeader();
        if (cookieHeader) {
            stepHeaders.cookie = cookieHeader;
        }
        const response = await fetch(new URL(path, HELABET_BASE_URL), {
            method: "GET",
            headers: stepHeaders,
        });
        this.updateFromSetCookie(response.headers);
        if (!response.ok) {
            throw new Error(`Warm-up step ${path} failed with status ${response.status}`);
        }
        await response.arrayBuffer();
    }
}
