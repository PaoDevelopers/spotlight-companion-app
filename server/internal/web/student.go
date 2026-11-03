package web

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
)

func (s *Server) home(w http.ResponseWriter, r *http.Request, u app.User) {
	ctx := r.Context()
	stats, err := s.app.HomeStats(ctx, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	upcoming, err := s.app.Upcoming(ctx, 3)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	comps, err := s.app.MyCompetitions(ctx, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	awards, err := s.app.MyAwards(ctx, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": stats, "upcoming": upcoming, "competitions": comps, "awards": awards})
}

func (s *Server) events(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Events(r.Context(), r.URL.Query().Get("subject"))
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type compView struct {
	app.Competition
	MyStatus *string `json:"myStatus"` // null when not registered
}

func (s *Server) event(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	ctx := r.Context()
	ev, err := s.app.Event(ctx, id)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	in, err := s.app.HasCheckin(ctx, id, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	signedUp, err := s.app.IsSignedUp(ctx, id, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	comps, err := s.app.CompetitionsForEvent(ctx, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	mine, err := s.app.MyRegistrations(ctx, u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	views := make([]compView, 0, len(comps))
	for _, c := range comps {
		v := compView{Competition: c}
		if st, ok := mine[c.ID]; ok {
			v.MyStatus = &st
		}
		views = append(views, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"event": ev, "checkedIn": in, "signedUp": signedUp, "competitions": views})
}

func (s *Server) signUp(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.SignUp(r.Context(), id, u.ID, false); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) cancelSignUp(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.app.CancelSignup(r.Context(), id, u.ID); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) register(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Team  string `json:"team"`
		House string `json:"house"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.Register(r.Context(), id, u.ID, in.Team, in.House); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type exhibitView struct {
	app.Exhibit
	Visited bool `json:"visited"`
}

func (s *Server) exhibits(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.Exhibits(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	seen, err := s.app.VisitedExhibitIDs(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]exhibitView, 0, len(list))
	for _, x := range list {
		out = append(out, exhibitView{x, seen[x.ID]})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) exhibit(w http.ResponseWriter, r *http.Request, u app.User) {
	x, err := s.app.ExhibitBySlug(r.Context(), r.PathValue("slug"))
	if err != nil {
		s.appError(w, r, err)
		return
	}
	seen, err := s.app.VisitedExhibitIDs(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"exhibit": x, "visited": seen[x.ID]})
}

type scanResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Href    string `json:"href,omitempty"`
	// When check-in is closed, why and for which event, so the app can say when it opens in the viewer's own time.
	Reason  string `json:"reason,omitempty"` // "early" (not open yet) or "late" (already over)
	Event   string `json:"event,omitempty"`
	OpensAt string `json:"opensAt,omitempty"`
}

// extractCode accepts either a bare code or the full /c/<code> link that a QR code or NFC tag holds.
func extractCode(raw string) string {
	raw = strings.TrimSpace(raw)
	if dec, err := url.PathUnescape(raw); err == nil {
		raw = dec
	}
	if i := strings.LastIndex(raw, "/c/"); i >= 0 {
		raw = raw[i+3:]
	}
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	return raw
}

func (s *Server) scan(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	code := extractCode(in.Code)
	ctx := r.Context()
	if strings.HasPrefix(code, "exhibit.") {
		slug, err := s.app.VisitExhibit(ctx, u.ID, code)
		if err != nil {
			if errors.Is(err, app.ErrBadToken) || errors.Is(err, app.ErrNotFound) {
				writeJSON(w, http.StatusOK, scanResponse{Message: "That exhibit code isn't valid."})
				return
			}
			s.serverError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, scanResponse{OK: true, Message: "Exhibit visit recorded", Href: "/exhibits/" + slug})
		return
	}
	res, err := s.app.CheckInStudent(ctx, u.ID, code)
	switch {
	case err == nil && res.Duplicate:
		writeJSON(w, http.StatusOK, scanResponse{OK: true, Message: "Already checked in to " + res.Title})
	case err == nil:
		writeJSON(w, http.StatusOK, scanResponse{OK: true, Message: "Checked in to " + res.Title + "!"})
	case errors.Is(err, app.ErrBadToken):
		writeJSON(w, http.StatusOK, scanResponse{Message: "That code is invalid or expired. Scan the live screen again."})
	case errors.Is(err, app.ErrNotFound):
		writeJSON(w, http.StatusOK, scanResponse{Message: "Event not found."})
	case errors.Is(err, app.ErrClosed):
		writeJSON(w, http.StatusOK, s.closedResponse(ctx, res.EventID))
	case errors.Is(err, app.ErrFull):
		writeJSON(w, http.StatusOK, scanResponse{Message: "This event is full."})
	default:
		s.serverError(w, r, err)
	}
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request, u app.User) {
	ctx := r.Context()
	month, err := s.app.MonthLeaderboard(ctx, 20)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	comps, err := s.app.AllCompetitions(ctx)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	boards := make([]app.Board, 0, len(comps))
	for _, c := range comps {
		ev, err := s.app.Event(ctx, c.EventID)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		b, err := s.app.CompetitionBoard(ctx, c, ev.Title)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		boards = append(boards, b)
	}
	if month == nil {
		month = []app.MonthRow{}
	}
	awards, err := s.app.PublishedAwardGroups(ctx)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"month": month, "competitions": boards, "awards": awards})
}

func (s *Server) myCheckins(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.MyCheckins(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// image serves an uploaded picture. It is only for signed-in users and never changes, so browsers may keep it.
func (s *Server) image(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	ct, data, err := s.app.Image(r.Context(), id)
	if err != nil {
		s.appError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Write(data)
}

// closedResponse explains why check-in is closed: not yet open (and when it opens), or the event is over.
func (s *Server) closedResponse(ctx context.Context, eventID int64) scanResponse {
	out := scanResponse{Message: "Check-in isn't open for this event."}
	ev, err := s.app.Event(ctx, eventID)
	if err != nil {
		return out
	}
	opens := app.CheckinOpensAt(ev)
	out.Event, out.OpensAt = ev.Title, app.Time(opens)
	if s.app.Now().Before(opens) {
		out.Reason = "early"
		out.Message = "Check-in for " + ev.Title + " isn't open yet."
	} else {
		out.Reason = "late"
		out.Message = ev.Title + " has finished, so check-in is closed."
	}
	return out
}
