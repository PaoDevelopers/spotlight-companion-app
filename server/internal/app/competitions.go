package app

import (
	"context"
	"database/sql"
	"sort"
	"strings"
)

var entryStatuses = map[string]bool{"registered": true, "competing": true, "advanced": true, "eliminated": true, "finished": true}

type Competition struct {
	ID      int64  `json:"id"`
	EventID int64  `json:"eventId"`
	Name    string `json:"name"`
	IsTeam  bool   `json:"isTeam"`
}

func (a *App) CompetitionsForEvent(ctx context.Context, eventID int64) ([]Competition, error) {
	return a.competitions(ctx, `WHERE event_id = ?`, eventID)
}

func (a *App) AllCompetitions(ctx context.Context) ([]Competition, error) {
	return a.competitions(ctx, ``)
}

func (a *App) competitions(ctx context.Context, where string, args ...any) ([]Competition, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT id, event_id, name, is_team FROM competitions `+where+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Competition{}
	for rows.Next() {
		var c Competition
		var team int
		if err := rows.Scan(&c.ID, &c.EventID, &c.Name, &team); err != nil {
			return nil, err
		}
		c.IsTeam = team == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

func (a *App) CreateCompetition(ctx context.Context, eventID int64, name string, isTeam bool) (Competition, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Competition{}, ErrInvalid
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO competitions (event_id, name, is_team) VALUES (?, ?, ?)`, eventID, name, b2i(isTeam))
	if err != nil {
		return Competition{}, err // a missing event fails the foreign key
	}
	id, _ := res.LastInsertId()
	return Competition{ID: id, EventID: eventID, Name: name, IsTeam: isTeam}, nil
}

// Register signs a student up once; registering again changes nothing.
func (a *App) Register(ctx context.Context, competitionID, userID int64, team string) error {
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO competition_entries (competition_id, user_id, team_name) SELECT id, ?, NULLIF(?, '') FROM competitions WHERE id = ? ON CONFLICT DO NOTHING`,
		userID, strings.TrimSpace(team), competitionID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var exists int
		if err := a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM competitions WHERE id = ?`, competitionID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return ErrNotFound
		}
	}
	return nil
}

type Entry struct {
	ID            int64   `json:"id"`
	CompetitionID int64   `json:"competitionId"`
	UserID        int64   `json:"userId"`
	Name          string  `json:"name"`
	ClassName     string  `json:"className"`
	TeamName      *string `json:"teamName"`
	Status        string  `json:"status"`
	Score         *int64  `json:"score"`
	Rank          *int64  `json:"rank"`
	Notes         *string `json:"notes"`
}

func (a *App) Entries(ctx context.Context) ([]Entry, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT e.id, e.competition_id, e.user_id, u.name, COALESCE(u.class_name,''), e.team_name, e.status, e.score, e.rank, e.notes
		FROM competition_entries e JOIN users u ON u.id = e.user_id ORDER BY e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var x Entry
		if err := rows.Scan(&x.ID, &x.CompetitionID, &x.UserID, &x.Name, &x.ClassName, &x.TeamName, &x.Status, &x.Score, &x.Rank, &x.Notes); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

type EntryPatch struct {
	Status string
	Score  *int64
	Rank   *int64
	Notes  *string
}

func (a *App) UpdateEntry(ctx context.Context, id int64, p EntryPatch) error {
	if !entryStatuses[p.Status] || (p.Rank != nil && *p.Rank < 1) {
		return ErrInvalid
	}
	res, err := a.DB.Write.ExecContext(ctx, `UPDATE competition_entries SET status = ?, score = ?, rank = ?, notes = ? WHERE id = ?`, p.Status, p.Score, p.Rank, p.Notes, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

type MyCompetition struct {
	EntryID     int64  `json:"entryId"`
	Competition string `json:"competition"`
	Event       string `json:"event"`
	Status      string `json:"status"`
	Score       *int64 `json:"score"`
	Rank        *int64 `json:"rank"`
}

func (a *App) MyCompetitions(ctx context.Context, userID int64) ([]MyCompetition, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT e.id, c.name, ev.title, e.status, e.score, e.rank
		FROM competition_entries e JOIN competitions c ON c.id = e.competition_id JOIN events ev ON ev.id = c.event_id
		WHERE e.user_id = ? ORDER BY e.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MyCompetition{}
	for rows.Next() {
		var x MyCompetition
		if err := rows.Scan(&x.EntryID, &x.Competition, &x.Event, &x.Status, &x.Score, &x.Rank); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// PublicName is what other students see: the real name only if the student opted in.
func PublicName(name, className string, show bool) string {
	switch {
	case show:
		return name
	case className != "":
		return "Student, " + className
	default:
		return "Anonymous"
	}
}

type BoardRow struct {
	ID     int64  `json:"id"`
	UserID int64  `json:"-"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Score  *int64 `json:"score"`
	Rank   *int64 `json:"rank"`
}

// CompetitionLeaderboard lists entries by rank, then score. Names respect each student's opt-in.
func (a *App) CompetitionLeaderboard(ctx context.Context, competitionID int64) ([]BoardRow, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT e.id, u.id, u.name, COALESCE(u.class_name,''), u.show_on_leaderboard, e.team_name, e.status, e.score, e.rank
		FROM competition_entries e JOIN users u ON u.id = e.user_id WHERE e.competition_id = ?`, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BoardRow{}
	for rows.Next() {
		var r BoardRow
		var name, class string
		var show int
		var team sql.NullString
		if err := rows.Scan(&r.ID, &r.UserID, &name, &class, &show, &team, &r.Status, &r.Score, &r.Rank); err != nil {
			return nil, err
		}
		r.Label = PublicName(name, class, show == 1)
		if team.Valid && team.String != "" {
			r.Label = team.String
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	key := func(p *int64, none int64) int64 {
		if p == nil {
			return none
		}
		return *p
	}
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := key(out[i].Rank, 1_000_000_000), key(out[j].Rank, 1_000_000_000)
		if ri != rj {
			return ri < rj
		}
		return key(out[i].Score, -1) > key(out[j].Score, -1)
	})
	return out, nil
}

type MonthRow struct {
	UserID int64  `json:"-"`
	Rank   int    `json:"rank"`
	Label  string `json:"label"`
	Points int64  `json:"points"`
}

// MonthLeaderboard: 1 point per event attended, 1 per exhibit visited, a bonus for competition podiums.
func (a *App) MonthLeaderboard(ctx context.Context, limit int) ([]MonthRow, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT u.id, u.name, COALESCE(u.class_name,''), u.show_on_leaderboard,
		  (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id),
		  (SELECT COUNT(*) FROM exhibit_visits v WHERE v.user_id = u.id),
		  COALESCE((SELECT SUM(CASE e.rank WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 3 ELSE 0 END) FROM competition_entries e WHERE e.user_id = u.id AND e.rank IS NOT NULL), 0)
		FROM users u WHERE u.role = 'student'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MonthRow
	for rows.Next() {
		var r MonthRow
		var name, class string
		var show int
		var att, vis, bonus int64
		if err := rows.Scan(&r.UserID, &name, &class, &show, &att, &vis, &bonus); err != nil {
			return nil, err
		}
		r.Points = att + vis + bonus
		r.Label = PublicName(name, class, show == 1)
		if r.Points > 0 {
			out = append(out, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Points != out[j].Points {
			return out[i].Points > out[j].Points
		}
		return out[i].UserID < out[j].UserID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	for i := range out {
		out[i].Rank = i + 1
	}
	return out, nil
}
