import { Link } from "react-router-dom";
import { FiPlay } from "react-icons/fi";
import { DEFAULT_TIME_ZONE } from "../utils/streams.js";

const formatDateLabel = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    timeZone: DEFAULT_TIME_ZONE,
  });
};

const formatOddValue = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(2);
};

const splitTeams = (title) => {
  if (!title || typeof title !== "string" || !title.includes(" vs ")) {
    return [title, ""];
  }
  return title.split(" vs ").map((value) => value.trim());
};

const LiveList = ({ items }) => {
  if (!items?.length) {
    return <div className="live-empty">No streams match this filter.</div>;
  }

  return (
    <div className="live-grid">
      {items.map((item) => {
        const sportLabel = (item.sport || "live").toUpperCase();
        const isLive = item.status === "live";
        const statusClassName = `status-pill${isLive ? " live" : ""}`;
        const statusLabel = isLive ? "Live" : "Upcoming";
        const [homeTeam, awayTeam] = splitTeams(item.title);
        const hasTeams = Boolean(homeTeam && awayTeam && item.title.includes(" vs "));
        const odds = item.odds || {};
        const startLabel = formatDateLabel(item.dateISO);
        const oddsItems = [
          { key: "w1", label: "W1", value: odds?.w1 },
          { key: "x", label: "X", value: odds?.x },
          { key: "w2", label: "W2", value: odds?.w2 },
        ];
        const hasOdds = oddsItems.some(
          (odd) => typeof odd.value === "number" && !Number.isNaN(odd.value),
        );

        const cardClassName = `live-card${isLive ? " is-live" : ""}`;

        return (
          <article key={item.id} className={cardClassName}>
            <div className="live-card-header">
              <span className={statusClassName}>{statusLabel}</span>
              <span className="live-sport-pill">{sportLabel}</span>
            </div>
            <div className="live-card-body">
              {hasTeams ? (
                <div className="live-scoreline">
                  <span className="live-team-name">{homeTeam}</span>
                  <span className="score-divider">vs</span>
                  <span className="live-team-name">{awayTeam}</span>
                </div>
              ) : (
                <h3 className="live-card-title">{item.title}</h3>
              )}
              <div className="live-card-meta">
                <span className="live-meta">
                  <FiPlay aria-hidden="true" />
                  {startLabel}
                </span>
              </div>
              {hasOdds ? (
                <div className="live-card-odds">
                  {oddsItems
                    .filter((odd) =>
                      odd.key === "x"
                        ? typeof odd.value === "number" && !Number.isNaN(odd.value)
                        : true,
                    )
                    .map((odd) => (
                      <div key={odd.key} className="odds-chip">
                        <span className="odds-label">{odd.label}</span>
                        <span className="odds-value">{formatOddValue(odd.value)}</span>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
            <div className="live-card-footer">
              <Link to={`/stream/${item.id}`} className="btn btn-yellow live-card-cta">
                WATCH
              </Link>
              {!item.hasStream ? (
                <span className="live-card-hint">Details inside</span>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default LiveList;
