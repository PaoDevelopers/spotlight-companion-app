package app

import (
	"errors"
	"testing"
	"time"
)

func mkCompetitionEvent(t *testing.T, a *App, title, kind string) (Event, Competition) {
	t.Helper()
	e, err := a.CreateEvent(ctx, EventInput{Title: title, Subject: "cs", StartsAt: start, EndsAt: start.Add(2 * time.Hour), Competition: kind})
	if err != nil {
		t.Fatal(err)
	}
	comps, _ := a.CompetitionsForEvent(ctx, e.ID)
	if kind == "" {
		if len(comps) != 0 || e.Competition != nil {
			t.Fatalf("ordinary event has competition %+v %v", comps, e.Competition)
		}
		return e, Competition{}
	}
	if len(comps) != 1 || comps[0].Kind != kind || comps[0].Name != title || e.Competition == nil || *e.Competition != kind {
		t.Fatalf("competition for %q: %+v event says %v", kind, comps, e.Competition)
	}
	return e, comps[0]
}

func TestCompetitionIsAPropertyOfTheEvent(t *testing.T) {
	a := newApp(t)
	e, c := mkCompetitionEvent(t, a, "Quiz", KindIndividual)
	u := mkUser(t, a, "A", "a@x", false)
	if err := a.Register(ctx, c.ID, u.ID, "ignored team", "Spring"); err != nil {
		t.Fatal(err)
	}
	if n, _ := a.CompetitionEntryCount(ctx, e.ID); n != 1 {
		t.Fatalf("entries = %d", n)
	}
	entries, _ := a.Entries(ctx)
	if entries[0].TeamName != nil || entries[0].House != nil {
		t.Fatalf("an individual contest must not keep team or house: %+v", entries[0])
	}

	// renaming the event renames the competition; changing the kind keeps the entries
	in := EventInput{Title: "Quiz Night", Subject: "cs", StartsAt: start, EndsAt: start.Add(time.Hour), Competition: KindTeam}
	got, err := a.UpdateEvent(ctx, e.ID, in)
	if err != nil || got.Competition == nil || *got.Competition != KindTeam {
		t.Fatalf("%+v %v", got, err)
	}
	comps, _ := a.CompetitionsForEvent(ctx, e.ID)
	if len(comps) != 1 || comps[0].Name != "Quiz Night" || !comps[0].IsTeam || comps[0].ID != c.ID {
		t.Fatalf("%+v", comps)
	}
	if n, _ := a.CompetitionEntryCount(ctx, e.ID); n != 1 {
		t.Fatalf("changing the kind must keep entries, have %d", n)
	}

	// turning it off removes the competition and its entries; the event stays
	in.Competition = ""
	got, err = a.UpdateEvent(ctx, e.ID, in)
	if err != nil || got.Competition != nil {
		t.Fatalf("%+v %v", got, err)
	}
	if n, _ := a.CompetitionEntryCount(ctx, e.ID); n != 0 {
		t.Fatalf("%d entries left", n)
	}
	in.Competition = "chess"
	if _, err := a.UpdateEvent(ctx, e.ID, in); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown kind: %v", err)
	}
}

func TestTeamAndHouseRegistrationRules(t *testing.T) {
	a := newApp(t)
	_, team := mkCompetitionEvent(t, a, "Relay", KindTeam)
	_, house := mkCompetitionEvent(t, a, "Sports Day", KindHouse)
	u := mkUser(t, a, "A", "a@x", false)

	if err := a.Register(ctx, team.ID, u.ID, "  ", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a team entry needs a team name: %v", err)
	}
	if err := a.Register(ctx, team.ID, u.ID, "The Quarks", "Winter"); err != nil {
		t.Fatal(err)
	}
	if err := a.Register(ctx, house.ID, u.ID, "", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a house entry needs a house: %v", err)
	}
	if err := a.Register(ctx, house.ID, u.ID, "", "Monday"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("not one of the four houses: %v", err)
	}
	if err := a.Register(ctx, house.ID, u.ID, "x", "Autumn"); err != nil {
		t.Fatal(err)
	}
	mine, _ := a.MyCompetitions(ctx, u.ID)
	if len(mine) != 2 || mine[0].Kind != KindTeam || *mine[0].Team != "The Quarks" || mine[0].House != nil || mine[1].Kind != KindHouse || *mine[1].House != "Autumn" || mine[1].Team != nil {
		t.Fatalf("%+v", mine)
	}
	if mine[0].Event != "Relay" || mine[1].Event != "Sports Day" {
		t.Fatalf("the home page names the event: %+v", mine)
	}
}

func TestBoardsGroupTeamsAndRankHouses(t *testing.T) {
	a := newApp(t)
	_, team := mkCompetitionEvent(t, a, "Relay", KindTeam)
	_, house := mkCompetitionEvent(t, a, "Sports Day", KindHouse)
	pub := mkUser(t, a, "Pat", "p@x", true)
	users := []User{pub, mkUser(t, a, "B", "b@x", false), mkUser(t, a, "C", "c@x", false), mkUser(t, a, "D", "d@x", false), mkUser(t, a, "E", "e@x", false)}

	// teams: two on the Quarks, one on the Bosons
	for i, tm := range []string{"Quarks", "Quarks", "Bosons"} {
		if err := a.Register(ctx, team.ID, users[i].ID, tm, ""); err != nil {
			t.Fatal(err)
		}
	}
	// houses: Spring 30+20, Winter 50 (tie with Spring), Summer 10; Autumn has nobody
	for i, h := range []string{"Spring", "Spring", "Winter", "Summer", "Summer"} {
		if err := a.Register(ctx, house.ID, users[i].ID, "", h); err != nil {
			t.Fatal(err)
		}
	}
	entries, _ := a.Entries(ctx)
	for _, en := range entries {
		var score, rank *int64
		switch {
		case en.CompetitionID == team.ID && en.UserID == users[0].ID:
			score, rank = ptr(int64(70)), ptr(int64(1))
		case en.CompetitionID == team.ID && en.UserID == users[1].ID:
			score = ptr(int64(60))
		case en.CompetitionID == team.ID:
			score, rank = ptr(int64(40)), ptr(int64(2))
		case en.UserID == users[0].ID:
			score = ptr(int64(30))
		case en.UserID == users[1].ID:
			score = ptr(int64(20))
		case en.UserID == users[2].ID:
			score = ptr(int64(50))
		case en.UserID == users[3].ID:
			score = ptr(int64(10))
		}
		if err := a.UpdateEntry(ctx, en.ID, EntryPatch{Status: "finished", Score: score, Rank: rank}); err != nil {
			t.Fatal(err)
		}
	}

	tb, _ := a.CompetitionBoard(ctx, team, "Relay")
	if len(tb.Groups) != 2 || tb.Groups[0].Label != "Quarks" || tb.Groups[0].Count != 2 || *tb.Groups[0].Rank != 1 || *tb.Groups[0].Score != 70 || tb.Groups[1].Label != "Bosons" {
		t.Fatalf("team standings: %+v", tb.Groups)
	}
	if got := tb.Groups[0].Members; len(got) != 2 || got[0] != "Pat" { // Pat opted in; the other stays "Student, 10A"
		t.Fatalf("members respect opt-in: %v", got)
	}
	for _, m := range tb.Groups[0].Members {
		if m == "B" {
			t.Fatal("a student who did not opt in must not appear by name")
		}
	}

	if tb.Rows == nil || tb.Groups == nil {
		t.Fatal("rows and groups must be empty lists, not null: the web app reads their length")
	}

	hb, _ := a.CompetitionBoard(ctx, house, "Sports Day")
	if len(hb.Groups) != 4 {
		t.Fatalf("all four houses are always listed: %+v", hb.Groups)
	}
	want := []struct {
		house string
		pts   int64
		rank  int64 // 0 = not placed
		n     int
	}{{"Spring", 50, 1, 2}, {"Winter", 50, 1, 1}, {"Summer", 10, 3, 2}, {"Autumn", 0, 0, 0}}
	for i, w := range want {
		g := hb.Groups[i]
		placed := g.Rank != nil
		if g.Label != w.house || *g.Score != w.pts || g.Count != w.n || placed != (w.rank != 0) || (placed && *g.Rank != w.rank) {
			t.Errorf("house %d: %+v (rank %v), want %+v", i, g, g.Rank, w)
		}
	}
	if len(hb.Rows) != 5 || hb.Rows[0].House == nil {
		t.Fatalf("individual rows should remain for house contests: %+v", hb.Rows)
	}

	// before any score is recorded there is no ranking to show
	_, fresh := mkCompetitionEvent(t, a, "New Day", KindHouse)
	fb, _ := a.CompetitionBoard(ctx, fresh, "New Day")
	for _, g := range fb.Groups {
		if g.Rank != nil {
			t.Fatalf("no scores yet, no ranks: %+v", fb.Groups)
		}
	}
}
