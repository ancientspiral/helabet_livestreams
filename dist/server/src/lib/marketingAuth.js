import { fetch } from "undici";
const EXPIRY_BUFFER_MS = 60_000;
export class MarketingAuth {
    accessToken = null;
    expiresAt = 0;
    inflight = null;
    authUrl;
    clientId;
    clientSecret;
    fetchImpl;
    constructor(config, fetchImpl = fetch) {
        this.authUrl = config.authUrl;
        this.clientId = config.clientId?.trim();
        this.clientSecret = config.clientSecret?.trim();
        this.fetchImpl = fetchImpl;
    }
    isTokenValid() {
        if (!this.accessToken) {
            return false;
        }
        if (!this.expiresAt) {
            return true;
        }
        return Date.now() + EXPIRY_BUFFER_MS < this.expiresAt;
    }
    async getBearer(forceRefresh = false) {
        if (!this.clientId || !this.clientSecret) {
            throw new Error("[marketing-auth] client id/secret missing");
        }
        if (forceRefresh) {
            this.invalidate();
        }
        if (this.isTokenValid()) {
            return this.accessToken;
        }
        if (this.inflight) {
            return this.inflight;
        }
        this.inflight = this.fetchToken().finally(() => {
            this.inflight = null;
        });
        return this.inflight;
    }
    invalidate() {
        this.accessToken = null;
        this.expiresAt = 0;
    }
    async fetchToken() {
        const payload = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: this.clientId,
            client_secret: this.clientSecret,
        });
        const response = await this.fetchImpl(this.authUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: payload.toString(),
        });
        const text = await response.text();
        if (!response.ok) {
            console.warn("[marketing-auth] token fetch failed", response.status, response.statusText, text.slice(0, 200));
            throw new Error(`[marketing-auth] token request failed: ${response.status} ${response.statusText}`);
        }
        let parsed;
        try {
            parsed = text ? JSON.parse(text) : {};
        }
        catch (error) {
            console.warn("[marketing-auth] token response invalid JSON", text.slice(0, 200), error);
            throw new Error("[marketing-auth] token response invalid JSON");
        }
        if (!parsed?.access_token) {
            throw new Error("[marketing-auth] token response missing access_token");
        }
        const expiresInSeconds = typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
            ? parsed.expires_in
            : 300;
        this.accessToken = parsed.access_token;
        this.expiresAt = Date.now() + expiresInSeconds * 1000;
        console.log("[marketing-auth] fetched token", `exp=${new Date(this.expiresAt).toISOString()}`);
        return this.accessToken;
    }
}
