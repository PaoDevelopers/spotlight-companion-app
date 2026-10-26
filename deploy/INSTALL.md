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
git clone https://github.com/kenny-21342/events-tracker && cd events-tracker
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

## 5. First use

1. Open the site, sign in as the admin with the one-time code from step 3.
2. **Roster:** *Teacher portal → Roster*, paste `name,email,class`, print the login codes (shown once).
3. Create events, exhibits (print each exhibit's QR or write its link to an NFC tag) and competitions.
4. **Do not print final QR codes or write NFC tags until `PUBLIC_URL` and `CHECKIN_SECRET` are final.**

## 6. Switch on Microsoft sign-in (when IT sends the client ID)

In `/etc/spotlight/spotlight.conf` set `AUTH_MODE=entra`, `OIDC_TENANT_ID=ddd3d26c-b197-4d00-a32d-1ffd84c0c295` and
`OIDC_CLIENT_ID=<the Application (client) ID>`, then `sudo systemctl restart spotlight`. Login codes stop working at
that moment. Students (`@stu.ykpaoschool.cn`) and staff (`@ykpaoschool.cn`) get accounts the first time they sign in;
addresses in `ADMIN_EMAILS` become admins. If sign-in fails, Microsoft shows an error code:

| Code | Meaning |
|---|---|
| `AADSTS50011` | the redirect address isn't registered (it must be exactly `PUBLIC_URL` + `/auth`) |
| `AADSTS700054` | ID tokens aren't enabled on the registration |
| `AADSTS700016` | wrong client ID or tenant |
| `AADSTS65001` | admin consent is needed |

To go back to codes, set `AUTH_MODE=roster` and restart.

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

## 9. Awards at the end of the month

Award drafts refresh every night at 03:00 server time. A teacher still reviews them in *Teacher portal → Awards* (remove
anyone ineligible, with a reason) and presses **Publish**. Published prizes are final and are never changed by later runs.

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
