package app

import (
	"errors"
	"strings"
	"testing"
)

func TestManualAwardsLifecycle(t *testing.T) {
	a := newApp(t)
	teacher := mkUser(t, a, "T", "t@x", false)
	if _, err := a.DB.Write.Exec(`UPDATE users SET role = 'teacher' WHERE id = ?`, teacher.ID); err != nil {
		t.Fatal(err)
	}
	pub, priv := mkUser(t, a, "Pat", "p@x", true), mkUser(t, a, "Sam", "s@x", false)

	// a teacher gives one award to two students, with a reason; both start as drafts
	n, err := a.AddAwards(ctx, teacher.ID, "  Most Creative  ", "Built a working Rube Goldberg machine", []int64{pub.ID, priv.ID})
	if err != nil || n != 2 {
		t.Fatalf("%d %v", n, err)
	}
	if mine, _ := a.MyAwards(ctx, pub.ID); len(mine) != 0 {
		t.Fatal("students must not see a draft")
	}
	if groups, _ := a.PublishedAwardGroups(ctx); len(groups) != 0 {
		t.Fatalf("nothing is public before publishing: %+v", groups)
	}
	all, _ := a.AllAwards(ctx)
	if len(all) != 2 || all[0].Title != "Most Creative" || all[0].Published {
		t.Fatalf("teacher list: %+v", all)
	}

	// giving the same award again only updates the reason
	if _, err := a.AddAwards(ctx, teacher.ID, "Most Creative", "Built a Rube Goldberg machine", []int64{pub.ID}); err != nil {
		t.Fatal(err)
	}
	if all, _ = a.AllAwards(ctx); len(all) != 2 {
		t.Fatalf("duplicate award rows: %+v", all)
	}

	// publishing one award shows it to its student, with the reason
	if changed, err := a.SetAwardsPublished(ctx, teacher.ID, []int64{all[0].ID}, true); err != nil || changed != 1 {
		t.Fatalf("%d %v", changed, err)
	}
	var first Award
	for _, x := range all {
		if x.ID == all[0].ID {
			first = x
		}
	}
	mine, _ := a.MyAwards(ctx, first.UserID)
	if len(mine) != 1 || mine[0].Title != "Most Creative" || mine[0].Reason == "" {
		t.Fatalf("student view: %+v", mine)
	}
	// publishing the rest, then everyone has theirs
	if changed, err := a.SetAwardsPublished(ctx, teacher.ID, nil, true); err != nil || changed != 1 {
		t.Fatalf("publish all drafts: %d %v", changed, err)
	}

	// the public list follows the leaderboard's privacy rule: a name and reason only for students who opted in
	groups, _ := a.PublishedAwardGroups(ctx)
	if len(groups) != 1 || len(groups[0].Winners) != 2 {
		t.Fatalf("%+v", groups)
	}
	for _, w := range groups[0].Winners {
		switch w.Label {
		case "Pat":
			if w.Reason == "" {
				t.Error("an opted-in winner's reason should show")
			}
		case "Student, 10A":
			if w.Reason != "" {
				t.Errorf("a private student's reason must not be public: %q", w.Reason)
			}
		default:
			t.Errorf("unexpected label %q", w.Label)
		}
	}
	if strings.Contains(groups[0].Winners[0].Label+groups[0].Winners[1].Label, "Sam") {
		t.Fatal("a private student's real name leaked")
	}

	// edit, hide again, delete
	if err := a.UpdateAward(ctx, teacher.ID, all[0].ID, "Best Design", "Clean build"); err != nil {
		t.Fatal(err)
	}
	if changed, _ := a.SetAwardsPublished(ctx, teacher.ID, []int64{all[0].ID}, false); changed != 1 {
		t.Fatal("hiding failed")
	}
	if _, err := a.SetAwardsPublished(ctx, teacher.ID, nil, false); !errors.Is(err, ErrInvalid) {
		t.Fatalf("'hide everything' must be refused: %v", err)
	}
	if err := a.DeleteAward(ctx, teacher.ID, all[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteAward(ctx, teacher.ID, all[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	var n2 int
	a.DB.Read.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE action LIKE 'awards.%'`).Scan(&n2)
	if n2 < 5 {
		t.Errorf("award changes should be in the audit log, found %d", n2)
	}
}

func TestAwardInputRules(t *testing.T) {
	a := newApp(t)
	teacher := mkUser(t, a, "T", "t@x", false)
	if _, err := a.DB.Write.Exec(`UPDATE users SET role = 'teacher' WHERE id = ?`, teacher.ID); err != nil {
		t.Fatal(err)
	}
	stu := mkUser(t, a, "S", "s@x", false)
	for name, c := range map[string]struct {
		title, reason string
		ids           []int64
	}{
		"no title":        {" ", "r", []int64{stu.ID}},
		"title too long":  {strings.Repeat("x", 81), "", []int64{stu.ID}},
		"reason too long": {"A", strings.Repeat("x", 501), []int64{stu.ID}},
		"nobody":          {"A", "", nil},
		"unknown user":    {"A", "", []int64{9999}},
		"a teacher":       {"A", "", []int64{teacher.ID}},
	} {
		if _, err := a.AddAwards(ctx, teacher.ID, c.title, c.reason, c.ids); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: got %v, want ErrInvalid", name, err)
		}
	}
	if all, _ := a.AllAwards(ctx); len(all) != 0 {
		t.Fatalf("a refused request must create nothing: %+v", all)
	}
	// a rename that collides with an award the student already has is refused, not a crash
	a.AddAwards(ctx, teacher.ID, "A", "", []int64{stu.ID})
	a.AddAwards(ctx, teacher.ID, "B", "", []int64{stu.ID})
	all, _ := a.AllAwards(ctx)
	if err := a.UpdateAward(ctx, teacher.ID, all[1].ID, "A", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate title for one student: %v", err)
	}
}
