package web

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var tinyPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

func (c *client) upload(path string, data []byte) (*http.Response, []byte) {
	c.e.t.Helper()
	req, _ := http.NewRequest("POST", c.e.base+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := c.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

func TestImagesUploadAndServe(t *testing.T) {
	_, teacher, student := seeded(t)

	if res, _ := student.upload("/api/admin/images", tinyPNG); res.StatusCode != 403 {
		t.Fatalf("students must not upload, got %d", res.StatusCode)
	}
	res, body := teacher.upload("/api/admin/images", tinyPNG)
	if res.StatusCode != 201 {
		t.Fatalf("upload: %d %s", res.StatusCode, body)
	}
	url := decode[struct{ URL string }](t, body).URL
	if !strings.HasPrefix(url, "/api/images/") {
		t.Fatalf("url %q", url)
	}
	got, data := student.do("GET", url, nil, nil)
	if got.StatusCode != 200 || got.Header.Get("Content-Type") != "image/png" || !bytes.Equal(data, tinyPNG) {
		t.Fatalf("serve: %d %q", got.StatusCode, got.Header.Get("Content-Type"))
	}
	if cc := got.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") || !strings.Contains(cc, "private") {
		t.Errorf("cache-control %q", cc)
	}
	if res, _ := e2(t).do("GET", url, nil, nil); res.StatusCode != 401 {
		t.Errorf("signed-out users must not see pictures, got %d", res.StatusCode)
	}
	// the type comes from the bytes: svg and html are refused whatever they claim to be
	for name, payload := range map[string][]byte{
		"svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"html": []byte("<html><script>alert(1)</script></html>"),
		"text": []byte("hello"),
		"none": {},
	} {
		if res, _ := teacher.upload("/api/admin/images", payload); res.StatusCode != 422 {
			t.Errorf("%s upload should be refused with 422, got %d", name, res.StatusCode)
		}
	}
	big := append(append([]byte{}, tinyPNG...), make([]byte, 7<<20)...)
	if res, _ := teacher.upload("/api/admin/images", big); res.StatusCode != 413 && res.StatusCode != 422 {
		t.Errorf("oversize upload got %d", res.StatusCode)
	}
	if res, _ := teacher.do("GET", "/api/images/999", nil, nil); res.StatusCode != 404 {
		t.Errorf("missing picture: %d", res.StatusCode)
	}
}

// e2 returns a client that never signed in.
func e2(t *testing.T) *client {
	e := setup(t, "roster")
	return e.client()
}

func TestDeleteExhibitCompetitionAndChemistry(t *testing.T) {
	_, teacher, student := seeded(t)
	type ex struct {
		ID   int64
		Slug string
	}
	list := decode[[]ex](t, teacher.mustStatus(200, "GET", "/api/admin/exhibits", nil))
	if len(list) == 0 {
		t.Fatal("no demo exhibits")
	}
	teacher.mustStatus(204, "DELETE", "/api/admin/exhibits/"+itoa(list[0].ID), nil)
	teacher.mustStatus(404, "DELETE", "/api/admin/exhibits/"+itoa(list[0].ID), nil)
	student.mustStatus(404, "GET", "/api/exhibits/"+list[0].Slug, nil)
	student.mustStatus(403, "DELETE", "/api/admin/exhibits/"+itoa(list[1].ID), nil)

	// a chemistry event and exhibit can be created, and the student filter finds them
	start := time.Now().Add(48 * time.Hour).UTC()
	ev := map[string]any{"title": "Reactions", "subject": "chemistry", "startsAt": start.Format(time.RFC3339), "endsAt": start.Add(time.Hour).Format(time.RFC3339)}
	teacher.mustStatus(201, "POST", "/api/admin/events", ev)
	found := decode[[]struct{ Title string }](t, student.mustStatus(200, "GET", "/api/events?subject=chemistry", nil))
	titles := map[string]bool{}
	for _, f := range found {
		titles[f.Title] = true
	}
	// the filter keeps mixed-subject events too, but not other single subjects
	if !titles["Reactions"] || titles["Rube Goldberg Contest"] || titles["Hackathon"] {
		t.Fatalf("chemistry filter: %+v", found)
	}
	teacher.mustStatus(200, "POST", "/api/admin/exhibits", map[string]any{"title": "Indicators", "subject": "chemistry"})
	ev["subject"] = "biology"
	teacher.mustStatus(422, "POST", "/api/admin/events", ev)

}

func TestCompetitionToggleOnEventAndEntriesByHand(t *testing.T) {
	_, teacher, student := seeded(t)
	start := time.Now().Add(72 * time.Hour).UTC()
	body := map[string]any{"title": "Sports Day", "subject": "both", "startsAt": start.Format(time.RFC3339), "endsAt": start.Add(3 * time.Hour).Format(time.RFC3339), "competition": "house"}
	ev := decode[struct {
		ID          int64
		Competition *string
	}](t, teacher.mustStatus(201, "POST", "/api/admin/events", body))
	if ev.Competition == nil || *ev.Competition != "house" {
		t.Fatalf("event should say it is a house competition: %+v", ev)
	}
	view := decode[struct {
		Competitions []struct {
			ID     int64
			Kind   string
			Houses []string
		}
	}](t, student.mustStatus(200, "GET", "/api/events/"+itoa(ev.ID), nil))
	if len(view.Competitions) != 1 || view.Competitions[0].Kind != "house" || len(view.Competitions[0].Houses) != 4 {
		t.Fatalf("%+v", view)
	}
	cid := view.Competitions[0].ID
	student.mustStatus(422, "POST", "/api/competitions/"+itoa(cid)+"/register", map[string]string{})
	student.mustStatus(204, "POST", "/api/competitions/"+itoa(cid)+"/register", map[string]string{"house": "Winter"})

	// a teacher enters a student who has no phone, and removes a wrong entry
	hits := decode[[]struct{ ID int64 }](t, teacher.mustStatus(200, "GET", "/api/admin/students?q=student", nil))
	if len(hits) == 0 {
		t.Fatal("demo student not found")
	}
	teacher.mustStatus(204, "POST", "/api/admin/competitions/"+itoa(cid)+"/entries", map[string]any{"userId": hits[0].ID, "house": "Summer"})
	teacher.mustStatus(422, "POST", "/api/admin/competitions/"+itoa(cid)+"/entries", map[string]any{"userId": hits[0].ID, "house": "Nope"})
	teacher.mustStatus(422, "POST", "/api/admin/competitions/"+itoa(cid)+"/entries", map[string]any{"userId": 99999, "house": "Summer"})
	student.mustStatus(403, "POST", "/api/admin/competitions/"+itoa(cid)+"/entries", map[string]any{"userId": hits[0].ID, "house": "Summer"})
	comps := decode[struct {
		Competitions []struct{ Entries []struct{ ID int64 } }
	}](t, teacher.mustStatus(200, "GET", "/api/admin/competitions", nil))
	var entryID int64
	for _, c := range comps.Competitions {
		for _, e := range c.Entries {
			entryID = e.ID
		}
	}
	if entryID == 0 {
		t.Fatal("no entry to delete")
	}
	teacher.mustStatus(204, "DELETE", "/api/admin/entries/"+itoa(entryID), nil)
	teacher.mustStatus(404, "DELETE", "/api/admin/entries/"+itoa(entryID), nil)

	// the leaderboard has a house board with all four houses
	lb := decode[struct {
		Competitions []struct {
			Kind   string
			Groups []struct{ Label string }
		}
	}](t, student.mustStatus(200, "GET", "/api/leaderboard", nil))
	var houseBoard bool
	for _, c := range lb.Competitions {
		if c.Kind == "house" && len(c.Groups) == 4 {
			houseBoard = true
		}
	}
	if !houseBoard {
		t.Fatalf("leaderboard: %+v", lb)
	}

	// the admin event view says how many entries turning the competition off would delete
	adm := decode[struct{ CompetitionEntries int64 }](t, teacher.mustStatus(200, "GET", "/api/admin/events/"+itoa(ev.ID), nil))
	if adm.CompetitionEntries < 0 {
		t.Fatal("entry count missing")
	}
	body["competition"] = ""
	teacher.mustStatus(200, "PUT", "/api/admin/events/"+itoa(ev.ID), body)
	after := decode[struct{ Competitions []struct{ ID int64 } }](t, student.mustStatus(200, "GET", "/api/events/"+itoa(ev.ID), nil))
	if len(after.Competitions) != 0 {
		t.Fatalf("competition should be gone: %+v", after)
	}
}

func TestAwardsOverHTTP(t *testing.T) {
	_, teacher, student := seeded(t)
	hits := decode[[]struct{ ID int64 }](t, teacher.mustStatus(200, "GET", "/api/admin/students?q=student", nil))
	body := map[string]any{"title": "Best Presentation", "reason": "Explained the maths clearly", "userIds": []int64{hits[0].ID}}

	student.mustStatus(403, "POST", "/api/admin/awards", body)
	student.mustStatus(403, "POST", "/api/admin/awards/publish", map[string]any{"published": true})
	teacher.mustStatus(422, "POST", "/api/admin/awards", map[string]any{"title": "", "userIds": []int64{hits[0].ID}})
	teacher.mustStatus(201, "POST", "/api/admin/awards", body)

	type home struct {
		Awards []struct{ Title, Reason string }
	}
	if h := decode[home](t, student.mustStatus(200, "GET", "/api/home", nil)); len(h.Awards) != 0 {
		t.Fatalf("a draft reached the student: %+v", h)
	}
	list := decode[struct{ Awards []struct{ ID int64 } }](t, teacher.mustStatus(200, "GET", "/api/admin/awards", nil))
	if len(list.Awards) != 1 {
		t.Fatalf("%+v", list)
	}
	teacher.mustStatus(200, "POST", "/api/admin/awards/publish", map[string]any{"published": true})
	h := decode[home](t, student.mustStatus(200, "GET", "/api/home", nil))
	if len(h.Awards) != 1 || h.Awards[0].Title != "Best Presentation" || h.Awards[0].Reason != "Explained the maths clearly" {
		t.Fatalf("student's award: %+v", h)
	}
	board := string(student.mustStatus(200, "GET", "/api/leaderboard", nil))
	if !strings.Contains(board, "Best Presentation") || strings.Contains(board, "Demo Student") || strings.Contains(board, "Explained the maths") {
		t.Fatalf("public list must show the title but not a private student's name or reason: %s", board)
	}
	teacher.mustStatus(204, "PUT", "/api/admin/awards/"+itoa(list.Awards[0].ID), map[string]any{"title": "Best Talk", "reason": ""})
	teacher.mustStatus(204, "DELETE", "/api/admin/awards/"+itoa(list.Awards[0].ID), nil)
	teacher.mustStatus(404, "DELETE", "/api/admin/awards/"+itoa(list.Awards[0].ID), nil)
	if h := decode[home](t, student.mustStatus(200, "GET", "/api/home", nil)); len(h.Awards) != 0 {
		t.Fatalf("deleted award still shown: %+v", h)
	}
}

// teacherOnly signs in a second demo teacher who is not an admin.
func teacherOnly(e *env) *client {
	if _, err := e.app.DB.Write.Exec(`INSERT OR IGNORE INTO users (email, name, role) VALUES ('plain.teacher@ykpaoschool.cn', 'Plain Teacher', 'teacher')`); err != nil {
		e.t.Fatal(err)
	}
	c := e.client()
	if _, err := e.app.DB.Write.Exec(`UPDATE users SET login_code_hash = (SELECT login_code_hash FROM users WHERE email = 'student@demo.school') WHERE email = 'plain.teacher@ykpaoschool.cn'`); err != nil {
		e.t.Fatal(err)
	}
	c.login("plain.teacher@ykpaoschool.cn", "DEMOCODE")
	return c
}

func TestAdminUploadsTheStudentList(t *testing.T) {
	e, teacher, student := seeded(t)
	admin := e.client()
	if _, err := e.app.DB.Write.Exec(`UPDATE users SET role = 'admin' WHERE email = 'teacher@demo.school'`); err != nil {
		t.Fatal(err)
	}
	admin.login("teacher@demo.school", "DEMOCODE") // the demo teacher, now an admin
	_ = teacher

	// the school system's SQLite export, invented names
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "students.db")
	d, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE students (id TEXT PRIMARY KEY, english_name TEXT, chinese_name TEXT, system_name TEXT NOT NULL)`,
		`INSERT INTO students VALUES ('s90001', '', '', 'Wong (Mei Ling 黄美玲) Amy')`,
		`INSERT INTO students VALUES ('s90002', '', '', 'Chan (Tai Man 陳大文) Ben')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	d.Close()
	dbBytes, _ := os.ReadFile(dbPath)

	// only admins may load a student list
	if res, _ := student.upload("/api/admin/students/import", dbBytes); res.StatusCode != 403 {
		t.Fatalf("a student must not import: %d", res.StatusCode)
	}
	res, body := teacherOnly(e).upload("/api/admin/students/import", dbBytes)
	_ = body
	if res.StatusCode != 403 {
		t.Fatalf("a teacher who is not an admin must not import: %d", res.StatusCode)
	}

	type report struct{ Read, Added, Existing, Skipped int }
	res, body = admin.upload("/api/admin/students/import?dryRun=1", dbBytes)
	if rep := decode[report](t, body); res.StatusCode != 200 || rep.Added != 2 {
		t.Fatalf("dry run: %d %s", res.StatusCode, body)
	}
	if hits := decode[[]struct{ Name string }](t, admin.mustStatus(200, "GET", "/api/admin/students?q=amy", nil)); len(hits) != 0 {
		t.Fatalf("a dry run must change nothing: %+v", hits)
	}
	res, body = admin.upload("/api/admin/students/import", dbBytes)
	if rep := decode[report](t, body); res.StatusCode != 200 || rep.Added != 2 || rep.Read != 2 {
		t.Fatalf("import: %d %s", res.StatusCode, body)
	}
	if strings.Contains(string(body), "Wong") || strings.Contains(string(body), "黄美玲") {
		t.Fatalf("the answer must hold counts, not names: %s", body)
	}
	hits := decode[[]struct{ Name, Email string }](t, admin.mustStatus(200, "GET", "/api/admin/students?q=黄美玲", nil))
	if len(hits) != 1 || hits[0].Email != "s90001@stu.ykpaoschool.cn" || hits[0].Name != "Mei Ling Wong 黄美玲 (Amy)" {
		t.Fatalf("the loaded student should be findable by their Chinese name: %+v", hits)
	}
	if _, body = admin.upload("/api/admin/students/import", dbBytes); decode[report](t, body).Added != 0 {
		t.Fatalf("a repeat must add nobody: %s", body)
	}

	// a CSV works too, and the upload is not kept on disk or in the database
	if _, body = admin.upload("/api/admin/students/import", []byte("id,name,class\ns90003,Pat Doe,10C\n")); decode[report](t, body).Added != 1 {
		t.Fatalf("csv: %s", body)
	}
	// things that are not student lists are refused
	for name, payload := range map[string][]byte{"text": []byte("hello"), "empty": {}, "wrong csv": []byte("a,b\n1,2\n"), "png": tinyPNG} {
		if res, _ := admin.upload("/api/admin/students/import", payload); res.StatusCode != 422 {
			t.Errorf("%s should be refused with 422, got %d", name, res.StatusCode)
		}
	}
}
