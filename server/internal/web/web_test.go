package web

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/config"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/db"
)

const secret = "0123456789abcdef0123456789abcdef"

type env struct {
	t    *testing.T
	app  *app.App
	ts   *httptest.Server
	base string
	now  time.Time
}

func setup(t *testing.T, mode string) *env {
	t.Helper()
	d, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	e := &env{t: t, now: time.Now()}
	e.ts = httptest.NewServer(nil)
	t.Cleanup(e.ts.Close)
	cfg := &config.Config{Secret: secret, PublicURL: e.ts.URL, AuthMode: mode, StaffDomain: "ykpaoschool.cn", StudentDomain: "stu.ykpaoschool.cn",
		DemoLoginCode: "DEMOCODE", CronSecret: "cron-secret"}
	cfg.OIDC = config.OIDC{TenantID: "t", ClientID: "client-1", Authorize: "https://login.example/authorize", Issuer: "https://login.example/v2.0"}
	e.app = app.New(d, cfg)
	e.app.Now = func() time.Time { return e.now }
	shell := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Spotlight Month</title>")}, "manifest.webmanifest": {Data: []byte(`{"name":"x"}`)}, "sw.js": {Data: []byte("//")}}
	e.ts.Config.Handler = New(e.app, slog.New(slog.NewTextHandler(io.Discard, nil)), shell)
	e.base = e.ts.URL
	return e
}

type client struct {
	*http.Client
	e *env
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{&http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, e}
}

func (c *client) do(method, path string, body any, hdr map[string]string) (*http.Response, []byte) {
	c.e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.e.base+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := c.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

func (c *client) mustStatus(want int, method, path string, body any) []byte {
	c.e.t.Helper()
	res, b := c.do(method, path, body, nil)
	if res.StatusCode != want {
		c.e.t.Fatalf("%s %s = %d, want %d: %s", method, path, res.StatusCode, want, b)
	}
	return b
}

func (c *client) login(email, code string) {
	c.e.t.Helper()
	c.mustStatus(200, "POST", "/api/auth/login", map[string]string{"email": email, "code": code})
}

func decode[T any](t *testing.T, b []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("%v: %s", err, b)
	}
	return v
}

func seeded(t *testing.T) (*env, *client, *client) {
	e := setup(t, "roster")
	if _, err := e.app.SeedDemo(context.Background()); err != nil {
		t.Fatal(err)
	}
	teacher, student := e.client(), e.client()
	teacher.login("teacher@demo.school", "DEMOCODE")
	student.login("student@demo.school", "DEMOCODE")
	return e, teacher, student
}

func TestRolesAndAuthentication(t *testing.T) {
	e, teacher, student := seeded(t)
	anon := e.client()
	for _, p := range []string{"/api/me", "/api/home", "/api/events", "/api/exhibits", "/api/leaderboard", "/api/admin/stats", "/api/admin/awards"} {
		if res, _ := anon.do("GET", p, nil, nil); res.StatusCode != 401 {
			t.Errorf("anonymous GET %s = %d, want 401", p, res.StatusCode)
		}
	}
	for _, p := range []string{"/api/admin/stats", "/api/admin/events", "/api/admin/exhibits", "/api/admin/competitions", "/api/admin/awards", "/api/admin/events/1/token", "/api/admin/events/1/attendees.csv"} {
		if res, _ := student.do("GET", p, nil, nil); res.StatusCode != 403 {
			t.Errorf("student GET %s = %d, want 403", p, res.StatusCode)
		}
	}
	for _, p := range []string{"/api/admin/awards/publish", "/api/admin/awards/run", "/api/admin/roster"} {
		if res, _ := student.do("POST", p, map[string]string{}, nil); res.StatusCode != 403 {
			t.Errorf("student POST %s = %d, want 403", p, res.StatusCode)
		}
	}
	// only admins change roles
	if res, _ := teacher.do("POST", "/api/admin/users/role", map[string]string{"email": "student@demo.school", "role": "admin"}, nil); res.StatusCode != 403 {
		t.Errorf("teacher changing roles = %d, want 403", res.StatusCode)
	}
	me := decode[struct{ Role, PassToken string }](t, student.mustStatus(200, "GET", "/api/me", nil))
	if me.Role != "student" || !strings.HasPrefix(me.PassToken, "pass.") {
		t.Fatalf("%+v", me)
	}
	student.mustStatus(204, "POST", "/api/auth/logout", nil)
	if res, _ := student.do("GET", "/api/me", nil, nil); res.StatusCode != 401 {
		t.Errorf("after logout = %d", res.StatusCode)
	}
}

func TestLoginRulesAndLockout(t *testing.T) {
	e, _, _ := seeded(t)
	c := e.client()
	for i := 0; i < 5; i++ {
		if res, _ := c.do("POST", "/api/auth/login", map[string]string{"email": "student@demo.school", "code": "WRONG"}, nil); res.StatusCode != 401 {
			t.Fatalf("attempt %d = %d", i, res.StatusCode)
		}
	}
	// locked out, even with the right code
	if res, _ := c.do("POST", "/api/auth/login", map[string]string{"email": "student@demo.school", "code": "DEMOCODE"}, nil); res.StatusCode != 429 {
		t.Fatalf("lockout = %d, want 429", res.StatusCode)
	}
	e.now = e.now.Add(11 * time.Minute)
	if res, _ := c.do("POST", "/api/auth/login", map[string]string{"email": "student@demo.school", "code": "DEMOCODE"}, nil); res.StatusCode != 200 {
		t.Fatalf("after the window = %d", res.StatusCode)
	}
	// session cookie flags
	res, _ := c.do("POST", "/api/auth/login", map[string]string{"email": "student@demo.school", "code": "DEMOCODE"}, nil)
	var sc *http.Cookie
	for _, k := range res.Cookies() {
		if k.Name == "session" {
			sc = k
		}
	}
	if sc == nil || !sc.HttpOnly || sc.SameSite != http.SameSiteLaxMode || sc.Path != "/" {
		t.Fatalf("session cookie %+v", sc)
	}
	// a tampered cookie is not a session
	bad := e.client()
	req, _ := http.NewRequest("GET", e.base+"/api/me", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: strings.Replace(sc.Value, "2.", "1.", 1)})
	if r, _ := bad.Do(req); r.StatusCode != 401 {
		t.Errorf("tampered cookie = %d", r.StatusCode)
	}
}

func TestRequestForgeryAndInputRules(t *testing.T) {
	e, teacher, student := seeded(t)
	// a form post from another website (browser sends Origin / Sec-Fetch-Site)
	for name, hdr := range map[string]map[string]string{
		"foreign origin": {"Origin": "https://evil.example"},
		"cross-site":     {"Sec-Fetch-Site": "cross-site"},
		"same-site only": {"Sec-Fetch-Site": "same-site"},
	} {
		if res, _ := student.do("PATCH", "/api/me", map[string]bool{"showOnLeaderboard": true}, hdr); res.StatusCode != 403 {
			t.Errorf("%s: %d, want 403", name, res.StatusCode)
		}
	}
	if res, _ := student.do("PATCH", "/api/me", map[string]bool{"showOnLeaderboard": true}, map[string]string{"Origin": e.base, "Sec-Fetch-Site": "same-origin"}); res.StatusCode != 200 {
		t.Errorf("legitimate same-origin request = %d", res.StatusCode)
	}
	// a plain HTML form (not JSON) is refused, unknown fields are refused, trailing junk is refused
	req, _ := http.NewRequest("PATCH", e.base+"/api/me", strings.NewReader("showOnLeaderboard=true"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if r, _ := student.Do(req); r.StatusCode != 415 {
		t.Errorf("form post = %d, want 415", r.StatusCode)
	}
	if res, _ := student.do("PATCH", "/api/me", map[string]any{"role": "admin"}, nil); res.StatusCode != 400 {
		t.Errorf("unknown field = %d, want 400", res.StatusCode)
	}
	req, _ = http.NewRequest("PATCH", e.base+"/api/me", strings.NewReader(`{"showOnLeaderboard":true} {"x":1}`))
	req.Header.Set("Content-Type", "application/json")
	if r, _ := student.Do(req); r.StatusCode != 400 {
		t.Errorf("trailing data = %d, want 400", r.StatusCode)
	}
	big := strings.Repeat("a", 3<<20)
	if res, _ := teacher.do("POST", "/api/admin/events", map[string]string{"title": big}, nil); res.StatusCode != 413 {
		t.Errorf("oversize body = %d, want 413", res.StatusCode)
	}
	// an image address that isn't https/relative is refused
	if res, _ := teacher.do("POST", "/api/admin/exhibits", map[string]any{"title": "X", "subject": "cs", "imageUrl": "javascript:alert(1)"}, nil); res.StatusCode != 422 {
		t.Errorf("javascript: image = %d, want 422", res.StatusCode)
	}
	// headers
	res, _ := student.do("GET", "/api/me", nil, nil)
	if res.Header.Get("X-Content-Type-Options") != "nosniff" || res.Header.Get("X-Frame-Options") != "DENY" || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("missing security headers: %v", res.Header)
	}
}

func TestEndToEndCheckInAndAwards(t *testing.T) {
	e, teacher, student := seeded(t)

	events := decode[[]app.Event](t, student.mustStatus(200, "GET", "/api/events", nil))
	if len(events) != 3 {
		t.Fatalf("%d events", len(events))
	}
	if sub := decode[[]app.Event](t, student.mustStatus(200, "GET", "/api/events?subject=physics", nil)); len(sub) != 2 { // physics + both
		t.Fatalf("physics filter: %d", len(sub))
	}
	opening := events[0]

	// the projector token works for exactly the right student flow
	tok := decode[struct{ Token, URL string }](t, teacher.mustStatus(200, "GET", "/api/admin/events/"+itoa(opening.ID)+"/token", nil))
	if res, _ := teacher.do("GET", "/api/admin/events/"+itoa(opening.ID)+"/token", nil, nil); res.Header.Get("Cache-Control") != "no-store" {
		t.Error("projector token must not be cached")
	}
	scan := func(code string) scanResp {
		return decode[scanResp](t, student.mustStatus(200, "POST", "/api/scan", map[string]string{"code": code}))
	}
	if r := scan(tok.URL); !r.OK || r.Message != "Checked in to Opening Assembly: Physics Meets CS!" {
		t.Fatalf("%+v", r)
	}
	if r := scan(tok.Token); !r.OK || !strings.HasPrefix(r.Message, "Already checked in") {
		t.Fatalf("%+v", r)
	}
	if r := scan("1.1.forged"); r.OK || !strings.Contains(r.Message, "invalid or expired") {
		t.Fatalf("%+v", r)
	}
	// NFC tag + exhibit tag
	exh := decode[[]struct {
		ID       int64
		Slug     string
		TagToken string
	}](t, teacher.mustStatus(200, "GET", "/api/admin/exhibits", nil))
	if r := scan("https://x.example/c/" + exh[0].TagToken); !r.OK || r.Href != "/exhibits/"+exh[0].Slug {
		t.Fatalf("exhibit scan %+v", r)
	}
	// teacher scans the student's pass for another event
	me := decode[struct {
		ID        int64
		PassToken string
	}](t, student.mustStatus(200, "GET", "/api/me", nil))
	hack := events[1]
	e.now = time.Unix(0, 0).Add(0) // outside every window
	e.now = time.Now()
	r := decode[scanResp](t, teacher.mustStatus(200, "POST", "/api/admin/events/"+itoa(hack.ID)+"/scan-pass", map[string]string{"token": me.PassToken}))
	if r.OK || r.Message != "Closed" { // the hackathon is 3 days away: not open yet
		t.Fatalf("%+v", r)
	}
	// manual add works regardless, CSV and attendee list reflect check-ins
	teacher.mustStatus(204, "POST", "/api/admin/events/"+itoa(hack.ID)+"/attendees", map[string]string{"email": "student@demo.school"})
	detail := decode[struct{ Attendees []app.Attendee }](t, teacher.mustStatus(200, "GET", "/api/admin/events/"+itoa(hack.ID), nil))
	if len(detail.Attendees) != 1 || detail.Attendees[0].Method != "manual" {
		t.Fatalf("%+v", detail)
	}
	if res, body := teacher.do("GET", "/api/admin/events/"+itoa(opening.ID)+"/attendees.csv", nil, nil); res.Header.Get("Content-Type") != "text/csv; charset=utf-8" || !strings.Contains(string(body), `"Demo Student","10A","qr"`) {
		t.Errorf("csv: %s %s", res.Header.Get("Content-Type"), body)
	}

	if hist := decode[[]struct{ Event, Method string }](t, student.mustStatus(200, "GET", "/api/me/checkins", nil)); len(hist) != 2 || hist[0].Event != "Opening Assembly: Physics Meets CS" || hist[0].Method != "qr" {
		t.Fatalf("history %+v", hist)
	}

	// competition: register, teacher records the result, student sees it, names stay private by default
	view := decode[struct {
		CheckedIn    bool
		Competitions []struct {
			ID       int64
			MyStatus *string
		}
	}](t, student.mustStatus(200, "GET", "/api/events/"+itoa(hack.ID), nil))
	if len(view.Competitions) != 1 || view.Competitions[0].MyStatus != nil || !view.CheckedIn {
		t.Fatalf("%+v", view)
	}
	student.mustStatus(204, "POST", "/api/competitions/"+itoa(view.Competitions[0].ID)+"/register", map[string]string{})
	comps := decode[struct {
		Competitions []struct{ Entries []app.Entry }
	}](t, teacher.mustStatus(200, "GET", "/api/admin/competitions", nil))
	entry := comps.Competitions[0].Entries[0]
	teacher.mustStatus(204, "PUT", "/api/admin/entries/"+itoa(entry.ID), map[string]any{"status": "finished", "score": 95, "rank": 1})
	if res, _ := teacher.do("PUT", "/api/admin/entries/"+itoa(entry.ID), map[string]any{"status": "dancing"}, nil); res.StatusCode != 422 {
		t.Errorf("bad status = %d", res.StatusCode)
	}
	board := student.mustStatus(200, "GET", "/api/leaderboard", nil)
	if strings.Contains(string(board), "Demo Student") || !strings.Contains(string(board), "Student, 10A") {
		t.Fatalf("leaderboard must hide the name: %s", board)
	}
	student.mustStatus(200, "PATCH", "/api/me", map[string]bool{"showOnLeaderboard": true})
	if board = student.mustStatus(200, "GET", "/api/leaderboard", nil); !strings.Contains(string(board), "Demo Student") {
		t.Fatalf("opted-in name should show: %s", board)
	}

	// awards: students see nothing until a teacher publishes
	teacher.mustStatus(204, "POST", "/api/admin/awards/run", nil)
	home := decode[struct{ Awards []app.AwardResult }](t, student.mustStatus(200, "GET", "/api/home", nil))
	if len(home.Awards) != 0 {
		t.Fatal("drafts leaked to the student")
	}
	if pub := decode[map[string]int64](t, teacher.mustStatus(200, "POST", "/api/admin/awards/publish", nil)); pub["published"] == 0 {
		t.Fatalf("%v", pub)
	}
	home = decode[struct{ Awards []app.AwardResult }](t, student.mustStatus(200, "GET", "/api/home", nil))
	if len(home.Awards) == 0 || home.Awards[0].Rank != 1 {
		t.Fatalf("%+v", home.Awards)
	}
	_ = me
}

type scanResp struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Href    string `json:"href"`
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestCronAwardsAndHealth(t *testing.T) {
	e, _, _ := seeded(t)
	c := e.client()
	if res, _ := c.do("GET", "/healthz", nil, nil); res.StatusCode != 200 {
		t.Error("healthz")
	}
	if res, _ := c.do("GET", "/readyz", nil, nil); res.StatusCode != 200 {
		t.Error("readyz")
	}
	if res, _ := c.do("POST", "/api/cron/awards", nil, nil); res.StatusCode != 401 {
		t.Errorf("no secret = %d", res.StatusCode)
	}
	if res, _ := c.do("POST", "/api/cron/awards", nil, map[string]string{"Authorization": "Bearer nope"}); res.StatusCode != 401 {
		t.Errorf("wrong secret = %d", res.StatusCode)
	}
	if res, _ := c.do("POST", "/api/cron/awards", nil, map[string]string{"Authorization": "Bearer cron-secret"}); res.StatusCode != 200 {
		t.Errorf("right secret = %d", res.StatusCode)
	}
	e.app.Cfg.CronSecret = ""
	if res, _ := c.do("POST", "/api/cron/awards", nil, map[string]string{"Authorization": "Bearer "}); res.StatusCode != 404 {
		t.Errorf("cron disabled should be 404, got %d", res.StatusCode)
	}
}

func TestSPAFallbackAndMissingAssets(t *testing.T) {
	e := setup(t, "roster")
	c := e.client()
	for _, p := range []string{"/", "/events", "/c/event.1.abc", "/admin/events/3"} {
		res, b := c.do("GET", p, nil, nil)
		if res.StatusCode != 200 || !strings.Contains(string(b), "Spotlight Month") {
			t.Errorf("GET %s = %d", p, res.StatusCode)
		}
	}
	if res, _ := c.do("GET", "/manifest.webmanifest", nil, nil); !strings.HasPrefix(res.Header.Get("Content-Type"), "application/manifest+json") {
		t.Errorf("manifest content type = %q", res.Header.Get("Content-Type"))
	}
	if res, _ := c.do("GET", "/sw.js", nil, nil); !strings.Contains(res.Header.Get("Content-Type"), "javascript") || res.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("sw.js headers: %v", res.Header)
	}
	for _, p := range []string{"/assets/missing.js", "/icon-192.png"} {
		if res, _ := c.do("GET", p, nil, nil); res.StatusCode != 404 {
			t.Errorf("missing file %s = %d, want 404", p, res.StatusCode)
		}
	}
	// real tokens from QR codes and NFC tags (dots, dashes, underscores)
	for _, p := range []string{"/c/7.58234719.Ab-_9xYz", "/c/exhibit.3.Kq0_zZ-9", "/c/pass.12.sig"} {
		if res, b := c.do("GET", p, nil, nil); res.StatusCode != 200 || !strings.Contains(string(b), "Spotlight Month") {
			t.Errorf("check-in link %s = %d", p, res.StatusCode)
		}
	}
	if res, _ := c.do("GET", "/api/nope", nil, nil); res.StatusCode != 404 {
		t.Errorf("unknown API route = %d", res.StatusCode)
	}
	if res, _ := c.do("GET", "/auth/start", nil, nil); res.StatusCode != 404 {
		t.Errorf("/auth/start in roster mode = %d", res.StatusCode)
	}
}

// ---- Microsoft sign-in through the real HTTP handlers ----

type idp struct {
	key *rsa.PrivateKey
	e   *env
}

func entraSetup(t *testing.T) (*env, *idp) {
	e := setup(t, "entra")
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	e.app.Keys = func(*jwt.Token) (any, error) { return &key.PublicKey, nil }
	e.app.Cfg.AdminEmails = []string{"boss@ykpaoschool.cn"}
	return e, &idp{key, e}
}

func (p *idp) token(t *testing.T, nonce, email string, extra jwt.MapClaims) string {
	c := jwt.MapClaims{"iss": "https://login.example/v2.0", "aud": "client-1", "exp": p.e.now.Add(5 * time.Minute).Unix(), "nonce": nonce, "email": email, "name": "Some One"}
	for k, v := range extra {
		c[k] = v
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodRS256, c).SignedString(p.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// start runs /auth/start and returns the nonce+state Microsoft would echo back.
func start(t *testing.T, c *client, next string) (nonce, state string) {
	res, _ := c.do("GET", "/auth/start?next="+url.QueryEscape(next), nil, nil)
	if res.StatusCode != 302 {
		t.Fatalf("start = %d", res.StatusCode)
	}
	u, _ := url.Parse(res.Header.Get("Location"))
	q := u.Query()
	if u.Host != "login.example" || q.Get("client_id") != "client-1" || q.Get("response_mode") != "form_post" || q.Get("response_type") != "id_token" || !strings.HasSuffix(q.Get("redirect_uri"), "/auth") {
		t.Fatalf("bad authorize url %s", u)
	}
	var ck *http.Cookie
	for _, k := range res.Cookies() {
		if k.Name == "oidc_nonce" {
			ck = k
		}
	}
	if ck == nil || ck.Value != q.Get("nonce") || !ck.HttpOnly || !ck.Secure || ck.SameSite != http.SameSiteNoneMode {
		t.Fatalf("nonce cookie %+v", ck)
	}
	return q.Get("nonce"), q.Get("state")
}

func (c *client) post(path string, form url.Values) (*http.Response, string) {
	req, _ := http.NewRequest("POST", c.e.base+path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Microsoft's post comes from another site; the browser still sends our cookies (nonce is SameSite=None)
	req.Header.Set("Origin", "https://login.microsoftonline.com")
	res, err := c.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func TestMicrosoftSignIn(t *testing.T) {
	e, p := entraSetup(t)
	jar := func(c *client) { // the nonce cookie is Secure; the test server is plain http, so copy it by hand
	}
	_ = jar

	type tc struct {
		name, email string
		extra       jwt.MapClaims
		badNonce    bool
		wantError   string
		wantRole    string
	}
	for _, c := range []tc{
		{name: "student", email: "kid@stu.ykpaoschool.cn", wantRole: "student"},
		{name: "teacher", email: "ms@ykpaoschool.cn", wantRole: "teacher"},
		{name: "admin by ADMIN_EMAILS", email: "boss@ykpaoschool.cn", wantRole: "admin"},
		{name: "outsider", email: "x@gmail.com", wantError: "domain"},
		{name: "token for another app", email: "kid@stu.ykpaoschool.cn", extra: jwt.MapClaims{"aud": "someone-else"}, wantError: "token"},
		{name: "wrong nonce inside the token", email: "kid@stu.ykpaoschool.cn", extra: jwt.MapClaims{"nonce": "other"}, wantError: "nonce"},
		{name: "state/cookie mismatch", email: "kid@stu.ykpaoschool.cn", badNonce: true, wantError: "expired"},
	} {
		t.Run(c.name, func(t *testing.T) {
			cl := e.client()
			nonce, state := start(t, cl, "/events")
			// give the client the nonce cookie (cookiejar drops Secure cookies on http)
			u, _ := url.Parse(e.base)
			jarCookie := &http.Cookie{Name: "oidc_nonce", Value: nonce, Path: "/"}
			if c.badNonce {
				jarCookie.Value = "different"
			}
			cl.Jar.SetCookies(u, []*http.Cookie{jarCookie})
			res, _ := cl.post("/auth", url.Values{"id_token": {p.token(t, nonce, c.email, c.extra)}, "state": {state}})
			loc := res.Header.Get("Location")
			if res.StatusCode != 303 {
				t.Fatalf("callback = %d", res.StatusCode)
			}
			if c.wantError != "" {
				if !strings.HasSuffix(loc, "/login?error="+c.wantError) {
					t.Fatalf("redirect %q, want error %s", loc, c.wantError)
				}
				if res2, _ := cl.do("GET", "/api/me", nil, nil); res2.StatusCode != 401 {
					t.Fatalf("a refused sign-in must not create a session (%d)", res2.StatusCode)
				}
				return
			}
			if !strings.HasSuffix(loc, "/events") {
				t.Fatalf("redirect %q should return to /events", loc)
			}
			me := decode[struct{ Role, Email string }](t, cl.mustStatus(200, "GET", "/api/me", nil))
			if me.Role != c.wantRole || me.Email != c.email {
				t.Fatalf("%+v", me)
			}
		})
	}

	t.Run("codes are refused and the roster is off in Microsoft mode", func(t *testing.T) {
		cl := e.client()
		if res, _ := cl.do("POST", "/api/auth/login", map[string]string{"email": "a@b", "code": "x"}, nil); res.StatusCode != 403 {
			t.Errorf("code login = %d, want 403", res.StatusCode)
		}
		if cfg := decode[map[string]string](t, cl.mustStatus(200, "GET", "/api/auth/config", nil)); cfg["mode"] != "entra" {
			t.Errorf("%v", cfg)
		}
	})

	t.Run("an open redirect in next is neutralised", func(t *testing.T) {
		for _, bad := range []string{"//evil.example", "https://evil.example", `/\evil.example`} {
			cl := e.client()
			nonce, state := start(t, cl, bad)
			u, _ := url.Parse(e.base)
			cl.Jar.SetCookies(u, []*http.Cookie{{Name: "oidc_nonce", Value: nonce, Path: "/"}})
			res, _ := cl.post("/auth", url.Values{"id_token": {p.token(t, nonce, "kid@stu.ykpaoschool.cn", nil)}, "state": {state}})
			if loc := res.Header.Get("Location"); loc != e.base+"/" {
				t.Errorf("next=%q redirected to %q", bad, loc)
			}
		}
	})

	t.Run("a replayed token without its nonce cookie is refused", func(t *testing.T) {
		cl := e.client()
		state := "abc." + base64.RawURLEncoding.EncodeToString([]byte("/events"))
		res, _ := cl.post("/auth", url.Values{"id_token": {p.token(t, "abc", "kid@stu.ykpaoschool.cn", nil)}, "state": {state}})
		if !strings.HasSuffix(res.Header.Get("Location"), "/login?error=expired") {
			t.Errorf("%q", res.Header.Get("Location"))
		}
	})

	t.Run("Microsoft reporting an error", func(t *testing.T) {
		res, _ := e.client().post("/auth", url.Values{"error": {"access_denied"}})
		if !strings.HasSuffix(res.Header.Get("Location"), "/login?error=external") {
			t.Errorf("%q", res.Header.Get("Location"))
		}
	})
}
