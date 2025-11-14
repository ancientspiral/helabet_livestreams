import type { Request, Response } from "express";
import { HelabetSession } from "../helabetSession.js";

const NO_BODY_STATUSES = new Set([204, 205, 304]);
const HLB_REFERER = "https://helabet.com/en/live";
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_APP_NAME = "__BETTING_APP__";

const FORWARDED_HEADER_KEYS = [
  "cookie",
  "x-hd",
  "x-app-n",
  "x-requested-with",
  "user-agent",
] as const;

const ensureHeaderValue = (value?: string | string[]): string | undefined => {
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string" && entry.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
};

const buildForwardHeaders = (req: Request): Record<string, string> => {
  const headers: Record<string, string> = {
    referer: HLB_REFERER,
    "x-requested-with": "XMLHttpRequest",
  };

  FORWARDED_HEADER_KEYS.forEach((key) => {
    const value = ensureHeaderValue(req.headers[key]);
    if (value) {
      headers[key] = value;
    }
  });

  if (!headers["user-agent"]) {
    headers["user-agent"] = DEFAULT_UA;
  }
  if (!headers["x-app-n"]) {
    headers["x-app-n"] = DEFAULT_APP_NAME;
  }

  return headers;
};

export function makeHelabetProxy(session: HelabetSession) {
  return async function proxy(req: Request, res: Response) {
    const pathWithQuery = req.originalUrl.replace(/^\/api\/hlb/, "") || "/";
    const method = (req.method ?? "GET").toUpperCase();
    const hasBody =
      method !== "GET" &&
      method !== "HEAD" &&
      req.body !== undefined &&
      req.body !== null &&
      req.body !== "";
    const headers = buildForwardHeaders(req);

    try {
      const upstream = await session.helabetRequest(pathWithQuery, {
        method,
        headers,
        body: hasBody ? req.body : undefined,
        retryOnAuth: true,
      });
      const status = upstream.status;

      if (!upstream.ok) {
        const snippet = (await upstream.text()).slice(0, 400);
        res.status(status).json({ error: true, status, snippet });
        return;
      }

      if (NO_BODY_STATUSES.has(status)) {
        res.status(status).end();
        return;
      }

      const contentType = upstream.headers.get("content-type") ?? "";
      const lowered = contentType.toLowerCase();
      const body = await upstream.text();

      if (lowered.includes("json")) {
        try {
          const parsed = body ? JSON.parse(body) : null;
          res.status(status).json(parsed);
        } catch (error) {
          const snippet = body.slice(0, 400);
          console.warn("[hlb-proxy] invalid JSON", {
            path: pathWithQuery,
            status,
            snippet,
            message: (error as Error)?.message ?? "parse_failed",
          });
          res
            .status(502)
            .json({ error: "invalid_json", status, snippet });
        }
        return;
      }

      res.status(status).type(contentType || "text/plain").send(body);
    } catch (error) {
      res.status(500).json({
        error: true,
        message: (error as Error)?.message ?? String(error),
      });
    }
  };
}
