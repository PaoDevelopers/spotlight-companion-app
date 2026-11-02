package app

import (
	"errors"
	"testing"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

func TestSignupRules(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "Talk", ptr(int64(2)))
	u1, u2, u3 := mkUser(t, a, "A", "a@x", false), mkUser(t, a, "B", "b@x", false), mkUser(t, a, "C", "c@x", false)

	for _, u := range []User{u1, u1, u2} { // twice for u1 is harmless
		if err := a.SignUp(ctx, e.ID, u.ID, false); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.SignUp(ctx, e.ID, u3.ID, false); !errors.Is(err, ErrFull) {
		t.Fatalf("third student should find sign-up full, got %v", err)
	}
	if err := a.SignUp(ctx, e.ID, u3.ID, true); err != nil {
		t.Fatalf("staff may sign up past capacity: %v", err)
	}
	got, _ := a.Event(ctx, e.ID)
	if got.SignupCount != 3 || !got.SignupEnabled {
		t.Fatalf("event shows %d signups, enabled=%v", got.SignupCount, got.SignupEnabled)
	}
	if err := a.CancelSignup(ctx, e.ID, u3.ID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := a.IsSignedUp(ctx, e.ID, u3.ID); ok {
		t.Fatal("still signed up after cancelling")
	}

	// closed after the event ends, and when switched off
	a.Now = func() time.Time { return start.Add(3 * time.Hour) }
	if err := a.SignUp(ctx, e.ID, u3.ID, false); !errors.Is(err, ErrNoSignup) {
		t.Fatalf("after the event: %v", err)
	}
	a.Now = func() time.Time { return during }
	off, err := a.CreateEvent(ctx, EventInput{Title: "Drop-in", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour), NoSignup: true})
	if err != nil || off.SignupEnabled {
		t.Fatalf("create with sign-up off: %+v %v", off, err)
	}
	if err := a.SignUp(ctx, off.ID, u1.ID, false); !errors.Is(err, ErrNoSignup) {
		t.Fatalf("sign-up switched off: %v", err)
	}
	if err := a.SignUp(ctx, 9999, u1.ID, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown event: %v", err)
	}
}

// Walk-ins must not take the places promised to students who signed up and haven't arrived yet.
func TestSignedUpStudentsKeepTheirPlace(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "Small", ptr(int64(2)))
	reg, walk1, walk2 := mkUser(t, a, "Reg", "r@x", false), mkUser(t, a, "W1", "w1@x", false), mkUser(t, a, "W2", "w2@x", false)
	if err := a.SignUp(ctx, e.ID, reg.ID, false); err != nil {
		t.Fatal(err)
	}
	code := token.MakeEvent(secret, e.ID, during.UnixMilli())
	if _, err := a.CheckInStudent(ctx, walk1.ID, code); err != nil {
		t.Fatalf("one free place for a walk-in: %v", err)
	}
	if _, err := a.CheckInStudent(ctx, walk2.ID, code); !errors.Is(err, ErrFull) {
		t.Fatalf("the other place belongs to the signed-up student, got %v", err)
	}
	if _, err := a.CheckInStudent(ctx, reg.ID, code); err != nil {
		t.Fatalf("the signed-up student must get in: %v", err)
	}
	signups, _ := a.Signups(ctx, e.ID)
	if len(signups) != 1 || !signups[0].CheckedIn {
		t.Fatalf("signup list should show them as arrived: %+v", signups)
	}
}

func TestManualCheckInByIDAndSearch(t *testing.T) {
	a := newApp(t)
	e := mkEvent(t, a, "Talk", nil)
	u := mkUser(t, a, "Mei Lin", "mei@stu.ykpaoschool.cn", false)
	mkUser(t, a, "Other", "o@x", false)
	if _, err := a.ManualCheckInID(ctx, e.ID, u.ID); err != nil {
		t.Fatal(err)
	}
	if att, _ := a.Attendees(ctx, e.ID); len(att) != 1 || att[0].Method != "manual" {
		t.Fatalf("attendees: %+v", att)
	}
	if hits, _ := a.SearchStudents(ctx, "mei", 8); len(hits) != 1 || hits[0].ID != u.ID {
		t.Fatalf("search by name: %+v", hits)
	}
	if hits, _ := a.SearchStudents(ctx, "%%", 8); len(hits) != 0 {
		t.Fatalf("wildcards must be literal: %+v", hits)
	}
	if hits, _ := a.SearchStudents(ctx, "m", 8); len(hits) != 0 {
		t.Fatalf("one letter is too short: %+v", hits)
	}
}

func TestEventImageAndHostValidation(t *testing.T) {
	a := newApp(t)
	in := EventInput{Title: "T", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour), Host: " Ms Chen "}
	for _, bad := range []string{"javascript:alert(1)", "http://insecure.example/x.png", "//evil.example/x.png"} {
		in.ImageURL = bad
		if _, err := a.CreateEvent(ctx, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q should be refused, got %v", bad, err)
		}
	}
	in.ImageURL = "https://example.org/a.png"
	e, err := a.CreateEvent(ctx, in)
	if err != nil || e.ImageURL == nil || *e.ImageURL != in.ImageURL || e.Host == nil || *e.Host != "Ms Chen" {
		t.Fatalf("%+v %v", e, err)
	}
}
