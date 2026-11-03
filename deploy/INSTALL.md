# Installing on the school server

The app is **one file** (`spotlight`) plus a settings file. It contains the web app, the API and the database engine
(SQLite). There is nothing else to install: no Node, no database server.

## 0. Facts to collect first (about 10 minutes, with Mr. Colin)

Fill these in; every step below depends on at least one of them.

| Question | How to find out | Why it matters |
|---|---|---|
| CPU type | `uname -m` (`x86_64` is the default build; `aarch64` needs `GOARCH=arm64`) | which binary to build |
| Linux and systemd | `cat /etc/os-release`, `systemctl --version` | the service files assume systemd |
| Public name and DNS | Is `spotlight.ykpaoschool.cn` created, and does it point at this server? `getent hosts spotlight.ykpaoschool.cn` | Microsoft's redirect address must match exactly |
| HTTPS certificate | Who issues one for that name? CCA's: `openssl x509 -in /var/lib/tls/cca-leafchain.pem -noout -subject -enddate -ext subjectAltName` (a `*.ykpaoschool.cn` entry means a wildcard) | browsers and Microsoft refuse plain http |
| Who owns port 443 | `sudo ss -ltnp \| grep ':443'` (CCA serves its own HTTPS on 443) | decides option A or B in step 4 |
| Outbound internet | `curl -sS -o /dev/null -w '%{http_code}\n' https://login.microsoftonline.com/ddd3d26c-b197-4d00-a32d-1ffd84c0c295/v2.0/.well-known/openid-configuration` should print `200` | the server downloads Microsoft's signing keys |
| Correct clock | `timedatectl` shows `System clock synchronized: yes` | sign-in tokens and the rotating QR code are time-based |
| Disk | `df -h /var` (the database is a few MB) | backups |

## 1. Get the binary

Either build it (needs Go 1.24+, Node 22+ and `make`; run on any machine, copy the result):

```
git clone https://github.com/PaoDevelopers/spotlight-companion-app && cd spotlight-companion-app
git checkout <the branch or tag to deploy>
make              # produces ./spotlight  (set GOARCH=arm64 for an ARM server)
./spotlight version
```

or download the tarball built by GitHub Actions when one exists (`spotlight-linux-amd64.tar.gz` with a `.sha256` file;
check it with `sha256sum -c`).

## 2. Create the service user, folders and settings

```
sudo useradd --system --home /var/lib/spotlight --shell /usr/sbin/nologin spotlight
sudo install -d -o root -g root /opt/spotlight
sudo install -m 0755 spotlight deploy/backup.sh /opt/spotlight/
sudo install -d -o root -g spotlight -m 0750 /etc/spotlight
sudo install -m 0640 -o root -g spotlight deploy/spotlight.conf.example /etc/spotlight/spotlight.conf
sudo install -d -o spotlight -g spotlight -m 0750 /var/backups/spotlight
```

Edit `/etc/spotlight/spotlight.conf`:
- `PUBLIC_URL` is the final address (`https://spotlight.ykpaoschool.cn`).
- `CHECKIN_SECRET`: `openssl rand -hex 32`. **Write it somewhere safe.** Losing or changing it invalidates every printed
  QR code and NFC tag.
- `ADMIN_EMAILS`: your school email.
- Keep `AUTH_MODE=roster` for now.

Settings are checked at start-up; any placeholder left in them makes the server refuse to run and say why.

## 3. Install and start the service

```
sudo cp deploy/spotlight.service deploy/spotlight-backup.service deploy/spotlight-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spotlight spotlight-backup.timer
systemctl status spotlight
curl -s http://127.0.0.1:8080/readyz          # prints: ready
```

The first start creates the admin account and prints its **one-time login code** in the log (it is not stored in
readable form and not shown again):

```
sudo journalctl -u spotlight | grep "admin account created"
```

## 4. HTTPS (choose one)

**A. Behind a reverse proxy (recommended if CCA already holds port 443 or IT already runs a proxy).** Keep
`LISTEN=127.0.0.1:8080` and add a site for `spotlight.ykpaoschool.cn` that forwards to it. `deploy/Caddyfile.example`
shows the whole configuration for Caddy; nginx or Apache work equally well. Make sure the proxy sends WebSocket-free
plain HTTP/1.1 requests (nothing special is needed) and does not rewrite the `Origin` header.

**B. The app serves HTTPS itself** (the way CCA does). Set `LISTEN=:443`, `TLS_CERT` and `TLS_KEY` (a chain file and key
readable by the `spotlight` user only), and uncomment the `CAP_NET_BIND_SERVICE` lines in
`/etc/systemd/system/spotlight.service`. Only possible if nothing else uses 443 on this address.

Then check from a laptop: `https://spotlight.ykpaoschool.cn/healthz` shows `ok` with a valid padlock, and
`/manifest.webmanifest` loads.

### 4a. Making it reachable on the school network (Debian)

1. **A name that resolves inside the school.** Ask IT for an internal DNS record `spotlight.ykpaoschool.cn` pointing at this server's address
   (`ip -4 addr` shows it). Check from another computer on the network: `nslookup spotlight.ykpaoschool.cn`.
2. **A certificate for that name.** Phones only allow the camera (QR scanning) and Microsoft sign-in on `https`, so a plain `http://192.168.x.x`
   address is only good for a quick look (see "Try it before HTTPS" below). Use the school's certificate (for example the wildcard one CCA uses). Put the
   files somewhere root can read, **not** under `/home` (the service cannot see home folders), for example `/etc/ssl/ykpaoschool/`.
3. **Who owns port 443?** `sudo ss -ltnp | grep ':443'`. If nothing does, use option B above (the app serves HTTPS itself), or nginx.
   If nginx already holds it (check the program name in that output), just add `deploy/nginx.conf.example` as one more site: nginx tells the sites apart by name, so no second address or port is needed. If a different program holds it, put **nginx** in front (`sudo apt install nginx`) or ask IT for a second
   address or port. Whatever address people really type must be exactly `PUBLIC_URL` and the redirect address registered with Microsoft.
4. **Open the firewall** if one is active (Debian has none by default): `sudo ufw status`, then for example
   `sudo ufw allow from 10.0.0.0/8 to any port 443 proto tcp` (use the school's real range, not the whole Internet).
5. **Keep it off the Internet for now** (IT's request): only an internal DNS record, no port forward on the school router, and no public DNS name.
6. **Check from a phone on the school wifi** (not mobile data): open `https://spotlight.ykpaoschool.cn/healthz` (it shows `ok` with a padlock), then sign in
   and try the Scan page: the camera should ask for permission.

**Try it before HTTPS is ready** (testing only, never print QR codes or tags from this): set `PUBLIC_URL=http://<server-ip>:8080`, `LISTEN=0.0.0.0:8080`,
`AUTH_MODE=roster`, restart, and open that address on a laptop on the same network. The camera will not work over plain `http` except on `localhost`, and
Microsoft sign-in cannot work without `https`. Put `PUBLIC_URL` and `LISTEN` back before real use, because printed codes contain `PUBLIC_URL`.

## 5. First use

1. Open the site, sign in as the admin with the one-time code from step 3.
2. **Roster:** *Teacher portal → Roster*, paste `name,email,class`, print the login codes (shown once).
3. Create events, exhibits (print each exhibit's QR or write its link to an NFC tag) and competitions.
4. **Do not print final QR codes or write NFC tags until `PUBLIC_URL` and `CHECKIN_SECRET` are final.**

### 5a. Load the school's student list (so teachers can find students who have not signed in)

Without this, a student only exists in the app after their first sign-in, so a teacher cannot check in, enter in a competition or
give an award to a student who has no phone or has never signed in. Load the school's list once.

**Easiest: in the browser.** Sign in as an admin, open *Teacher portal* (the dashboard) and use **Load the school's student list**. Choose the
school's `students.db` (or a CSV). It first shows how many students it found and how many would be added, and only loads when you press the
button. The uploaded file is not kept. Or from the command line on the server:

```
sudo -u spotlight /opt/spotlight/spotlight -config /etc/spotlight/spotlight.conf import-students --dry-run /path/to/students.db
sudo -u spotlight /opt/spotlight/spotlight -config /etc/spotlight/spotlight.conf import-students /path/to/students.db
```

- The file is the school system's `students.db` (a table `students` with `id` and `system_name`), or a CSV with a header row `id,name,class`
  (or `email,name,class`). The email is built from the id: `s10001` becomes `s10001@stu.ykpaoschool.cn`.
- It prints counts only. It is safe to run again whenever the list changes: it adds missing students, never changes an existing
  person's name or role, and only fills in a class that is empty.
- It creates **no login codes**. With Microsoft sign-in a student is matched to their loaded account by email when they first sign in
  (Microsoft's name then replaces the loaded one). In `roster` mode, print codes with the Roster page as before.
- The school's list has no class column, so students show as "Anonymous" on public lists until a class is set. A CSV with a `class` column,
  or the Roster page, fills it in.
- **Keep the file out of the repository and off the Vercel preview** (real students; the preview must only ever hold fake data). Delete the
  copy on the server after loading, and remember the database it fills is covered by the nightly backup.

## 6. Switch on Microsoft sign-in (when IT sends the client ID)

IT has created the registration (client ID below; neither ID is a secret). In `/etc/spotlight/spotlight.conf` set
`AUTH_MODE=entra`, `OIDC_TENANT_ID=ddd3d26c-b197-4d00-a32d-1ffd84c0c295` and
`OIDC_CLIENT_ID=e42a56a6-39f7-4c8c-be7c-2493fe4ec29c`, then `sudo systemctl restart spotlight`. Login codes stop working at
that moment. Students (`@stu.ykpaoschool.cn`) and staff (`@ykpaoschool.cn`) get accounts the first time they sign in;
addresses in `ADMIN_EMAILS` become admins. If sign-in fails, Microsoft shows an error code:

| Code | Meaning |
|---|---|
| `AADSTS50011` | the redirect address isn't registered (it must be exactly `PUBLIC_URL` + `/auth`) |
| `AADSTS700054` | ID tokens aren't enabled on the registration |
| `AADSTS700016` | wrong client ID or tenant |
| `AADSTS65001` | admin consent is needed |

To go back to codes, set `AUTH_MODE=roster` and restart.

**After the first successful Microsoft sign-in on the real address, tell IT.** The registration currently also lists a
`localhost` redirect address that IT only added so we could test; IT wants it removed as soon as the real site works.
IT has limited sign-in to staff and high-school students, so other accounts are stopped by Microsoft before they reach us.

### School network only (IT's request for now)
IT would like the site reachable from inside the school only at first, and reviewed before it is put on the Internet.
This works with Microsoft sign-in: only the browser talks to Microsoft, and the server needs outbound HTTPS to
`login.microsoftonline.com` only (no inbound Internet traffic). What changes:
- The DNS name `spotlight.ykpaoschool.cn` is an **internal** record; students at home cannot open the site.
- HTTPS cannot use an automatic public certificate (Let's Encrypt must reach the server from the Internet). Use the
  school's own certificate for that name (for example the wildcard CCA uses) with `TLS_CERT`/`TLS_KEY`, or the `tls` line in
  `Caddyfile.example`.
- Camera and NFC check-in still work, because the address is `https`.
- If CCA's server is also used, port 443 is already taken: use a reverse proxy with a separate name, or another port, and
  put exactly that address in `PUBLIC_URL` and in the registration (Microsoft matches the redirect address exactly).

## 7. Updating

```
sudo install -m 0755 spotlight /opt/spotlight/spotlight.new && sudo mv /opt/spotlight/spotlight.new /opt/spotlight/spotlight
sudo systemctl restart spotlight && curl -s http://127.0.0.1:8080/readyz
```

Database changes apply automatically at start-up, once each. Take a backup first (below). To roll back, put the previous
binary back and restore the backup made before the update.

## 8. Backups and restore

`spotlight-backup.timer` copies the database nightly to `/var/backups/spotlight` (14 days kept) while the app runs.
**Copy that folder to another machine regularly**; a backup on the same disk doesn't survive that disk failing.

```
sudo -u spotlight /opt/spotlight/backup.sh                       # take one now
sudo systemctl stop spotlight
sudo -u spotlight cp /var/backups/spotlight/spotlight-YYYYMMDD-HHMMSS.db /var/lib/spotlight/spotlight.db
sudo rm -f /var/lib/spotlight/spotlight.db-wal /var/lib/spotlight/spotlight.db-shm
sudo systemctl start spotlight
```

## 9. Awards

Awards are chosen by teachers; the server calculates nothing and runs no nightly job. In *Teacher portal → Awards* a teacher gives an
award (a title, one or more students, an optional reason). New awards are drafts that only teachers can see. **Publish** shows each
student their award and reason on their Home page and lists the winners on the Board. Awards can be edited, hidden or removed at any time,
and every change is recorded in the audit log.

## 10. When something is wrong

| Symptom | Look at |
|---|---|
| Won't start | `journalctl -u spotlight -e` (the first line says which setting is wrong) |
| Everyone asked to sign in again after an update | `CHECKIN_SECRET` changed |
| Microsoft sign-in: "Sign-in session expired" | the browser blocked the sign-in cookie; the site must be `https`; check `PUBLIC_URL` matches the address bar |
| "This sign-in did not match…" / token errors | server clock off (`timedatectl`), or the registration's client ID is wrong |
| Rotating QR on the projector isn't accepted | server clock off, or the projector page lost its connection (it says so) |
| `/readyz` says database unavailable | disk full or permissions on `/var/lib/spotlight` |
| Printed QR codes stopped working | `CHECKIN_SECRET` or `PUBLIC_URL` changed after printing |
