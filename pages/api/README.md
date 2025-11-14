The project serves API routes from the standalone Express server located in `server/index.ts`.

Front-end code calls the following endpoints (proxied by Vite to `http://localhost:4000` during development):

- `GET /api/leagues`
- `GET /api/league/:li/matches`
- `POST /api/resolve`

These routes are implemented in `server/routes/streams.ts`.
