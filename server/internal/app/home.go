package app

import "context"

type HomeStats struct {
	Attended      int64 `json:"attended"`
	Visited       int64 `json:"visited"`
	TotalExhibits int64 `json:"totalExhibits"`
}

func (a *App) HomeStats(ctx context.Context, userID int64) (HomeStats, error) {
	var s HomeStats
	err := a.DB.Read.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM checkins WHERE user_id = ?),
		(SELECT COUNT(*) FROM exhibit_visits WHERE user_id = ?),
		(SELECT COUNT(*) FROM exhibits)`, userID, userID).Scan(&s.Attended, &s.Visited, &s.TotalExhibits)
	return s, err
}

type Stats struct {
	Events   int64 `json:"events"`
	Checkins int64 `json:"checkins"`
	Users    int64 `json:"users"`
	Exhibits int64 `json:"exhibits"`
}

func (a *App) Stats(ctx context.Context) (Stats, error) {
	var s Stats
	err := a.DB.Read.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM events), (SELECT COUNT(*) FROM checkins), (SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM exhibits)`).
		Scan(&s.Events, &s.Checkins, &s.Users, &s.Exhibits)
	return s, err
}

// MyJudgeScores returns the scores this judge has already given, by exhibit id.
func (a *App) MyJudgeScores(ctx context.Context, judgeID int64) (map[int64]int64, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT exhibit_id, score FROM judge_scores WHERE category = ? AND judge_id = ?`, Category, judgeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var id, s int64
		if err := rows.Scan(&id, &s); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}

// MyRegistration returns the student's entry status for a competition, or "" if not registered.
func (a *App) MyRegistrations(ctx context.Context, userID int64) (map[int64]string, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT competition_id, status FROM competition_entries WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var id int64
		var st string
		if err := rows.Scan(&id, &st); err != nil {
			return nil, err
		}
		out[id] = st
	}
	return out, rows.Err()
}

func (a *App) HasCheckin(ctx context.Context, eventID, userID int64) (bool, error) {
	var n int
	err := a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM checkins WHERE event_id = ? AND user_id = ?`, eventID, userID).Scan(&n)
	return n > 0, err
}

type MyCheckin struct {
	Event  string `json:"event"`
	Method string `json:"method"`
	At     string `json:"at"`
}

// MyCheckins lists the events this student has checked in to, oldest first.
func (a *App) MyCheckins(ctx context.Context, userID int64) ([]MyCheckin, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT e.title, c.method, c.at FROM checkins c JOIN events e ON e.id = c.event_id WHERE c.user_id = ? ORDER BY c.at, c.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MyCheckin{}
	for rows.Next() {
		var m MyCheckin
		var at int64
		if err := rows.Scan(&m.Event, &m.Method, &at); err != nil {
			return nil, err
		}
		m.At = Time(fromUnix(at))
		out = append(out, m)
	}
	return out, rows.Err()
}
