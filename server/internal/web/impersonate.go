package web

import (
	"net/http"
	"slices"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/auth"
)

// "View as a student" lets one named admin test the app as another student would see it.
//
//   - It exists only for admins whose email is listed in IMPERSONATE_EMAILS (empty list = the feature is off, and its
//     endpoints answer 404 as if they did not exist).
//   - Only students can be viewed, never teachers or admins.
//   - The admin's own identity is kept in a second signed cookie, so one press of "Exit" restores it. That cookie is
//     signed with a different key than a normal session, so a session cookie cannot be passed off as one.
//   - The student session lasts one hour, not 45 days. Starting and stopping are written to the audit log.
//   - While viewing, everything the admin does is done as that student (that is the point: to test check-in, sign-up and so
//     on), except changing the student's privacy setting. Use a test student on the real server.
const (
	actorCookie      = "actor"
	impersonationTTL = 3600
)

func (s *Server) actorSecret() string { return s.app.Cfg.Secret + "/actor" }

// mayImpersonate says whether u is an admin on the allow-list.
func (s *Server) mayImpersonate(u app.User) bool {
	return u.Role == "admin" && slices.Contains(s.app.Cfg.ImpersonateEmails, u.Email)
}

// actor returns the admin behind a "view as" session, or false if this is an ordinary session. It re-checks the
// allow-list and role every time, so removing someone from IMPERSONATE_EMAILS ends it immediately.
func (s *Server) actor(r *http.Request) (app.User, bool) {
	c, err := r.Cookie(actorCookie)
	if err != nil {
		return app.User{}, false
	}
	id, ok := auth.ReadSession(s.actorSecret(), c.Value, s.app.Now().UnixMilli())
	if !ok {
		return app.User{}, false
	}
	u, err := s.app.UserByID(r.Context(), id)
	if err != nil || !s.mayImpersonate(u) {
		return app.User{}, false
	}
	return u, true
}

func (s *Server) setActor(w http.ResponseWriter, adminID int64) {
	http.SetCookie(w, &http.Cookie{
		Name: actorCookie, Value: auth.CreateSessionFor(s.actorSecret(), adminID, s.app.Now().UnixMilli(), impersonationTTL),
		Path: "/", MaxAge: impersonationTTL, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.app.Cfg.Secure(),
	})
}

func (s *Server) clearActor(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: actorCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.app.Cfg.Secure()})
}

// startImpersonation: POST /api/admin/impersonate {"userId": 5}
func (s *Server) startImpersonation(w http.ResponseWriter, r *http.Request, u app.User) {
	if !s.mayImpersonate(u) {
		http.NotFound(w, r) // not on the list: the feature does not exist for this person
		return
	}
	var in struct {
		UserID int64 `json:"userId"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	target, err := s.app.UserByID(r.Context(), in.UserID)
	if err != nil || target.Role != "student" {
		s.appError(w, r, app.ErrInvalid)
		return
	}
	if err := s.app.AuditImpersonation(r.Context(), u.ID, target.ID, true); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.setActor(w, u.ID)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: auth.CreateSessionFor(s.app.Cfg.Secret, target.ID, s.app.Now().UnixMilli(), impersonationTTL),
		Path: "/", MaxAge: impersonationTTL, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.app.Cfg.Secure(),
	})
	writeJSON(w, http.StatusOK, target)
}

// stopImpersonation: POST /api/impersonate/stop. Works from the student session, because that is where the admin is.
func (s *Server) stopImpersonation(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.actor(r)
	if !ok {
		s.clearActor(w) // a stale or invalid leftover
		fail(w, http.StatusConflict, "not_impersonating", "you are not viewing as a student")
		return
	}
	if cur, ok := s.current(r); ok {
		_ = s.app.AuditImpersonation(r.Context(), admin.ID, cur.ID, false)
	}
	s.clearActor(w)
	s.setSession(w, admin.ID) // back to a normal 45-day session as themselves
	writeJSON(w, http.StatusOK, admin)
}
