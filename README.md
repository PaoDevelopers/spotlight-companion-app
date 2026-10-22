# Spotlight Month: Physics / CS events tracker

Installable web app (PWA, so no app-store approval) for the school's Physics / CS month: events and check-in
(rotating QR, student pass QR, NFC tags), competitions and leaderboards, exhibit companion pages, and
awards computed at month end, published only after a teacher confirms.

## Run locally
```bash
npm install
npm run dev          # no DATABASE_URL = in-memory DB, seeded with demo data on first login
```
Demo login (dev only): `teacher@demo.school` / `student@demo.school`, code printed by seed, or set
`DEMO_LOGIN_CODE=DEMOCODE` to fix it.

```bash
npm test             # unit + service tests (in-memory Postgres)
npm run test:e2e     # Playwright: student/teacher flows, fake-camera QR scanning (needs ffmpeg; set CHROMIUM_PATH if needed)
npm run build && PROD_DATABASE_URL=postgres://... npm run test:e2e:prod   # PWA/offline checks on the production build
TEST_DATABASE_URL=postgres://... npm test   # same service tests on real Postgres (wipes that DB)
```

## Configuration (`.env.example`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres. Migrations run automatically on start. |
| `CHECKIN_SECRET` | Signs sessions, check-in QR/NFC tokens. **Required in production**; changing it invalidates printed tags. |
| `ADMIN_EMAILS` | First admin(s); a one-time login code is printed to the server log on first start. |
| `CRON_SECRET` | Bearer token for `/api/cron/awards` (Vercel Cron sends it automatically). |
| `AUTH_MODE` | `roster` (email + printed code) now; `entra` (Microsoft SSO) planned. Not yet read by the code. |

## Deploy
- **Vercel**: set the variables above, add a Postgres (Neon). `vercel.json` runs the awards job daily; it only creates *drafts*.
- **School server**: `docker compose up --build` (uses `.env`; point `DATABASE_URL` at the `db` service).

## Typical flow
1. Admin signs in, promotes teachers (Teacher portal home), imports the roster CSV and prints login codes.
2. Teachers create events/exhibits/competitions. Print exhibit QR codes or write the shown URLs to NFC tags.
3. At an event, open *Display check-in QR* on the projector. Students scan in the app or with their phone camera.
4. Last week: students vote, judges score. After the freeze: *Awards → Compute drafts → review/veto → Publish*.

## Not done yet
Microsoft Entra SSO (needs tenant/client IDs), exhibit quizzes, certificate PDFs, realtime leaderboard.
See the plan for the rationale behind each choice.
