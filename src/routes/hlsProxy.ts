import type { Request, Response } from "express";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fetch } from "undici";

const ALLOWED_HOST_REGEX = /^edge\d+\.xmediaget\.com$/i;
const ORIGIN_HEADER = "https://helabet.com";
const REFERER_HEADER = "https://helabet.com/";

const decodeSrc = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const url = new URL(decoded);
    if (!ALLOWED_HOST_REGEX.test(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const encodeSrc = (value: string): string =>
  Buffer.from(value).toString("base64");

const rewritePlaylist = (body: string, baseUrl: URL): string => {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }
      try {
        const resolved = new URL(trimmed, baseUrl).toString();
        const proxied = `/api/hls?src=${encodeURIComponent(encodeSrc(resolved))}`;
        return proxied;
      } catch {
        return line;
      }
    })
    .join("\n");
};

export const hlsProxyHandler = async (req: Request, res: Response): Promise<void> => {
  const encodedSrc = typeof req.query.src === "string" ? req.query.src : null;
  const target = decodeSrc(encodedSrc ?? undefined);
  if (!target) {
    res.status(400).json({ error: "invalid_source" });
    return;
  }

  const url = new URL(target);
  const isPlaylist = url.pathname.endsWith(".m3u8");

  try {
    const upstream = await fetch(url, {
      headers: {
        Origin: ORIGIN_HEADER,
        Referer: REFERER_HEADER,
        "User-Agent":
          req.get("user-agent") ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: req.get("accept") ?? "*/*",
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    if (isPlaylist) {
      const playlistText = await upstream.text();
      const rewritten = rewritePlaylist(playlistText, url);
      res
        .status(200)
        .type(upstream.headers.get("content-type") || "application/vnd.apple.mpegurl")
        .send(rewritten);
      return;
    }

    res.status(200);
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.type(contentType);
    }
    if (upstream.body) {
      Readable.fromWeb(upstream.body as unknown as NodeReadableStream).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.warn("[hls-proxy] failed", (error as Error)?.message ?? error);
    res.status(502).json({ error: "hls_proxy_failed" });
  }
};
