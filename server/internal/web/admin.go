package web

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
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
	Visits   int64  `json:"visits"`
}

func (s *Server) exhibitView(x app.Exhibit, visits int64) exhibitAdminView {
	t := token.MakeTag(s.app.Cfg.Secret, token.KindExhibit, x.ID)
	return exhibitAdminView{x, t, s.app.Cfg.PublicURL + "/c/" + t, visits}
}

func (s *Server) adminExhibits(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Exhibits(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	visits, err := s.app.ExhibitVisitCounts(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]exhibitAdminView, 0, len(list))
	for _, x := range list {
		out = append(out, s.exhibitView(x, visits[x.ID]))
	}
	writeJSON(w, http.StatusOK, out)
}

type exhibitBody struct {
	Title    string `json:"title"`
	Slug     string `json:"slug"`
	Subject  string `json:"subject"`
	Summary  string `json:"summary"`
	BodyMD   string `json:"bodyMd"`
	ImageURL string `json:"imageUrl"`
	// ExhibitionID puts the installation in an exhibition; null or absent leaves it standalone.
	ExhibitionID *int64 `json:"exhibitionId"`
}

func (b exhibitBody) input() app.ExhibitInput {
	return app.ExhibitInput{Slug: b.Slug, Title: b.Title, Subject: b.Subject, Summary: b.Summary, BodyMD: b.BodyMD, ImageURL: b.ImageURL, ExhibitionID: b.ExhibitionID}
}

type exhibitionBody struct {
	Title    string `json:"title"`
	Subject  string `json:"subject"`
	Summary  string `json:"summary"`
	BodyMD   string `json:"bodyMd"`
	ImageURL string `json:"imageUrl"`
}

func (b exhibitionBody) input() app.ExhibitionInput {
	return app.ExhibitionInput{Title: b.Title, Subject: b.Subject, Summary: b.Summary, BodyMD: b.BodyMD, ImageURL: b.ImageURL}
}

func (s *Server) adminExhibitions(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Exhibitions(r.Context(), 0)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) adminCreateExhibition(w http.ResponseWriter, r *http.Request, u app.User) {
	var in exhibitionBody
	if !readJSON(w, r, &in) {
		return
	}
	x, err := s.app.CreateExhibition(r.Context(), in.input())
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, x)
}

func (s *Server) adminUpdateExhibition(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in exhibitionBody
	if !readJSON(w, r, &in) {
		return
	}
	x, err := s.app.UpdateExhibition(r.Context(), id, in.input())
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, x)
}

func (s *Server) adminDeleteExhibition(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteExhibition(r.Context(), id); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminCreateExhibit adds a new exhibit. It never overwrites an existing one.
func (s *Server) adminCreateExhibit(w http.ResponseWriter, r *http.Request, u app.User) {
	var in exhibitBody
	if !readJSON(w, r, &in) {
		return
	}
	x, err := s.app.CreateExhibit(r.Context(), in.input())
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, s.exhibitView(x, 0))
}

func (s *Server) adminUpdateExhibit(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in exhibitBody
	if !readJSON(w, r, &in) {
		return
	}
	x, err := s.app.UpdateExhibit(r.Context(), id, in.input())
	if err != nil {
		s.appError(w, r, err)
		return
	}
	visits, err := s.app.ExhibitVisitCounts(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s.exhibitView(x, visits[x.ID]))
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

// adminAwards lists every award, drafts included, and the titles used so far (to suggest for the next one).
func (s *Server) adminAwards(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.AllAwards(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"awards": list})
}

func (s *Server) adminAddAwards(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		Title   string  `json:"title"`
		Reason  string  `json:"reason"`
		UserIDs []int64 `json:"userIds"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	n, err := s.app.AddAwards(r.Context(), u.ID, in.Title, in.Reason, in.UserIDs)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"created": n})
}

func (s *Server) adminUpdateAward(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Title  string `json:"title"`
		Reason string `json:"reason"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.UpdateAward(r.Context(), u.ID, id, in.Title, in.Reason); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminDeleteAward(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.DeleteAward(r.Context(), u.ID, id); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminPublishAwards shows awards to students (or hides them again). Without ids it publishes every draft.
func (s *Server) adminPublishAwards(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		IDs       []int64 `json:"ids"`
		Published bool    `json:"published"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	n, err := s.app.SetAwardsPublished(r.Context(), u.ID, in.IDs, in.Published)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"changed": n})
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

const maxStudentFile = 5 << 20

// adminImportStudents loads the school's student list from an uploaded file (the school system's students.db or a CSV).
// Admins only. With ?dryRun=1 it only reports what it would do. The answer holds counts, never names.
func (s *Server) adminImportStudents(w http.ResponseWriter, r *http.Request, u app.User) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxStudentFile))
	if err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "too_large", "that file is too large to be a student list")
		return
	}
	f, err := os.CreateTemp("", "students-*")
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer os.Remove(f.Name()) // the uploaded list is not kept anywhere
	if err := os.Chmod(f.Name(), 0o600); err != nil {
		s.serverError(w, r, err)
		return
	}
	_, werr := f.Write(data)
	if cerr := f.Close(); werr != nil || cerr != nil {
		s.serverError(w, r, errors.Join(werr, cerr))
		return
	}
	recs, err := app.ReadStudentsFile(r.Context(), f.Name(), s.app.Cfg.StudentDomain)
	if err != nil || len(recs) == 0 || len(recs) > 20000 {
		fail(w, http.StatusUnprocessableEntity, "invalid", "That doesn't look like a student list. Use the school's students.db, or a CSV whose first row names the columns id (or email), name and optionally class.")
		return
	}
	rep, err := s.app.ImportStudents(r.Context(), recs, r.URL.Query().Get("dryRun") == "1")
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// adminMergeStudents makes two student accounts one (for duplicates that already exist). Admins only.
// {"keepId":5,"dropId":9,"dryRun":true} reports counts without changing anything.
func (s *Server) adminMergeStudents(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		KeepID int64 `json:"keepId"`
		DropID int64 `json:"dropId"`
		DryRun bool  `json:"dryRun"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	rep, err := s.app.MergeStudents(r.Context(), u.ID, in.KeepID, in.DropID, in.DryRun)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
