import { fetch } from "undici";

type FetchLike = typeof fetch;

const EXPIRY_BUFFER_MS = 60_000;

export interface MarketingAuthConfig {
  authUrl: string;
  clientId?: string;
  clientSecret?: string;
}

export class MarketingAuth {
  private accessToken: string | null = null;

  private expiresAt = 0;

  private inflight: Promise<string> | null = null;

  private readonly authUrl: string;

  private readonly clientId?: string;

  private readonly clientSecret?: string;

  private readonly fetchImpl: FetchLike;

  constructor(config: MarketingAuthConfig, fetchImpl: FetchLike = fetch) {
    this.authUrl = config.authUrl;
    this.clientId = config.clientId?.trim();
    this.clientSecret = config.clientSecret?.trim();
    this.fetchImpl = fetchImpl;
  }

  private isTokenValid(): boolean {
    if (!this.accessToken) {
      return false;
    }
    if (!this.expiresAt) {
      return true;
    }
    return Date.now() + EXPIRY_BUFFER_MS < this.expiresAt;
  }

  async getBearer(forceRefresh = false): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("[marketing-auth] client id/secret missing");
    }

    if (forceRefresh) {
      this.invalidate();
    }

    if (this.isTokenValid()) {
      return this.accessToken as string;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.fetchToken().finally(() => {
      this.inflight = null;
    });

    return this.inflight;
  }

  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private async fetchToken(): Promise<string> {
    const payload = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
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
      console.warn(
        "[marketing-auth] token fetch failed",
        response.status,
        response.statusText,
        text.slice(0, 200),
      );
      throw new Error(
        `[marketing-auth] token request failed: ${response.status} ${response.statusText}`,
      );
    }

    let parsed: { access_token?: string; expires_in?: number };
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch (error) {
      console.warn(
        "[marketing-auth] token response invalid JSON",
        text.slice(0, 200),
        error,
      );
      throw new Error("[marketing-auth] token response invalid JSON");
    }

    if (!parsed?.access_token) {
      throw new Error("[marketing-auth] token response missing access_token");
    }

    const expiresInSeconds =
      typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
        ? parsed.expires_in
        : 300;
    this.accessToken = parsed.access_token;
    this.expiresAt = Date.now() + expiresInSeconds * 1000;

    console.log(
      "[marketing-auth] fetched token",
      `exp=${new Date(this.expiresAt).toISOString()}`,
    );

    return this.accessToken;
  }
}
