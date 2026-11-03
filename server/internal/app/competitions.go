package app

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
)

var entryStatuses = map[string]bool{"registered": true, "competing": true, "advanced": true, "eliminated": true, "finished": true}

// Kinds of competition an event can be. "house" means students compete for one of the school's four houses.
const (
	KindIndividual = "individual"
	KindTeam       = "team"
	KindHouse      = "house"
)

// Houses are the four school houses (xueyuan), in display order.
var Houses = []string{"Spring", "Summer", "Autumn", "Winter"}

func ValidKind(k string) bool { return k == KindIndividual || k == KindTeam || k == KindHouse }

func ValidHouse(h string) bool {
	for _, x := range Houses {
		if x == h {
			return true
		}
	}
	return false
}

type Competition struct {
	ID      int64    `json:"id"`
	EventID int64    `json:"eventId"`
	Name    string   `json:"name"`
	IsTeam  bool     `json:"isTeam"`
	Kind    string   `json:"kind"`
	Houses  []string `json:"houses,omitempty"` // the houses to choose from, for house competitions
}

func (a *App) CompetitionsForEvent(ctx context.Context, eventID int64) ([]Competition, error) {
	return a.competitions(ctx, `WHERE event_id = ?`, eventID)
}

func (a *App) AllCompetitions(ctx context.Context) ([]Competition, error) {
	return a.competitions(ctx, ``)
}

func (a *App) competitions(ctx context.Context, where string, args ...any) ([]Competition, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT id, event_id, name, is_team, kind FROM competitions `+where+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Competition{}
	for rows.Next() {
		var c Competition
		var team int
		if err := rows.Scan(&c.ID, &c.EventID, &c.Name, &team, &c.Kind); err != nil {
			return nil, err
		}
		c.IsTeam = team == 1
		if c.Kind == KindHouse {
			c.Houses = Houses
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateCompetition adds a competition to an event directly (events normally do this themselves when saved with a kind).
func (a *App) CreateCompetition(ctx context.Context, eventID int64, name, kind string) (Competition, error) {
	name = strings.TrimSpace(name)
	if name == "" || !ValidKind(kind) {
		return Competition{}, ErrInvalid
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO competitions (event_id, name, is_team, kind) VALUES (?, ?, ?, ?)`, eventID, name, b2i(kind == KindTeam), kind)
	if err != nil {
		return Competition{}, err // a missing event fails the foreign key
	}
	id, _ := res.LastInsertId()
	return Competition{ID: id, EventID: eventID, Name: name, IsTeam: kind == KindTeam, Kind: kind}, nil
}

// setCompetition makes the event's competition match kind inside the caller's transaction: "" removes it (and every
// entry in it), otherwise it creates or updates the single competition, named after the event.
func setCompetition(ctx context.Context, t *sql.Tx, eventID int64, kind, title string) error {
	if kind == "" {
		_, err := t.ExecContext(ctx, `DELETE FROM competitions WHERE event_id = ?`, eventID)
		return err
	}
	var id int64
	err := t.QueryRowContext(ctx, `SELECT id FROM competitions WHERE event_id = ? ORDER BY id LIMIT 1`, eventID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = t.ExecContext(ctx, `INSERT INTO competitions (event_id, name, is_team, kind) VALUES (?, ?, ?, ?)`, eventID, title, b2i(kind == KindTeam), kind)
		return err
	} else if err != nil {
		return err
	}
	_, err = t.ExecContext(ctx, `UPDATE competitions SET name = ?, is_team = ?, kind = ? WHERE id = ?`, title, b2i(kind == KindTeam), kind, id)
	return err
}

// CompetitionEntryCount is how many students have entered the event's competition (shown before a teacher turns it off).
func (a *App) CompetitionEntryCount(ctx context.Context, eventID int64) (n int64, err error) {
	err = a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM competition_entries e JOIN competitions c ON c.id = e.competition_id WHERE c.event_id = ?`, eventID).Scan(&n)
	return
}

// Register enters a student once; registering again changes nothing. Team competitions need a team name and house
// competitions need one of the houses; individual ones ignore both. Teachers use this too, to enter a student by hand.
func (a *App) Register(ctx context.Context, competitionID, userID int64, team, house string) error {
	team, house = strings.TrimSpace(team), strings.TrimSpace(house)
	var kind string
	err := a.DB.Read.QueryRowContext(ctx, `SELECT kind FROM competitions WHERE id = ?`, competitionID).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	switch kind {
	case KindTeam:
		if team == "" || len([]rune(team)) > 40 {
			return ErrInvalid
		}
		house = ""
	case KindHouse:
		if !ValidHouse(house) {
			return ErrInvalid
		}
		team = ""
	default:
		team, house = "", ""
	}
	_, err = a.DB.Write.ExecContext(ctx, `INSERT INTO competition_entries (competition_id, user_id, team_name, house) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, '')) ON CONFLICT DO NOTHING`,
		competitionID, userID, team, house)
	return err
}

// DeleteEntry removes one student's entry (a wrong sign-up, or someone who withdrew).
func (a *App) DeleteEntry(ctx context.Context, id int64) error {
	res, err := a.DB.Write.ExecContext(ctx, `DELETE FROM competition_entries WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
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
	House         *string `json:"house"`
	Status        string  `json:"status"`
	Score         *int64  `json:"score"`
	Rank          *int64  `json:"rank"`
	Notes         *string `json:"notes"`
}

func (a *App) Entries(ctx context.Context) ([]Entry, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT e.id, e.competition_id, e.user_id, u.name, COALESCE(u.class_name,''), e.team_name, e.house, e.status, e.score, e.rank, e.notes
		FROM competition_entries e JOIN users u ON u.id = e.user_id ORDER BY e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var x Entry
		if err := rows.Scan(&x.ID, &x.CompetitionID, &x.UserID, &x.Name, &x.ClassName, &x.TeamName, &x.House, &x.Status, &x.Score, &x.Rank, &x.Notes); err != nil {
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
	EntryID     int64   `json:"entryId"`
	EventID     int64   `json:"eventId"`
	Competition string  `json:"competition"`
	Event       string  `json:"event"`
	Kind        string  `json:"kind"`
	Team        *string `json:"team"`
	House       *string `json:"house"`
	Status      string  `json:"status"`
	Score       *int64  `json:"score"`
	Rank        *int64  `json:"rank"`
}

func (a *App) MyCompetitions(ctx context.Context, userID int64) ([]MyCompetition, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT e.id, ev.id, c.name, ev.title, c.kind, e.team_name, e.house, e.status, e.score, e.rank
		FROM competition_entries e JOIN competitions c ON c.id = e.competition_id JOIN events ev ON ev.id = c.event_id
		WHERE e.user_id = ? ORDER BY e.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MyCompetition{}
	for rows.Next() {
		var x MyCompetition
		if err := rows.Scan(&x.EntryID, &x.EventID, &x.Competition, &x.Event, &x.Kind, &x.Team, &x.House, &x.Status, &x.Score, &x.Rank); err != nil {
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
	ID     int64   `json:"id"`
	UserID int64   `json:"-"`
	Label  string  `json:"label"` // the student's public name (real name only if they opted in)
	Team   *string `json:"team"`
	House  *string `json:"house"`
	Status string  `json:"status"`
	Score  *int64  `json:"score"`
	Rank   *int64  `json:"rank"`
}

// BoardGroup is one line of a team or house standing: a team with its members, or a house with its points.
type BoardGroup struct {
	Label   string   `json:"label"`
	Rank    *int64   `json:"rank"`
	Score   *int64   `json:"score"`
	Count   int      `json:"count"` // members of the team, or entrants for the house
	Members []string `json:"members,omitempty"`
}

// Board is what students see for one competition. Individual: rows. Team: one group per team (plus rows for anyone
// without a team). House: the four houses ranked by their entrants' scores added up, plus the individual rows.
type Board struct {
	ID      int64        `json:"id"`
	EventID int64        `json:"eventId"`
	Name    string       `json:"name"`
	Event   string       `json:"event"`
	Kind    string       `json:"kind"`
	Rows    []BoardRow   `json:"rows"`
	Groups  []BoardGroup `json:"groups"`
}

func orDefault(p *int64, none int64) int64 {
	if p == nil {
		return none
	}
	return *p
}

// CompetitionLeaderboard lists entries by rank, then score. Names respect each student's opt-in.
func (a *App) CompetitionLeaderboard(ctx context.Context, competitionID int64) ([]BoardRow, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT e.id, u.id, u.name, COALESCE(u.class_name,''), u.show_on_leaderboard, e.team_name, e.house, e.status, e.score, e.rank
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
		if err := rows.Scan(&r.ID, &r.UserID, &name, &class, &show, &r.Team, &r.House, &r.Status, &r.Score, &r.Rank); err != nil {
			return nil, err
		}
		r.Label = PublicName(name, class, show == 1)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := orDefault(out[i].Rank, 1_000_000_000), orDefault(out[j].Rank, 1_000_000_000)
		if ri != rj {
			return ri < rj
		}
		return orDefault(out[i].Score, -1) > orDefault(out[j].Score, -1)
	})
	return out, nil
}

// CompetitionBoard builds the board for one competition, grouping into teams or houses where that applies.
func (a *App) CompetitionBoard(ctx context.Context, c Competition, eventTitle string) (Board, error) {
	rows, err := a.CompetitionLeaderboard(ctx, c.ID)
	if err != nil {
		return Board{}, err
	}
	b := Board{ID: c.ID, EventID: c.EventID, Name: c.Name, Event: eventTitle, Kind: c.Kind, Rows: rows, Groups: []BoardGroup{}}
	switch c.Kind {
	case KindTeam:
		byTeam := map[string]*BoardGroup{}
		var order []string
		loose := []BoardRow{} // never nil: it is sent to the browser as a list
		for _, r := range rows { // rows are already best rank first
			if r.Team == nil || *r.Team == "" {
				loose = append(loose, r)
				continue
			}
			g, ok := byTeam[*r.Team]
			if !ok {
				g = &BoardGroup{Label: *r.Team}
				byTeam[*r.Team] = g
				order = append(order, *r.Team)
			}
			g.Count++
			g.Members = append(g.Members, r.Label)
			if r.Rank != nil && (g.Rank == nil || *r.Rank < *g.Rank) {
				g.Rank = r.Rank
			}
			if r.Score != nil && (g.Score == nil || *r.Score > *g.Score) {
				g.Score = r.Score
			}
		}
		for _, t := range order {
			b.Groups = append(b.Groups, *byTeam[t])
		}
		sort.SliceStable(b.Groups, func(i, j int) bool {
			ri, rj := orDefault(b.Groups[i].Rank, 1_000_000_000), orDefault(b.Groups[j].Rank, 1_000_000_000)
			if ri != rj {
				return ri < rj
			}
			return orDefault(b.Groups[i].Score, -1) > orDefault(b.Groups[j].Score, -1)
		})
		b.Rows = loose
	case KindHouse:
		points := map[string]int64{}
		count := map[string]int{}
		scored := false
		for _, r := range rows {
			if r.House == nil {
				continue
			}
			count[*r.House]++
			if r.Score != nil {
				points[*r.House] += *r.Score
				scored = true
			}
		}
		for _, h := range Houses {
			p := points[h]
			b.Groups = append(b.Groups, BoardGroup{Label: h, Score: &p, Count: count[h]})
		}
		sort.SliceStable(b.Groups, func(i, j int) bool { return *b.Groups[i].Score > *b.Groups[j].Score })
		if scored { // ties share a place (1, 2, 2, 4); a house with no points is not placed at all
			for i := range b.Groups {
				if *b.Groups[i].Score <= 0 {
					break
				}
				rank := int64(i + 1)
				if i > 0 && *b.Groups[i].Score == *b.Groups[i-1].Score {
					rank = *b.Groups[i-1].Rank
				}
				b.Groups[i].Rank = &rank
			}
		}
	}
	return b, nil
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
