package web

import (
	"bytes"
	"encoding/base64"
	"io"
	"net/http"
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
	created := decode[struct{ ID int64 }](t, teacher.mustStatus(201, "POST", "/api/admin/events", ev))
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

	comp := decode[struct{ ID int64 }](t, teacher.mustStatus(201, "POST", "/api/admin/competitions", map[string]any{"eventId": created.ID, "name": "Titration race"}))
	teacher.mustStatus(204, "DELETE", "/api/admin/competitions/"+itoa(comp.ID), nil)
	teacher.mustStatus(404, "DELETE", "/api/admin/competitions/"+itoa(comp.ID), nil)
}
