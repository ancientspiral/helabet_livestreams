import { Link } from "react-router-dom";
import LiveList from "../components/LiveList.jsx";

const NotFound = ({ streams = [] }) => {
  const suggestions = streams
    .filter((item) => item.status === "live")
    .slice(0, 2);

  return (
    <div className="not-found">
      <div className="container">
        <div className="not-found-card">
          <span className="not-found-kicker">404 · Signal lost</span>
          <h1>We couldn&apos;t find that stream</h1>
          <p>
            The pitchside cameras are rolling, but this page has taken an
            unexpected half-time break. Double-check the URL or jump back into
            the action below.
          </p>
          <div className="not-found-actions">
            <Link to="/" className="btn btn-yellow">
              Back to live centre
            </Link>
            <Link to="/admin" className="btn btn-outline">
              Open admin panel
            </Link>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="not-found-suggestions">
            <h2>Maybe you meant one of these?</h2>
            <LiveList items={suggestions} />
          </div>
        )}
      </div>
    </div>
  );
};
export default NotFound;
