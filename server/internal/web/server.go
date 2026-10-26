// Package web is the HTTP layer: JSON API under /api, the Microsoft sign-in redirect, and the embedded SPA.
package web

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/kenny-21342/events-tracker/server/internal/app"
	"github.com/kenny-21342/events-tracker/server/internal/auth"
)

var staticExt = map[string]bool{".js": true, ".mjs": true, ".css": true, ".map": true, ".png": true, ".jpg": true, ".jpeg": true, ".svg": true,
	".ico": true, ".webp": true, ".woff": true, ".woff2": true, ".json": true, ".webmanifest": true, ".txt": true, ".xml": true}

const (
	sessionCookie = "session"
	nonceCookie   = "oidc_nonce"
)

type Server struct {
	app    *app.App
	log    *slog.Logger
	ui     fs.FS
	logins *limiter
}

type ctxKey struct{}

func New(a *app.App, log *slog.Logger, ui fs.FS) http.Handler {
	s := &Server{app: a, log: log, ui: ui, logins: newLimiter(5, 10*time.Minute)}
	mux := http.NewServeMux()
	s.routes(mux)
	return s.recoverer(s.securityHeaders(s.sameOrigin(mux)))
}

func (s *Server) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /readyz", s.ready)

	// sign-in
	mux.HandleFunc("GET /api/auth/config", s.authConfig)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /auth/start", s.oidcStart)
	mux.HandleFunc("POST /auth", s.oidcCallback)

	// any signed-in user
	mux.HandleFunc("GET /api/me", s.user(s.me))
	mux.HandleFunc("PATCH /api/me", s.user(s.updateMe))
	mux.HandleFunc("GET /api/me/checkins", s.user(s.myCheckins))
	mux.HandleFunc("GET /api/home", s.user(s.home))
	mux.HandleFunc("GET /api/events", s.user(s.events))
	mux.HandleFunc("GET /api/events/{id}", s.user(s.event))
	mux.HandleFunc("POST /api/competitions/{id}/register", s.user(s.register))
	mux.HandleFunc("GET /api/exhibits", s.user(s.exhibits))
	mux.HandleFunc("GET /api/exhibits/{slug}", s.user(s.exhibit))
	mux.HandleFunc("PUT /api/vote", s.user(s.vote))
	mux.HandleFunc("POST /api/scan", s.user(s.scan))
	mux.HandleFunc("GET /api/leaderboard", s.user(s.leaderboard))

	// teachers and admins
	mux.HandleFunc("GET /api/admin/stats", s.staff(s.adminStats))
	mux.HandleFunc("GET /api/admin/events", s.staff(s.adminEvents))
	mux.HandleFunc("POST /api/admin/events", s.staff(s.adminCreateEvent))
	mux.HandleFunc("GET /api/admin/events/{id}", s.staff(s.adminEvent))
	mux.HandleFunc("PUT /api/admin/events/{id}", s.staff(s.adminUpdateEvent))
	mux.HandleFunc("DELETE /api/admin/events/{id}", s.staff(s.adminDeleteEvent))
	mux.HandleFunc("POST /api/admin/events/{id}/attendees", s.staff(s.adminAddAttendee))
	mux.HandleFunc("DELETE /api/admin/events/{id}/attendees/{userId}", s.staff(s.adminUndoAttendee))
	mux.HandleFunc("GET /api/admin/events/{id}/attendees.csv", s.staff(s.adminAttendeesCSV))
	mux.HandleFunc("POST /api/admin/events/{id}/scan-pass", s.staff(s.adminScanPass))
	mux.HandleFunc("GET /api/admin/events/{id}/token", s.staff(s.adminEventToken))
	mux.HandleFunc("GET /api/admin/exhibits", s.staff(s.adminExhibits))
	mux.HandleFunc("POST /api/admin/exhibits", s.staff(s.adminSaveExhibit))
	mux.HandleFunc("GET /api/admin/competitions", s.staff(s.adminCompetitions))
	mux.HandleFunc("POST /api/admin/competitions", s.staff(s.adminCreateCompetition))
	mux.HandleFunc("PUT /api/admin/entries/{id}", s.staff(s.adminUpdateEntry))
	mux.HandleFunc("GET /api/admin/awards", s.staff(s.adminAwards))
	mux.HandleFunc("POST /api/admin/awards/judge-score", s.staff(s.adminJudgeScore))
	mux.HandleFunc("POST /api/admin/awards/run", s.staff(s.adminRunAwards))
	mux.HandleFunc("POST /api/admin/awards/veto", s.staff(s.adminVeto))
	mux.HandleFunc("POST /api/admin/awards/publish", s.staff(s.adminPublish))
	mux.HandleFunc("POST /api/admin/roster", s.staff(s.adminRoster))
	mux.HandleFunc("POST /api/admin/users/role", s.admin(s.adminSetRole))

	// optional external scheduler (the server also runs the daily job itself)
	mux.HandleFunc("POST /api/cron/awards", s.cronAwards)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, http.StatusNotFound, "not_found", "not found") })
	mux.HandleFunc("/", s.serveUI)
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.app.DB.Read.PingContext(ctx); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ready\n"))
}

// ---- middleware ----

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", slog.Any("value", v), slog.String("path", r.URL.Path))
				fail(w, http.StatusInternalServerError, "internal", "something went wrong")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; "+
			"connect-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if s.app.Cfg.Secure() {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// sameOrigin refuses state-changing requests that come from another website. Browsers send Origin (or at least
// Sec-Fetch-Site) on such requests; scripts and tests that send neither are not a browser-based forgery risk.
// /auth is exempt because Microsoft legitimately posts to it from another site (it is protected by the nonce).
func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.URL.Path != "/auth" {
				if o := r.Header.Get("Origin"); o != "" {
					if o != s.app.Cfg.PublicURL {
						fail(w, http.StatusForbidden, "cross_origin", "cross-site request refused")
						return
					}
				} else if sfs := r.Header.Get("Sec-Fetch-Site"); sfs != "" && sfs != "same-origin" && sfs != "none" {
					fail(w, http.StatusForbidden, "cross_origin", "cross-site request refused")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

type userHandler func(http.ResponseWriter, *http.Request, app.User)

// current finds the signed-in user from the session cookie.
func (s *Server) current(r *http.Request) (app.User, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return app.User{}, false
	}
	id, ok := auth.ReadSession(s.app.Cfg.Secret, c.Value, s.app.Now().UnixMilli())
	if !ok {
		return app.User{}, false
	}
	u, err := s.app.UserByID(r.Context(), id)
	return u, err == nil
}

func (s *Server) user(h userHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.current(r)
		if !ok {
			fail(w, http.StatusUnauthorized, "unauthorized", "please sign in")
			return
		}
		h(w, r, u)
	}
}

func (s *Server) staff(h userHandler) http.HandlerFunc {
	return s.user(func(w http.ResponseWriter, r *http.Request, u app.User) {
		if !u.IsStaff() {
			fail(w, http.StatusForbidden, "forbidden", "teachers only")
			return
		}
		h(w, r, u)
	})
}

func (s *Server) admin(h userHandler) http.HandlerFunc {
	return s.user(func(w http.ResponseWriter, r *http.Request, u app.User) {
		if u.Role != "admin" {
			fail(w, http.StatusForbidden, "forbidden", "admins only")
			return
		}
		h(w, r, u)
	})
}

// ---- the SPA ----

// serveUI serves the built React app: real files as they are, any other path falls back to index.html so
// client-side routes (/events, /c/<token>, ...) survive a reload.
func (s *Server) serveUI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	f, err := s.ui.Open(name)
	if err == nil {
		st, serr := f.Stat()
		f.Close()
		if serr != nil || st.IsDir() {
			err = fs.ErrNotExist
		}
	}
	if err != nil {
		// A missing static file is a 404, not the app shell. Only real file types count: check-in links such as
		// /c/event.12.Xy3 contain dots too and must reach the app.
		if strings.HasPrefix(name, "assets/") || staticExt[strings.ToLower(path.Ext(name))] {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
	}
	h := w.Header()
	switch {
	case strings.HasPrefix(name, "assets/"):
		h.Set("Cache-Control", "public, max-age=31536000, immutable") // hashed file names
	case name == "sw.js":
		h.Set("Cache-Control", "no-cache")
		h.Set("Service-Worker-Allowed", "/")
	default:
		h.Set("Cache-Control", "no-cache")
	}
	http.ServeFileFS(w, r, s.ui, name)
}
