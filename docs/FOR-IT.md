# Spotlight Month web app: information for IT

A short overview for Mr. Colin, to go with the Microsoft Entra registration request. Plain language; ask if anything is unclear.

## What it is
A web app (works in a phone browser, installable to the home screen, no app-store approval needed) for the Physics / CS
Spotlight Month. Students see events, check in by scanning a QR code or tapping an NFC tag, read about the exhibits, enter
competitions and see the month's prizes. Teachers manage events, exhibits and results in a teacher portal.

## See it yourself
- **Prototype:** https://events-tracker-mocha.vercel.app
- **Student login:** `student@demo.school`, code `WZGQMZAK` (fake account, fake data)
- Things to try: *Events*, *Exhibits* (open one), *Board* (leaderboard), *Me* (your personal QR pass and the privacy switch).
  The *Scan* tab asks for camera permission; scanning needs a real event or exhibit QR code, which we can show live.
- The teacher portal exists too; we're happy to walk through it on a screen share rather than share that login.

**What you are looking at:** an earlier build of the same app, hosted on Vercel (a public cloud service) **for demonstration
only, with fake data**. The version for the school is a different build of the same app: a single program (one file plus a
database file) that runs on the school server, so real student data never leaves school hardware. Real Microsoft sign-in is
not switched on yet because it needs the registration requested in `docs/IT-REQUEST.md`. Until then, the prototype signs in
with email plus a printed code, as you see in the demo.

## How Microsoft sign-in will work (the same pattern as CCA)
1. The student presses "Sign in with Microsoft" and is sent to your Microsoft login page.
2. Microsoft sends a signed ID token back to `https://spotlight.ykpaoschool.cn/auth`.
3. Our server checks it: the signature against your tenant's published keys, that it was issued by your tenant, that it was
   issued **to our app** (not another app in the tenant), that it hasn't expired, and that it belongs to this sign-in (a
   one-time value). Anything that fails is refused.
4. Only an `@stu.ykpaoschool.cn` address (student) or an `@ykpaoschool.cn` address (teacher) is accepted. Any other domain is refused.
5. We keep a signed session cookie (`HttpOnly`, `Secure`). The cookie currently lasts 45 days; we can shorten it (CCA uses 72 hours).

No client secret, no Microsoft Graph, no refresh tokens, no access to mail, files or calendars. The only registration settings
needed are in `docs/IT-REQUEST.md`.

## What data the app keeps
| Data | Source | Notes |
|---|---|---|
| Name, school email | the Microsoft sign-in token | nothing else is requested |
| Class | the roster the school gives us | optional |
| Check-ins, exhibit visits, competition entries and results, votes, prize results | created by using the app | |
| Audit log | actions by teachers (role changes, prize decisions) | |

No passwords. Students choose whether their name appears on public leaderboards; the default is hidden ("Student, 10A").
Data lives in one database file on the school server, backed up nightly.

## What it needs from the school server
- One Linux program and a settings file; no database server and no extra software. About 12 MB.
- A DNS name (`spotlight.ykpaoschool.cn`) and an HTTPS certificate for it.
- Outbound HTTPS to `login.microsoftonline.com` (to fetch Microsoft's public signing keys).
- Correct server time (sign-in tokens and the rotating check-in QR code are time-based).

Install instructions: `deploy/INSTALL.md`. The service runs as its own unprivileged user with the standard systemd hardening options.

## Safeguards built in
Teacher and admin actions are checked on the server for every request. Requests from other websites are refused. Strict
security headers (including a content security policy) are set. Login-code attempts are rate-limited. Check-in codes are
signed and the projector's QR code changes every 30 seconds, so a screenshot shared in a group chat stops working.
Capacity limits hold even when a whole assembly scans at once (tested with 60 simultaneous scans for 10 places).

## Being upfront about what is not done yet
- Real Microsoft sign-in has been tested only against a stand-in identity provider, not your tenant, because we have no client ID yet.
- The school-server install has not been done yet; the guide is written but untested on your server.
- No outside security review has been done. We'd welcome IT's review of the sign-in flow and the server setup.

## Questions for IT
See the request email: the registration settings, the DNS name and certificate, and an approval form if one is needed.
