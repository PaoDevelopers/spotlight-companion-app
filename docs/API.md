# HTTP API

The Go server (`server/`) serves this JSON API under `/api`, plus the Microsoft sign-in redirects and the built React app.
This file is the contract the React app (`web/`) is written against. When a handler changes, change this file too.

## Conventions

- **JSON only.** Requests with a body must send `Content-Type: application/json`, and may only contain the fields listed
  (unknown fields are rejected with 400). Bodies are limited to 2 MB.
- **Errors** are `{"error": "message for people", "code": "machine_code"}` with the matching HTTP status.
  Show `error` to the user; branch on `code`. Common codes: `unauthorized` (401, go to the login page), `forbidden` (403),
  `not_found` (404), `invalid` (422, form problem), `too_many_attempts` (429).
- **Sessions** are an `HttpOnly` cookie called `session`, set by login or Microsoft sign-in. The browser sends it
  automatically; never read it in JavaScript. There is nothing else to send: no tokens, no CSRF header (the server rejects
  requests whose `Origin` is another site).
- **Times** are RFC 3339 strings in UTC (`2026-11-05T10:00:00Z`). Send times with an offset (`2026-11-05T18:00:00+08:00`).
- **Ids** are integers. A missing or malformed id in a path is a 404.
- Check-in links look like `https://<host>/c/<code>`. The React router must serve `/c/:code` (see "Scanning").

## Who can call what

| Group | Who | Prefix |
|---|---|---|
| public | anyone | `/healthz`, `/readyz`, `/api/auth/*`, `/auth*` |
| user | any signed-in account | `/api/*` below "Student" |
| staff | `teacher` or `admin` | `/api/admin/*` |
| admin | `admin` only | `POST /api/admin/users/role` |

## Sign-in

`GET /api/auth/config` → `{"mode": "roster" | "entra"}`. Decides which login screen to show.

**roster mode** (email + printed code): `POST /api/auth/login` `{"email": "...", "code": "..."}` → the user object, cookie set.
Wrong email or code is `401 bad_login` (the same for both). Five failures for one email lock it for 10 minutes (`429`).
In `entra` mode this returns `403 use_microsoft`.

**entra mode** (Microsoft): the login page is a plain link, not a fetch:
`<a href="/auth/start?next=/events">Sign in with Microsoft</a>`. The server redirects to Microsoft, Microsoft posts back to
`/auth`, and the server sets the cookie and redirects to `next` (a same-site path; anything else becomes `/`).
Failures redirect to `/login?error=<code>` where code is `external`, `expired`, `token`, `nonce`, `bad_email` or `domain`.
Show a friendly message for each. Students (`@stu.ykpaoschool.cn`) and staff (`@ykpaoschool.cn`) get accounts on first
sign-in; other domains are refused.

`POST /api/auth/logout` → 204 (clears the cookie).

## Student

`GET /api/me` → `User` plus `passToken`:
```json
{"id":2,"email":"student@demo.school","name":"Demo Student","className":"10A","role":"student","showOnLeaderboard":false,
 "passToken":"pass.2.Ab3..."}
```
`passToken` is the text of the student's personal QR code (render it with a QR library; a teacher scans it).

`PATCH /api/me` `{"showOnLeaderboard": true}` → the updated `User`.

`GET /api/home` →
```json
{"stats":{"attended":3,"visited":1,"totalExhibits":2},
 "upcoming":[Event],"competitions":[{"entryId":1,"competition":"Hackathon","event":"Hackathon","status":"finished","score":95,"rank":1}],
 "awards":[AwardResult]}
```
`awards` are the student's own **published** prizes.

`GET /api/events?subject=physics|cs` → `[Event]` ordered by start (a subject filter also includes `both`).
`Event` = `{id,title,subject,description,venue|null,startsAt,endsAt,capacity|null}`.

`GET /api/events/{id}` → `{"event":Event,"checkedIn":bool,"competitions":[{id,eventId,name,isTeam,myStatus|null}]}`.
`myStatus` is `null` when the student is not registered.

`POST /api/competitions/{id}/register` `{"team": ""}` → 204. Registering twice is harmless.

`GET /api/exhibits` → `[{id,slug,title,subject,summary,bodyMd,imageUrl|null,visited}]`.
`GET /api/exhibits/{slug}` → `{"exhibit":Exhibit,"votedForThis":bool,"visited":bool}`. `bodyMd` is Markdown:
render it with a Markdown component that does **not** allow raw HTML.

`PUT /api/vote` `{"exhibitId": 1}` → 204. One vote per student; voting again moves it. Voting for your own project is
`409 own_exhibit`.

`GET /api/leaderboard` → `{"month":[{rank,label,points}],"competitions":[{id,name,event,rows:[{id,label,status,score|null,rank|null}]}]}`.
`label` is already privacy-safe: a real name only if that student opted in, otherwise `Student, 10A`.

### Scanning

`POST /api/scan` `{"code": "<anything the camera or NFC gave you>"}` accepts either the bare code or the whole
`https://host/c/<code>` link. Always answers 200 for scan outcomes:
```json
{"ok": true,  "message": "Checked in to Hackathon!"}
{"ok": true,  "message": "Exhibit visit recorded", "href": "/exhibits/double-pendulum"}
{"ok": false, "message": "That code is invalid or expired. Scan the live screen again."}
```
If `href` is present, navigate there. Show `message` as is. Other statuses (401, 5xx) are real errors.

The route `/c/:code` in the React app should call this endpoint with the code from the URL (this is what an NFC tap or a
phone-camera scan opens), require sign-in first (redirect to `/login?next=/c/<code>`), then show the message or follow `href`.
Check-in codes contain dots, dashes and underscores; do not treat them as file names.

## Teachers and admins (`/api/admin/*`)

`GET /api/admin/stats` → `{events,checkins,users,exhibits}`.

**Events**
- `GET /api/admin/events` → `[Event]`
- `POST /api/admin/events` `{title,subject,description,venue,startsAt,endsAt,capacity|null}` → 201 `Event`
  (`subject` is `physics`, `cs` or `both`; end must be after start; capacity > 0 or null). Invalid → `422 invalid`.
- `GET /api/admin/events/{id}` → `{"event":Event,"attendees":[{userId,name,className,method,at}],"tagToken","tagUrl"}`.
  `tagUrl` is the permanent link to write to an NFC tag or print as a QR code for that event.
- `PUT /api/admin/events/{id}` same body as create → `Event`. `DELETE /api/admin/events/{id}` → 204.
- `GET /api/admin/events/{id}/token` → `{"token","url"}`: the **rotating** code for the projector QR. It is valid for
  about a minute. Fetch it every 10 seconds and re-render the QR from `url`. Never cached.
- `POST /api/admin/events/{id}/attendees` `{"email": "..."}` → 204: manual check-in (ignores the time window and capacity).
- `DELETE /api/admin/events/{id}/attendees/{userId}` → 204 (undo).
- `GET /api/admin/events/{id}/attendees.csv` → `text/csv` download.
- `POST /api/admin/events/{id}/scan-pass` `{"token": "<scanned student pass>"}` → `{"ok","message"}` like `/api/scan`.

**Exhibits**
- `GET /api/admin/exhibits` → `[Exhibit + tagToken + tagUrl]` (`tagUrl` = permanent link for the exhibit's QR/NFC tag).
- `POST /api/admin/exhibits` `{title,slug,subject,summary,bodyMd,imageUrl,owners:[email]}` → `Exhibit + tag`. Saving with an
  existing slug updates it; a non-empty `owners` list replaces the creators (they receive "Most Creative"). `imageUrl` must
  be `https://...` or a `/path`.

**Competitions**
- `GET /api/admin/competitions` → `{"events":[Event],"competitions":[{id,eventId,name,isTeam,entries:[Entry]}]}`.
  `Entry` = `{id,competitionId,userId,name,className,teamName|null,status,score|null,rank|null,notes|null}`.
- `POST /api/admin/competitions` `{eventId,name,isTeam}` → 201.
- `PUT /api/admin/entries/{id}` `{status,score|null,rank|null,notes|null}` → 204. `status` is one of `registered`,
  `competing`, `advanced`, `eliminated`, `finished`.

**Awards**
- `GET /api/admin/awards` → `{"exhibits":[{id,title,myScore|null}],"drafts":[AwardResult],"published":[AwardResult],"liveWinners":n}`.
- `POST /api/admin/awards/judge-score` `{exhibitId, score}` → 204 (0–100; scoring again replaces).
- `POST /api/admin/awards/run` → 204: computes **drafts** (replaces earlier drafts; awards already published are untouched).
- `POST /api/admin/awards/veto` `{id, reason}` → 204: removes a draft winner (published results can't be changed: 403).
- `POST /api/admin/awards/publish` → `{"published": n}`: makes all drafts visible to students.
  `AwardResult` = `{id,award,key,rank,metrics:{...},userId,name,className,published}`.

**Roster and roles**
- `POST /api/admin/roster` `{"csv": "name,email,class\n..."}` → `{"issued":[{name,email,className,code}]}`. The codes are shown
  once and never stored in readable form: show them immediately with a print button. Not available in `entra` mode (409).
- `POST /api/admin/users/role` `{email, role}` (admin only) → 204. `role` is `student`, `teacher` or `admin`.

## Operations

- `GET /healthz` → `ok` while the process is up. `GET /readyz` → `ready` only if the database answers.
- `POST /api/cron/awards` with `Authorization: Bearer <CRON_SECRET>` computes draft awards (optional; the server also does
  this itself every night at 03:00). It is switched off (404) when `CRON_SECRET` is not set.
