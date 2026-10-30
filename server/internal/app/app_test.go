package app

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/config"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/db"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

const secret = "0123456789abcdef0123456789abcdef"

var (
	ctx    = context.Background()
	start  = time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	during = start.Add(30 * time.Minute)
)

func newApp(t *testing.T) *App {
	t.Helper()
	d, err := db.Open(ctx, filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	a := New(d, &config.Config{
		Secret: secret, PublicURL: "https://spotlight.test", AuthMode: "roster",
		StaffDomain: "ykpaoschool.cn", StudentDomain: "stu.ykpaoschool.cn",
	})
	a.Now = func() time.Time { return during }
	return a
}

func mkUser(t *testing.T, a *App, name, email string, show bool) User {
	t.Helper()
	if _, err := a.DB.Write.Exec(`INSERT INTO users (email, name, class_name, show_on_leaderboard) VALUES (?, ?, '10A', ?)`, email, name, b2i(show)); err != nil {
		t.Fatal(err)
	}
	u, err := a.UserByEmail(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func mkEvent(t *testing.T, a *App, title string, capacity *int64) Event {
	t.Helper()
	e, err := a.CreateEvent(ctx, EventInput{Title: title, Subject: "cs", StartsAt: start, EndsAt: start.Add(2 * time.Hour), Capacity: capacity})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func ptr[T any](v T) *T { return &v }

func TestRosterImportAndLogin(t *testing.T) {
	a := newApp(t)
	admin := mkUser(t, a, "Boss", "boss@x", false)
	rows, err := ParseRosterCSV("Name, Email ,class\nAda,Ada@School.edu,10A\n\"Lee, Bo\",bo@school.edu,\nbad,nomail,10B\n")
	if err != nil || len(rows) != 2 || rows[1].Name != "Lee, Bo" {
		t.Fatalf("rows %+v err %v", rows, err)
	}
	if _, err := ParseRosterCSV("foo,bar\n1,2"); err == nil {
		t.Error("CSV without name/email columns should be refused")
	}
	// a teacher already in the system must not be overwritten or handed a student code
	if _, err := a.DB.Write.Exec(`INSERT INTO users (email, name, role) VALUES ('bo@school.edu', 'Mr Lee', 'teacher')`); err != nil {
		t.Fatal(err)
	}
	issued, err := a.ImportRoster(ctx, admin, rows)
	if err != nil || len(issued) != 1 || issued[0].Email != "ada@school.edu" {
		t.Fatalf("issued %+v err %v", issued, err)
	}
	if u, ok := a.LoginWithCode(ctx, "ada@school.edu", strings.ToLower(issued[0].Code)); !ok || u.Name != "Ada" {
		t.Error("login with the printed code (any case) should work")
	}
	if _, ok := a.LoginWithCode(ctx, "ada@school.edu", "WRONGCODE"); ok {
		t.Error("wrong code accepted")
	}
	if _, ok := a.LoginWithCode(ctx, "nobody@school.edu", issued[0].Code); ok {
		t.Error("unknown email accepted")
	}
	if u, _ := a.UserByEmail(ctx, "bo@school.edu"); u.Role != "teacher" || u.Name != "Mr Lee" {
		t.Errorf("staff account was changed: %+v", u)
	}
}

func TestCheckInRules(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "Robotics", ptr(int64(2)))
	u1, u2, u3 := mkUser(t, a, "A", "a@x", false), mkUser(t, a, "B", "b@x", false), mkUser(t, a, "C", "c@x", false)
	code := token.MakeEvent(secret, e.ID, during.UnixMilli())

	r, err := a.CheckInStudent(ctx, u1.ID, code)
	if err != nil || r.Duplicate || r.Title != "Robotics" {
		t.Fatalf("first scan: %+v %v", r, err)
	}
	if r, err = a.CheckInStudent(ctx, u1.ID, code); err != nil || !r.Duplicate {
		t.Fatalf("repeat scan should be a harmless duplicate: %+v %v", r, err)
	}
	if _, err = a.CheckInStudent(ctx, u2.ID, code); err != nil {
		t.Fatal(err)
	}
	if _, err = a.CheckInStudent(ctx, u3.ID, code); !errors.Is(err, ErrFull) {
		t.Fatalf("third student should hit capacity, got %v", err)
	}
	if _, err = a.CheckInStudent(ctx, u3.ID, "junk"); !errors.Is(err, ErrBadToken) {
		t.Fatalf("junk code: %v", err)
	}
	// teacher override works even when full
	if _, err = a.ManualCheckIn(ctx, e.ID, "c@x"); err != nil {
		t.Fatalf("manual check-in must ignore capacity: %v", err)
	}
	if err := a.UndoCheckIn(ctx, e.ID, u3.ID); err != nil {
		t.Fatal(err)
	}
	// outside the window
	a.Now = func() time.Time { return start.Add(3 * time.Hour) }
	late := token.MakeEvent(secret, e.ID, a.Now().UnixMilli())
	if _, err = a.CheckInStudent(ctx, u3.ID, late); !errors.Is(err, ErrClosed) {
		t.Fatalf("after the event: %v", err)
	}
	a.Now = func() time.Time { return start.Add(-2 * time.Hour) }
	if _, err = a.CheckInStudent(ctx, u3.ID, token.MakeEvent(secret, e.ID, a.Now().UnixMilli())); !errors.Is(err, ErrClosed) {
		t.Fatalf("long before the event: %v", err)
	}
	if err := a.UndoCheckIn(ctx, e.ID, u2.ID); err != nil { // make room again
		t.Fatal(err)
	}
	a.Now = func() time.Time { return start.Add(-30 * time.Minute) } // inside the one-hour early window
	if _, err = a.CheckInStudent(ctx, u3.ID, token.MakeEvent(secret, e.ID, a.Now().UnixMilli())); err != nil {
		t.Fatalf("within an hour before start should be open: %v", err)
	}
}

func TestNFCPassAndExhibitTags(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "E", nil)
	u1, u2 := mkUser(t, a, "A", "a@x", false), mkUser(t, a, "B", "b@x", false)
	if _, err := a.CheckInStudent(ctx, u1.ID, token.MakeTag(secret, token.KindEvent, e.ID)); err != nil {
		t.Fatal(err)
	}
	st, r, err := a.CheckInByPass(ctx, e.ID, token.MakePass(secret, u2.ID))
	if err != nil || st.Name != "B" || r.Duplicate {
		t.Fatalf("%+v %+v %v", st, r, err)
	}
	if _, _, err := a.CheckInByPass(ctx, e.ID, "pass.2.forged"); !errors.Is(err, ErrBadToken) {
		t.Fatalf("forged pass: %v", err)
	}
	list, _ := a.Attendees(ctx, e.ID)
	if len(list) != 2 || list[0].Method != "nfc" || list[1].Method != "pass" {
		t.Fatalf("attendees %+v", list)
	}
	csv := AttendeesCSV([]Attendee{{Name: "=cmd()", ClassName: `a"b`, Method: "qr", At: Time(during)}})
	if !strings.Contains(csv, `"'=cmd()","a""b","qr"`) || !strings.HasPrefix(csv, "name,class,method,time\n") {
		t.Errorf("CSV not neutralised: %q", csv)
	}

	x, err := a.SaveExhibit(ctx, ExhibitInput{Title: "Wave Tank", Subject: "physics", OwnerEmails: []string{"b@x", "ghost@x"}})
	if err != nil || x.Slug != "wave-tank" {
		t.Fatalf("%+v %v", x, err)
	}
	if _, err := a.VisitExhibit(ctx, u1.ID, token.MakeTag(secret, token.KindEvent, x.ID)); !errors.Is(err, ErrBadToken) {
		t.Fatalf("an event tag must not count as an exhibit visit: %v", err)
	}
	if slug, err := a.VisitExhibit(ctx, u1.ID, token.MakeTag(secret, token.KindExhibit, x.ID)); err != nil || slug != "wave-tank" {
		t.Fatalf("%q %v", slug, err)
	}
	if _, err := a.VisitExhibit(ctx, u1.ID, token.MakeTag(secret, token.KindExhibit, 999)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown exhibit: %v", err)
	}
	if seen, _ := a.VisitedExhibitIDs(ctx, u1.ID); !seen[x.ID] {
		t.Error("visit not recorded")
	}
}

// Sixty students scan at once for ten places: exactly ten get in. (The TypeScript version could overbook.)
func TestCapacityHoldsUnderConcurrentScans(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "Big", ptr(int64(10)))
	code := token.MakeEvent(secret, e.ID, during.UnixMilli())
	var users []User
	for i := 0; i < 60; i++ {
		users = append(users, mkUser(t, a, "S", "s"+strings.Repeat("x", i)+"@x", false))
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, full := 0, 0
	for _, u := range users {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			_, err := a.CheckInStudent(ctx, id, code)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ErrFull):
				full++
			default:
				t.Errorf("unexpected error %v", err)
			}
		}(u.ID)
	}
	wg.Wait()
	if ok != 10 || full != 50 {
		t.Fatalf("admitted %d, refused %d; want 10 and 50", ok, full)
	}
	list, _ := a.Attendees(ctx, e.ID)
	if len(list) != 10 {
		t.Fatalf("%d rows stored", len(list))
	}
}

func TestLeaderboardsRespectOptIn(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "Hack", nil)
	pub, priv := mkUser(t, a, "Pat", "p@x", true), mkUser(t, a, "Sam", "s@x", false)
	c, err := a.CreateCompetition(ctx, e.ID, "Hackathon", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []User{pub, priv} {
		if err := a.Register(ctx, c.ID, u.ID, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.Register(ctx, c.ID, pub.ID, ""); err != nil {
		t.Fatal("registering twice should be harmless:", err)
	}
	if err := a.Register(ctx, 999, pub.ID, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown competition: %v", err)
	}
	entries, _ := a.Entries(ctx)
	for _, en := range entries {
		rank := int64(1)
		if en.UserID == pub.ID {
			rank = 2
		}
		if err := a.UpdateEntry(ctx, en.ID, EntryPatch{Status: "finished", Score: ptr(int64(10)), Rank: &rank}); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.UpdateEntry(ctx, entries[0].ID, EntryPatch{Status: "dancing"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad status: %v", err)
	}
	lb, _ := a.CompetitionLeaderboard(ctx, c.ID)
	if len(lb) != 2 || lb[0].Label != "Student, 10A" || lb[1].Label != "Pat" {
		t.Fatalf("%+v", lb)
	}
	month, _ := a.MonthLeaderboard(ctx, 20)
	if len(month) != 2 || month[0].Points != 10 || month[1].Points != 6 {
		t.Fatalf("%+v", month)
	}
	for _, m := range month {
		if strings.Contains(m.Label, "Sam") {
			t.Error("opted-out name leaked")
		}
	}
}

func TestAwardsWorkflow(t *testing.T) {
	a := newApp(t)
	e1, e2 := mkEvent(t, a, "E1", nil), mkEvent(t, a, "E2", nil)
	u1, u2, judge := mkUser(t, a, "A", "a@x", false), mkUser(t, a, "B", "b@x", false), mkUser(t, a, "J", "j@x", false)
	for _, c := range [][2]int64{{u1.ID, e1.ID}, {u1.ID, e2.ID}, {u2.ID, e1.ID}} {
		if _, err := a.DB.Write.Exec(`INSERT INTO checkins (event_id, user_id, method, at) VALUES (?, ?, 'qr', ?)`, c[1], c[0], during.Unix()); err != nil {
			t.Fatal(err)
		}
	}
	x, _ := a.SaveExhibit(ctx, ExhibitInput{Title: "X", Subject: "cs", OwnerEmails: []string{"b@x"}})
	if err := a.CastVote(ctx, u2.ID, x.ID); !errors.Is(err, ErrOwnExhibit) {
		t.Fatalf("own exhibit: %v", err)
	}
	if err := a.CastVote(ctx, u1.ID, x.ID); err != nil {
		t.Fatal(err)
	}
	if id, _ := a.MyVote(ctx, u1.ID); id != x.ID {
		t.Fatal("vote not stored")
	}
	if err := a.ScoreExhibit(ctx, judge.ID, x.ID, 150); err != nil { // clamps to 100
		t.Fatal(err)
	}

	res, err := a.RunAwards(ctx, &judge.ID)
	if err != nil || res.Participation[0].UserID != u1.ID || res.Creative[0].UserID != u2.ID || res.Creative[0].Metrics["judge"] != 100 {
		t.Fatalf("%+v %v", res, err)
	}
	if pub, _ := a.AwardResults(ctx, true, 0); len(pub) != 0 {
		t.Fatal("students must see nothing before publishing")
	}
	drafts, _ := a.AwardResults(ctx, false, 0)
	var creative AwardResult
	for _, d := range drafts {
		if d.Key == "creative" {
			creative = d
		}
	}
	if err := a.RemoveDraftResult(ctx, creative.ID, judge.ID, "ineligible"); err != nil {
		t.Fatal(err)
	}
	if n, err := a.PublishAwards(ctx, judge.ID); err != nil || n == 0 {
		t.Fatalf("published %d, %v", n, err)
	}
	before, _ := a.AwardResults(ctx, true, 0)
	if _, err := a.RunAwards(ctx, &judge.ID); err != nil { // must not change published rows
		t.Fatal(err)
	}
	after, _ := a.AwardResults(ctx, true, 0)
	if len(before) != len(after) {
		t.Fatalf("published results changed: %d -> %d", len(before), len(after))
	}
	for i := range before {
		if before[i].ID != after[i].ID || before[i].UserID != after[i].UserID || before[i].Rank != after[i].Rank {
			t.Fatalf("published row %d changed", i)
		}
	}
	for _, r := range before {
		if r.Key == "creative" {
			t.Fatal("the vetoed creative winner must not be published")
		}
	}
	if err := a.RemoveDraftResult(ctx, before[0].ID, judge.ID, "late"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("published results are final: %v", err)
	}
}

func TestSeedDemoAndEnsureAdmins(t *testing.T) {
	a := newApp(t)
	a.Cfg.DemoLoginCode = "DEMOCODE"
	codes, err := a.SeedDemo(ctx)
	if err != nil || codes["teacher@demo.school"] != "DEMOCODE" {
		t.Fatalf("%v %v", codes, err)
	}
	if again, _ := a.SeedDemo(ctx); again != nil {
		t.Error("seeding twice should do nothing")
	}
	evs, _ := a.Events(ctx, "")
	comps, _ := a.AllCompetitions(ctx)
	if len(evs) != 3 || evs[0].Title != "Opening Assembly: Physics Meets CS" || len(comps) != 1 || comps[0].EventID != evs[1].ID {
		t.Fatalf("seed content: %+v %+v", evs, comps)
	}
	if u, ok := a.LoginWithCode(ctx, "student@demo.school", "demoCODE"); !ok || u.Role != "student" {
		t.Error("demo student should log in")
	}
	a.Cfg.AdminEmails = []string{"boss@school.cn"}
	got, _ := a.EnsureAdmins(ctx)
	if len(got["boss@school.cn"]) != 8 {
		t.Fatalf("admin code %v", got)
	}
	if again, _ := a.EnsureAdmins(ctx); len(again) != 0 {
		t.Error("existing admin must not get a new code")
	}
	a.Cfg.AuthMode = "entra"
	a.Cfg.AdminEmails = []string{"other@school.cn"}
	if got, _ := a.EnsureAdmins(ctx); len(got) != 0 {
		t.Error("no codes in Microsoft mode")
	}
}

func TestEventValidationAndCascade(t *testing.T) {
	a := newApp(t)
	for name, in := range map[string]EventInput{
		"no title":      {Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour)},
		"ends first":    {Title: "x", Subject: "cs", StartsAt: start, EndsAt: start.Add(-time.Hour)},
		"bad subject":   {Title: "x", Subject: "art", StartsAt: start, EndsAt: start.Add(time.Hour)},
		"zero capacity": {Title: "x", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour), Capacity: ptr(int64(0))},
	} {
		if _, err := a.CreateEvent(ctx, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	e := mkEvent(t, a, "Gone", nil)
	if _, err := a.UpdateEvent(ctx, 999, EventInput{Title: "x", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour)}); !errors.Is(err, ErrNotFound) {
		t.Errorf("update missing: %v", err)
	}
	if err := a.DeleteEvent(ctx, e.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Event(ctx, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted event still found: %v", err)
	}
	if up, _ := a.Upcoming(ctx, 3); len(up) != 0 {
		t.Errorf("upcoming %+v", up)
	}
}
