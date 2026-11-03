package app

import (
	"errors"
	"testing"
)

func TestCreateAndUpdateExhibit(t *testing.T) {
	a := newApp(t)
	x, err := a.CreateExhibit(ctx, ExhibitInput{Title: "Wave Tank", Subject: "physics", Summary: "ripples"})
	if err != nil || x.Slug != "wave-tank" {
		t.Fatalf("%+v %v", x, err)
	}
	// a second exhibit with the same title must not overwrite the first: it gets its own address
	y, err := a.CreateExhibit(ctx, ExhibitInput{Title: "Wave Tank", Subject: "cs", Summary: "other"})
	if err != nil || y.Slug != "wave-tank-2" || y.ID == x.ID {
		t.Fatalf("%+v %v", y, err)
	}
	if again, _ := a.ExhibitBySlug(ctx, "wave-tank"); again.Summary != "ripples" || again.Subject != "physics" {
		t.Fatalf("the first exhibit was overwritten: %+v", again)
	}
	// a web address chosen by hand that is taken is refused, not overwritten
	if _, err := a.CreateExhibit(ctx, ExhibitInput{Title: "Another", Slug: "wave-tank", Subject: "cs"}); !errors.Is(err, ErrExists) {
		t.Fatalf("taken address: %v", err)
	}
	// titles without Latin letters (Chinese) work, each with its own address
	c1, err1 := a.CreateExhibit(ctx, ExhibitInput{Title: "光的折射", Subject: "physics"})
	c2, err2 := a.CreateExhibit(ctx, ExhibitInput{Title: "化学反应", Subject: "chemistry"})
	if err1 != nil || err2 != nil || c1.Slug != "exhibit" || c2.Slug != "exhibit-2" {
		t.Fatalf("%+v %v / %+v %v", c1, err1, c2, err2)
	}

	// editing keeps the address (so the QR tag and bookmarks keep working) and changes the content
	up, err := a.UpdateExhibit(ctx, x.ID, ExhibitInput{Title: "Wave Tank v2", Subject: "chemistry", Summary: "new", BodyMD: "## Hi", ImageURL: "/api/images/3", Slug: "ignored"})
	if err != nil || up.Slug != "wave-tank" || up.Title != "Wave Tank v2" || up.Subject != "chemistry" || up.ImageURL == nil || *up.ImageURL != "/api/images/3" {
		t.Fatalf("%+v %v", up, err)
	}
	if cleared, _ := a.UpdateExhibit(ctx, x.ID, ExhibitInput{Title: "Wave Tank v2", Subject: "chemistry"}); cleared.ImageURL != nil {
		t.Fatalf("an empty picture should clear it: %+v", cleared)
	}
	if _, err := a.UpdateExhibit(ctx, 9999, ExhibitInput{Title: "x", Subject: "cs"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown exhibit: %v", err)
	}
	for name, in := range map[string]ExhibitInput{
		"no title":       {Title: " ", Subject: "cs"},
		"bad subject":    {Title: "x", Subject: "art"},
		"script url":     {Title: "x", Subject: "cs", ImageURL: "javascript:alert(1)"},
		"proto-relative": {Title: "x", Subject: "cs", ImageURL: "//evil.example/a.png"},
	} {
		if _, err := a.CreateExhibit(ctx, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
		if _, err := a.UpdateExhibit(ctx, x.ID, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("update %s: %v", name, err)
		}
	}
}
