package web

import (
	"crypto/rand"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/kenny-21342/events-tracker/server/internal/app"
	"github.com/kenny-21342/events-tracker/server/internal/auth"
	"github.com/kenny-21342/events-tracker/server/internal/token"
)

func (s *Server) setSession(w http.ResponseWriter, userID int64) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: auth.CreateSession(s.app.Cfg.Secret, userID, s.app.Now().UnixMilli()),
		Path: "/", MaxAge: auth.SessionDays * 86400, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.app.Cfg.Secure(),
	})
}

func (s *Server) authConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"mode": s.app.Cfg.AuthMode})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if s.app.Cfg.AuthMode != "roster" {
		fail(w, http.StatusForbidden, "use_microsoft", "please sign in with Microsoft")
		return
	}
	var in struct{ Email, Code string }
	if !readJSON(w, r, &in) {
		return
	}
	key := strings.ToLower(strings.TrimSpace(in.Email))
	now := s.app.Now()
	if s.logins.blocked(key, now) {
		fail(w, http.StatusTooManyRequests, "too_many_attempts", "Too many attempts. Try again in 10 minutes or ask your teacher.")
		return
	}
	u, ok := s.app.LoginWithCode(r.Context(), key, in.Code)
	if !ok {
		s.logins.fail(key, now)
		fail(w, http.StatusUnauthorized, "bad_login", "Email or code not recognised.")
		return
	}
	s.logins.clear(key)
	s.setSession(w, u.ID)
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.app.Cfg.Secure()})
	w.WriteHeader(http.StatusNoContent)
}

// ---- Microsoft sign-in ----

func (s *Server) oidcStart(w http.ResponseWriter, r *http.Request) {
	if s.app.Cfg.AuthMode != "entra" {
		http.NotFound(w, r)
		return
	}
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		s.serverError(w, r, err)
		return
	}
	nonce := base64.RawURLEncoding.EncodeToString(b)
	next := cleanPath(r.URL.Query().Get("next"))
	// state = nonce.next; the nonce is checked against the cookie AND against the signed token on the way back.
	state := nonce + "." + base64.RawURLEncoding.EncodeToString([]byte(next))
	target, err := s.app.AuthorizeURL(s.app.Cfg.PublicURL+"/auth", nonce, state)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	// SameSite=None: Microsoft posts back from another site, and Lax cookies aren't sent on cross-site POSTs.
	http.SetCookie(w, &http.Cookie{Name: nonceCookie, Value: nonce, Path: "/", MaxAge: 600, HttpOnly: true, Secure: true, SameSite: http.SameSiteNoneMode})
	http.Redirect(w, r, target, http.StatusFound)
}

func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if s.app.Cfg.AuthMode != "entra" {
		http.NotFound(w, r)
		return
	}
	back := func(code string) {
		http.SetCookie(w, &http.Cookie{Name: nonceCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteNoneMode})
		http.Redirect(w, r, s.app.Cfg.PublicURL+"/login?error="+url.QueryEscape(code), http.StatusSeeOther)
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10) // an ID token form is a few KB
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.PostForm.Get("error") != "" {
		back("external")
		return
	}
	nonce, nextB64, _ := strings.Cut(r.PostForm.Get("state"), ".")
	c, err := r.Cookie(nonceCookie)
	if nonce == "" || err != nil || c.Value != nonce {
		back("expired")
		return
	}
	who, err := s.app.VerifyIDToken(r.Context(), r.PostForm.Get("id_token"), nonce)
	if err != nil {
		s.refuse(w, r, err, back)
		return
	}
	u, err := s.app.Provision(r.Context(), who)
	if err != nil {
		s.refuse(w, r, err, back)
		return
	}
	next := "/"
	if raw, err := base64.RawURLEncoding.DecodeString(nextB64); err == nil {
		next = cleanPath(string(raw))
	}
	s.setSession(w, u.ID)
	http.SetCookie(w, &http.Cookie{Name: nonceCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteNoneMode})
	http.Redirect(w, r, s.app.Cfg.PublicURL+next, http.StatusSeeOther)
}

func (s *Server) refuse(w http.ResponseWriter, r *http.Request, err error, back func(string)) {
	if oe, ok := err.(*app.OIDCError); ok {
		s.log.Warn("sign-in refused", slog.String("code", oe.Code), slog.String("detail", oe.Detail))
		back(oe.Code)
		return
	}
	s.serverError(w, r, err)
}

// ---- who am I ----

type meResponse struct {
	app.User
	PassToken string `json:"passToken"`
}

func (s *Server) me(w http.ResponseWriter, r *http.Request, u app.User) {
	writeJSON(w, http.StatusOK, meResponse{u, token.MakePass(s.app.Cfg.Secret, u.ID)})
}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		ShowOnLeaderboard *bool `json:"showOnLeaderboard"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.ShowOnLeaderboard != nil {
		if err := s.app.SetShowOnLeaderboard(r.Context(), u.ID, *in.ShowOnLeaderboard); err != nil {
			s.serverError(w, r, err)
			return
		}
		u.ShowOnLeaderboard = *in.ShowOnLeaderboard
	}
	writeJSON(w, http.StatusOK, u)
}
