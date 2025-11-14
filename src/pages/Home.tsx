import { useCallback, useMemo } from "react";
import LiveList from "../components/LiveList.jsx";
import ScheduleSection from "../components/ScheduleSection.jsx";

type TransmissionItem = {
  id: string;
  sport: string;
  title: string;
  status: string;
  when?: string;
  bucket?: string;
  dateISO?: string | null;
  videoId?: string | null;
  sgi?: string | null;
  frame?: string | null;
  startTimeMs?: number | null;
  hasStream?: boolean;
  link?: string | null;
  origin?: string | null;
  odds?: {
    w1?: number | null;
    x?: number | null;
    w2?: number | null;
  } | null;
};

interface HomeProps {
  liveTransmissions: TransmissionItem[];
  scheduleEvents: TransmissionItem[];
  searchQuery?: string;
}

const Home = ({
  liveTransmissions,
  scheduleEvents,
  searchQuery = "",
}: HomeProps) => {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const playableFilter = useCallback((items: TransmissionItem[] = []) => {
    return items.filter((item) => {
      if (!item || !item.hasStream) {
        return false;
      }
      const hasVideoId =
        typeof item.videoId === "string" && item.videoId.trim().length > 0;
      const hasSgi =
        typeof item.sgi === "string" && item.sgi.trim().length > 0;
      const hasFrame =
        typeof item.frame === "string" && item.frame.trim().length > 0;
      return hasVideoId || hasSgi || hasFrame;
    });
  }, []);

  const filterByQuery = useCallback(
    (items: TransmissionItem[] = []) => {
      if (!normalizedQuery) {
        return items;
      }
      return items.filter((item) => {
        const title = item.title?.toLowerCase() ?? "";
        const sport = item.sport?.toLowerCase() ?? "";
        return title.includes(normalizedQuery) || sport.includes(normalizedQuery);
      });
    },
    [normalizedQuery],
  );

  const filteredLive = useMemo(() => {
    const base = Array.isArray(liveTransmissions) ? liveTransmissions : [];
    const playable = playableFilter(base);
    return filterByQuery(playable);
  }, [filterByQuery, playableFilter, liveTransmissions]);

  const liveStreams = useMemo(() => {
    return [...filteredLive]
      .filter((item) => item.status === "live")
      .sort((a, b) => {
        const aTime =
          typeof a.startTimeMs === "number"
            ? a.startTimeMs
            : a.dateISO
              ? new Date(a.dateISO).getTime()
              : Number.POSITIVE_INFINITY;
        const bTime =
          typeof b.startTimeMs === "number"
            ? b.startTimeMs
            : b.dateISO
              ? new Date(b.dateISO).getTime()
              : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
  }, [filteredLive]);

  const scheduleItems = useMemo(() => {
    const base = Array.isArray(scheduleEvents) ? scheduleEvents : [];
    const playable = playableFilter(base);
    const matched = filterByQuery(playable);
    return matched.sort((a, b) => {
      const aTime =
        typeof a.startTimeMs === "number"
          ? a.startTimeMs
          : a.dateISO
            ? new Date(a.dateISO).getTime()
            : Number.POSITIVE_INFINITY;
      const bTime =
        typeof b.startTimeMs === "number"
          ? b.startTimeMs
          : b.dateISO
            ? new Date(b.dateISO).getTime()
            : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
  }, [filterByQuery, scheduleEvents]);

  const heroStats = useMemo(() => {
    const liveNow = filteredLive.filter((item) => item.status === "live").length;
    const upcoming = scheduleItems.length;
    const sportCount = new Set(
      filteredLive.map((item) => (item.sport || "").toLowerCase()).filter(Boolean),
    ).size;
    return {
      liveNow,
      sportCount,
      upcoming,
    };
  }, [filteredLive, scheduleItems]);
  const heroMetricList = [
    { label: "Live now", value: heroStats.liveNow },
    { label: "Sports today", value: heroStats.sportCount || 0 },
    { label: "Upcoming", value: heroStats.upcoming },
  ];

  return (
    <>
      <div className="home-page">
        <div className="container">
          <section className="hero hero-live">
            <div className="hero-content">
              <p className="hero-kicker">Live centre</p>
              <h1>Every match, every moment.</h1>
              <p className="hero-subtext">
                Instant access to verified Helabet streams, live odds, and curated
                schedules built for sports fans. Pick a match, lock in, and follow
                the action with zero scrolling.
              </p>
              <div className="hero-actions">
                <a className="btn btn-yellow hero-cta" href="#schedule">
                  View schedule
                </a>
              </div>
              <div className="hero-metrics">
                {heroMetricList.map((metric) => (
                  <div key={metric.label} className="hero-metric">
                    <span className="metric-value">{metric.value}</span>
                    <span className="metric-label">{metric.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <ScheduleSection transmissions={scheduleItems} />

          <section className="live-section">
            <div className="section-header">
              <h2>Live now</h2>
              <p className="section-subtext">
                Choose a stream to jump straight into the broadcast.
              </p>
            </div>
            <LiveList items={liveStreams} />
          </section>

          <section className="info-section">
            <div className="info-card">
              <h3>Built for quick embedding</h3>
              <p>
                Can embed an iframe from the main platform. Re-use this layout for
                promos, featured odds, and league specific hubs and blah blah blah
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default Home;
