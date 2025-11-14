import type { Request, Response } from "express";

const PLAYER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Helabet Stream Player</title>
    <style>
      :root {
        color-scheme: dark;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #000;
        color: #fff;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .player-shell {
        position: relative;
        width: 100%;
        height: 100vh;
        background: #000;
      }
      video {
        width: 100%;
        height: 100%;
        background: #000;
      }
      video::-webkit-media-controls-play-button,
      video::-webkit-media-controls-pause-button,
      video::-webkit-media-controls-start-playback-button {
        display: none !important;
      }
      video::-webkit-media-controls-timeline,
      video::-webkit-media-controls-progress-bar,
      video::-webkit-media-controls-current-time-display,
      video::-webkit-media-controls-time-remaining-display {
        display: none !important;
      }
      .player-status {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 1rem;
        font-size: 0.95rem;
        background: rgba(0, 0, 0, 0.65);
        transition: opacity 0.2s ease;
      }
      .player-status.hidden {
        opacity: 0;
        pointer-events: none;
      }
      .player-hud {
        position: absolute;
        inset: 16px 16px auto auto;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        pointer-events: none;
      }
      .live-pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 6px 14px;
        border-radius: 999px;
        font-size: 0.75rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        background: rgba(0, 0, 0, 0.66);
        border: 1px solid rgba(255, 255, 255, 0.35);
        pointer-events: none;
      }
      .live-pill .live-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #ff4f4f;
        box-shadow: 0 0 10px rgba(255, 79, 79, 0.8);
      }
      .live-pill.is-behind {
        border-color: rgba(255, 255, 255, 0.2);
        background: rgba(0, 0, 0, 0.55);
        color: rgba(255, 255, 255, 0.65);
      }
    </style>
  </head>
  <body>
    <div class="player-shell">
      <video
        id="player-video"
        playsinline
        autoplay
        preload="auto"
        controls
        disablepictureinpicture
      ></video>
      <div id="player-status" class="player-status">Loading stream…</div>
      <div class="player-hud" aria-live="polite">
        <div id="player-live-pill" class="live-pill" aria-label="Live stream">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="live-label">Live</span>
        </div>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
    <script>
      (() => {
        const params = new URLSearchParams(window.location.search);
        const videoId = (params.get("videoId") || "").trim();
        const sgi = (params.get("sgi") || "").trim();
        const playerId =
          (params.get("playerId") || "").trim() ||
          \`player-\${Math.random().toString(36).slice(2, 10)}\`;
        const statusEl = document.getElementById("player-status");
        const videoEl = document.getElementById("player-video");
        const livePill = document.getElementById("player-live-pill");
        if (videoEl) {
          try {
            videoEl.muted = false;
            videoEl.defaultMuted = false;
            videoEl.volume = 1;
          } catch {
            // browsers might block before user gesture
          }
        }
        const body = {};
        if (videoId) body.videoId = videoId;
        if (sgi) body.sgi = sgi;
        if (!videoId && !sgi) {
          statusEl.textContent = "Missing stream identifier.";
          return;
        }

        let refreshTimer = null;
        let retryDelay = 2000;
        let hls = null;
        let readySignalled = false;
        let geoBlocked = false;
        const liveEventCleanups = [];

        const cleanup = () => {
          if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
          }
          if (hls) {
            hls.destroy();
            hls = null;
          }
          while (liveEventCleanups.length) {
            const dispose = liveEventCleanups.pop();
            try {
              dispose();
            } catch {
              // noop
            }
          }
        };

        const GEO_BLOCKED_MESSAGE = "Video not available in your region.";

        const handleGeoBlocked = () => {
          if (geoBlocked) {
            return;
          }
          geoBlocked = true;
          cleanup();
          setStatus(GEO_BLOCKED_MESSAGE);
          notifyParent("player-error", { message: "geo_blocked" });
        };

        const extractStatus = (response) => {
          if (!response || typeof response !== "object") {
            return null;
          }
          if (typeof response.status === "number") {
            return response.status;
          }
          if (typeof response.code === "number") {
            return response.code;
          }
          if (
            response.details &&
            typeof response.details === "object" &&
            typeof response.details.status === "number"
          ) {
            return response.details.status;
          }
          return null;
        };

        const isForbiddenResponse = (response) => extractStatus(response) === 403;

        const notifyParent = (type, detail) => {
          try {
            if (window.parent && typeof window.parent.postMessage === "function") {
              window.parent.postMessage({ type, playerId, detail }, "*");
            }
          } catch {
            // noop
          }
        };

        const setStatus = (message) => {
          if (!message) {
            statusEl.classList.add("hidden");
            statusEl.textContent = "";
            return;
          }
          statusEl.textContent = message;
          statusEl.classList.remove("hidden");
        };

        const toProxyUrl = (url) => {
          try {
            const encoded = btoa(url);
            const proxied = new URL("/api/hls", window.location.origin);
            proxied.searchParams.set("src", encoded);
            return proxied.toString();
          } catch {
            return url;
          }
        };

        const LIVE_EDGE_THRESHOLD_SEC = 2.5;

        const isAtLiveEdge = () => {
          if (!videoEl || typeof videoEl.currentTime !== "number") {
            return true;
          }
          const seekable = videoEl.seekable;
          if (!seekable || seekable.length === 0) {
            return true;
          }
          const liveEdge = seekable.end(seekable.length - 1);
          if (!Number.isFinite(liveEdge)) {
            return true;
          }
          return liveEdge - videoEl.currentTime <= LIVE_EDGE_THRESHOLD_SEC;
        };

        const updateLiveUi = () => {
          const atEdge = isAtLiveEdge();
          if (livePill) {
            livePill.classList.toggle("is-behind", !atEdge);
            livePill.setAttribute(
              "aria-label",
              atEdge ? "Live stream" : "Behind live, waiting to catch up",
            );
          }
        };

        const watchVideoEvent = (event, handler) => {
          videoEl.addEventListener(event, handler);
          liveEventCleanups.push(() => videoEl.removeEventListener(event, handler));
        };

        const attachLiveControls = () => {
          const handler = () => window.requestAnimationFrame(updateLiveUi);
          ["timeupdate", "playing", "waiting", "seeking", "seeked"].forEach((event) =>
            watchVideoEvent(event, handler),
          );
        };

        attachLiveControls();
        updateLiveUi();

        const applySource = (url) => {
          const sourceUrl = toProxyUrl(url);
          if (hls) {
            hls.destroy();
            hls = null;
          }
          if (window.Hls && window.Hls.isSupported()) {
            hls = new window.Hls({ lowLatencyMode: true, backBufferLength: 90 });
            hls.attachMedia(videoEl);
            hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
              hls.loadSource(sourceUrl);
            });
            hls.on(window.Hls.Events.ERROR, (_, data) => {
              if (data && isForbiddenResponse(data.response)) {
                handleGeoBlocked();
                return;
              }
              if (data && data.fatal) {
                setStatus("Stream temporarily unavailable. Retrying…");
                scheduleRetry();
              }
            });
          } else if (videoEl.canPlayType("application/vnd.apple.mpegURL")) {
            videoEl.src = sourceUrl;
            videoEl.play().catch(() => {});
          } else {
            videoEl.src = sourceUrl;
            videoEl.play().catch(() => {});
          }
          updateLiveUi();
        };

        const scheduleRefresh = (ttlSec) => {
          if (geoBlocked) {
            return;
          }
          const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 300;
          const jitter = 0.9 + Math.random() * 0.1;
          const delay = Math.max(2000, Math.round(ttl * 1000 * jitter));
          refreshTimer = window.setTimeout(() => {
            resolveStream(true);
          }, delay);
        };

        const scheduleRetry = () => {
          if (refreshTimer) {
            clearTimeout(refreshTimer);
          }
          if (geoBlocked) {
            return;
          }
          const delay = Math.min(retryDelay, 60_000);
          refreshTimer = window.setTimeout(() => resolveStream(true), delay);
          retryDelay = Math.min(delay * 2, 60_000);
        };

        const resolveStream = async (force = false) => {
          if (geoBlocked) {
            setStatus(GEO_BLOCKED_MESSAGE);
            return;
          }
          if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
          }

          setStatus(force ? "" : "Loading stream…");

          try {
            const response = await fetch("/api/resolve", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              credentials: "include",
              body: JSON.stringify(body),
            });

            if (!response.ok) {
              if (response.status === 403) {
                handleGeoBlocked();
                return;
              }
              let message = "resolve_failed";
              try {
                const errorJson = await response.json();
                if (errorJson && typeof errorJson === "object") {
                  const fetchedMessage =
                    (errorJson.message && String(errorJson.message)) ||
                    (errorJson.error && String(errorJson.error));
                  if (fetchedMessage) {
                    message = fetchedMessage;
                  }
                }
              } catch {
                // no-op
              }
              const error = new Error(message);
              error.status = response.status;
              throw error;
            }

            const payload = await response.json();
            const url = payload && payload.url;
            if (!url) {
              throw Object.assign(new Error("resolve_failed"), { status: 503 });
            }

            applySource(url);
            scheduleRefresh(payload && payload.ttlHintSec);
            setStatus("");
            retryDelay = 2000;
            if (!readySignalled) {
              notifyParent("player-ready");
              readySignalled = true;
            }
          } catch (error) {
            const status =
              typeof error === "object" && error && "status" in error
                ? error.status
                : 503;
            if (status === 404) {
              setStatus("Stream not found.");
              notifyParent("player-error", { message: "not_found" });
              return;
            }
            setStatus("Stream temporarily unavailable. Retrying…");
            const errorMessage =
              typeof error === "object" && error && "message" in error
                ? error.message
                : "resolve_failed";
            notifyParent("player-error", { message: errorMessage });
            scheduleRetry();
          }
        };

        window.addEventListener("beforeunload", cleanup);
        resolveStream();
      })();
    </script>
  </body>
</html>`;

export const renderPlayerPage = (): string => PLAYER_HTML;

export const playerPageHandler = (_req: Request, res: Response): void => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("text/html").send(renderPlayerPage());
};
