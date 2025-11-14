import express from "express";
import {
  fetchMatchesWithVideo,
  fetchLiveMatches,
  loadLeagues,
  searchLineMatches,
  searchLiveMatches,
} from "../lib/helabet.js";
import rateLimit from "express-rate-limit";
import { makeResolveHandler } from "../../src/routes/resolve.js";
import { HelabetSession } from "../../src/helabetSession.js";

const router = express.Router();

const resolveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "rate_limited" },
  skip: (req) => {
    const videoId = (req.body as { videoId?: unknown })?.videoId;
    return typeof videoId === "string" && videoId.startsWith("demo-");
  },
});
const legacyResolveSession = new HelabetSession();
const resolveHandler = makeResolveHandler(legacyResolveSession);

// streams.ts (или прямо в компоненте)
type HelabetGame = {
  I: number;         // матч ID
  L: string;         // лига (EN)
  LE?: string;       // лига (EN, альтернативное поле)
  LR?: string;       // лига (RU)
  O1?: string; O2?: string; // имена команд (локализованные)
  O1E?: string; O2E?: string; // имена команд EN
  E?: Array<any>;    // исходы/коэффы
  S?: number;        // unix secs
};

export async function fetchTopGames(): Promise<HelabetGame[]> {
  const res = await fetch("/api/live/top-games");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // тут ВАЖНО: используем именно Value
  return Array.isArray(data?.Value) ? (data.Value as HelabetGame[]) : [];
}

router.get("/leagues", async (req, res, next) => {
  try {
    const leagues = await loadLeagues(req.headers.cookie);
    res.json({ leagues });
  } catch (error) {
    next(error);
  }
});

router.get("/league/:li/matches", async (req, res) => {
  const leagueId = Number.parseInt(req.params.li, 10);
  if (Number.isNaN(leagueId)) {
    res.status(400).json({ matches: [], warning: "invalid_league" });
    return;
  }

  const cookies = req.headers.cookie;
  const { matches, warning } = await fetchMatchesWithVideo(leagueId, cookies);
  res.json({ matches, warning });
});

router.get("/search/live", async (req, res, next) => {
  try {
    const text = String(req.query.q ?? "").trim();
    if (!text) {
      res.json({ results: [] });
      return;
    }
    const cookies = req.headers.cookie;
    const payload = (await searchLiveMatches(text, cookies)) as
      | { Value?: unknown[] }
      | null;
    res.json({ results: payload?.Value ?? [] });
  } catch (error) {
    next(error);
  }
});

router.get("/search/line", async (req, res, next) => {
  try {
    const text = String(req.query.q ?? "").trim();
    if (!text) {
      res.json({ results: [] });
      return;
    }
    const cookies = req.headers.cookie;
    const payload = (await searchLineMatches(text, cookies)) as
      | { Value?: unknown[] }
      | null;
    res.json({ results: payload?.Value ?? [] });
  } catch (error) {
    next(error);
  }
});

router.get("/live/matches", async (req, res, next) => {
  try {
    const cookies = req.headers.cookie;
    const result = await fetchLiveMatches(cookies);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/resolve", resolveLimiter, resolveHandler);

export default router;

