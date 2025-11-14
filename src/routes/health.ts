import type { Request, Response } from "express";

export function healthHandler(_req: Request, res: Response): void {
  res.json({ ok: true, ts: new Date().toISOString() });
}
