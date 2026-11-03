package web

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/auth"
)

type meView struct {
	ID             int64
	Name, Role     string
	ViewingAs      string
	CanImpersonate bool
}

func TestViewAsStudentIsOffUnlessListed(t *testing.T) {
	e, teacher, student := seeded(t)
	// make the demo teacher an admin, but do not list them: the feature does not exist for them
	e.app.DB.Write.Exec(`UPDATE users SET role = 'admin' WHERE email = 'teacher@demo.school'`)
	admin := e.client()
	admin.login("teacher@demo.school", "DEMOCODE")
	_ = teacher
	sid := decode[meView](t, student.mustStatus(200, "GET", "/api/me", nil)).ID

	admin.mustStatus(404, "POST", "/api/admin/impersonate", map[string]any{"userId": sid})
	if m := decode[meView](t, admin.mustStatus(200, "GET", "/api/me", nil)); m.CanImpersonate {
		t.Fatalf("not on the list, yet told they can: %+v", m)
	}
	student.mustStatus(403, "POST", "/api/admin/impersonate", map[string]any{"userId": sid})
}

func TestViewAsStudentLifecycle(t *testing.T) {
	e, _, student := seeded(t)
	e.app.DB.Write.Exec(`UPDATE users SET role = 'admin' WHERE email = 'teacher@demo.school'`)
	e.app.Cfg.ImpersonateEmails = []string{"teacher@demo.school"}
	admin := e.client()
	admin.login("teacher@demo.school", "DEMOCODE")
	sid := decode[meView](t, student.mustStatus(200, "GET", "/api/me", nil)).ID
	adminMe := decode[meView](t, admin.mustStatus(200, "GET", "/api/me", nil))
	if !adminMe.CanImpersonate || adminMe.ViewingAs != "" {
		t.Fatalf("a listed admin can start: %+v", adminMe)
	}

	// only students can be viewed
	admin.mustStatus(422, "POST", "/api/admin/impersonate", map[string]any{"userId": adminMe.ID})
	admin.mustStatus(422, "POST", "/api/admin/impersonate", map[string]any{"userId": 99999})

	// start: the admin now sees the app as that student
	admin.mustStatus(200, "POST", "/api/admin/impersonate", map[string]any{"userId": sid})
	m := decode[meView](t, admin.mustStatus(200, "GET", "/api/me", nil))
	if m.ID != sid || m.Role != "student" || m.ViewingAs != adminMe.Name || m.CanImpersonate {
		t.Fatalf("viewing as the student: %+v", m)
	}
	admin.mustStatus(200, "GET", "/api/home", nil)        // student pages work
	admin.mustStatus(403, "GET", "/api/admin/stats", nil) // and the admin powers are not available meanwhile
	admin.mustStatus(403, "POST", "/api/admin/impersonate", map[string]any{"userId": sid})
	admin.mustStatus(409, "PATCH", "/api/me", map[string]bool{"showOnLeaderboard": true}) // a student's privacy choice is theirs

	// stop: back to the admin, normal powers, and stopping twice is refused
	admin.mustStatus(200, "POST", "/api/impersonate/stop", nil)
	m = decode[meView](t, admin.mustStatus(200, "GET", "/api/me", nil))
	if m.ID != adminMe.ID || m.ViewingAs != "" || m.Role != "admin" {
		t.Fatalf("after stopping: %+v", m)
	}
	admin.mustStatus(200, "GET", "/api/admin/stats", nil)
	admin.mustStatus(409, "POST", "/api/impersonate/stop", nil)

	// both ends are in the audit log, attributed to the admin
	var starts, stops int
	e.app.DB.Read.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE action = 'impersonate.start' AND actor_id = ?`, adminMe.ID).Scan(&starts)
	e.app.DB.Read.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE action = 'impersonate.stop' AND actor_id = ?`, adminMe.ID).Scan(&stops)
	if starts != 1 || stops != 1 {
		t.Fatalf("audit: %d starts, %d stops", starts, stops)
	}
}

func TestViewAsStudentCannotBeForgedOrOutliveItsPermission(t *testing.T) {
	e, _, student := seeded(t)
	e.app.DB.Write.Exec(`UPDATE users SET role = 'admin' WHERE email = 'teacher@demo.school'`)
	e.app.Cfg.ImpersonateEmails = []string{"teacher@demo.school"}
	admin := e.client()
	admin.login("teacher@demo.school", "DEMOCODE")
	adminID := decode[meView](t, admin.mustStatus(200, "GET", "/api/me", nil)).ID
	sid := decode[meView](t, student.mustStatus(200, "GET", "/api/me", nil)).ID
	now := time.Now().UnixMilli()

	// a student who somehow holds an admin's ordinary session cannot use it as the "actor" cookie: it is signed with another key
	forger := e.client()
	cookie := fmt.Sprintf("session=%s; actor=%s", auth.CreateSession(secret, sid, now), auth.CreateSession(secret, adminID, now))
	res, _ := forger.do("POST", "/api/impersonate/stop", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != 409 {
		t.Fatalf("a forged actor cookie must not restore an admin session: %d", res.StatusCode)
	}
	_, body := forger.do("GET", "/api/me", nil, map[string]string{"Cookie": cookie})
	if strings.Contains(string(body), "viewingAs") {
		t.Fatalf("a forged actor cookie must not look like impersonation: %s", body)
	}

	// removing the admin from the list ends the view at once: they can no longer step back as an admin through it
	admin.mustStatus(200, "POST", "/api/admin/impersonate", map[string]any{"userId": sid})
	e.app.Cfg.ImpersonateEmails = nil
	if m := decode[meView](t, admin.mustStatus(200, "GET", "/api/me", nil)); m.ViewingAs != "" {
		t.Fatalf("no longer allowed, still shown as impersonating: %+v", m)
	}
	admin.mustStatus(409, "POST", "/api/impersonate/stop", nil)

	// signing out clears both cookies
	e.app.Cfg.ImpersonateEmails = []string{"teacher@demo.school"}
	admin2 := e.client()
	admin2.login("teacher@demo.school", "DEMOCODE")
	admin2.mustStatus(200, "POST", "/api/admin/impersonate", map[string]any{"userId": sid})
	admin2.mustStatus(204, "POST", "/api/auth/logout", nil)
	admin2.mustStatus(401, "GET", "/api/me", nil)
	admin2.mustStatus(409, "POST", "/api/impersonate/stop", nil)
}

func TestClosedCheckinSaysWhy(t *testing.T) {
	e, teacher, student := seeded(t)
	mk := func(title string, startIn time.Duration) int64 {
		st := e.now.Add(startIn).UTC()
		ev := decode[struct{ ID int64 }](t, teacher.mustStatus(201, "POST", "/api/admin/events", map[string]any{
			"title": title, "subject": "cs", "startsAt": st.Format(time.RFC3339), "endsAt": st.Add(time.Hour).Format(time.RFC3339)}))
		return ev.ID
	}
	early, late := mk("Next week", 7*24*time.Hour), mk("Long ago", -48*time.Hour)
	type scan struct {
		OK                              bool
		Message, Reason, Event, OpensAt string
	}
	for id, want := range map[int64]string{early: "early", late: "late"} {
		tag := decode[struct{ TagURL string }](t, teacher.mustStatus(200, "GET", "/api/admin/events/"+itoa(id), nil)).TagURL
		got := decode[scan](t, student.mustStatus(200, "POST", "/api/scan", map[string]string{"code": tag}))
		if got.OK || got.Reason != want || got.Event == "" || got.OpensAt == "" || strings.Contains(got.Message, "isn't open for this event") {
			t.Errorf("%s: %+v", want, got)
		}
	}
}
