## Helabet Proxy & Livestream Client

A production-ready Helabet proxy is bundled with the React client so browsers can call Helabet JSON APIs without hitting the 406 anti-bot filter. The proxy performs a server-side warm-up to capture cookies, keeps them in-memory, and reuses them for subsequent requests.

### Key Features
- `/api/hlb/*` endpoint forwards to `https://helabet.com/*` with a shared `HelabetSession` that maintains warm-up cookies for 10 minutes.
- Minimal upstream headers (UA, Accept, `x-app-n`, `x-requested-with`, Referer) avoid browser-only `sec-*` headers.
- Automatic retry on 401/403/406 after forcing a warm-up.
- `/api/health` responds with `{ ok: true }` for health checks.
- Works on Vercel (default) and as a standalone Express server. Both reuse the same session implementation.

### Environment Variables
Copy `.env.example` into `.env` (or set the variables in your hosting platform):

```
CORS_ORIGIN=https://your-landing-domain.com
HELABET_UA=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
HELABET_APP_N=__BETTING_APP__
PORT=3001
MARKETING_API_AUTH_URL=https://cpservm.com/gateway/token
MARKETING_API_BASE=https://cpservm.com/gateway/marketing
MARKETING_API_CLIENT_ID=<ask your manager>
MARKETING_API_CLIENT_SECRET=<ask your manager>
MARKETING_API_REF=1
MARKETING_API_GROUP=<ask your manager>
MARKETING_API_COUNTRY=<ask your manager>
MARKETING_API_LANG=en
MARKETING_API_PERIODS=0,1,2
MARKETING_API_TYPES=
MARKETING_API_VIDS=
MARKETING_API_MAX_SPORTS_PER_REQUEST=25
MARKETING_API_VIDEO_ONLY=false
```

`CORS_ORIGIN` controls which browser origin can access the proxy. `HELABET_UA` and `HELABET_APP_N` override the default warm-up headers when needed.  
`MARKETING_API_*` settings configure the Marketing DataFeed described in `Marketing API.html` — grab the OAuth client id/secret, partner ref (`MARKETING_API_REF`), group (`MARKETING_API_GROUP`), country (`MARKETING_API_COUNTRY`), and optional partner link from your manager. The proxy fetches and refreshes bearer tokens automatically via `MARKETING_API_AUTH_URL` (defaults to `https://cpservm.com/gateway/token`). Periods/types/vids mirror the curl examples in the docs and can be tuned without redeploying; leave `MARKETING_API_TYPES` / `MARKETING_API_VIDS` empty if you want the broadest feed.

### Local Development (Express)
1. `cp .env.example .env` and set `CORS_ORIGIN=http://localhost:5173` (or another dev origin).
2. Install dependencies with `npm install` (or `pnpm i`, `yarn`).
3. Start the proxy with `npm run dev:express`.
4. The React client can call `/api/hlb/...` directly (same origin) or via a dev server proxy.

The Express entrypoint (`src/express/server.ts`) calls `HelabetSession.warmUp()` on boot so the first Helabet request already has cookies.

### Vercel Deployment
1. Configure project environment variables `CORS_ORIGIN`, `HELABET_UA`, and `HELABET_APP_N` in the Vercel dashboard.
2. Deploy as usual. `api/index.ts` re-exports the serverless handler from `src/serverless/vercel.ts`.
3. Each cold start performs a non-blocking warm-up (HTML + JSON endpoints) and caches cookies for the life of the instance.

### API Surface
- `GET /api/health` → `{ ok: true }`
- `GET /api/hlb/*` → Proxy to `https://helabet.com/*`
  - Successful JSON/plain responses are returned transparently.
  - Upstream errors bubble back as `{ error: true, status, bodySnippet }`.

No `sec-*`, `if-modified-since`, or other browser-only headers are forwarded. The proxy always sends `Referer: https://helabet.com/en/live?platform_type=desktop` to stay consistent with Helabet expectations.

### Client Example
`src/client/fetchTopGames.ts` shows a minimal browser helper:

```ts
export async function fetchTopGames() {
  const res = await fetch('/api/hlb/service-api/LiveFeed/GetTopGamesStatZip?lng=en&antisports=66&partner=237');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

### Scripts

```bash
npm run dev:express   # start the express proxy locally
npm run server:dev    # same as above but with watch mode
npm run test          # run vitest (smoke + mapper tests)
npm run build         # type-check server & proxy code (tsc)
npm run client:dev    # Vite client (optional when working on the UI)
```

### Testing
`npm run test` executes Vitest. A smoke test validates `/api/health` and a mocked JSON passthrough, while legacy mapper tests ensure stream helpers continue working.

### Notes
- Warm-up hits both `en/live` (HTML) and `bff-api/config/video.json` (JSON) before serving traffic.
- Cookies are kept in-memory per runtime instance; Vercel cold starts trigger a new warm-up.
- If Helabet changes anti-bot rules and one warm-up step starts returning 404/5xx, the proxy still retries on 401/403/406 and re-attempts the warm-up automatically.

### Diagnostics
- Verify the raw proxy by curling Helabet directly through Express:  
  `curl -s http://localhost:3001/api/hlb/service-api/LiveFeed/WebGetTopChampsZip?lng=en&country=147 | jq '.Value | length'`
- Marketing API debug snapshot (sports, batches, raw sample):  
  `curl -s "http://localhost:3001/api/marketing/debug" | jq`
- Full schedule (all fixtures, grouped into Lagos buckets):  
  `curl -s "http://localhost:3001/api/live/all" | jq '.[0:3]'`
- Streams-only payload grouped by sport:  
  `curl -s "http://localhost:3001/api/live/matches" | jq 'group_by(.sport)|map({sport:.[0].sport,count:length})'`
- Resolver checks for VI and SGI-only matches:  
  `curl -s -X POST http://localhost:3001/api/resolve -H 'content-type: application/json' -d '{"videoId":"VI_HERE"}'`  
  `curl -s -X POST http://localhost:3001/api/resolve -H 'content-type: application/json' -d '{"videoId":"", "sgi":"SGI_HERE"}'`
- All scheduling buckets (Today / Tomorrow / This Week) are computed on the server using the `Africa/Lagos` timezone with a 15-minute grace window; past streams outside that window will not appear.
