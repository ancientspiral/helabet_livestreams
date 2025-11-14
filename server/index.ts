import "dotenv/config";
import type { Server } from "node:http";
import express from "express";
import cors from "cors";
import streamsRouter from "./routes/streams.js";
import helabetProxyRouter from "./routes/helabet-proxy.js";
import {
  apiGetTopGamesStatZip,
  apiGetSportsShortZip,
  apiGetTopChampsZip,
  apiGet1x2_VZip,
  apiGetChampZip,
  apiCinema,
} from "./helabetClient.js";
import { HelabetSession } from "./helabetSession.js";

const app = express();

const session = new HelabetSession({
  ua: process.env.HELABET_UA,
  appN: process.env.HELABET_APP_N,
});

const NO_BODY_STATUSES = new Set([204, 205, 304]);

const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  }),
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/live/top-games", async (_req, res) => {
  console.log("Mounted: GET /api/live/top-games");
  try {
    res.json(await apiGetTopGamesStatZip());
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    res.status(502).json({ error: message });
  }
});

app.get("/api/live/sports", async (_req, res) => {
  try {
    res.json(await apiGetSportsShortZip());
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    res.status(502).json({ error: message });
  }
});

app.get("/api/live/top-champs", async (_req, res) => {
  try {
    res.json(await apiGetTopChampsZip());
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    res.status(502).json({ error: message });
  }
});

app.get("/api/live/one-x-two", async (_req, res) => {
  try {
    res.json(await apiGet1x2_VZip());
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    res.status(502).json({ error: message });
  }
});

app.get("/api/live/champ/:id", async (req, res) => {
  try {
    res.json(await apiGetChampZip(req.params.id));
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    res.status(502).json({ error: message });
  }
});

app.get("/api/live/cinema/:vid", async (req, res) => {
  try {
    res.json(await apiCinema(req.params.vid));
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    res.status(502).json({ error: message });
  }
});

app.get("/api/hlb/*", async (req, res) => {
  const pathWithQuery = req.originalUrl.replace(/^\/api\/hlb/, "") || "/";
  const normalizedPath = pathWithQuery.startsWith("/")
    ? pathWithQuery
    : `/${pathWithQuery}`;
  const upstreamUrl = `https://helabet.com${normalizedPath}`;
  let finalStatus = 500;

  try {
    const upstreamResponse = await session.helabetGet(pathWithQuery);
    finalStatus = upstreamResponse.status;

    if (!upstreamResponse.ok) {
      const rawBody = await upstreamResponse.text();
      res.status(finalStatus).json({
        error: true,
        status: finalStatus,
        body: rawBody.slice(0, 500),
      });
      return;
    }

    if (NO_BODY_STATUSES.has(finalStatus)) {
      res.status(finalStatus).end();
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    const lowered = contentType.toLowerCase();
    const rawBody = await upstreamResponse.text();

    if (lowered.includes("json")) {
      try {
        const parsed = rawBody ? JSON.parse(rawBody) : null;
        res.status(finalStatus).json(parsed);
      } catch {
        res.status(finalStatus).type(contentType || "application/json").send(rawBody);
      }
      return;
    }

    res.status(finalStatus).type(contentType || "text/plain").send(rawBody);
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    finalStatus = 500;
    res.status(500).json({ error: true, message });
  } finally {
    console.log(`[helabet proxy] ${req.method} ${upstreamUrl} -> ${finalStatus}`);
  }
});

app.use("/api", streamsRouter);
app.use("/api/helabet", helabetProxyRouter);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Server error", (error as Error)?.message);
    res.status(500).json({ error: "server_error" });
  },
);

function printRoutes(app: any) {
  const routes: string[] = [];
  // @ts-ignore
  app._router?.stack?.forEach((m: any) => {
    if (m.route && m.route.path) {
      routes.push(`${Object.keys(m.route.methods).join(",").toUpperCase()} ${m.route.path}`);
    } else if (m.name === 'router' && m.handle?.stack) {
      m.handle.stack.forEach((h: any) => {
        if (h.route) {
          routes.push(`${Object.keys(h.route.methods).join(",").toUpperCase()} ${m.regexp?.source || ''}${h.route.path}`);
        }
      });
    }
  });
  console.log("[routes]", routes);
}
printRoutes(app);

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

declare global {
  // eslint-disable-next-line no-var
  var __helabetServer: Server | undefined;
}

if (process.env.NODE_ENV !== "test") {
  const runningServer = globalThis.__helabetServer;
  if (runningServer) {
    runningServer.close();
  }

  const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  void (async () => {
    try {
      await session.warmUp();
      console.log("[helabet session] Warmup completed");
    } catch (error) {
      console.warn(
        "[helabet session] Warmup failed",
        (error as Error)?.message ?? String(error),
      );
    }
  })();

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Set PORT to a free port or stop the other process.`,
      );
      return;
    }
    console.error("Server failed to start", error);
  });

  globalThis.__helabetServer = server;
}

export default app;

/*
README: Helabet Session Warmup
- 406 responses come from helabet.com's anti-bot layer when headers or cookies look like a fresh browser; a bare GET often sees 406 while HEAD 200 succeeds.
- A server-managed warmup fetch primes cookies once and reuses them, so subsequent API calls look like the same vetted session.
- We intentionally avoid sending any sec-* or if-modified-since headers; keeping the request headers minimal helps match helabet's expectations.
- Minimal client example:
  ```ts
  export async function fetchTopGames() {
    const res = await fetch('/api/hlb/service-api/LiveFeed/GetTopGamesStatZip?lng=en&antisports=66&partner=237');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  ```
*/
