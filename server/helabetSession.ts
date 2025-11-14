import { fetch, Headers, Response } from "undici";
import setCookie, { type Cookie } from "set-cookie-parser";

const HELABET_BASE_URL = "https://helabet.com";
const WARMUP_HTML_PATH = "/en/live?platform_type=desktop";
const WARMUP_SPA_PATH = "/sys-v3-host-app-front/en/live?platform_type=desktop";
const WARMUP_VIDEO_CFG_PATH = "/bff-api/config/video.json";
const WARMUP_REUSE_WINDOW_MS = 10 * 60 * 1000;

type RetryableStatus = 401 | 403 | 406;

const RETRYABLE_STATUSES: RetryableStatus[] = [401, 403, 406];

interface SessionOptions {
  ua?: string;
  appN?: string;
}

export class HelabetSession {
  private readonly cookieJar = new Map<string, string>();

  private lastWarmup = 0;

  private warmupPromise: Promise<void> | null = null;

  private readonly UA: string;

  private readonly APP_N: string;

  constructor(opts?: SessionOptions) {
    this.UA = opts?.ua?.trim() ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.APP_N = opts?.appN?.trim() || "__BETTING_APP__";
  }

  private buildCookieHeader(): string {
    return Array.from(this.cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private updateFromSetCookie(headers: Headers): void {
    const headerWithGetSetCookie = headers as Headers & {
      getSetCookie?: () => string[] | undefined;
    };

    const cookieValues =
      typeof headerWithGetSetCookie.getSetCookie === "function"
        ? headerWithGetSetCookie.getSetCookie() ?? []
        : headers.get("set-cookie")
            ? [headers.get("set-cookie") as string]
            : [];

    if (cookieValues.length === 0) {
      return;
    }

    const parsed = setCookie.parse(cookieValues, { map: true }) as Record<
      string,
      Cookie | undefined
    >;
    const now = Date.now();
    Object.entries(parsed).forEach(([name, details]) => {
      if (!details) {
        return;
      }

      const expiresAt =
        details.expires instanceof Date ? details.expires.getTime() : null;

      if (
        details.value === "" ||
        details.maxAge === 0 ||
        (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt <= now)
      ) {
        this.cookieJar.delete(name);
        return;
      }

      if (typeof details.value === "string") {
        this.cookieJar.set(name, details.value);
      }
    });
  }

// helabetSession.ts — перепиши warmUp() так
async warmUp(force = false): Promise<void> {
  if (!force && this.cookieJar.size > 0 && this.lastWarmup) {
    const age = Date.now() - this.lastWarmup;
    if (age < WARMUP_REUSE_WINDOW_MS) return;
  }
  if (this.warmupPromise) return this.warmupPromise;

  const run = (async () => {
    try {
      // 1) Простой HTML — чаще всего достаточно
      await this.performWarmUpStep(WARMUP_HTML_PATH, {
        accept: "text/html,application/xhtml+xml,*/*",
      });

      if (!this.cookieJar.has("SESSION")) {
        // 2) SPA JSON с обязательными заголовками
        await this.performWarmUpStep(WARMUP_SPA_PATH, {
          accept: "application/json, text/plain, */*",
          "force-spa": "true",
          "mf-render-mode": "json",
          "x-app-n": "v3-nuxt2",
        });
      }

      // 3) Добрать служебные куки (необязательно, но полезно)
      await this.performWarmUpStep(WARMUP_VIDEO_CFG_PATH, {
        accept: "application/json, text/plain, */*",
      });

      this.lastWarmup = Date.now();
    } catch (error) {
      throw new Error(
        `Helabet warmup failed: ${(error as Error)?.message ?? String(error)}`
      );
    }
  })();

  this.warmupPromise = run.finally(() => (this.warmupPromise = null));
  return this.warmupPromise;
}

  async helabetGet(pathWithQuery: string): Promise<Response> {
    const normalizedPath = pathWithQuery.startsWith("/")
      ? pathWithQuery
      : `/${pathWithQuery}`;

    const targetUrl = new URL(normalizedPath, HELABET_BASE_URL);

    const attemptFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        accept: "application/json, text/plain, */*",
        "user-agent": this.UA,
        "x-requested-with": "XMLHttpRequest",
        referer: `${HELABET_BASE_URL}/en/live?platform_type=desktop`,
      };

      const cookieHeader = this.buildCookieHeader();
      if (cookieHeader) {
        headers.cookie = cookieHeader;
      }

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers,
        });

        this.updateFromSetCookie(response.headers);
        return response;
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        return new Response(
          JSON.stringify({ error: true, message }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          },
        );
      }
    };

    let response = await attemptFetch();

    if (
      RETRYABLE_STATUSES.includes(response.status as RetryableStatus)
    ) {
      try {
        await this.warmUp(true);
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: true,
            message: `Warmup failed before retry: ${(error as Error)?.message ?? String(error)}`,
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          },
        );
      }

      response = await attemptFetch();
    }

    return response;
  }

  private async performWarmUpStep(
    path: string,
    headerOverrides: Record<string, string>,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "user-agent": this.UA,
      ...headerOverrides,
    };

    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const response = await fetch(new URL(path, HELABET_BASE_URL), {
      method: "GET",
      headers,
    });

    this.updateFromSetCookie(response.headers);

    // Warmup should succeed with 2xx; capture any anomalies for logging upstream.
    if (!response.ok) {
      throw new Error(`Warmup step ${path} returned status ${response.status}`);
    }

    // Consume body to free resources without parsing.
    await response.arrayBuffer();
  }
}
