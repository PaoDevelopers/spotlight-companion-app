package preview

import (
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// The function must start from environment settings alone, seed the demo, and serve the API and a SPA fallback.
func TestHandlerStartsFromEnvironmentAndServesDemo(t *testing.T) {
	t.Setenv("PUBLIC_URL", "https://preview.example")
	t.Setenv("CHECKIN_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DB_PATH", filepath.Join(t.TempDir(), "p.db"))
	t.Setenv("DEMO_SEED", "1")
	t.Setenv("DEMO_LOGIN_CODE", "PREVIEWX")

	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		Handle(rec, httptest.NewRequest("GET", path, nil))
		return rec
	}
	if rec := get("/healthz"); rec.Code != 200 {
		t.Fatalf("healthz = %d %s", rec.Code, rec.Body)
	}
	if rec := get("/api/auth/config"); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"roster"`) {
		t.Fatalf("config = %d %s", rec.Code, rec.Body)
	}
	login := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email":"student@demo.school","code":"previewx"}`))
	req.Header.Set("Content-Type", "application/json")
	Handle(login, req)
	if login.Code != 200 {
		t.Fatalf("demo login = %d %s", login.Code, login.Body)
	}
	if got := login.Result().Cookies(); len(got) == 0 || got[0].Name != "session" {
		t.Fatalf("no session cookie: %v", got)
	}
}
