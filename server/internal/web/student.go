package web

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/kenny-21342/events-tracker/server/internal/app"
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
	awards, err := s.app.AwardResults(ctx, true, u.ID)
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
	writeJSON(w, http.StatusOK, map[string]any{"event": ev, "checkedIn": in, "competitions": views})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request, u app.User) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Team string `json:"team"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.Register(r.Context(), id, u.ID, in.Team); err != nil {
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
	voted, err := s.app.MyVote(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	seen, err := s.app.VisitedExhibitIDs(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"exhibit": x, "votedForThis": voted == x.ID, "visited": seen[x.ID]})
}

func (s *Server) vote(w http.ResponseWriter, r *http.Request, u app.User) {
	var in struct {
		ExhibitID int64 `json:"exhibitId"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.app.CastVote(r.Context(), u.ID, in.ExhibitID); err != nil {
		s.appError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type scanResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Href    string `json:"href,omitempty"`
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
		writeJSON(w, http.StatusOK, scanResponse{Message: "Check-in isn't open for this event."})
	case errors.Is(err, app.ErrFull):
		writeJSON(w, http.StatusOK, scanResponse{Message: "This event is full."})
	default:
		s.serverError(w, r, err)
	}
}

type compBoard struct {
	ID    int64          `json:"id"`
	Name  string         `json:"name"`
	Event string         `json:"event"`
	Rows  []app.BoardRow `json:"rows"`
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
	boards := make([]compBoard, 0, len(comps))
	for _, c := range comps {
		rows, err := s.app.CompetitionLeaderboard(ctx, c.ID)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		ev, err := s.app.Event(ctx, c.EventID)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		boards = append(boards, compBoard{c.ID, c.Name, ev.Title, rows})
	}
	if month == nil {
		month = []app.MonthRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"month": month, "competitions": boards})
}

func (s *Server) myCheckins(w http.ResponseWriter, r *http.Request, u app.User) {
	list, err := s.app.MyCheckins(r.Context(), u.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
