import { fetch, Headers, Response } from "undici";
import type { BodyInit as UndiciBodyInit } from "undici";
import setCookie, { type Cookie } from "set-cookie-parser";

const HELABET_BASE_URL = "https://helabet.com";
const WARMUP_HTML_PATH = "/en/live?platform_type=desktop";
const WARMUP_SPA_PATH = "/sys-v3-host-app-front/en/live?platform_type=desktop";
const WARMUP_VIDEO_CFG_PATH = "/bff-api/config/video.json";
const WARMUP_REUSE_WINDOW_MS = 10 * 60 * 1000;

type RetryableStatus = 401 | 403 | 406;

const RETRYABLE_STATUSES: RetryableStatus[] = [401, 403, 406];

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  retryOnAuth?: boolean;
}

export interface HelabetSessionOptions {
  ua?: string;
  appN?: string;
}

interface CookieMeta {
  expiresAt: number | null;
}

export class HelabetSession {
  private readonly cookieJar = new Map<string, string>();

  private readonly cookieMeta = new Map<string, CookieMeta>();

  private lastWarmup = 0;

  private warmupPromise: Promise<void> | null = null;

  private readonly UA: string;

  private readonly APP_N: string;

  constructor(opts?: HelabetSessionOptions) {
    this.UA =
      opts?.ua?.trim() ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.APP_N = opts?.appN?.trim() || "__BETTING_APP__";
  }

  async warmUp(force = false): Promise<void> {
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

  async helabetGet(pathWithQuery: string): Promise<Response> {
    return this.helabetRequest(pathWithQuery, { method: "GET" });
  }

  async helabetRequest(
    pathWithQuery: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    if (this.cookieJar.size === 0) {
      try {
        await this.warmUp();
      } catch {
        // allow the request to surface errors upstream
      }
    }

    return this.executeRequest(pathWithQuery, options);
  }

  private buildCookieHeader(): string {
    const now = Date.now();
    const pairs: string[] = [];

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

  private updateFromSetCookie(headers: Headers): void {
    const headerWithGetSetCookie = headers as Headers & {
      getSetCookie?: () => string[] | undefined;
    };

    const rawSetCookie =
      typeof headerWithGetSetCookie.getSetCookie === "function"
        ? headerWithGetSetCookie.getSetCookie() ?? []
        : headers.get("set-cookie")
          ? [headers.get("set-cookie") as string]
          : [];

    if (rawSetCookie.length === 0) {
      return;
    }

    const parsed = setCookie.parse(rawSetCookie, { map: true }) as Record<
      string,
      Cookie | undefined
    >;

    const now = Date.now();

    for (const [name, details] of Object.entries(parsed)) {
      if (!details) {
        continue;
      }

      const value = details.value?.trim() ?? "";
      const expiresAt = this.resolveCookieExpiry(details, now);

      if (
        value === "" ||
        details.maxAge === 0 ||
        (typeof expiresAt === "number" && expiresAt <= now)
      ) {
        this.cookieJar.delete(name);
        this.cookieMeta.delete(name);
        continue;
      }

      this.cookieJar.set(name, value);
      this.cookieMeta.set(name, { expiresAt });
    }
  }

  private resolveCookieExpiry(details: Cookie, now: number): number | null {
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

  private async executeRequest(
    pathWithQuery: string,
    options: RequestOptions,
  ): Promise<Response> {
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

    let body: UndiciBodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (
        typeof options.body === "string" ||
        options.body instanceof Uint8Array ||
        options.body instanceof ArrayBuffer
      ) {
        body = options.body as UndiciBodyInit;
      } else {
        body = JSON.stringify(options.body) as UndiciBodyInit;
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
    }

    const attemptFetch = async (): Promise<Response> => {
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

    if (
      retryOnAuth &&
      RETRYABLE_STATUSES.includes(response.status as RetryableStatus)
    ) {
      try {
        await this.warmUp(true);
        response = await attemptFetch();
      } catch {
        // swallow and return original response
      }
    }

    return response;
  }

  private async performWarmUpStep(
    path: string,
    headers: Record<string, string>,
  ): Promise<void> {
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
