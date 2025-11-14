import { useEffect, useMemo, useState } from "react";

const generatePlayerId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

interface PlayerFrameProps {
  videoId?: string | null;
  sgi?: string | null;
  className?: string;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

const PlayerFrame = ({
  videoId,
  sgi,
  className,
  onReady,
  onError,
}: PlayerFrameProps) => {
  const [statusMessage, setStatusMessage] = useState("Loading…");
  const [isReady, setIsReady] = useState(false);
  const playerId = useMemo(() => generatePlayerId(), []);
  const hasSource = Boolean(
    (typeof videoId === "string" && videoId.trim()) ||
      (typeof sgi === "string" && sgi.trim()),
  );

  const iframeSrc = useMemo(() => {
    if (!hasSource) {
      return null;
    }
    const params = new URLSearchParams();
    if (videoId) {
      params.set("videoId", videoId);
    }
    if (sgi) {
      params.set("sgi", sgi);
    }
    params.set("playerId", playerId);
    return `/player?${params.toString()}`;
  }, [hasSource, playerId, sgi, videoId]);

  useEffect(() => {
    if (!hasSource) {
      setStatusMessage("Stream unavailable.");
      setIsReady(false);
      return;
    }
    setStatusMessage("Loading…");
    setIsReady(false);
  }, [hasSource, iframeSrc]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event?.data || typeof event.data !== "object") {
        return;
      }
      const data = event.data as { type?: string; playerId?: string; detail?: unknown };
      if (data.playerId !== playerId) {
        return;
      }
      if (data.type === "player-ready") {
        setIsReady(true);
        setStatusMessage("");
        if (onReady) {
          onReady();
        }
        return;
      }
      if (data.type === "player-error") {
        setIsReady(false);
        const detailMessage =
          (typeof data.detail === "object" &&
          data.detail &&
          "message" in data.detail
            ? (data.detail as { message?: string }).message
            : undefined) ?? "resolve_failed";
        if (detailMessage === "geo_blocked") {
          setStatusMessage("Video not available in your region");
        } else {
          setStatusMessage("Stream temporarily unavailable. Retrying…");
        }
        if (onError) {
          onError(new Error(detailMessage));
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onError, onReady, playerId]);

  const wrapperClassName = className ?? "live-player-wrapper";

  return (
    <div className={wrapperClassName}>
      {iframeSrc ? (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          allow="autoplay; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin"
          title="Live stream player"
        />
      ) : (
        <div className="player-frame-empty">Stream unavailable.</div>
      )}
      {(!isReady || statusMessage) && (
        <div className="live-player-status">
          {statusMessage || "Loading…"}
        </div>
      )}
    </div>
  );
};

export default PlayerFrame;
