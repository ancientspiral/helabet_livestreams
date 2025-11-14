import express from "express";
import {
  HelabetProxyError,
  apiGetChampZip,
  apiGetChampsZip,
  apiGetCinemaUrl,
} from "../lib/helabet.js";

const router = express.Router();

const parseNumericQuery = (value: unknown): number | null => {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const parseBooleanQuery = (value: unknown): boolean =>
  value === "1" || value === "true";

const respondWithError = (
  res: express.Response,
  status: number,
  error: string,
): void => {
  res.status(status).json({ error });
};

const handleError = (
  error: unknown,
  res: express.Response,
  fallback: string,
): void => {
  if (error instanceof HelabetProxyError) {
    respondWithError(res, error.status, error.message);
    return;
  }

  const statusCandidate =
    typeof (error as { status?: unknown })?.status === "number"
      ? Number((error as { status: number }).status)
      : null;

  const message =
    error instanceof Error && error.message ? error.message : fallback;

  respondWithError(
    res,
    statusCandidate && statusCandidate >= 400 ? statusCandidate : 502,
    message,
  );
};

router.get("/champs", async (req, res) => {
  const sport = parseNumericQuery(req.query.sport);
  if (sport === null) {
    respondWithError(res, 400, "invalid_sport");
    return;
  }

  const virtual = parseBooleanQuery(req.query.virtual);

  try {
    const payload = await apiGetChampsZip(sport, virtual);
    res.json(payload);
  } catch (error) {
    handleError(error, res, "champs_fetch_failed");
  }
});

router.get("/champ", async (req, res) => {
  const champ = parseNumericQuery(req.query.champ);
  if (champ === null) {
    respondWithError(res, 400, "invalid_champ");
    return;
  }

  try {
    const payload = await apiGetChampZip(champ);
    res.json(payload);
  } catch (error) {
    handleError(error, res, "champ_fetch_failed");
  }
});

router.get("/stream", async (req, res) => {
  const videoId = typeof req.query.videoId === "string" ? req.query.videoId : "";
  if (!videoId) {
    respondWithError(res, 400, "invalid_video_id");
    return;
  }

  try {
    const payload = await apiGetCinemaUrl(videoId);
    res.json(payload);
  } catch (error) {
    handleError(error, res, "stream_fetch_failed");
  }
});

export default router;
