import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "./components/Header.jsx";
import Home from "./pages/Home";
import StreamPage from "./pages/StreamPage.jsx";
import FooterArea from "./components/FooterArea.jsx";
import AdminPageWrapper from "./pages/AdminPageWrapper.jsx";
import NotFound from "./pages/NotFound.jsx";
import { TRANSMISSIONS } from "./data/transmissions.js";
import { deriveScheduleBucket, generateStreamId } from "./utils/streams.js";
// Live feed integration handled on Home via dedicated API routes.

const CUSTOM_STREAM_STORAGE_KEY = "helabet_streams";
const ADMIN_SESSION_KEY = "helabet_admin_session";
const ADMIN_SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour
const ADMIN_USER_HASH = import.meta.env.VITE_ADMIN_USER_HASH;
const ADMIN_PASS_HASH = import.meta.env.VITE_ADMIN_PASS_HASH;
const ADMIN_LOG_KEY = "helabet_admin_logs";

import { normalizeStream } from "./utils/api.js";

const loadInitialCustomStreams = () => {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(CUSTOM_STREAM_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const sanitized = parsed
            .map((item) =>
              normalizeStream(item, item?.origin || "custom"),
            )
            .filter(
              (stream) =>
                stream &&
                stream.origin !== "seed" &&
                stream.source !== "seed",
            );
          if (sanitized.length !== parsed.length) {
            window.localStorage.setItem(
              CUSTOM_STREAM_STORAGE_KEY,
              JSON.stringify(sanitized),
            );
          }
          if (sanitized.length) {
            return sanitized;
          }
        }
      } catch (error) {
        console.warn("Failed to parse stored streams", error);
      }
    }
  }
  return [...TRANSMISSIONS].map((item) =>
    normalizeStream({ ...item, origin: item.origin || "seed" }, "seed"),
  );
};

const loadInitialLogs = () => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(ADMIN_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadStoredSession = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to read admin session", error);
    return null;
  }
};

const hashValue = async (value) => {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return null;
  }

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
};

import { useLiveStreams } from "./hooks/useLiveStreams.js";

const AppRoutes = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("q") || "";
  });
  const [customStreams, setCustomStreams] = useState(() =>
    loadInitialCustomStreams(),
  );
  const { streams: apiStreams, allEvents } = useLiveStreams();
  const [adminSession, setAdminSession] = useState(() => loadStoredSession());
  const [activityLogs, setActivityLogs] = useState(() => loadInitialLogs());



  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const query = params.get("q") || "";
    setSearchQuery(query);
  }, [location.search]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ADMIN_LOG_KEY, JSON.stringify(activityLogs));
    }
  }, [activityLogs]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        CUSTOM_STREAM_STORAGE_KEY,
        JSON.stringify(customStreams),
      );
    }
  }, [customStreams]);

  useEffect(() => {
    if (!adminSession) {
      return undefined;
    }

    const remaining = adminSession.expiresAt - Date.now();
    if (remaining <= 0) {
      setAdminSession(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      }
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setAdminSession(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      }
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [adminSession]);

  const streams = useMemo(() => {
    const merged = new Map();
    (apiStreams ?? []).forEach((stream) => {
      if (stream?.id) {
        merged.set(stream.id, stream);
      }
    });
    customStreams.forEach((stream) => {
      if (stream?.id) {
        merged.set(stream.id, stream);
      }
    });
    return Array.from(merged.values());
  }, [apiStreams, customStreams]);

  const scheduleEvents = useMemo(() => {
    const merged = new Map();
    if (Array.isArray(allEvents)) {
      allEvents.forEach((event) => {
        if (event?.id) {
          merged.set(event.id, event);
        }
      });
    }
    customStreams.forEach((stream) => {
      if (!stream?.id || merged.has(stream.id)) {
        return;
      }
      merged.set(stream.id, {
        ...stream,
        bucket: stream.bucket ?? stream.when ?? "today",
        when: stream.bucket ?? stream.when ?? "today",
        hasStream:
          typeof stream.hasStream === "boolean"
            ? stream.hasStream
            : Boolean(stream.videoId || stream.sgi || stream.frame),
      });
    });
    return Array.from(merged.values());
  }, [allEvents, customStreams]);

  const logActivity = (action, stream, extra = {}) => {
    const entry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      streamId: stream?.id ?? null,
      title: stream?.title ?? "Untitled stream",
      user: (adminSession?.username || "admin").toUpperCase(),
      details: extra,
    };

    setActivityLogs((prev) => [entry, ...prev].slice(0, 200));
  };

  const handleSearchChange = (value = "", submit = false) => {
    const rawValue = value ?? "";
    const trimmedValue = rawValue.trim();
    const params = new URLSearchParams(location.search);

    if (trimmedValue) {
      params.set("q", trimmedValue);
    } else {
      params.delete("q");
    }

    setSearchQuery(submit ? trimmedValue : rawValue);

    const searchString = params.toString();
    const nextSearch = searchString ? `?${searchString}` : "";

    if (submit) {
      navigate({ pathname: "/", search: nextSearch });
    } else if (location.pathname === "/" && location.search !== nextSearch) {
      navigate({ pathname: "/", search: nextSearch });
    }
  };

  const handleCreateStream = (payload) => {
    const normalized = normalizeStream(
      {
        ...payload,
        id: payload.id ?? generateStreamId(),
        origin: "custom",
      },
      "custom",
    );
    setCustomStreams((prev) => [...prev, normalized]);
    logActivity("created", normalized);
  };

  const handleUpdateStream = (id, updates) => {
    let previousStream = null;
    let updatedStream = null;
    setCustomStreams((prev) =>
      prev.map((item) => {
        if (item.id !== id) {
          return item;
        }
        previousStream = item;
        const merged = normalizeStream(
          {
            ...item,
            ...updates,
            id: item.id,
            origin: item.origin || "custom",
          },
          item.origin || "custom",
        );
        updatedStream = merged;
        return merged;
      }),
    );
    if (updatedStream && previousStream) {
      const changes = [];
      if (previousStream.title !== updatedStream.title) changes.push("title");
      if (previousStream.frame !== updatedStream.frame)
        changes.push("stream URL");
      if (previousStream.sport !== updatedStream.sport) changes.push("sport");
      if (previousStream.dateISO !== updatedStream.dateISO)
        changes.push("start time");
      if (
        JSON.stringify(previousStream.odds) !==
        JSON.stringify(updatedStream.odds)
      )
        changes.push("odds");
      if (previousStream.description !== updatedStream.description)
        changes.push("description");

      logActivity("updated", updatedStream, { changes });
    }
  };

  const handleDeleteStream = (id) => {
    let removedStream = null;
    setCustomStreams((prev) =>
      prev.filter((item) => {
        if (item.id === id) {
          removedStream = item;
          return false;
        }
        return true;
      }),
    );
    if (removedStream) {
      logActivity("deleted", removedStream);
    }
  };

  const handleAdminLogin = async (username, password) => {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedPassword = password.trim();

    const [hashedUser, hashedPassword] = await Promise.all([
      hashValue(normalizedUsername),
      hashValue(normalizedPassword),
    ]);

    const isValid =
      hashedUser && hashedPassword
        ? hashedUser === ADMIN_USER_HASH && hashedPassword === ADMIN_PASS_HASH
        : false;
    if (isValid) {
      const session = {
        username: normalizedUsername,
        expiresAt: Date.now() + ADMIN_SESSION_DURATION_MS,
      };
      setAdminSession(session);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          ADMIN_SESSION_KEY,
          JSON.stringify(session),
        );
      }
    }
    return isValid;
  };

  const handleAdminLogout = () => {
    setAdminSession(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
    }
  };

  const isAdminAuthed = Boolean(adminSession);
  const activeAdminName = adminSession?.username ?? "";

  return (
    <div className="app-shell">
      <Header searchQuery={searchQuery} onSearchChange={handleSearchChange} />

      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <Home
                liveTransmissions={streams}
                scheduleEvents={scheduleEvents}
                searchQuery={searchQuery}
              />
            }
          />
          <Route
            path="/stream/:id"
            element={<StreamPage transmissions={streams} />}
          />
          <Route
            path="/admin"
            element={
              <AdminPageWrapper
                streams={streams}
                onCreateStream={handleCreateStream}
                onUpdateStream={handleUpdateStream}
                onDeleteStream={handleDeleteStream}
                isAuthenticated={isAdminAuthed}
                onLogin={handleAdminLogin}
                onLogout={handleAdminLogout}
                activeAdmin={activeAdminName}
                logs={activityLogs}
              />
            }
          />
          <Route path="*" element={<NotFound streams={streams} />} />
        </Routes>
      </main>

      <FooterArea />
    </div>
  );
};

const App = () => (
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>
);

export default App;
