package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/kenny-21342/events-tracker/server/internal/awards"
)

// Category is the vote/score category behind the "Most Creative" award.
const Category = "creative"

var defaultAwards = []struct{ Key, Title, Config string }{
	{"participation", "Most Participation", `{}`},
	{"explorer", "Explorer", `{}`},
	{"creative", "Most Creative", `{"peer":0.5,"judge":0.5}`},
}

// EnsureAwards makes sure the built-in awards exist.
func (a *App) EnsureAwards(ctx context.Context) error {
	return a.tx(ctx, func(t *sql.Tx) error { return ensureAwards(ctx, t) })
}

func ensureAwards(ctx context.Context, t *sql.Tx) error {
	for _, d := range defaultAwards {
		if _, err := t.ExecContext(ctx, `INSERT INTO awards (key, title, config) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`, d.Key, d.Title, d.Config); err != nil {
			return err
		}
	}
	return nil
}

// CastVote records a student's one creative vote (changing it replaces it). Owners can't vote for their own project.
func (a *App) CastVote(ctx context.Context, voterID, exhibitID int64) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var own int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM exhibit_owners WHERE exhibit_id = ? AND user_id = ?`, exhibitID, voterID).Scan(&own); err != nil {
			return err
		}
		if own > 0 {
			return ErrOwnExhibit
		}
		var exists int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM exhibits WHERE id = ?`, exhibitID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return ErrNotFound
		}
		_, err := t.ExecContext(ctx, `INSERT INTO votes (category, exhibit_id, voter_id) VALUES (?, ?, ?) ON CONFLICT(category, voter_id) DO UPDATE SET exhibit_id = excluded.exhibit_id`, Category, exhibitID, voterID)
		return err
	})
}

// MyVote returns the exhibit this student voted for, or 0.
func (a *App) MyVote(ctx context.Context, voterID int64) (int64, error) {
	var id int64
	err := a.DB.Read.QueryRowContext(ctx, `SELECT exhibit_id FROM votes WHERE category = ? AND voter_id = ?`, Category, voterID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return id, err
}

// ScoreExhibit records a judge's 0-100 score (rounded and clamped); scoring again replaces it.
func (a *App) ScoreExhibit(ctx context.Context, judgeID, exhibitID int64, score float64) error {
	s := int64(math.Max(0, math.Min(100, math.Floor(score+0.5))))
	return a.tx(ctx, func(t *sql.Tx) error {
		var exists int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM exhibits WHERE id = ?`, exhibitID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return ErrNotFound
		}
		_, err := t.ExecContext(ctx, `INSERT INTO judge_scores (category, exhibit_id, judge_id, score) VALUES (?, ?, ?, ?)
			ON CONFLICT(category, exhibit_id, judge_id) DO UPDATE SET score = excluded.score`, Category, exhibitID, judgeID, s)
		return err
	})
}

func gather(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (awards.Input, error) {
	var in awards.Input
	each := func(query string, args []any, scan func(*sql.Rows) error) error {
		rows, err := q.QueryContext(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := scan(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	if err := each(`SELECT user_id, event_id, at FROM checkins ORDER BY id`, nil, func(r *sql.Rows) error {
		var c awards.Checkin
		var at int64
		if err := r.Scan(&c.UserID, &c.EventID, &at); err != nil {
			return err
		}
		c.At = time.Unix(at, 0).UTC()
		in.Checkins = append(in.Checkins, c)
		return nil
	}); err != nil {
		return in, err
	}
	if err := each(`SELECT user_id, exhibit_id FROM exhibit_visits ORDER BY id`, nil, func(r *sql.Rows) error {
		var v awards.Visit
		in.Visits = append(in.Visits, v)
		return r.Scan(&in.Visits[len(in.Visits)-1].UserID, &in.Visits[len(in.Visits)-1].ExhibitID)
	}); err != nil {
		return in, err
	}
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM exhibits`).Scan(&in.TotalExhibits); err != nil {
		return in, err
	}
	if err := each(`SELECT voter_id, exhibit_id FROM votes WHERE category = ? ORDER BY id`, []any{Category}, func(r *sql.Rows) error {
		in.Votes = append(in.Votes, awards.Vote{})
		return r.Scan(&in.Votes[len(in.Votes)-1].VoterID, &in.Votes[len(in.Votes)-1].ExhibitID)
	}); err != nil {
		return in, err
	}
	if err := each(`SELECT exhibit_id, score FROM judge_scores WHERE category = ? ORDER BY id`, []any{Category}, func(r *sql.Rows) error {
		in.JudgeScores = append(in.JudgeScores, awards.JudgeScore{})
		return r.Scan(&in.JudgeScores[len(in.JudgeScores)-1].ExhibitID, &in.JudgeScores[len(in.JudgeScores)-1].Score)
	}); err != nil {
		return in, err
	}
	owners := map[int64][]int64{}
	var order []int64
	if err := each(`SELECT exhibit_id, user_id FROM exhibit_owners ORDER BY rowid`, nil, func(r *sql.Rows) error {
		var e, u int64
		if err := r.Scan(&e, &u); err != nil {
			return err
		}
		if _, ok := owners[e]; !ok {
			order = append(order, e)
		}
		owners[e] = append(owners[e], u)
		return nil
	}); err != nil {
		return in, err
	}
	for _, e := range order {
		in.ExhibitOwners = append(in.ExhibitOwners, awards.ExhibitOwner{ExhibitID: e, UserIDs: owners[e]})
	}
	var cfg string
	if err := q.QueryRowContext(ctx, `SELECT config FROM awards WHERE key = 'creative'`).Scan(&cfg); err == nil {
		var w struct{ Peer, Judge *float64 }
		if json.Unmarshal([]byte(cfg), &w) == nil {
			p, j := 0.5, 0.5
			if w.Peer != nil {
				p = *w.Peer
			}
			if w.Judge != nil {
				j = *w.Judge
			}
			in.CreativeWeights = &awards.Weights{Peer: p, Judge: j}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return in, err
	}
	return in, nil
}

// AwardPreview is a dry run: it computes the winners from live data and writes nothing.
func (a *App) AwardPreview(ctx context.Context) (awards.Result, error) {
	in, err := gather(ctx, a.DB.Read)
	if err != nil {
		return awards.Result{}, err
	}
	return awards.Compute(in), nil
}

func resultFor(r awards.Result, key string) []awards.Ranked {
	switch key {
	case "participation":
		return r.Participation
	case "explorer":
		return r.Explorer
	case "creative":
		return r.Creative
	}
	return nil
}

// RunAwards stores the computed winners as drafts, replacing earlier drafts. An award that already has
// published results is left alone, so running again can never change what students have seen.
func (a *App) RunAwards(ctx context.Context, actorID *int64) (awards.Result, error) {
	var result awards.Result
	err := a.tx(ctx, func(t *sql.Tx) error {
		if err := ensureAwards(ctx, t); err != nil {
			return err
		}
		in, err := gather(ctx, t)
		if err != nil {
			return err
		}
		result = awards.Compute(in)

		rows, err := t.QueryContext(ctx, `SELECT id, key FROM awards ORDER BY id`)
		if err != nil {
			return err
		}
		type def struct {
			id  int64
			key string
		}
		var defs []def
		for rows.Next() {
			var d def
			if err := rows.Scan(&d.id, &d.key); err != nil {
				rows.Close()
				return err
			}
			defs = append(defs, d)
		}
		rows.Close()

		for _, d := range defs {
			var published int
			if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM award_results WHERE award_id = ? AND published = 1`, d.id).Scan(&published); err != nil {
				return err
			}
			if published > 0 {
				continue
			}
			if _, err := t.ExecContext(ctx, `DELETE FROM award_results WHERE award_id = ?`, d.id); err != nil {
				return err
			}
			for _, w := range resultFor(result, d.key) {
				m, _ := json.Marshal(w.Metrics)
				if _, err := t.ExecContext(ctx, `INSERT INTO award_results (award_id, user_id, rank, metrics) VALUES (?, ?, ?, ?)`, d.id, w.UserID, w.Rank, string(m)); err != nil {
					return err
				}
			}
		}
		return audit(ctx, t, actorID, "awards.run", result)
	})
	return result, err
}

// RemoveDraftResult is the teacher's veto: it removes a draft winner and moves the ones below up.
func (a *App) RemoveDraftResult(ctx context.Context, resultID, actorID int64, reason string) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var awardID, userID int64
		var published int
		err := t.QueryRowContext(ctx, `SELECT award_id, user_id, published FROM award_results WHERE id = ?`, resultID).Scan(&awardID, &userID, &published)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if published == 1 {
			return ErrForbidden // published results are final
		}
		if _, err := t.ExecContext(ctx, `DELETE FROM award_results WHERE id = ?`, resultID); err != nil {
			return err
		}
		rows, err := t.QueryContext(ctx, `SELECT id FROM award_results WHERE award_id = ? AND published = 0 ORDER BY rank, id`, awardID)
		if err != nil {
			return err
		}
		var ids []int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		rows.Close()
		for i, id := range ids {
			if _, err := t.ExecContext(ctx, `UPDATE award_results SET rank = ? WHERE id = ?`, i+1, id); err != nil {
				return err
			}
		}
		if reason == "" {
			reason = "no reason given"
		}
		return audit(ctx, t, &actorID, "awards.veto", map[string]any{"resultId": resultID, "userId": userID, "awardId": awardID, "reason": reason})
	})
}

// PublishAwards makes every draft visible to students and returns how many were published.
func (a *App) PublishAwards(ctx context.Context, actorID int64) (int64, error) {
	var n int64
	err := a.tx(ctx, func(t *sql.Tx) error {
		res, err := t.ExecContext(ctx, `UPDATE award_results SET published = 1 WHERE published = 0`)
		if err != nil {
			return err
		}
		n, _ = res.RowsAffected()
		return audit(ctx, t, &actorID, "awards.publish", map[string]any{"count": n})
	})
	return n, err
}

type AwardResult struct {
	ID        int64              `json:"id"`
	Award     string             `json:"award"`
	Key       string             `json:"key"`
	Rank      int64              `json:"rank"`
	Metrics   map[string]float64 `json:"metrics"`
	UserID    int64              `json:"userId"`
	Name      string             `json:"name"`
	ClassName string             `json:"className"`
	Published bool               `json:"published"`
}

// AwardResults lists drafts or published winners, optionally only one student's.
func (a *App) AwardResults(ctx context.Context, published bool, userID int64) ([]AwardResult, error) {
	q := `SELECT r.id, a.title, a.key, r.rank, r.metrics, u.id, u.name, COALESCE(u.class_name,''), r.published
		FROM award_results r JOIN awards a ON a.id = r.award_id JOIN users u ON u.id = r.user_id WHERE r.published = ?`
	args := []any{b2i(published)}
	if userID != 0 {
		q += ` AND u.id = ?`
		args = append(args, userID)
	}
	rows, err := a.DB.Read.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AwardResult{}
	for rows.Next() {
		var r AwardResult
		var m string
		var p int
		if err := rows.Scan(&r.ID, &r.Award, &r.Key, &r.Rank, &m, &r.UserID, &r.Name, &r.ClassName, &p); err != nil {
			return nil, err
		}
		r.Published = p == 1
		if err := json.Unmarshal([]byte(m), &r.Metrics); err != nil {
			r.Metrics = map[string]float64{}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Award != out[j].Award {
			return out[i].Award < out[j].Award
		}
		return out[i].Rank < out[j].Rank
	})
	return out, nil
}
