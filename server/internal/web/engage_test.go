package web

import (
	"context"
	"strings"
	"testing"
)

func TestLibraryOverHTTP(t *testing.T) {
	_, teacher, student := seeded(t)
	body := map[string]any{"title": "Uncle Tungsten", "author": "Sacks", "subject": "chemistry", "summary": "memoir", "bodyMd": "# hi", "imageUrl": ""}
	student.mustStatus(403, "POST", "/api/admin/books", body)
	out := decode[struct{ Book struct{ ID int64 } }](t, teacher.mustStatus(201, "POST", "/api/admin/books", body))
	id := itoa(out.Book.ID)
	student.mustStatus(200, "PUT", "/api/books/"+id+"/read", nil)
	student.mustStatus(200, "PUT", "/api/books/"+id+"/read", nil)
	got := decode[struct {
		Book struct{ Reads int64 }
	}](t, student.mustStatus(200, "GET", "/api/books/"+id, nil))
	if got.Book.Reads != 1 {
		t.Fatalf("reads %d", got.Book.Reads)
	}
	c := decode[struct{ Comment struct{ ID int64 } }](t, student.mustStatus(201, "POST", "/api/books/"+id+"/comments", map[string]any{"body": "great"}))
	student.mustStatus(422, "POST", "/api/books/"+id+"/comments", map[string]any{"body": " "})
	teacher.mustStatus(204, "DELETE", "/api/comments/"+itoa(c.Comment.ID), nil)
	student.mustStatus(404, "DELETE", "/api/comments/"+itoa(c.Comment.ID), nil)
}

func TestHuntOverHTTP(t *testing.T) {
	e, teacher, student := seeded(t)
	other := e.client()
	other.login("teacher@demo.school", "DEMOCODE")
	hunt := map[string]any{"title": "Chem hunt", "subject": "chemistry", "description": "d", "imageUrl": "", "published": true, "stages": []map[string]any{
		{"title": "A", "clue": "go to the lab", "answers": []string{"na"}},
		{"title": "B", "clue": "now the roof", "answers": []string{"cl"}},
	}}
	student.mustStatus(403, "POST", "/api/admin/hunts", hunt)
	made := decode[struct {
		Hunt   struct{ ID int64 }
		Stages []struct {
			ID    int64
			Token string
		}
	}](t, teacher.mustStatus(201, "POST", "/api/admin/hunts", hunt))
	id := itoa(made.Hunt.ID)
	if !strings.HasPrefix(made.Stages[0].Token, "stage.") {
		t.Fatalf("token %q", made.Stages[0].Token)
	}
	// students never get the answers or later clues
	raw := string(student.mustStatus(200, "GET", "/api/hunts/"+id, nil))
	if strings.Contains(raw, "now the roof") || strings.Contains(raw, `"answers"`) {
		t.Fatalf("leak: %s", raw)
	}
	for i := 0; i < 8; i++ {
		student.mustStatus(200, "POST", "/api/hunts/"+id+"/code", map[string]any{"code": "nope"})
	}
	student.mustStatus(429, "POST", "/api/hunts/"+id+"/code", map[string]any{"code": "na"})

	// a station QR code completes stage 1 for someone else
	scan := decode[struct {
		OK   bool
		Href string
	}](t, other.mustStatus(200, "POST", "/api/scan", map[string]any{"code": "https://x/c/" + made.Stages[0].Token}))
	if !scan.OK || scan.Href != "/hunts/"+id {
		t.Fatalf("scan %+v", scan)
	}
	// hunt evidence is private
	res, up := student.upload("/api/uploads?kind=hunt", tinyPNG)
	if res.StatusCode != 201 {
		t.Fatalf("upload %d %s", res.StatusCode, up)
	}
	url := decode[struct{ URL string }](t, up).URL
	if r, _ := other.do("GET", url, nil, nil); r.StatusCode != 200 { // a teacher
		t.Fatalf("teacher must see evidence, got %d", r.StatusCode)
	}
	third := e.client()
	if _, err := e.app.DB.Write.Exec(`INSERT INTO users (email, name, role, login_code_hash) SELECT 'third@demo.school', 'Third', 'student', login_code_hash FROM users WHERE email = 'student@demo.school'`); err != nil {
		t.Fatal(err)
	}
	third.login("third@demo.school", "DEMOCODE")
	if r, _ := third.do("GET", url, nil, nil); r.StatusCode != 404 {
		t.Fatalf("other students must not see evidence, got %d", r.StatusCode)
	}
	if r, _ := student.upload("/api/uploads?kind=content", tinyPNG); r.StatusCode != 422 {
		t.Fatalf("content kind: %d", r.StatusCode)
	}
	teacher.mustStatus(200, "GET", "/api/admin/hunts/"+id+"/results", nil)
}

func TestWorksOverHTTP(t *testing.T) {
	e, teacher, student := seeded(t)
	ev := "1"
	_, up := student.upload("/api/uploads?kind=work", tinyPNG)
	img := decode[struct{ ID int64 }](t, up).ID
	if c := decode[struct{ CanPost bool }](t, student.mustStatus(200, "GET", "/api/events/"+ev+"/works", nil)); c.CanPost {
		t.Fatal("not checked in yet")
	}
	student.mustStatus(403, "POST", "/api/events/"+ev+"/works", map[string]any{"imageId": img, "caption": "mine"})
	if _, err := e.app.ManualCheckIn(context.Background(), 1, "student@demo.school"); err != nil {
		t.Fatal(err)
	}
	w := decode[struct{ Work struct{ ID int64 } }](t, student.mustStatus(201, "POST", "/api/events/"+ev+"/works", map[string]any{"imageId": img, "caption": "mine"}))
	if c := decode[struct {
		Works   []struct{ Caption string }
		CanPost bool
	}](t, student.mustStatus(200, "GET", "/api/events/"+ev+"/works", nil)); !c.CanPost || len(c.Works) != 1 {
		t.Fatalf("%+v", c)
	}
	teacher.mustStatus(204, "DELETE", "/api/works/"+itoa(w.Work.ID), nil)
}
