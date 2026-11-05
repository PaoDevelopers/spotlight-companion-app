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

`GET /api/me/checkins` → `[{event, method, at}]`: the events this student has checked in to, oldest first.

`PATCH /api/me` `{"showOnLeaderboard": true}` → the updated `User`.

`GET /api/home` →
```json
{"stats":{"attended":3,"visited":1,"totalExhibits":2},
 "upcoming":[Event],"competitions":[{"entryId":1,"competition":"Hackathon","event":"Hackathon","status":"finished","score":95,"rank":1}],
 "awards":[{"id":1,"title":"Most Creative Exhibit","reason":"Built a working machine"}]}
```
`awards` are the awards a teacher gave this student and **published** (`reason` may be empty).

`GET /api/events?subject=physics|cs` → `[Event]` ordered by start (a subject filter also includes `both`).
`Event` = `{id,title,subject,description,venue|null,startsAt,endsAt,capacity|null}`.

`GET /api/events/{id}` → `{"event":Event,"checkedIn":bool,"signedUp":bool,"competitions":[{id,eventId,name,isTeam,kind,houses?,myStatus|null}]}`.
`myStatus` is `null` when the student is not registered.
`PUT /api/events/{id}/signup` → 204: reserve a place (harmless to repeat). `409 full` when the places are taken, `409 signup_closed`
when sign-up is off or the event is over. `DELETE /api/events/{id}/signup` → 204. A signed-up student keeps their place at
check-in: walk-ins can't take it. A student without a device is found by the teacher (see `/api/admin/students`).

`POST /api/competitions/{id}/register` `{"team": ""}` → 204. Registering twice is harmless.

`GET /api/exhibits` → `[{id,slug,title,subject,summary,bodyMd,imageUrl|null,exhibitionId|null,visited}]`.
`GET /api/exhibits/{slug}` → `{"exhibit":Exhibit,"visited":bool}`. `bodyMd` is Markdown:
render it with a Markdown component that does **not** allow raw HTML.

`GET /api/leaderboard` → `{"month":[{rank,label,points}],"competitions":[{id,name,event,rows:[{id,label,status,score|null,rank|null}]}]}`.
`label` is already privacy-safe: a real name only if that student opted in, otherwise `Student, 10A`.

### Scanning

`POST /api/scan` `{"code": "<anything the camera or NFC gave you>"}` accepts either the bare code or the whole
`https://host/c/<code>` link. Always answers 200 for scan outcomes (when check-in is closed the answer also has `reason` = `early`|`late`, `event` and `opensAt`, so the app can say when it opens):
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
- `POST /api/admin/events` `{title,subject,description,venue,host,imageUrl,startsAt,endsAt,capacity|null,signupEnabled}` → 201 `Event`
  (`subject` is `physics`, `chemistry`, `cs` or `both` ("both" = a mix of several, shown as Mixed); end must be after start; capacity > 0 or null; `description` is Markdown;
  `imageUrl` must be `https://...` or a `/path`; `signupEnabled` defaults to true when omitted; `competition` is `""` (not a competition),
  `individual`, `team` or `house`: see Competitions below). Invalid → `422 invalid`.
  `Event` = `{id,title,subject,description,venue|null,startsAt,endsAt,capacity|null,imageUrl|null,host|null,signupEnabled,signupCount}`.
- `GET /api/admin/events/{id}` → `{"event":Event,"attendees":[{userId,name,className,method,at}],"signups":[{userId,name,email,className,byStaff,at,checkedIn}],"tagToken","tagUrl"}`.
  `tagUrl` is the permanent link to write to an NFC tag or print as a QR code for that event.
- `PUT /api/admin/events/{id}` same body as create → `Event`. `DELETE /api/admin/events/{id}` → 204.
- `GET /api/admin/events/{id}/token` → `{"token","url"}`: the **rotating** code for the projector QR. It is valid for
  about a minute. Fetch it every 10 seconds and re-render the QR from `url`. Never cached.
- `POST /api/admin/events/{id}/attendees` `{"userId": 5}` or `{"email": "..."}` → 204: manual check-in (ignores the time window and capacity).
- `POST /api/admin/events/{id}/signups` `{"userId": 5}` or `{"email": "..."}` → 204: sign a student up on their behalf (ignores capacity,
  the switch and the end time). `DELETE /api/admin/events/{id}/signups/{userId}` → 204.
- `GET /api/admin/students?q=` → `[{id,name,email,className}]` (max 8; needs 2+ characters; matches name, email or class). For finding a
  student who has no phone.
- `DELETE /api/admin/events/{id}/attendees/{userId}` → 204 (undo).
- `GET /api/admin/events/{id}/attendees.csv` → `text/csv` download.
- `POST /api/admin/events/{id}/scan-pass` `{"token": "<scanned student pass>"}` → `{"ok","message"}` like `/api/scan`.

**Pictures** (for descriptions and cover images)
- `POST /api/admin/images` raw bytes of one picture (any `Content-Type`) → 201 `{"id","url":"/api/images/<id>"}`. PNG, JPEG, GIF or WebP up to 6 MB,
  recognised from the bytes (SVG and everything else → `422 invalid`). Put the `url` in Markdown as `![text](/api/images/<id>)` or in `imageUrl`.
- `GET /api/images/{id}` (any signed-in user) → the picture; never changes, so it is cached for a year.

**Exhibitions** (named groups of exhibits, such as "Physics Exhibition")
- `GET /api/admin/exhibitions` → `[{id,title,subject,summary,bodyMd,imageUrl|null,total,visited:0}]` (`total` = exhibits in it).
- `POST /api/admin/exhibitions` `{title,subject,summary,bodyMd,imageUrl}` → 201. `PUT /api/admin/exhibitions/{id}` same body → 200.
  `DELETE /api/admin/exhibitions/{id}` → 204: only the grouping goes; its exhibits stay and become standalone.
- Students: `GET /api/exhibitions` → the same list, with `visited` = how many of its exhibits this student has scanned.

**Exhibits**
- `GET /api/admin/exhibits` → `[Exhibit + tagToken + tagUrl + visits]` (`tagUrl` = permanent link for the exhibit's QR/NFC tag; `visits` = students who scanned it).
- `POST /api/admin/exhibits` `{title,subject,summary,bodyMd,imageUrl,exhibitionId?,slug?}` (`exhibitionId` puts it in an exhibition; absent/null = standalone; an id that does not exist is `422`) → 201 `Exhibit + tag`. Always a new exhibit: the web address (`slug`) is made from the
  title (a title with no Latin letters, such as a Chinese one, becomes `exhibit`) and numbered `-2`, `-3`... if taken, so nothing is overwritten. A `slug` you
  pass that is already used is refused with `409 exists`. `imageUrl` must be `https://...` or a `/path` (for example `/api/images/3`).
- `PUT /api/admin/exhibits/{id}` same body (any `slug` is ignored) → `Exhibit + tag`. The web address and the QR/NFC tag never change when an exhibit is edited.
- `DELETE /api/admin/exhibits/{id}` → 204 (its visits go with it; its printed QR stops working). Unknown id → 404.

**Competitions**

A competition belongs to exactly one event and is switched on and off with the event's `competition` field (create or `PUT` the event).
It is named after the event. There are three kinds: `individual` (each student is scored alone), `team` (a student enters under a team name)
and `house` (a student enters for Spring, Summer, Autumn or Winter; the house's points are the sum of its entrants' scores).
Changing the kind keeps the entries; setting `competition` to `""` deletes the competition **and all its entries**
(`GET /api/admin/events/{id}` returns `competitionEntries`, the number that would be lost, so a client can ask first).

- `GET /api/admin/competitions` → `{"events":[Event],"competitions":[{id,eventId,name,isTeam,kind,houses?,entries:[Entry]}]}`.
  `Entry` = `{id,competitionId,userId,name,className,teamName|null,house|null,status,score|null,rank|null,notes|null}`.
- `PUT /api/admin/entries/{id}` `{status,score|null,rank|null,notes|null}` → 204. `status` is one of `registered`,
  `competing`, `advanced`, `eliminated`, `finished`. `DELETE /api/admin/entries/{id}` → 204 (removes a wrong or withdrawn entry).
- `POST /api/admin/competitions/{id}/entries` `{"userId","team","house"}` → 204: enter a student by hand (for example one without a phone).
  Same rules as a student's own entry.
- Student side: `GET /api/events/{id}` lists `competitions:[{id,name,kind,houses?,myStatus|null}]`;
  `POST /api/competitions/{id}/register` `{"team","house"}` → 204 (`422 invalid` if a team name or a valid house is missing for that kind).
- `GET /api/leaderboard` → `{"month":[...],"competitions":[Board]}` where `Board` = `{id,eventId,name,event,kind,rows:[{id,label,team,house,status,score,rank}],groups:[{label,rank,score,count,members?}]}`.
  `rows` are individuals (labels respect each student's opt-in). For `team`, `groups` are the teams (best rank, best score, members); for `house`, `groups`
  are all four houses ranked by total points (a house with no points is unranked). `rows` and `groups` are always lists, never null.

**Awards** (chosen by teachers; nothing is calculated)

An award is a title, a student and an optional reason. Giving one to several students creates one row per student. New awards are
**drafts** that only teachers see; publishing shows them to the student (on `/api/home`) and lists them on `/api/leaderboard`.
Every change is written to the audit log. Only students can receive awards.

- `GET /api/admin/awards` → `{"awards":[{id,title,reason,userId,name,className,published}]}` (drafts included, real names).
- `POST /api/admin/awards` `{title, reason, userIds:[...]}` → 201 `{"created": n}` (title 1–80 characters, reason up to 500, up to 200 students).
  Giving the same award to the same student again just updates the reason. Invalid → `422 invalid` and nothing is created.
- `PUT /api/admin/awards/{id}` `{title, reason}` → 204. `DELETE /api/admin/awards/{id}` → 204.
- `POST /api/admin/awards/publish` `{"ids":[...], "published": true|false}` → `{"changed": n}`. With no `ids`, `published: true` publishes every draft;
  `published: false` always needs `ids` (hiding "everything" is refused).
- Public list: `GET /api/leaderboard` also returns `"awards":[{"title","winners":[{"label","reason?"}]}]` (published only). Like the leaderboard, a
  student's name shows only if they opted in; the reason is included only for those students.

**View as a student** (testing; one admin only)
- Switched on by listing the admin's email in `IMPERSONATE_EMAILS` (empty = off, and the endpoints answer 404). `GET /api/me` then has `"canImpersonate": true` for that admin.
- `POST /api/admin/impersonate` `{"userId"}` → 200 student. Only students can be viewed. It keeps the admin's identity in a second, differently signed cookie and gives
  a student session that lasts **one hour**. While viewing, `GET /api/me` has `"viewingAs": "<admin name>"`, admin endpoints answer 403, and a student's privacy setting
  cannot be changed (409). `POST /api/impersonate/stop` → 200 admin (back to a normal session); 409 if not viewing. Both are in the audit log. Signing out ends it.

**Merging a student's two accounts** (admin only)
- `POST /api/admin/users/merge` `{"keepId","dropId","dryRun"?}` → `{"moved":{table:n},"duplicate":{table:n}}` (counts only). Folds the account `dropId` into `keepId`: its check-ins,
  sign-ups, competition entries, exhibit visits and awards move over (anything the staying account already has is not doubled), the staying account keeps its name,
  and the old address becomes another address of the same student, so signing in under it, a manual check-in by email or loading the school list again all lead
  to the one account. Both must be students (`422` otherwise; `404` if one is missing). Audit-logged. Use `dryRun` to preview.
- Microsoft sign-in does this by itself: a record loaded from the student list (or an earlier account) is recognised through **any** address in the token
  (`preferred_username` and `email`), becomes the signed-in account, and takes Microsoft's name; two accounts reached by one token are merged. A second address only ever
  matches a **student** account on the student domain, never a teacher or admin account.

**Roster and roles**
- `POST /api/admin/roster` `{"csv": "name,email,class\n..."}` → `{"issued":[{name,email,className,code}]}`. The codes are shown
  once and never stored in readable form: show them immediately with a print button. Not available in `entra` mode (409).
- `POST /api/admin/users/role` `{email, role}` (admin only) → 204. `role` is `student`, `teacher` or `admin`.

## Library, scavenger hunts and shared works

Students (any signed-in user):
- `GET /api/books` → `{"books":[Book]}`; `GET /api/books/{id}` → `{"book":Book,"comments":[{id,userId,name,className,body,at}]}`. `Book` = `{id,title,author,subject,summary,bodyMd,imageUrl|null,reads,comments,iRead}`.
- `PUT|DELETE /api/books/{id}/read` → `{"book"}`: mark / unmark "I've read this" (one per student; repeating is harmless).
- `POST /api/books/{id}/comments` `{"body"}` → 201 `{"comment"}`. Plain text, 1–1000 characters, 10 an hour. Real names are shown. `DELETE /api/comments/{id}` → 204: the writer or any teacher (a teacher's deletion is audited).
- `POST /api/uploads?kind=work|hunt` raw picture bytes → 201 `{"id","url"}`. For a student's own pictures; 30 an hour, 300 in all. The picture must then be attached with the calls below (it can be attached once).
- `GET /api/events/{id}/works` → `{"works":[{id,userId,name,className,imageUrl,caption,at}],"canPost"}` (`canPost` = checked in). `POST /api/events/{id}/works` `{imageId,caption}` → 201; 403 unless checked in; 6 per student per event. `DELETE /api/works/{id}` → 204 (owner or teacher).
- `GET /api/hunts` → `{"hunts":[HuntView]}` (published only, with the student's own progress); `GET /api/hunts/{id}` → `{"hunt":HuntView}`. `HuntView` has `stageList` (`state` is `done`, `current` or `locked`; `clue` is sent only for done/current stages), `done`, `total`, `finished`, `rank` and `board` (finishers by finish time; a name is shown only for students who chose to show their name, and the viewer always sees their own line). Staff may open a draft.
- `POST /api/hunts/{id}/code` `{"code"}` → `{result: done|already|locked|wrong, message, done, total, finished}`. The server finds the stage by itself. Stages complete strictly in order. Eight wrong answers in a minute → 429.
- Scanning a station QR (`POST /api/scan`, code `stage.<id>.<sig>`) completes that stage the same way.
- `POST /api/hunt-stages/{id}/photos` `{imageId,caption}` → 201 (stage must be unlocked; 5 per stage). `DELETE /api/hunt-photos/{id}` → 204 (owner or teacher). Hunt pictures are served only to their owner and to teachers.

Teachers:
- `GET|POST /api/admin/books`, `PUT|DELETE /api/admin/books/{id}`; body `{title,author,subject,summary,bodyMd,imageUrl}`.
- `GET|POST /api/admin/hunts`, `GET|PUT|DELETE /api/admin/hunts/{id}`; body `{title,subject,description,imageUrl,published,stages:[{id|null,title,clue,answers:[...]}]}`. A stage that keeps its `id` keeps its progress and photos; one left out is deleted. Answers include `token`/`url` per stage (the permanent QR for the station).
- `GET /api/admin/hunts/{id}/results` → `{"hunt","results":[{userId,name,className,done,total,rank,finished,finishedAt,stages:[{stageId,position,title,at,method,photos}]}]}`.
- `POST /api/admin/hunts/{id}/mark` `{userId,stageId,done}` → 204: record or undo a stage by hand (audited).

## Operations

- `GET /healthz` → `ok` while the process is up. `GET /readyz` → `ready` only if the database answers.
