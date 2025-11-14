import { Link } from "react-router-dom";

const ScheduleList = ({ items, compact = false }) => {
  if (!items?.length) {
    return (
      <div className={`schedule-empty${compact ? " is-compact" : ""}`}>
        No streams in this schedule.
      </div>
    );
  }

  return (
    <ul className={`schedule-list${compact ? " is-compact" : ""}`}>
      {items.map((item) => {
        const isLive = item.status === "live";
        const sportLabel = item.sport.toUpperCase();
        const startTime = item.dateISO
          ? new Date(item.dateISO).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "--:--";

        return (
          <li key={item.id} className={`schedule-card${compact ? " compact" : ""}`}>
            <div className="schedule-card-main">
              <span className="sport-badge">{sportLabel}</span>
              <h3 className="schedule-card-title">{item.title}</h3>
              <div className="schedule-meta">
                <span>{startTime}</span>
                <span className={`status-pill${isLive ? " live" : ""}`}>
                  {isLive ? "LIVE" : "Upcoming"}
                </span>
              </div>
            </div>
            <Link to={`/stream/${item.id}`} className="btn btn-yellow">
              Watch
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

export default ScheduleList;
