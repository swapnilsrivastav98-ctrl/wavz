# Wavz

Personal audiobook player. Next.js app, files live in Cloudflare R2, playback
position is saved in the browser's `localStorage`.

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in:
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — from an R2 API token (Cloudflare dashboard → R2 → Manage API Tokens) scoped to your bucket.
   - `APP_PASSWORD` — the password used to unlock the app.
   - `AUTH_SECRET` — any long random string, e.g. `openssl rand -hex 32`.

2. **CORS on the R2 bucket** — the browser uploads audio/cover files directly
   to R2 via presigned URLs, so the bucket needs a CORS policy allowing `PUT`
   from wherever the app is hosted:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://your-vercel-domain.vercel.app"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["*"]
     }
   ]
   ```

   Set this under R2 bucket → Settings → CORS Policy.

3. Install dependencies and run:

   ```bash
   npm install
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## How it works

- **Library metadata** (title, author, R2 keys) lives in a single `library.json`
  manifest object inside the R2 bucket itself — no database.
- **Playback progress** is stored per-device in `localStorage`, keyed by book id.
- **Audio/cover playback** uses short-lived presigned R2 GET URLs generated
  server-side per page load; uploads use presigned PUT URLs so large audio
  files go straight from the browser to R2, bypassing Vercel's request body limits.
- **Auth** is a single shared password gating the whole app via a signed cookie
  (see `middleware.ts`) — fine for personal use, not a multi-user system.
- Installable as a PWA (`manifest.webmanifest` + `public/sw.js`) — use
  "Add to Home Screen" on mobile.

## Deploy

Push to a GitHub repo and import into Vercel, then set the same env vars from
`.env.local` in the Vercel project settings.
