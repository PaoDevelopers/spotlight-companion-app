package app

import (
	"errors"
	"testing"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

func TestExhibitionsGroupInstallations(t *testing.T) {
	a := newApp(t)
	phys, err := a.CreateExhibition(ctx, ExhibitionInput{Title: " Physics Exhibition ", Subject: "physics", Summary: "Forces and waves"})
	if err != nil || phys.Title != "Physics Exhibition" || phys.Total != 0 {
		t.Fatalf("%+v %v", phys, err)
	}
	chem, _ := a.CreateExhibition(ctx, ExhibitionInput{Title: "Chemistry Exhibition", Subject: "chemistry"})

	// installations are put in an exhibition when created, and can move or stand alone
	pendulum, err := a.CreateExhibit(ctx, ExhibitInput{Title: "Pendulum", Subject: "physics", ExhibitionID: &phys.ID})
	if err != nil || pendulum.ExhibitionID == nil || *pendulum.ExhibitionID != phys.ID {
		t.Fatalf("%+v %v", pendulum, err)
	}
	wave, _ := a.CreateExhibit(ctx, ExhibitInput{Title: "Wave Tank", Subject: "physics", ExhibitionID: &phys.ID})
	loose, _ := a.CreateExhibit(ctx, ExhibitInput{Title: "Lone Exhibit", Subject: "cs"})
	if loose.ExhibitionID != nil {
		t.Fatalf("standalone exhibit has an exhibition: %+v", loose)
	}
	if _, err := a.CreateExhibit(ctx, ExhibitInput{Title: "Bad", Subject: "cs", ExhibitionID: ptr(int64(999))}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an exhibition that does not exist must be refused, not ignored: %v", err)
	}
	moved, err := a.UpdateExhibit(ctx, wave.ID, ExhibitInput{Title: "Wave Tank", Subject: "physics", ExhibitionID: &chem.ID})
	if err != nil || moved.ExhibitionID == nil || *moved.ExhibitionID != chem.ID {
		t.Fatalf("%+v %v", moved, err)
	}
	if _, err := a.UpdateExhibit(ctx, wave.ID, ExhibitInput{Title: "Wave Tank", Subject: "physics", ExhibitionID: ptr(int64(999))}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("update with a missing exhibition: %v", err)
	}
	if again, _ := a.ExhibitBySlug(ctx, "wave-tank"); again.ExhibitionID == nil || *again.ExhibitionID != chem.ID {
		t.Fatalf("a refused update must change nothing: %+v", again)
	}

	// counts: how many installations, and how many this student has visited
	stu := mkUser(t, a, "S", "s@x", false)
	if _, err := a.VisitExhibit(ctx, stu.ID, token.MakeTag(secret, token.KindExhibit, pendulum.ID)); err != nil {
		t.Fatal(err)
	}
	list, _ := a.Exhibitions(ctx, stu.ID)
	byTitle := map[string]Exhibition{}
	for _, x := range list {
		byTitle[x.Title] = x
	}
	if p := byTitle["Physics Exhibition"]; p.Total != 1 || p.Visited != 1 {
		t.Fatalf("physics: %+v", p)
	}
	if c := byTitle["Chemistry Exhibition"]; c.Total != 1 || c.Visited != 0 {
		t.Fatalf("chemistry: %+v", c)
	}
	if teacherView, _ := a.Exhibitions(ctx, 0); teacherView[0].Visited != 0 {
		t.Fatalf("a teacher's list has no 'visited': %+v", teacherView)
	}

	// edit, then delete: the installations stay, standalone
	up, err := a.UpdateExhibition(ctx, phys.ID, ExhibitionInput{Title: "Physics Hall", Subject: "both", BodyMD: "## Welcome", ImageURL: "/api/images/2"})
	if err != nil || up.Title != "Physics Hall" || up.Subject != "both" || up.ImageURL == nil {
		t.Fatalf("%+v %v", up, err)
	}
	if err := a.DeleteExhibition(ctx, phys.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteExhibition(ctx, phys.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	if kept, err := a.ExhibitBySlug(ctx, "pendulum"); err != nil || kept.ExhibitionID != nil {
		t.Fatalf("deleting an exhibition must keep its installations, standalone: %+v %v", kept, err)
	}
	if n, _ := a.VisitedExhibitIDs(ctx, stu.ID); !n[pendulum.ID] {
		t.Fatal("visits must survive")
	}
	for name, in := range map[string]ExhibitionInput{
		"no title":    {Title: "", Subject: "cs"},
		"bad subject": {Title: "x", Subject: "art"},
		"script url":  {Title: "x", Subject: "cs", ImageURL: "javascript:alert(1)"},
	} {
		if _, err := a.CreateExhibition(ctx, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
