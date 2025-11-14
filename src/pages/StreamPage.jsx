import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import LiveList from "../components/LiveList.jsx";
import PlayerFrame from "../components/PlayerFrame";

const formatOddValue = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${value}`;
};

const formatStartTimeLabel = (isoString) => {
  if (!isoString) {
    return "Start time TBD";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "Start time TBD";
  }
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const StreamPage = ({ transmissions }) => {
  const { id } = useParams();

  const transmission = useMemo(
    () => transmissions.find((item) => item.id === id),
    [transmissions, id],
  );

  const teams = useMemo(() => {
    if (!transmission?.title || !transmission.title.includes(" vs ")) {
      return [null, null];
    }
    return transmission.title.split(" vs ").map((value) => value.trim());
  }, [transmission]);

  const [homeTeam, awayTeam] = teams;

  const pageTitle = transmission
    ? homeTeam && awayTeam
      ? `${homeTeam} vs ${awayTeam} \u2013 live stream`
      : `${transmission.title} \u2013 live stream`
    : "Stream not found";

  const pageDescription = transmission
    ? transmission.description ||
      `Watch ${transmission.title} online with live odds and commentary.`
    : "Stream unavailable.";

  useEffect(() => {
    if (!transmission) {
      return;
    }

    document.title = pageTitle;

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", pageDescription);
    }
  }, [transmission, pageTitle, pageDescription]);

  const todaysStreams = useMemo(() => {
    if (!transmission) return [];

    return transmissions
      .filter(
        (item) =>
          item.when === "today" &&
          item.status === "live" &&
          item.id !== transmission.id,
      )
      .sort((a, b) => {
        if (!a.dateISO || !b.dateISO) return 0;
        return new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime();
      });
  }, [transmissions, transmission]);

  const odds = transmission?.odds ?? {};
  const sportLabel = (transmission?.sport || "LIVE").toUpperCase();
  const startTimeLabel = formatStartTimeLabel(transmission?.dateISO);
  const streamStatusLabel = transmission?.status === "live" ? "Live" : "Upcoming";
  const streamStatusClass = `status-pill${
    transmission?.status === "live" ? " live" : ""
  }`;
  const oddsItems = [
    { key: "w1", label: "W1", value: odds?.w1 },
    { key: "x", label: "X", value: odds?.x },
    { key: "w2", label: "W2", value: odds?.w2 },
  ];

  const hasOdds = oddsItems.some(
    (item) => typeof item.value === "number" && !Number.isNaN(item.value),
  );

  if (!transmission) {
    return (
      <div className="stream-page">
        <div className="container">
          <h1>Stream not found</h1>
          <p>The stream you are looking for does not exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stream-page">
      <div className="container">
        <div className="stream-header">
          <div className="stream-heading">
            <p className="stream-kicker">Live stream</p>
            <h1 className="stream-title">{transmission.title}</h1>
          </div>
          <div className="stream-meta">
            <span className={streamStatusClass}>{streamStatusLabel}</span>
            <span className="stream-meta-time">{startTimeLabel}</span>
            <span className="stream-meta-sport">{sportLabel}</span>
          </div>
        </div>

        <div className="stream-player">
          {transmission.videoId || transmission.sgi ? (
            <PlayerFrame
              videoId={transmission.videoId ?? undefined}
              sgi={transmission.sgi ?? undefined}
              className="stream-player-frame"
            />
          ) : transmission.frame ? (
            <iframe
              src={transmission.frame}
              title={pageTitle}
              allow="autoplay; fullscreen"
              loading="lazy"
            />
          ) : (
            <div className="player-placeholder">
              <p>Stream placeholder</p>
              <span>Embed from helabet will appear here.</span>
              {transmission.link ? (
                <a
                  className="btn btn-yellow"
                  href={transmission.link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open official stream
                </a>
              ) : null}
            </div>
          )}
        </div>

        <section className="stream-odds-panel">
          <h3>Match odds</h3>
          {hasOdds ? (
            <div className="odds-line">
              {oddsItems
                .filter(
                  (item) =>
                    item.key !== "x" ||
                    (typeof item.value === "number" &&
                      !Number.isNaN(item.value)),
                )
                .map((item) => (
                  <div key={item.key} className="odds-chip">
                    <span className="odds-label">{item.label}</span>
                    <span className="odds-value">
                      {formatOddValue(item.value)}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="odds-empty">
              Odds will appear here once available.
            </div>
          )}
        </section>

        {todaysStreams.length > 0 && (
          <section className="live-section">
            <div className="section-header">
              <h2>Today&apos;s streams</h2>
              <p className="section-subtext">
                Pick another event happening today.
              </p>
            </div>
            <LiveList items={todaysStreams} />
          </section>
        )}

        <div className="stream-description">
          <p>
            {transmission.description ||
              "Stay tuned for live updates throughout the stream."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default StreamPage;
