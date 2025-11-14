import type { HeadersInit } from "undici";

const RETRYABLE_STATUS = new Set([406, 429]);
const BASE_DELAY_MS = 200;

interface CacheEntry<T> {
  data: T;
  until: number;
}

const cacheStore = new Map<string, CacheEntry<unknown>>();

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const headersCommon = (): Headers => {
  const headers = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://helabet.com/",
    Origin: "https://helabet.com",
    "x-app-n": "__BETTING_APP__",
    "x-requested-with": "XMLHttpRequest",
  });

  const xHd = process.env.HELABET_X_HD?.trim();
  if (xHd) {
    headers.set("x-hd", xHd);
  }

  const cookies = process.env.HELABET_COOKIES?.trim();
  if (cookies) {
    headers.set("Cookie", cookies);
  }

  return headers;
};

export const mergeHeaders = (
  base: Headers,
  extra?: HeadersInit,
): Headers => {
  const result = new Headers(base);
  if (!extra) return result;

  const iterate = (name: string, value: string) => {
    if (value !== undefined && value !== null) {
      result.set(name, value);
    }
  };

  if (extra instanceof Headers) {
    extra.forEach(iterate);
    return result;
  }

  if (Array.isArray(extra)) {
    extra.forEach(([name, value]) => iterate(name, value));
    return result;
  }

  Object.entries(extra).forEach(([name, value]) => {
    if (typeof value === "string") {
      iterate(name, value);
    }
  });

  return result;
};

export const fetchWithRetry = async (
  url: string | URL,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> => {
  let attempt = 0;
  let lastError: unknown;
  let lastResponse: Response | null = null;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, init);
      lastResponse = response;

      const shouldRetry =
        RETRYABLE_STATUS.has(response.status) || response.status >= 500;
      if (!shouldRetry) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    attempt += 1;
    if (attempt >= maxRetries) {
      break;
    }

    const waitTime = BASE_DELAY_MS * 2 ** (attempt - 1);
    await delay(waitTime);
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError ?? new Error("fetch_failed");
};

export const readCache = <T>(key: string): T | undefined => {
  const entry = cacheStore.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.until < Date.now()) {
    cacheStore.delete(key);
    return undefined;
  }

  return entry.data as T;
};

export const writeCache = <T>(key: string, data: T, ttlMs: number): void => {
  cacheStore.set(key, { data, until: Date.now() + ttlMs });
};

export const clearCacheEntry = (key: string): void => {
  cacheStore.delete(key);
};

export const dumpCacheKeys = (): string[] => Array.from(cacheStore.keys());
