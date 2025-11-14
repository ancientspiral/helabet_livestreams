import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 60_000;
export const useLiveStreams = () => {
  const [streamEvents, setStreamEvents] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  /** @type {import("react").MutableRefObject<AbortController | null>} */
  const abortRef = useRef(null);
  /** @type {import("react").MutableRefObject<number | null>} */
  const timerRef = useRef(null);

  const summarize = (label, list) => {
    const sports = Array.isArray(list)
      ? list.reduce((acc, item) => {
          const key = item?.sport ?? "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {})
      : {};
    console.log(`[${label}]`, {
      total: Array.isArray(list) ? list.length : 0,
      sports,
    });
  };

  const loadLiveData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const [streamsResponse, allResponse] = await Promise.all([
        fetch("/api/live/matches", {
          headers: { accept: "application/json" },
          credentials: "include",
          signal: controller.signal,
        }),
        fetch("/api/live/all", {
          headers: { accept: "application/json" },
          credentials: "include",
          signal: controller.signal,
        }),
      ]);
      if (!streamsResponse.ok) {
        throw new Error(`Failed to fetch streams: ${streamsResponse.status}`);
      }
      if (!allResponse.ok) {
        throw new Error(`Failed to fetch all events: ${allResponse.status}`);
      }
      const [streamsPayload, allPayload] = await Promise.all([
        streamsResponse.json(),
        allResponse.json(),
      ]);
      const nextStreams = Array.isArray(streamsPayload)
        ? streamsPayload
        : Array.isArray(streamsPayload?.matches)
          ? streamsPayload.matches
          : [];
      const nextAll = Array.isArray(allPayload)
        ? allPayload
        : Array.isArray(allPayload?.matches)
          ? allPayload.matches
          : [];
      setStreamEvents(nextStreams);
      setAllEvents(nextAll);
      summarize("live-streams", nextStreams);
      summarize("live-all", nextAll);
    } catch (error) {
      if (error && typeof error === "object" && error.name === "AbortError") {
        return;
      }
      console.warn("Failed to load live streams", error);
      setStreamEvents([]);
      setAllEvents([]);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const scheduleNext = () => {
      timerRef.current = window.setTimeout(() => {
        void loadLiveData().finally(() => {
          if (isMounted) {
            scheduleNext();
          }
        });
      }, POLL_INTERVAL_MS);
    };

    void loadLiveData().finally(() => {
      if (isMounted) {
        scheduleNext();
      }
    });

    return () => {
      isMounted = false;
      abortRef.current?.abort();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loadLiveData]);

  return { streams: streamEvents, allEvents };
};
