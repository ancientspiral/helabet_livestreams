export function healthHandler(_req, res) {
    res.json({ ok: true, ts: new Date().toISOString() });
}
