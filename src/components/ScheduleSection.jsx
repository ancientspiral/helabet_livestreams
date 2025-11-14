import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DEFAULT_TIME_ZONE,
  deriveScheduleBucket,
} from "../utils/streams.js";

const TAB_OPTIONS = [{ label: "Today", value: "today" }];

const formatDateOnlyLabel = (date) => {
  if (!date) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = (mapped.weekday ?? "").toUpperCase();
  const day = mapped.day ?? "--";
  const month = mapped.month ?? "--";
  const year = mapped.year ?? "----";
  return `${weekday} ${day}.${month}.${year}`;
};

const getDefaultTabLabel = (_tab, referenceDate) => {
  const base = new Date(referenceDate);
  if (Number.isNaN(base.getTime())) {
    return "Today";
  }
  return formatDateOnlyLabel(base);
};

const formatTime = (isoString) => {
  if (!isoString) return "--:--";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DEFAULT_TIME_ZONE,
  });
};

const ZERO_PAD = (value) => value.toString().padStart(2, "0");

const formatCountdown = (diffMs) => {
  if (diffMs <= 0) {
    return "00:00:00:00";
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${ZERO_PAD(days)}:${ZERO_PAD(hours)}:${ZERO_PAD(minutes)}:${ZERO_PAD(
    seconds,
  )}`;
};

const normalizeBucketValue = (value, dateISO, referenceDate) => {
  let bucket = value;
  if (!bucket) {
    bucket = dateISO
      ? deriveScheduleBucket(dateISO, referenceDate, DEFAULT_TIME_ZONE)
      : "today";
  }
  switch (bucket) {
    case "next-week":
    case "this-month":
    case "next-month":
    case "later":
      return "this-week";
    default:
      return bucket;
  }
};

const matchesTab = (item, tab, referenceDate) => {
  const bucket = normalizeBucketValue(
    item?.bucket ?? item?.when,
    item?.dateISO,
    referenceDate,
  );
  if (!bucket) return false;
  return bucket === tab;
};

const ScheduleSection = ({ transmissions = [] }) => {
  const [activeTab, setActiveTab] = useState("today");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const preparedItems = useMemo(() => {
    return (Array.isArray(transmissions) ? transmissions : []).map((item) => {
      const date = item?.dateISO ? new Date(item.dateISO) : null;
      const bucket = normalizeBucketValue(
        item?.bucket ?? item?.when,
        item?.dateISO,
        now,
      );
      return { ...item, date, bucket };
    });
  }, [transmissions, now]);

  const filteredItems = useMemo(() => {
    return preparedItems.filter((item) => matchesTab(item, activeTab, now));
  }, [preparedItems, activeTab, now]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.getTime() - b.date.getTime();
    });
  }, [filteredItems]);

  const headerLabel = useMemo(() => {
    if (activeTab === "today") {
      return getDefaultTabLabel(activeTab, now);
    }

    const firstWithDate = sortedItems.find((item) => item.date);
    if (firstWithDate?.date) {
      return formatDateOnlyLabel(firstWithDate.date);
    }
    return getDefaultTabLabel(activeTab, now);
  }, [sortedItems, activeTab, now]);

  const futureTargets = useMemo(() => {
    return sortedItems
      .filter((item) => item.date && item.date.getTime() > now.getTime())
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [sortedItems, now]);

  const countdownItem = futureTargets[0] || null;
  const countdownValue =
    countdownItem
      ? formatCountdown(countdownItem.date.getTime() - now.getTime())
      : null;

  return (
    <section id="schedule" className="schedule-section">
      <header className="schedule-header">
        <p className="schedule-date">{headerLabel}</p>
      </header>

      <div className="schedule-tabs">
        {TAB_OPTIONS.map((tab) => {
          const isActive = tab.value === activeTab;
          return (
            <button
              key={tab.value}
              type="button"
              className={`schedule-tab${isActive ? " is-active" : ""}`}
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {countdownValue ? (
        <div className="schedule-countdown" role="status">
          <span className="countdown-label">Next stream starts in:</span>
          <span className="countdown-value">{countdownValue}</span>
        </div>
      ) : (
        <div className="schedule-countdown is-empty" role="status">
          <span>
            {sortedItems.length
              ? "Streams scheduled for this tab"
              : "No streams for this tab"}
          </span>
        </div>
      )}

      {sortedItems.length ? (
        <div className="schedule-grid">
          {sortedItems.map((item) => {
            const timeLabel = formatTime(item.dateISO);
            const isLiveNow = Boolean(item?.hasStream && item?.status === "live");
            const tagLabel = isLiveNow ? "Live" : "No live yet";
            const tagClass = isLiveNow
              ? "schedule-tag schedule-tag--live"
              : "schedule-tag";
            const content = (
              <>
                <span className="schedule-time">{timeLabel}</span>
                <span className="schedule-title">
                  {item.title}
                  <span className={tagClass}>{tagLabel}</span>
                </span>
              </>
            );

            if (item.hasStream) {
              return (
                <Link
                  key={item.id}
                  to={`/stream/${item.id}`}
                  className="schedule-row"
                  aria-label={`Watch ${item.title} at ${timeLabel}`}
                >
                  {content}
                </Link>
              );
            }

            if (item.link) {
              return (
                <a
                  key={item.id}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="schedule-row schedule-row--link"
                  aria-label={`Open ${item.title} at ${timeLabel}`}
                >
                  {content}
                </a>
              );
            }

            return (
              <div
                key={item.id}
                className="schedule-row schedule-row--readonly"
                aria-label={`${item.title} at ${timeLabel} (info only)`}
              >
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="schedule-empty">No streams in this schedule.</div>
      )}
    </section>
  );
};

export default ScheduleSection;
