package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// Awards are chosen by teachers: a title, the students who receive it and an optional reason. They stay drafts
// (teachers only) until published, and then students see them. Nothing about them is calculated.

const (
	maxAwardTitle  = 80
	maxAwardReason = 500
)

type Award struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Reason    string `json:"reason"`
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	ClassName string `json:"className"`
	Published bool   `json:"published"`
}

func cleanAward(title, reason string) (string, string, error) {
	title, reason = strings.TrimSpace(title), strings.TrimSpace(reason)
	if title == "" || len([]rune(title)) > maxAwardTitle || len([]rune(reason)) > maxAwardReason {
		return "", "", ErrInvalid
	}
	return title, reason, nil
}

// AddAwards gives one award to each listed student as a draft. Giving the same award to the same student again
// only updates the reason. Only students can receive awards. It returns how many students were given it.
func (a *App) AddAwards(ctx context.Context, actorID int64, title, reason string, userIDs []int64) (int, error) {
	title, reason, err := cleanAward(title, reason)
	if err != nil || len(userIDs) == 0 || len(userIDs) > 200 {
		return 0, ErrInvalid
	}
	err = a.tx(ctx, func(t *sql.Tx) error {
		for _, uid := range userIDs {
			var role string
			if err := t.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, uid).Scan(&role); errors.Is(err, sql.ErrNoRows) || (err == nil && role != "student") {
				return ErrInvalid
			} else if err != nil {
				return err
			}
			if _, err := t.ExecContext(ctx, `INSERT INTO student_awards (title, user_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(title, user_id) DO UPDATE SET reason = excluded.reason`, title, uid, reason, actorID, unix(a.Now())); err != nil {
				return err
			}
		}
		return audit(ctx, t, &actorID, "awards.add", map[string]any{"title": title, "students": userIDs})
	})
	if err != nil {
		return 0, err
	}
	return len(userIDs), nil
}

// UpdateAward changes an award's title and reason, whether or not it is published.
func (a *App) UpdateAward(ctx context.Context, actorID, id int64, title, reason string) error {
	title, reason, err := cleanAward(title, reason)
	if err != nil {
		return err
	}
	return a.tx(ctx, func(t *sql.Tx) error {
		res, err := t.ExecContext(ctx, `UPDATE student_awards SET title = ?, reason = ? WHERE id = ?`, title, reason, id)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") { // the student already has an award with that title
				return ErrInvalid
			}
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return audit(ctx, t, &actorID, "awards.update", map[string]any{"id": id, "title": title})
	})
}

func (a *App) DeleteAward(ctx context.Context, actorID, id int64) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var uid int64
		var title string
		if err := t.QueryRowContext(ctx, `SELECT user_id, title FROM student_awards WHERE id = ?`, id).Scan(&uid, &title); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `DELETE FROM student_awards WHERE id = ?`, id); err != nil {
			return err
		}
		return audit(ctx, t, &actorID, "awards.delete", map[string]any{"id": id, "title": title, "userId": uid})
	})
}

// SetAwardsPublished shows (or hides again) the listed awards to students. With no ids and published=true it
// publishes every draft. It returns how many awards changed.
func (a *App) SetAwardsPublished(ctx context.Context, actorID int64, ids []int64, published bool) (int64, error) {
	if len(ids) == 0 && !published {
		return 0, ErrInvalid // hiding awards always names them: never "hide everything"
	}
	var n int64
	err := a.tx(ctx, func(t *sql.Tx) error {
		var at any
		if published {
			at = unix(a.Now())
		}
		if len(ids) == 0 {
			res, err := t.ExecContext(ctx, `UPDATE student_awards SET published = 1, published_at = ? WHERE published = 0`, at)
			if err != nil {
				return err
			}
			n, _ = res.RowsAffected()
		}
		for _, id := range ids {
			res, err := t.ExecContext(ctx, `UPDATE student_awards SET published = ?, published_at = ? WHERE id = ? AND published = ?`, b2i(published), at, id, b2i(!published))
			if err != nil {
				return err
			}
			c, _ := res.RowsAffected()
			n += c
		}
		return audit(ctx, t, &actorID, "awards.publish", map[string]any{"published": published, "count": n})
	})
	return n, err
}

const awardCols = `a.id, a.title, a.reason, u.id, u.name, COALESCE(u.class_name,''), a.published`

func (a *App) awards(ctx context.Context, where string, args ...any) ([]Award, []bool, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT `+awardCols+`, u.show_on_leaderboard FROM student_awards a JOIN users u ON u.id = a.user_id `+where+` ORDER BY a.title, u.class_name, u.name`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	out, shows := []Award{}, []bool{}
	for rows.Next() {
		var x Award
		var pub, show int
		if err := rows.Scan(&x.ID, &x.Title, &x.Reason, &x.UserID, &x.Name, &x.ClassName, &pub, &show); err != nil {
			return nil, nil, err
		}
		x.Published = pub == 1
		out, shows = append(out, x), append(shows, show == 1)
	}
	return out, shows, rows.Err()
}

// AllAwards is the teacher's list: drafts and published, with real names.
func (a *App) AllAwards(ctx context.Context) ([]Award, error) {
	out, _, err := a.awards(ctx, ``)
	return out, err
}

// MyAwards are the published awards of one student, with the reason.
func (a *App) MyAwards(ctx context.Context, userID int64) ([]Award, error) {
	out, _, err := a.awards(ctx, `WHERE a.published = 1 AND a.user_id = ?`, userID)
	return out, err
}

// AwardWinner is one line of the public awards list. Like the leaderboard, a student's name shows only if they
// chose to be shown; the reason is also kept private for those who did not.
type AwardWinner struct {
	Label  string `json:"label"`
	Reason string `json:"reason,omitempty"`
}

type AwardGroup struct {
	Title   string        `json:"title"`
	Winners []AwardWinner `json:"winners"`
}

// PublishedAwardGroups lists the published awards by title for everyone to see.
func (a *App) PublishedAwardGroups(ctx context.Context) ([]AwardGroup, error) {
	list, shows, err := a.awards(ctx, `WHERE a.published = 1`)
	if err != nil {
		return nil, err
	}
	out := []AwardGroup{}
	for i, x := range list {
		if len(out) == 0 || out[len(out)-1].Title != x.Title {
			out = append(out, AwardGroup{Title: x.Title, Winners: []AwardWinner{}})
		}
		w := AwardWinner{Label: PublicName(x.Name, x.ClassName, shows[i])}
		if shows[i] {
			w.Reason = x.Reason
		}
		g := &out[len(out)-1]
		g.Winners = append(g.Winners, w)
	}
	return out, nil
}
