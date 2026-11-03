package app

import (
	"errors"
	"testing"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

// All names and addresses are invented.
const studentDomain = "@stu.ykpaoschool.cn"

func countRows(t *testing.T, a *App, q string, args ...any) int {
	t.Helper()
	var n int
	if err := a.DB.Read.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// give a student a record of everything: check-in, sign-up, competition entry, exhibit visit, award
func fillHistory(t *testing.T, a *App, uid int64, e Event, comp Competition, ex Exhibit) {
	t.Helper()
	if _, err := a.ManualCheckInID(ctx, e.ID, uid); err != nil {
		t.Fatal(err)
	}
	if err := a.SignUp(ctx, e.ID, uid, true); err != nil {
		t.Fatal(err)
	}
	if err := a.Register(ctx, comp.ID, uid, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := a.VisitExhibit(ctx, uid, token.MakeTag(secret, token.KindExhibit, ex.ID)); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DB.Write.Exec(`INSERT INTO student_awards (title, user_id, reason, published) VALUES ('Best', ?, 'why', 1)`, uid); err != nil {
		t.Fatal(err)
	}
}

func setupHistory(t *testing.T, a *App) (Event, Competition, Exhibit) {
	e, comp := mkCompetitionEvent(t, a, "Quiz", KindIndividual)
	ex, err := a.CreateExhibit(ctx, ExhibitInput{Title: "Pendulum", Subject: "physics"})
	if err != nil {
		t.Fatal(err)
	}
	return e, comp, ex
}

// The loaded record becomes the signed-in account: Microsoft's name replaces the loaded one, nothing recorded is lost.
func TestSignInTakesOverTheLoadedRecord(t *testing.T) {
	a := newApp(t)
	e, comp, ex := setupHistory(t, a)
	if _, err := a.ImportStudents(ctx, []StudentRecord{{ID: "s90001", Name: DisplayName("Wong (Mei Ling 黄美玲) Amy"), Class: "11B"}}, false); err != nil {
		t.Fatal(err)
	}
	rec, _ := a.UserByEmail(ctx, "s90001"+studentDomain)
	fillHistory(t, a, rec.ID, e, comp, ex)
	before := countRows(t, a, `SELECT COUNT(*) FROM users`)

	u, err := a.Provision(ctx, Identity{Email: "s90001" + studentDomain, Name: "Amy Wong 黄美玲"})
	if err != nil || u.ID != rec.ID || u.Name != "Amy Wong 黄美玲" || u.ClassName != "11B" || u.Role != "student" {
		t.Fatalf("the record must become the account, with the new name and the old class: %+v %v", u, err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM users`) != before {
		t.Fatal("signing in must not create a second account")
	}
	for table, want := range map[string]int{"checkins": 1, "event_signups": 1, "competition_entries": 1, "exhibit_visits": 1, "student_awards": 1} {
		if got := countRows(t, a, `SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, u.ID); got != want {
			t.Errorf("%s: %d rows kept, want %d", table, got, want)
		}
	}
}

// Microsoft can send the person's list address in one claim and another address in the other. Both lead to the one record.
func TestSecondAddressInTheTokenFindsTheSameAccount(t *testing.T) {
	a := newApp(t)
	e, comp, ex := setupHistory(t, a)
	a.ImportStudents(ctx, []StudentRecord{{ID: "s90002", Name: "Chan Tai Man 陳大文 (Ben)", Class: "12A"}}, false)
	rec, _ := a.UserByEmail(ctx, "s90002"+studentDomain)
	fillHistory(t, a, rec.ID, e, comp, ex)

	// the sign-in name is a different address; the list address arrives as the mail address
	who := Identity{Email: "ben.chan" + studentDomain, Name: "Ben Chan 陳大文", Others: []string{"s90002" + studentDomain}}
	u, err := a.Provision(ctx, who)
	if err != nil || u.ID != rec.ID || u.Name != "Ben Chan 陳大文" || u.Email != "s90002"+studentDomain {
		t.Fatalf("the loaded record must be found through the other address: %+v %v", u, err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM users WHERE role = 'student'`) != 1 {
		t.Fatal("a duplicate account was created")
	}
	// the address they actually sign in with is remembered, so it works on its own next time
	u2, err := a.Provision(ctx, Identity{Email: "ben.chan" + studentDomain, Name: "Ben Chan 陳大文"})
	if err != nil || u2.ID != rec.ID {
		t.Fatalf("next sign-in with only that address: %+v %v", u2, err)
	}
	if byAlias, err := a.UserByEmail(ctx, "ben.chan"+studentDomain); err != nil || byAlias.ID != rec.ID {
		t.Fatalf("teachers entering that address find the same student: %+v %v", byAlias, err)
	}
	// loading the school list again must not bring the old record back as a second person
	rep, err := a.ImportStudents(ctx, []StudentRecord{{ID: "s90002", Name: "Chan (Tai Man 陳大文) Ben"}, {ID: "ben.chan", Name: "Ben Chan"}}, false)
	if err != nil || rep.Added != 0 || rep.Existing != 2 {
		t.Fatalf("re-import: %+v %v", rep, err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM users WHERE role = 'student'`) != 1 {
		t.Fatal("re-importing recreated a duplicate")
	}
}

// If both addresses already have an account (the record, and one made by an earlier sign-in), signing in joins them.
func TestSignInMergesTwoExistingAccounts(t *testing.T) {
	a := newApp(t)
	e1, comp, ex := setupHistory(t, a)
	e2, err := a.CreateEvent(ctx, EventInput{Title: "Talk", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	a.ImportStudents(ctx, []StudentRecord{{ID: "s90003", Name: "Loaded Name", Class: "10C"}}, false)
	old, _ := a.UserByEmail(ctx, "s90003"+studentDomain)
	fillHistory(t, a, old.ID, e1, comp, ex) // history on the loaded record

	// an earlier sign-in made a second account under the other address, with its own history
	first, err := a.Provision(ctx, Identity{Email: "kim.lee" + studentDomain, Name: "Kim Lee"})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == old.ID {
		t.Fatal("test set-up: these should start as two accounts")
	}
	a.ManualCheckInID(ctx, e1.ID, first.ID) // the same check-in on both: must not be doubled
	a.ManualCheckInID(ctx, e2.ID, first.ID) // and one only here

	u, err := a.Provision(ctx, Identity{Email: "kim.lee" + studentDomain, Name: "Kim Lee", Others: []string{"s90003" + studentDomain}})
	if err != nil {
		t.Fatal(err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM users WHERE role = 'student'`) != 1 {
		t.Fatal("the two accounts should now be one")
	}
	if got := countRows(t, a, `SELECT COUNT(*) FROM checkins WHERE user_id = ?`, u.ID); got != 2 {
		t.Fatalf("check-ins: %d, want 2 (one shared event counted once, plus the other)", got)
	}
	for table, want := range map[string]int{"event_signups": 1, "competition_entries": 1, "exhibit_visits": 1, "student_awards": 1} {
		if got := countRows(t, a, `SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, u.ID); got != want {
			t.Errorf("%s: %d, want %d", table, got, want)
		}
	}
	if u.Name != "Kim Lee" || u.ClassName != "10C" {
		t.Fatalf("name from Microsoft, class from the record: %+v", u)
	}
}

// A second address in a token must never attach someone to a teacher's or an admin's account.
func TestAnAddressClaimCannotReachStaffAccounts(t *testing.T) {
	a := newApp(t)
	teacher, err := a.Provision(ctx, Identity{Email: "ms.chen@ykpaoschool.cn", Name: "Ms Chen"})
	if err != nil || teacher.Role != "teacher" {
		t.Fatalf("%+v %v", teacher, err)
	}
	// a student whose token also claims the teacher's address
	s, err := a.Provision(ctx, Identity{Email: "sneaky" + studentDomain, Name: "Sneaky", Others: []string{"ms.chen@ykpaoschool.cn"}})
	if err != nil || s.ID == teacher.ID || s.Role != "student" {
		t.Fatalf("a student must get their own account, never the teacher's: %+v %v", s, err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM user_aliases WHERE email = 'ms.chen@ykpaoschool.cn'`) != 0 {
		t.Fatal("someone else's address must not be saved as an alias")
	}
	if got, _ := a.UserByEmail(ctx, "ms.chen@ykpaoschool.cn"); got.ID != teacher.ID {
		t.Fatalf("the teacher's address still finds the teacher: %+v", got)
	}
	// and a teacher's token cannot pull in a student's account
	stu, _ := a.Provision(ctx, Identity{Email: "real.kid" + studentDomain, Name: "Real Kid"})
	t2, err := a.Provision(ctx, Identity{Email: "mr.lee@ykpaoschool.cn", Name: "Mr Lee", Others: []string{"real.kid" + studentDomain}})
	if err != nil || t2.ID == stu.ID || t2.Role != "teacher" {
		t.Fatalf("%+v %v", t2, err)
	}
	// a student address that is NOT on a school domain is never saved either
	if _, err := a.Provision(ctx, Identity{Email: "plain" + studentDomain, Name: "Plain", Others: []string{"someone@gmail.com"}}); err != nil {
		t.Fatal(err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM user_aliases WHERE email = 'someone@gmail.com'`) != 0 {
		t.Fatal("an outside address must not become an alias")
	}
}

func TestMergeStudentsByHand(t *testing.T) {
	a := newApp(t)
	e, comp, ex := setupHistory(t, a)
	e2, _ := a.CreateEvent(ctx, EventInput{Title: "Talk", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour)})
	keep := mkUser(t, a, "Real Account", "real@stu.ykpaoschool.cn", false)
	drop := mkUser(t, a, "Loaded Record", "s90004@stu.ykpaoschool.cn", false)
	teacher := mkUser(t, a, "T", "t@ykpaoschool.cn", false)
	a.DB.Write.Exec(`UPDATE users SET role = 'teacher' WHERE id = ?`, teacher.ID)
	fillHistory(t, a, drop.ID, e, comp, ex)
	a.ManualCheckInID(ctx, e.ID, keep.ID) // already has this one
	a.ManualCheckInID(ctx, e2.ID, drop.ID)

	if _, err := a.MergeStudents(ctx, teacher.ID, keep.ID, keep.ID, false); !errors.Is(err, ErrInvalid) {
		t.Fatalf("merging an account with itself: %v", err)
	}
	if _, err := a.MergeStudents(ctx, teacher.ID, keep.ID, teacher.ID, false); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a teacher account must not be merged: %v", err)
	}
	if _, err := a.MergeStudents(ctx, teacher.ID, keep.ID, 99999, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown account: %v", err)
	}
	dry, err := a.MergeStudents(ctx, teacher.ID, keep.ID, drop.ID, true)
	if err != nil || dry.Moved["checkins"] != 1 || dry.Duplicate["checkins"] != 1 || dry.Moved["student_awards"] != 1 {
		t.Fatalf("dry run: %+v %v", dry, err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM users WHERE id = ?`, drop.ID) != 1 {
		t.Fatal("a dry run changed something")
	}
	if _, err := a.MergeStudents(ctx, teacher.ID, keep.ID, drop.ID, false); err != nil {
		t.Fatal(err)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM users WHERE id = ?`, drop.ID) != 0 {
		t.Fatal("the record should be gone")
	}
	if got := countRows(t, a, `SELECT COUNT(*) FROM checkins WHERE user_id = ?`, keep.ID); got != 2 {
		t.Fatalf("check-ins: %d", got)
	}
	if got, _ := a.UserByEmail(ctx, "s90004@stu.ykpaoschool.cn"); got.ID != keep.ID || got.Name != "Real Account" {
		t.Fatalf("the old address now leads to the real account: %+v", got)
	}
	if countRows(t, a, `SELECT COUNT(*) FROM audit_log WHERE action = 'users.merge' AND actor_id = ?`, teacher.ID) != 1 {
		t.Fatal("the merge should be in the audit log")
	}
}
