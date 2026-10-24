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
| `AUTH_MODE` | `roster` (default): email + printed code. `entra`: Microsoft sign-in only; codes are refused. |
| `OIDC_TENANT_ID`, `OIDC_CLIENT_ID` | Needed when `AUTH_MODE=entra`. Not secrets, and there is no client secret. |
| `APP_URL` | The site's public address (e.g. `https://spotlight.school.example`). Must match the redirect address registered with Microsoft. |
| `STAFF_DOMAIN`, `STUDENT_DOMAIN` | Default `ykpaoschool.cn` and `stu.ykpaoschool.cn`. |
| `ADMIN_EMAILS` | In `entra` mode these full addresses become admins when they sign in. |

## Deploy

### Vercel (preview or production)
The app needs a real Postgres on Vercel: without `DATABASE_URL` it falls back to an in-memory database, which serverless instances don't share.

1. Vercel: **Add New → Project**, import this GitHub repo. Branch pushes get preview deployments automatically.
2. **Storage → Create → Neon Postgres** (Marketplace). It sets `DATABASE_URL`; use the pooled connection string. Put the function and DB regions near the school.
3. **Environment variables**: `CHECKIN_SECRET` (long random string), `CRON_SECRET` (long random string), `ADMIN_EMAILS` (your school email).
4. Deploy. The build runs `scripts/migrate.mts`, which applies migrations to `DATABASE_URL` (this includes preview builds, so previews and production share one database unless you give previews their own).
5. Get a login:
   - **Fake demo data (recommended for a preview):** from your machine run `DATABASE_URL="<neon url>" npm run seed`. It creates a demo teacher and student plus sample events and exhibits, and prints their one-time codes. It does nothing if the demo accounts already exist.
   - **Real admin:** the first request after deploy creates the `ADMIN_EMAILS` account and prints its one-time code in the function **Logs**.
6. **Settings → Deployment Protection**: preview URLs require a Vercel login by default. Allow public access for the demo, or share a protection-bypass link.
7. Open it on a phone (HTTPS is provided, so the camera works) and try "Add to Home Screen".

Notes:
- Printed exhibit/NFC codes embed the site's domain. Set up the stable production domain **before** printing anything, and don't print from a preview URL.
- `vercel.json` runs the awards job daily; it only creates drafts. Vercel sends `CRON_SECRET` automatically.
- Use fake data only until the school confirms its data policy for hosting student data outside the school.

### School server
`docker compose up --build` (uses `.env`; point `DATABASE_URL` at the `db` service).

## Microsoft sign-in (`AUTH_MODE=entra`)
Works like the school's CCA app: the browser goes to Microsoft, which posts a signed ID token back to `/auth`.
We check the signature against the tenant's published keys, the issuer, that the token was issued to **our** client ID,
its expiry and a one-time nonce, so no client secret is needed. `@stu.ykpaoschool.cn` accounts become students and
`@ykpaoschool.cn` accounts become teachers on first sign-in; other domains are refused. Existing accounts keep their
role, and are matched by email.

Ask IT for an app registration (or an extra redirect address on an existing one) with:
- Redirect URI (Web): `https://<our-host>/auth` (exact; Microsoft doesn't allow wildcards, so use the stable domain)
- Authentication: enable **ID tokens** (implicit/hybrid flow), single tenant
- Permissions: sign-in only (`openid profile email`)
Then set `OIDC_TENANT_ID`, `OIDC_CLIENT_ID`, `APP_URL`, `AUTH_MODE=entra`. Test without Microsoft: `npm run test:e2e:sso`
(uses a fake provider; it can't prove the school's real registration, only our side of the flow).

## Typical flow
1. Admin signs in, promotes teachers (Teacher portal home), imports the roster CSV and prints login codes.
2. Teachers create events/exhibits/competitions. Print exhibit QR codes or write the shown URLs to NFC tags.
3. At an event, open *Display check-in QR* on the projector. Students scan in the app or with their phone camera.
4. Last week: students vote, judges score. After the freeze: *Awards → Compute drafts → review/veto → Publish*.

## Not done yet
Real Microsoft sign-in has only been tested against a fake provider (needs the school's tenant/client IDs); exhibit quizzes, certificate PDFs, realtime leaderboard.
See the plan for the rationale behind each choice.
