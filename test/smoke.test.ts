import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Response } from "undici";
import { HelabetSession } from "../src/helabetSession.js";
import { makeHelabetProxy } from "../src/routes/proxy.js";
import { healthHandler } from "../src/routes/health.js";

describe("helabet proxy smoke", () => {
  let app: express.Express;
  let session: HelabetSession;

  beforeEach(() => {
    app = express();
    session = new HelabetSession();
    const proxy = makeHelabetProxy(session);
    app.get("/api/health", healthHandler);
    app.get("/api/hlb/*", proxy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok for health endpoint", async () => {
    const result = await request(app).get("/api/health").expect(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        ok: true,
        ts: expect.any(String),
      }),
    );
  });

  it("passes through JSON responses from helabet", async () => {
    const payload = { hello: "world" };
    const spy = vi.spyOn(session, "helabetRequest").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await request(app)
      .get("/api/hlb/service-api/mock")
      .expect(200);

    expect(result.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith(
      "/service-api/mock",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
