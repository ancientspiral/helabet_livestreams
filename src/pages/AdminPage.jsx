import { useMemo, useState } from "react";
import { formatDatetimeLocal } from "../utils/streams.js";

const SPORT_OPTIONS = [
  "volleyball",
  "football",
  "basketball",
  "tennis",
  "cricket",
  "esports",
  "ice-hockey",
  "esports",
  "rugby",
  "baseball",
  "table-tennis",
];

const INITIAL_FORM_STATE = {
  title: "",
  frame: "",
  sport: SPORT_OPTIONS[0],
  dateISO: "",
  w1Odds: "",
  xOdds: "",
  w2Odds: "",
  description: "",
};

const formatDisplayDate = (isoString) => {
  if (!isoString) return "--";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatActionLabel = (action) => {
  switch (action) {
    case "created":
      return "created";
    case "updated":
      return "updated";
    case "deleted":
      return "removed";
    default:
      return action;
  }
};

const formatLogTimestamp = (isoString) => {
  if (!isoString) return "Just now";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
  });
};

const AdminPage = ({
  streams,
  onCreateStream,
  onUpdateStream,
  onDeleteStream,
  isAuthenticated,
  onLogin,
  onLogout,
  activeAdmin,
  logs = [],
}) => {
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [editingId, setEditingId] = useState(null);
  const [errors, setErrors] = useState({});
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sportFilter, setSportFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");

  const sortedStreams = useMemo(() => {
    return [...streams].sort((a, b) => {
      const aDate = a?.dateISO ? new Date(a.dateISO).getTime() : 0;
      const bDate = b?.dateISO ? new Date(b.dateISO).getTime() : 0;
      return bDate - aDate;
    });
  }, [streams]);

  const activityFeed = useMemo(() => logs, [logs]);

  const availableSports = useMemo(() => {
    const unique = new Set(
      streams
        .map((stream) => (stream?.sport || "").toLowerCase())
        .filter((value) => Boolean(value)),
    );
    return Array.from(unique);
  }, [streams]);

  const summaryStats = useMemo(() => {
    const liveNow = streams.filter((stream) => (stream.status || "live") === "live")
      .length;
    const manualCount = streams.filter(
      (stream) => (stream.origin || "").toLowerCase() === "custom",
    ).length;
    const upcomingCount = streams.filter(
      (stream) => (stream.status || "upcoming") === "upcoming",
    ).length;
    return {
      total: streams.length,
      liveNow,
      manualCount,
      upcomingCount,
    };
  }, [streams]);

  const filteredStreams = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return sortedStreams.filter((stream) => {
      const normalizedStatus = (stream.status || "live").toLowerCase();
      const normalizedSport = (stream.sport || "").toLowerCase();
      const normalizedOrigin = (stream.origin || "").toLowerCase();
      const matchesQuery = normalizedQuery
        ? stream.title?.toLowerCase().includes(normalizedQuery)
        : true;
      const matchesStatus =
        statusFilter === "all" ? true : normalizedStatus === statusFilter;
      const matchesSport =
        sportFilter === "all" ? true : normalizedSport === sportFilter;
      const matchesOrigin =
        originFilter === "manual"
          ? normalizedOrigin === "custom"
          : true;
      return matchesQuery && matchesStatus && matchesSport && matchesOrigin;
    });
  }, [sortedStreams, searchQuery, sportFilter, statusFilter, originFilter]);

  const statusOptions = ["all", "live", "upcoming", "finished"];

  const handleFilterReset = () => {
    setStatusFilter("all");
    setSportFilter("all");
    setSearchQuery("");
    setOriginFilter("all");
  };

  const resetForm = () => {
    setFormState(INITIAL_FORM_STATE);
    setEditingId(null);
    setErrors({});
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    const username = loginUsername.trim();
    const password = loginPassword.trim();

    if (!username) {
      setLoginError("Login is required");
      return;
    }

    if (!password) {
      setLoginError("Password is required");
      return;
    }

    setLoginError("");
    setIsLoggingIn(true);
    try {
      const isValid = await onLogin(username, password);
      if (isValid) {
        resetForm();
        setLoginUsername("");
        setLoginPassword("");
        setLoginError("");
      } else {
        setLoginError("Incorrect credentials. Please try again.");
      }
    } catch {
      setLoginError("Login failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleEdit = (stream) => {
    if (stream.origin !== "custom") {
      return;
    }
    setEditingId(stream.id);
    setFormState({
      title: stream.title || "",
      frame: stream.frame || "",
      sport: stream.sport || SPORT_OPTIONS[0],
      dateISO: stream.dateISO ? formatDatetimeLocal(stream.dateISO) : "",
      w1Odds:
        typeof stream.odds?.w1 === "number" && !Number.isNaN(stream.odds.w1)
          ? stream.odds.w1.toString()
          : "",
      xOdds:
        typeof stream.odds?.x === "number" && !Number.isNaN(stream.odds.x)
          ? stream.odds.x.toString()
          : "",
      w2Odds:
        typeof stream.odds?.w2 === "number" && !Number.isNaN(stream.odds.w2)
          ? stream.odds.w2.toString()
          : "",
      description: stream.description || "",
    });
    setErrors({});
  };

  const handleDelete = (id) => {
    const target = streams.find((item) => item.id === id);
    if (!target || target.origin !== "custom") return;
    const confirmMessage = `Delete "${target.title}"? This action cannot be undone.`;
    if (window.confirm(confirmMessage)) {
      onDeleteStream(id);
      if (editingId === id) {
        resetForm();
      }
    }
  };

  const parseOdds = (value, meta, nextErrors) => {
    const { fieldName, fieldLabel, required } = meta;
    if (value === "" || value === null || value === undefined) {
      if (required) {
        nextErrors[fieldName] = `${fieldLabel} is required`;
      }
      return null;
    }
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      nextErrors[fieldName] = `${fieldLabel} must be a number`;
      return null;
    }
    return parsed;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    const trimmedTitle = formState.title.trim();
    const trimmedFrame = formState.frame.trim();
    const trimmedDescription = formState.description.trim();

    if (!trimmedTitle) {
      nextErrors.title = "Match title is required";
    }

    if (!trimmedFrame) {
      nextErrors.frame = "Stream URL is required";
    }

    let isoValue = null;
    if (!formState.dateISO) {
      nextErrors.dateISO = "Start date and time is required";
    } else {
      const parsedDate = new Date(formState.dateISO);
      if (Number.isNaN(parsedDate.getTime())) {
        nextErrors.dateISO = "Enter a valid date and time";
      } else {
        isoValue = parsedDate.toISOString();
      }
    }

    const w1 = parseOdds(
      formState.w1Odds,
      { fieldName: "w1Odds", fieldLabel: "W1", required: true },
      nextErrors,
    );
    const w2 = parseOdds(
      formState.w2Odds,
      { fieldName: "w2Odds", fieldLabel: "W2", required: true },
      nextErrors,
    );
    const x = parseOdds(
      formState.xOdds,
      { fieldName: "xOdds", fieldLabel: "X", required: false },
      nextErrors,
    );

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const odds = {
      w1,
      w2,
      ...(x !== null ? { x } : {}),
    };

    const payload = {
      title: trimmedTitle,
      frame: trimmedFrame,
      sport: formState.sport,
      status: "live",
      dateISO: isoValue,
      description: trimmedDescription,
      odds,
    };

    if (editingId) {
      onUpdateStream(editingId, payload);
    } else {
      onCreateStream(payload);
    }

    resetForm();
  };

  const handleLogout = () => {
    resetForm();
    setLoginUsername("");
    setLoginPassword("");
    setLoginError("");
    setIsLoggingIn(false);
    onLogout();
  };

  if (!isAuthenticated) {
    return (
      <div className="admin-page">
        <div className="container">
          <div className="admin-login">
            <h1>Admin access</h1>
            <p>Enter your credentials to manage live streams.</p>
            <form onSubmit={handleLoginSubmit} noValidate>
              <div className="admin-input">
                <label htmlFor="admin-login">Login</label>
                <input
                  id="admin-login"
                  type="text"
                  name="login"
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="admin-input">
                <label htmlFor="admin-password">Password</label>
                <input
                  id="admin-password"
                  type="password"
                  name="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {loginError && <span className="admin-error">{loginError}</span>}
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? "Signing in..." : "Log in"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const isEditing = Boolean(editingId);
  const activeLabel = activeAdmin || "admin";

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-meta-bar">
          <div className="admin-meta-left">
            <h1>Admin panel</h1>
            <span className="admin-identity">Logged in as {activeLabel}</span>
          </div>
          <div className="admin-meta-actions">
            <button
              type="button"
              className="btn btn-outline btn-compact"
              onClick={resetForm}
            >
              New stream
            </button>
            <button
              type="button"
              className="btn btn-danger btn-compact"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </div>

        <div className="admin-summary-grid">
          <div className="admin-stat-card">
            <span className="stat-label">Live now</span>
            <strong className="stat-value">{summaryStats.liveNow}</strong>
            <span className="stat-subtext">Streams broadcasting</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Manual streams</span>
            <strong className="stat-value">{summaryStats.manualCount}</strong>
            <span className="stat-subtext">Custom embeds</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Upcoming</span>
            <strong className="stat-value">{summaryStats.upcomingCount}</strong>
            <span className="stat-subtext">Scheduled next</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Total</span>
            <strong className="stat-value">{summaryStats.total}</strong>
            <span className="stat-subtext">Streams tracked</span>
          </div>
        </div>

        <div className="admin-filters">
          <div className="admin-search">
            <label htmlFor="admin-search">Search matches</label>
            <input
              id="admin-search"
              type="search"
              placeholder="Team name or keyword"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <div className="admin-filter-controls">
            <div className="admin-filter-select">
              <label htmlFor="admin-sport-filter">Sport</label>
              <select
                id="admin-sport-filter"
                value={sportFilter}
                onChange={(event) => setSportFilter(event.target.value)}
              >
                <option value="all">All sports</option>
                {availableSports.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-filter-select">
              <label htmlFor="admin-origin-filter">Source</label>
              <select
                id="admin-origin-filter"
                value={originFilter}
                onChange={(event) => setOriginFilter(event.target.value)}
              >
                <option value="all">All streams</option>
                <option value="manual">Manual only</option>
              </select>
            </div>
            <div className="admin-filter-pills" role="tablist" aria-label="Status filter">
              {statusOptions.map((option) => {
                const isActive = statusFilter === option;
                const label =
                  option === "all"
                    ? "All statuses"
                    : option.charAt(0).toUpperCase() + option.slice(1);
                return (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    className={`admin-filter-pill${isActive ? " is-active" : ""}`}
                    onClick={() => setStatusFilter(option)}
                  >
                    {label}
                  </button>
                );
              })}
              <button
                type="button"
                className="admin-filter-reset"
                onClick={handleFilterReset}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="admin-layout">
          <section className="admin-streams-card">
            <div className="admin-card-header">
              <h2>Streams</h2>
              <span className="admin-count">
                {filteredStreams.length} shown
                <span className="admin-count-total">
                  {" "}
                  / {sortedStreams.length} total
                </span>
              </span>
            </div>

            {filteredStreams.length ? (
              <div className="admin-table-wrapper is-scrollable">
                <table className="admin-streams-table">
                  <thead>
                    <tr>
                      <th scope="col">Match</th>
                      <th scope="col">Sport</th>
                      <th scope="col">Start</th>
                      <th scope="col">Source</th>
                      <th scope="col">Status</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStreams.map((stream) => {
                      const statusLabel = (
                        stream.status || "live"
                      ).toUpperCase();
                      const isReadOnly = stream.origin !== "custom";
                      const sourceLabel = isReadOnly ? "Feed" : "Manual";
                      return (
                        <tr key={stream.id}>
                          <td>{stream.title}</td>
                          <td>{stream.sport}</td>
                          <td>{formatDisplayDate(stream.dateISO)}</td>
                          <td>
                            <span
                              className={`admin-source ${
                                isReadOnly ? "is-feed" : "is-manual"
                              }`}
                            >
                              {sourceLabel}
                            </span>
                          </td>
                          <td>{statusLabel}</td>
                          <td>
                            <div className="admin-actions">
                              {!isReadOnly ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-compact"
                                    onClick={() => handleEdit(stream)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-compact"
                                    onClick={() => handleDelete(stream.id)}
                                  >
                                    Delete
                                  </button>
                                </>
                              ) : (
                                <span className="admin-tag">API feed</span>
                              )}
                              <a
                                className="btn btn-secondary btn-compact"
                                href={`/stream/${stream.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Preview
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="admin-empty">
                No streams match your filters. Adjust the search or create a new stream.
              </p>
            )}
          </section>

          <section className="admin-form-card">
            <h2>{isEditing ? "Edit stream" : "Create stream"}</h2>
            <p className="admin-note">
              {isEditing
                ? `Editing ${formState.title || "selected stream"}.`
                : "Fill in the details to publish a new live stream."}
            </p>
            <form
              onSubmit={handleSubmit}
              className="admin-form-grid"
              noValidate
            >
              <div className="admin-field">
                <label htmlFor="stream-title">Match title*</label>
                <input
                  id="stream-title"
                  name="title"
                  type="text"
                  value={formState.title}
                  onChange={handleInputChange}
                  placeholder="Team A vs Team B"
                  required
                />
                {errors.title && (
                  <span className="admin-field-error">{errors.title}</span>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="stream-frame">Stream URL*</label>
                <input
                  id="stream-frame"
                  name="frame"
                  type="text"
                  value={formState.frame}
                  onChange={handleInputChange}
                  placeholder="https://example.com/embed"
                  required
                />
                {errors.frame && (
                  <span className="admin-field-error">{errors.frame}</span>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="stream-sport">Sport</label>
                <select
                  id="stream-sport"
                  name="sport"
                  value={formState.sport}
                  onChange={handleInputChange}
                >
                  {SPORT_OPTIONS.map((sport) => (
                    <option key={sport} value={sport}>
                      {sport}
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-field">
                <label htmlFor="stream-date">Start date &amp; time*</label>
                <input
                  id="stream-date"
                  name="dateISO"
                  type="datetime-local"
                  value={formState.dateISO}
                  onChange={handleInputChange}
                  required
                />
                {errors.dateISO && (
                  <span className="admin-field-error">{errors.dateISO}</span>
                )}
              </div>

              <div className="admin-field">
                <label>Odds</label>
                <div className="admin-odds-grid">
                  <input
                    name="w1Odds"
                    type="text"
                    inputMode="decimal"
                    placeholder="W1"
                    value={formState.w1Odds}
                    onChange={handleInputChange}
                    required
                  />
                  <input
                    name="xOdds"
                    type="text"
                    inputMode="decimal"
                    placeholder="X (optional)"
                    value={formState.xOdds}
                    onChange={handleInputChange}
                  />
                  <input
                    name="w2Odds"
                    type="text"
                    inputMode="decimal"
                    placeholder="W2"
                    value={formState.w2Odds}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                {(errors.w1Odds || errors.xOdds || errors.w2Odds) && (
                  <span className="admin-field-error">
                    {errors.w1Odds || errors.xOdds || errors.w2Odds}
                  </span>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="stream-description">Description</label>
                <textarea
                  id="stream-description"
                  name="description"
                  value={formState.description}
                  onChange={handleInputChange}
                  placeholder="Short summary shown on the stream page."
                />
              </div>

              <div className="admin-form-actions">
                <button type="submit" className="btn btn-yellow">
                  {isEditing ? "Save changes" : "Create stream"}
                </button>
                <button
                  type="button"
                  className="btn btn-neutral"
                  onClick={resetForm}
                >
                  {isEditing ? "Cancel editing" : "Clear"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="admin-log-card">
          <div className="admin-card-header">
            <h2>Activity log</h2>
          </div>
          {activityFeed.length ? (
            <ul className="admin-log-list">
              {activityFeed.map((entry) => {
                const actionLabel = formatActionLabel(entry.action);
                const changes = entry.details?.changes ?? [];
                return (
                  <li key={entry.id} className="admin-log-item">
                    <span className="admin-log-time">
                      {formatLogTimestamp(entry.timestamp)}
                    </span>
                    <div className="admin-log-body">
                      <p className="admin-log-text">
                        <span className="admin-log-user">{entry.user}</span>{" "}
                        {actionLabel}{" "}
                        <span className="admin-log-title">{entry.title}</span>
                      </p>
                      <div className="admin-log-meta">
                        <span>ID: {entry.streamId || "—"}</span>
                        {changes?.length ? (
                          <span>Changes: {changes.join(", ")}</span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="admin-empty">No recent changes recorded.</p>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminPage;
