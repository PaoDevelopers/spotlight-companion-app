package web

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

func (s *Server) adminStats(w http.ResponseWriter, r *http.Request, u app.User) {
	st, err := s.app.Stats(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// eventBody is what the create/edit form sends.
type eventBody struct {
	Title       string `json:"title"`
	Subject     string `json:"subject"`
	Description string `json:"description"`
	Venue       string `json:"venue"`
	StartsAt    string `json:"startsAt"` // RFC 3339, e.g. 2026-11-20T18:00:00+08:00
	EndsAt      string `json:"endsAt"`
	Capacity    *int64 `json:"capacity"`
	ImageURL    string `json:"imageUrl"`
	Host        string `json:"host"`
	// SignupEnabled is a pointer so that older clients that don't send it keep sign-up on.
	SignupEnabled *bool `json:"signupEnabled"`
	// Competition is "", "individual", "team" or "house".
	Competition string `json:"competition"`
}

func (b eventBody) input() (app.EventInput, error) {
	st, err1 := time.Parse(time.RFC3339, b.StartsAt)
	en, err2 := time.Parse(time.RFC3339, b.EndsAt)
	if err1 != nil || err2 != nil {
		return app.EventInput{}, app.ErrInvalid
	}
	return app.EventInput{Title: b.Title, Subject: b.Subject, Description: b.Description, Venue: b.Venue, StartsAt: st, EndsAt: en, Capacity: b.Capacity,
		ImageURL: b.ImageURL, Host: b.Host, NoSignup: b.SignupEnabled != nil && !*b.SignupEnabled, Competition: b.Competition}, nil
}

func (s *Server) adminEvents(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Events(r.Context(), "")
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) adminCreateEvent(w http.ResponseWriter, r *http.Request, u app.User) {
	var b eventBody
	if !readJSON(w, r, &b) {
		return
	}
	in, err := b.input()
	if err != nil {
		s.appError(w, r, err)
		return
	}
	ev, err := s.app.CreateEvent(r.Context(), in)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, ev)
}

func (s *Server) adminEvent(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	ev, err := s.app.Event(r.Context(), id)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	att, err := s.app.Attendees(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	signups, err := s.app.Signups(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	entries, err := s.app.CompetitionEntryCount(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	tag := token.MakeTag(s.app.Cfg.Secret, token.KindEvent, id)
	writeJSON(w, http.StatusOK, map[string]any{"event": ev, "attendees": att, "signups": signups, "competitionEntries": entries, "tagToken": tag, "tagUrl": s.app.Cfg.PublicURL + "/c/" + tag})
}

func (s *Server) adminUpdateEvent(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var b eventBody
	if !readJSON(w, r, &b) {
		return
	}
	in, err := b.input()
	if err != nil {
		s.appError(w, r, err)
		return
	}
	ev, err := s.app.UpdateEvent(r.Context(), id, in)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ev)
}

func (s *Server) adminDeleteEvent(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteEvent(r.Context(), id); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminAddAttendee(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Email  string `json:"email"`
		UserID int64  `json:"userId"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	var err error
	if in.UserID > 0 {
		_, err = s.app.ManualCheckInID(r.Context(), id, in.UserID)
	} else {
		_, err = s.app.ManualCheckIn(r.Context(), id, in.Email)
	}
	if err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminUndoAttendee(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	uid, ok := pathID(w, r, "userId")
	if !ok {
		return
	}
	if err := s.app.UndoCheckIn(r.Context(), id, uid); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminAttendeesCSV(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	rows, err := s.app.Attendees(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=attendance.csv")
	w.Write([]byte(app.AttendeesCSV(rows)))
}

func (s *Server) adminScanPass(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Token string `json:"token"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	student, res, err := s.app.CheckInByPass(r.Context(), id, extractCode(in.Token))
	switch {
	case err == nil && res.Duplicate:
		writeJSON(w, http.StatusOK, scanResponse{OK: true, Message: student.Name + " was already checked in"})
	case err == nil:
		writeJSON(w, http.StatusOK, scanResponse{OK: true, Message: student.Name + " checked in"})
	default:
		msg := map[string]string{"invalid or expired code": "Not a valid pass", "not found": "Student or event not found",
			"check-in is not open for this event": "Closed", "this event is full": "Event is full"}[err.Error()]
		if msg == "" {
			s.appError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, scanResponse{Message: msg})
	}
}

// adminEventToken is the rotating code shown on the projector. It must never be cached.
func (s *Server) adminEventToken(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if _, err := s.app.Event(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	t := token.MakeEvent(s.app.Cfg.Secret, id, s.app.Now().UnixMilli())
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"token": t, "url": s.app.Cfg.PublicURL + "/c/" + t})
}

type exhibitAdminView struct {
	app.Exhibit
	TagToken string `json:"tagToken"`
	TagURL   string `json:"tagUrl"`
}

func (s *Server) adminExhibits(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Exhibits(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]exhibitAdminView, 0, len(list))
	for _, x := range list {
		t := token.MakeTag(s.app.Cfg.Secret, token.KindExhibit, x.ID)
		out = append(out, exhibitAdminView{x, t, s.app.Cfg.PublicURL + "/c/" + t})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) adminSaveExhibit(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		Title    string   `json:"title"`
		Slug     string   `json:"slug"`
		Subject  string   `json:"subject"`
		Summary  string   `json:"summary"`
		BodyMD   string   `json:"bodyMd"`
		ImageURL string   `json:"imageUrl"`
		Owners   []string `json:"owners"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if img := strings.TrimSpace(in.ImageURL); img != "" && !strings.HasPrefix(img, "https://") && (!strings.HasPrefix(img, "/") || strings.HasPrefix(img, "//")) {
		s.appError(w, r, app.ErrInvalid) // no javascript: or data: URLs in the image field
		return
	}
	x, err := s.app.SaveExhibit(r.Context(), app.ExhibitInput{Slug: in.Slug, Title: in.Title, Subject: in.Subject, Summary: in.Summary, BodyMD: in.BodyMD, ImageURL: in.ImageURL, OwnerEmails: in.Owners})
	if err != nil {
		s.appError(w, r, err)
		return
	}
	t := token.MakeTag(s.app.Cfg.Secret, token.KindExhibit, x.ID)
	writeJSON(w, http.StatusOK, exhibitAdminView{x, t, s.app.Cfg.PublicURL + "/c/" + t})
}

type compAdminView struct {
	app.Competition
	Entries []app.Entry `json:"entries"`
}

func (s *Server) adminCompetitions(w http.ResponseWriter, r *http.Request, u app.User) {
	ctx := r.Context()
	events, err := s.app.Events(ctx, "")
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	comps, err := s.app.AllCompetitions(ctx)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	entries, err := s.app.Entries(ctx)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	views := make([]compAdminView, 0, len(comps))
	for _, c := range comps {
		v := compAdminView{Competition: c, Entries: []app.Entry{}}
		for _, e := range entries {
			if e.CompetitionID == c.ID {
				v.Entries = append(v.Entries, e)
			}
		}
		views = append(views, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "competitions": views})
}

// adminAddEntry enters a student in a competition by hand: for someone with no phone, or a wrong or missed sign-up.
func (s *Server) adminAddEntry(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		UserID int64  `json:"userId"`
		Team   string `json:"team"`
		House  string `json:"house"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if _, err := s.app.UserByID(r.Context(), in.UserID); err != nil {
		s.appError(w, r, app.ErrInvalid)
		return
	}
	if err := s.app.Register(r.Context(), id, in.UserID, in.Team, in.House); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminDeleteEntry(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteEntry(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminUpdateEntry(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Status string  `json:"status"`
		Score  *int64  `json:"score"`
		Rank   *int64  `json:"rank"`
		Notes  *string `json:"notes"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.UpdateEntry(r.Context(), id, app.EntryPatch{Status: in.Status, Score: in.Score, Rank: in.Rank, Notes: in.Notes}); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminAwards(w http.ResponseWriter, r *http.Request, u app.User) {
	ctx := r.Context()
	drafts, err := s.app.AwardResults(ctx, false, 0)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	published, err := s.app.AwardResults(ctx, true, 0)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	ex, err := s.app.Exhibits(ctx)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	mine, err := s.app.MyJudgeScores(ctx, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	preview, err := s.app.AwardPreview(ctx)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	type exh struct {
		ID      int64  `json:"id"`
		Title   string `json:"title"`
		MyScore *int64 `json:"myScore"`
	}
	exs := make([]exh, 0, len(ex))
	for _, x := range ex {
		e := exh{ID: x.ID, Title: x.Title}
		if sc, ok := mine[x.ID]; ok {
			e.MyScore = &sc
		}
		exs = append(exs, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"exhibits": exs, "drafts": drafts, "published": published,
		"liveWinners": len(preview.Participation) + len(preview.Explorer) + len(preview.Creative),
	})
}

func (s *Server) adminJudgeScore(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		ExhibitID int64   `json:"exhibitId"`
		Score     float64 `json:"score"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.ScoreExhibit(r.Context(), u.ID, in.ExhibitID, in.Score); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminRunAwards(w http.ResponseWriter, r *http.Request, u app.User) {
	if _, err := s.app.RunAwards(r.Context(), &u.ID); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminVeto(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		ID     int64  `json:"id"`
		Reason string `json:"reason"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.RemoveDraftResult(r.Context(), in.ID, u.ID, strings.TrimSpace(in.Reason)); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminPublish(w http.ResponseWriter, r *http.Request, u app.User) {
	n, err := s.app.PublishAwards(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"published": n})
}

func (s *Server) adminRoster(w http.ResponseWriter, r *http.Request, u app.User) {
	if s.app.Cfg.AuthMode != "roster" {
		fail(w, http.StatusConflict, "not_in_use", "Login codes aren't used with Microsoft sign-in.")
		return
	}
	var in struct {
		CSV string `json:"csv"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	rows, err := app.ParseRosterCSV(in.CSV)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, "invalid", err.Error())
		return
	}
	issued, err := s.app.ImportRoster(r.Context(), u, rows)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if issued == nil {
		issued = []app.Issued{}
	}
	w.Header().Set("Cache-Control", "no-store") // the response holds one-time login codes
	writeJSON(w, http.StatusOK, map[string]any{"issued": issued})
}

func (s *Server) adminSetRole(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct{ Email, Role string }
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.SetRole(r.Context(), u, in.Email, in.Role); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// cronAwards lets an external scheduler (cron, systemd timer) compute draft awards. The server also does
// this itself every day, so this is optional; it stays off unless CRON_SECRET is set.
func (s *Server) cronAwards(w http.ResponseWriter, r *http.Request) {
	want := s.app.Cfg.CronSecret
	if want == "" {
		http.NotFound(w, r)
		return
	}
	if !constantEq(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), want) {
		fail(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}
	res, err := s.app.RunAwards(r.Context(), nil)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "winners": map[string]int{
		"participation": len(res.Participation), "explorer": len(res.Explorer), "creative": len(res.Creative)}})
}

// adminSignup signs a student up on their behalf (for example one who has no device), by id or email.
func (s *Server) adminSignup(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Email  string `json:"email"`
		UserID int64  `json:"userId"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	uid := in.UserID
	if uid <= 0 {
		target, err := s.app.UserByEmail(r.Context(), in.Email)
		if err != nil {
			s.appError(w, r, err)
			return
		}
		uid = target.ID
	}
	if err := s.app.SignUp(r.Context(), id, uid, true); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminCancelSignup(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	uid, ok := pathID(w, r, "userId")
	if !ok {
		return
	}
	if err := s.app.CancelSignup(r.Context(), id, uid); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminStudents(w http.ResponseWriter, r *http.Request, u app.User) {
	hits, err := s.app.SearchStudents(r.Context(), r.URL.Query().Get("q"), 8)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, hits)
}

func (s *Server) adminDeleteExhibit(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteExhibit(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminUploadImage takes the raw bytes of one picture and answers with the address to put in a description.
func (s *Server) adminUploadImage(w http.ResponseWriter, r *http.Request, u app.User) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, app.MaxImageBytes+1))
	if err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "too_large", "that picture is too large")
		return
	}
	id, err := s.app.SaveImage(r.Context(), data, u.ID)
	if err != nil {
		if errors.Is(err, app.ErrInvalid) {
			fail(w, http.StatusUnprocessableEntity, "invalid", "use a PNG, JPEG, GIF or WebP picture under 6 MB")
			return
		}
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "url": "/api/images/" + strconv.FormatInt(id, 10)})
}
