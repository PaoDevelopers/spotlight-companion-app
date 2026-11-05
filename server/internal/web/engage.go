package web

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

// Library, scavenger hunts and shared works.

type bookBody struct {
	Title    string `json:"title"`
	Author   string `json:"author"`
	Subject  string `json:"subject"`
	Summary  string `json:"summary"`
	BodyMD   string `json:"bodyMd"`
	ImageURL string `json:"imageUrl"`
}

func (b bookBody) input() app.BookInput {
	return app.BookInput{Title: b.Title, Author: b.Author, Subject: b.Subject, Summary: b.Summary, BodyMD: b.BodyMD, ImageURL: b.ImageURL}
}

func (s *Server) books(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Books(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": list})
}

func (s *Server) book(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	b, err := s.app.Book(r.Context(), id, u.ID)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	cs, err := s.app.Comments(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"book": b, "comments": cs})
}

func (s *Server) setRead(read bool) func(http.ResponseWriter, *http.Request, app.User) {
	return func(w http.ResponseWriter, r *http.Request, u app.User) {
		id, ok := pathID(w, r, "id")
		if !ok {
			return
		}
		if err := s.app.SetRead(r.Context(), id, u.ID, read); err != nil {
			s.appError(w, r, err)
			return
		}
		b, err := s.app.Book(r.Context(), id, u.ID)
		if err != nil {
			s.appError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"book": b})
	}
}

func (s *Server) addComment(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	c, err := s.app.AddComment(r.Context(), id, u, in.Body)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"comment": c})
}

func (s *Server) deleteComment(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteComment(r.Context(), id, u); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminBooks lists the books with the address of the site, which the QR signs need.
func (s *Server) adminBooks(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Books(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": list, "baseUrl": s.app.Cfg.PublicURL})
}

func (s *Server) adminSaveBook(create bool) func(http.ResponseWriter, *http.Request, app.User) {
	return func(w http.ResponseWriter, r *http.Request, u app.User) {
		var in bookBody
		if !readJSON(w, r, &in) {
			return
		}
		var b app.Book
		var err error
		if create {
			b, err = s.app.CreateBook(r.Context(), in.input())
		} else {
			id, ok := pathID(w, r, "id")
			if !ok {
				return
			}
			b, err = s.app.UpdateBook(r.Context(), id, in.input())
		}
		if err != nil {
			s.appError(w, r, err)
			return
		}
		status := http.StatusOK
		if create {
			status = http.StatusCreated
		}
		writeJSON(w, status, map[string]any{"book": b})
	}
}

func (s *Server) adminDeleteBook(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteBook(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- student pictures ----

// uploadStudentImage stores a picture a student is about to attach to a shared work or hunt stage.
func (s *Server) uploadStudentImage(w http.ResponseWriter, r *http.Request, u app.User) {
	kind := r.URL.Query().Get("kind")
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, app.MaxImageBytes+1))
	if err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "too_large", "that picture is too large")
		return
	}
	id, err := s.app.SaveStudentImage(r.Context(), u, data, kind)
	if err != nil {
		if errors.Is(err, app.ErrInvalid) {
			fail(w, http.StatusUnprocessableEntity, "invalid", "use a PNG, JPEG, GIF or WebP picture under 6 MB")
			return
		}
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "url": "/api/images/" + strconv.FormatInt(id, 10)})
}

// ---- works ----

func (s *Server) works(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if _, err := s.app.Event(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	list, err := s.app.Works(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	in, err := s.app.HasCheckin(r.Context(), id, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"works": list, "canPost": in})
}

func (s *Server) addWork(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		ImageID int64  `json:"imageId"`
		Caption string `json:"caption"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	work, err := s.app.AddWork(r.Context(), id, u, in.ImageID, in.Caption)
	if err != nil {
		if errors.Is(err, app.ErrForbidden) {
			fail(w, http.StatusForbidden, "forbidden", "Check in to this event first, then share your work.")
			return
		}
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"work": work})
}

func (s *Server) deleteWork(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteWork(r.Context(), id, u); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- hunts (students) ----

func (s *Server) hunts(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.PublishedHunts(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hunts": list})
}

func (s *Server) hunt(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	v, err := s.app.HuntFor(r.Context(), id, u)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hunt": v})
}

// huntCodeLimiterKey keeps guessing in check: a few wrong codes in a row make a student wait.
func huntKey(userID int64) string { return "hunt:" + strconv.FormatInt(userID, 10) }

func (s *Server) submitCode(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	now := time.Now()
	key := huntKey(u.ID)
	if s.guesses.blocked(key, now) {
		fail(w, http.StatusTooManyRequests, "too_many", "Too many wrong answers. Wait a minute, then try again.")
		return
	}
	out, err := s.app.SubmitCode(r.Context(), id, u, in.Code)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	if out.Result == "wrong" {
		s.guesses.fail(key, now)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) addHuntPhoto(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		ImageID int64  `json:"imageId"`
		Caption string `json:"caption"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	p, err := s.app.AddHuntPhoto(r.Context(), u, id, in.ImageID, in.Caption)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"photo": p})
}

func (s *Server) deleteHuntPhoto(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteHuntPhoto(r.Context(), id, u); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- hunts (teachers) ----

type huntBody struct {
	Title       string `json:"title"`
	Subject     string `json:"subject"`
	Description string `json:"description"`
	ImageURL    string `json:"imageUrl"`
	Published   bool   `json:"published"`
	Stages      []struct {
		ID      *int64   `json:"id"`
		Title   string   `json:"title"`
		Clue    string   `json:"clue"`
		Answers []string `json:"answers"`
	} `json:"stages"`
}

func (b huntBody) input() app.HuntInput {
	in := app.HuntInput{Title: b.Title, Subject: b.Subject, Description: b.Description, ImageURL: b.ImageURL, Published: b.Published}
	for _, st := range b.Stages {
		in.Stages = append(in.Stages, app.StageInput{ID: st.ID, Title: st.Title, Clue: st.Clue, Answers: st.Answers})
	}
	return in
}

type stageAdminView struct {
	app.StageAdmin
	Token string `json:"token"`
	URL   string `json:"url"`
}

func (s *Server) adminHuntView(id int64, r *http.Request) (map[string]any, error) {
	h, stages, err := s.app.HuntForEditing(r.Context(), id)
	if err != nil {
		return nil, err
	}
	out := make([]stageAdminView, 0, len(stages))
	for _, st := range stages {
		t := token.MakeTag(s.app.Cfg.Secret, token.KindStage, st.ID)
		out = append(out, stageAdminView{st, t, s.app.Cfg.PublicURL + "/c/" + t})
	}
	return map[string]any{"hunt": h, "stages": out}, nil
}

func (s *Server) adminHunts(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.AllHunts(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hunts": list})
}

func (s *Server) adminHunt(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	v, err := s.adminHuntView(id, r)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) adminSaveHunt(create bool) func(http.ResponseWriter, *http.Request, app.User) {
	return func(w http.ResponseWriter, r *http.Request, u app.User) {
		var in huntBody
		if !readJSON(w, r, &in) {
			return
		}
		var id int64
		if !create {
			var ok bool
			if id, ok = pathID(w, r, "id"); !ok {
				return
			}
		}
		id, err := s.app.SaveHunt(r.Context(), id, in.input())
		if err != nil {
			s.appError(w, r, err)
			return
		}
		v, err := s.adminHuntView(id, r)
		if err != nil {
			s.appError(w, r, err)
			return
		}
		status := http.StatusOK
		if create {
			status = http.StatusCreated
		}
		writeJSON(w, status, v)
	}
}

func (s *Server) adminDeleteHunt(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteHunt(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminHuntResults(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	h, _, err := s.app.HuntForEditing(r.Context(), id)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	rows, err := s.app.HuntResults(r.Context(), id)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hunt": h, "results": rows})
}

func (s *Server) adminMarkStage(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		UserID  int64 `json:"userId"`
		StageID int64 `json:"stageId"`
		Done    bool  `json:"done"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.MarkStage(r.Context(), u.ID, id, in.UserID, in.StageID, in.Done); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
