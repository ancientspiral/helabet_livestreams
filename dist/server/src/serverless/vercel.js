import express from "express";
import rateLimit from "express-rate-limit";
import { HelabetSession } from "../helabetSession.js";
import { makeHelabetProxy } from "../routes/proxy.js";
import { healthHandler } from "../routes/health.js";
import { makeResolveHandler } from "../routes/resolve.js";
import { hlsProxyHandler } from "../routes/hlsProxy.js";
import { playerPageHandler } from "../routes/playerPage.js";
import { LiveAggregator } from "../lib/liveAggregator.js";
import { MarketingAuth } from "../lib/marketingAuth.js";
import { MarketingClient } from "../lib/marketingClient.js";
import { loadMarketingEnvConfig } from "../lib/marketingConfig.js";
const app = express();
app.set("trust proxy", 1);
const session = new HelabetSession({
    ua: process.env.HELABET_UA,
    appN: process.env.HELABET_APP_N,
});
const marketingEnv = loadMarketingEnvConfig(process.env);
const marketingAuth = new MarketingAuth({
    authUrl: marketingEnv.authUrl,
    clientId: marketingEnv.clientId,
    clientSecret: marketingEnv.clientSecret,
});
const marketingClient = new MarketingClient({
    baseUrl: marketingEnv.baseUrl,
    ref: marketingEnv.ref,
    language: marketingEnv.language,
    groupId: marketingEnv.groupId,
    countryId: marketingEnv.countryId,
    partnerLink: marketingEnv.partnerLink,
    periods: marketingEnv.periods,
    types: marketingEnv.types,
    vids: marketingEnv.vids,
    cacheTtlMs: marketingEnv.cacheTtlMs,
    oddsIds: marketingEnv.oddsIds,
    oddsScheme: marketingEnv.oddsScheme,
}, marketingAuth);
const aggregator = new LiveAggregator(marketingClient, {
    maxBatchSize: marketingEnv.maxBatchSize,
    videoOnly: marketingEnv.videoOnly,
    upcomingWindowMs: marketingEnv.upcomingWindowMs,
    liveLookbackMs: marketingEnv.liveLookbackMs,
    prematchLookaheadMs: marketingEnv.prematchLookaheadMs,
}, session);
void session
    .warmUp()
    .catch((error) => console.warn("[helabet] initial warm-up failed", error?.message ?? String(error)));
const proxyHandler = makeHelabetProxy(session);
const corsOrigin = process.env.CORS_ORIGIN;
const resolveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
    message: { message: "rate_limited" },
    skip: (req) => {
        const videoId = req.body?.videoId;
        return typeof videoId === "string" && videoId.startsWith("demo-");
    },
});
app.use((req, res, next) => {
    if (corsOrigin) {
        res.setHeader("Access-Control-Allow-Origin", corsOrigin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
});
app.use(express.json());
const shouldIncludeAll = (value) => {
    if (typeof value === "string") {
        return value === "1" || value.toLowerCase() === "true";
    }
    if (Array.isArray(value)) {
        return shouldIncludeAll(value[0]);
    }
    return false;
};
app.get("/api/live/matches", async (req, res, next) => {
    try {
        const includeAll = shouldIncludeAll(req.query.all);
        const payload = await aggregator.getMatches({ includeAll });
        res.json(payload);
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/live/all", async (_req, res, next) => {
    try {
        const payload = await aggregator.getMatches({ includeAll: true });
        res.json(payload);
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/marketing/debug", async (req, res, next) => {
    try {
        const forceRefresh = req.query.refresh === "1" || req.query.force === "1" || req.query.force === "true";
        const snapshot = await aggregator.getDebugSnapshot(forceRefresh);
        res.json(snapshot);
    }
    catch (error) {
        next(error);
    }
});
// Lightweight aliases to reuse the proxy session for common endpoints
app.get("/api/live/top-games", (_req, res) => {
    res.redirect(307, "/api/hlb/service-api/LiveFeed/GetTopGamesStatZip?lng=en&antisports=66&partner=237");
});
app.get("/api/live/sports", (_req, res) => {
    res.redirect(307, "/api/hlb/service-api/LiveFeed/GetSportsShortZip?lng=en&gr=766&country=147&partner=237&virtualSports=true&groupChamps=true");
});
app.get("/api/live/top-champs", (_req, res) => {
    res.redirect(307, "/api/hlb/service-api/LiveFeed/WebGetTopChampsZip?lng=en&country=147");
});
app.get("/api/live/champ/:id", (req, res) => {
    const champId = encodeURIComponent(req.params.id);
    const params = new URLSearchParams({
        champId,
        lng: "en",
        partner: "237",
        antisports: "66",
        country: "147",
    });
    const sport = Array.isArray(req.query.sport)
        ? req.query.sport[0]
        : req.query.sport;
    if (typeof sport === "string" && sport.trim()) {
        const trimmed = sport.trim();
        params.set("lid", trimmed);
        params.set("sport", trimmed);
    }
    res.redirect(307, `/api/hlb/service-api/LiveFeed/GetChampZip?${params.toString()}`);
});
app.get("/api/health", healthHandler);
app.get("/api/hlb", proxyHandler);
app.get("/api/hlb/*", proxyHandler);
app.get("/player", playerPageHandler);
app.get("/api/hls", hlsProxyHandler);
const resolveHandler = makeResolveHandler(session);
app.post("/api/resolve", resolveLimiter, resolveHandler);
app.use((error, _req, res, _next) => {
    console.error("[serverless]", error?.message ?? String(error));
    res.status(500).json({ error: "server_error" });
});
export default app;
