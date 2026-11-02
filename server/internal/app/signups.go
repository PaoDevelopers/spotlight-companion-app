package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// SignUp reserves a place. Students can only sign up while the event is still ahead of them, sign-up is on and a
// place is free; staff signing someone up ignores all three. Signing up twice is harmless.
func (a *App) SignUp(ctx context.Context, eventID, userID int64, byStaff bool) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var ends int64
		var capacity sql.NullInt64
		var enabled int
		err := t.QueryRowContext(ctx, `SELECT ends_at, capacity, signup_enabled FROM events WHERE id = ?`, eventID).Scan(&ends, &capacity, &enabled)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		var already int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_signups WHERE event_id = ? AND user_id = ?`, eventID, userID).Scan(&already); err != nil {
			return err
		}
		if already > 0 {
			return nil
		}
		if !byStaff {
			if enabled == 0 || a.Now().After(fromUnix(ends)) {
				return ErrNoSignup
			}
			if capacity.Valid {
				var n int64
				if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_signups WHERE event_id = ?`, eventID).Scan(&n); err != nil {
					return err
				}
				if n >= capacity.Int64 {
					return ErrFull
				}
			}
		}
		_, err = t.ExecContext(ctx, `INSERT INTO event_signups (event_id, user_id, at, by_staff) VALUES (?, ?, ?, ?)`, eventID, userID, unix(a.Now()), b2i(byStaff))
		return err
	})
}

func (a *App) CancelSignup(ctx context.Context, eventID, userID int64) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM event_signups WHERE event_id = ? AND user_id = ?`, eventID, userID)
	return err
}

func (a *App) IsSignedUp(ctx context.Context, eventID, userID int64) (bool, error) {
	var n int
	err := a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_signups WHERE event_id = ? AND user_id = ?`, eventID, userID).Scan(&n)
	return n > 0, err
}

// MySignups lists the event ids a student has signed up for.
func (a *App) MySignups(ctx context.Context, userID int64) (map[int64]bool, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT event_id FROM event_signups WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

type Signup struct {
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	ClassName string `json:"className"`
	ByStaff   bool   `json:"byStaff"`
	At        string `json:"at"`
	CheckedIn bool   `json:"checkedIn"`
}

// Signups lists who signed up, by class then name, with whether they have arrived. It is the teacher's
// expected-attendance list, and what the printed paper sheet is made from.
func (a *App) Signups(ctx context.Context, eventID int64) ([]Signup, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT u.id, u.name, u.email, COALESCE(u.class_name, ''), s.by_staff, s.at,
		       EXISTS (SELECT 1 FROM checkins c WHERE c.event_id = s.event_id AND c.user_id = s.user_id)
		FROM event_signups s JOIN users u ON u.id = s.user_id WHERE s.event_id = ?
		ORDER BY COALESCE(u.class_name, ''), u.name`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Signup{}
	for rows.Next() {
		var x Signup
		var staff, in int
		var at int64
		if err := rows.Scan(&x.UserID, &x.Name, &x.Email, &x.ClassName, &staff, &at, &in); err != nil {
			return nil, err
		}
		x.ByStaff, x.CheckedIn, x.At = staff == 1, in == 1, Time(fromUnix(at))
		out = append(out, x)
	}
	return out, rows.Err()
}

type UserHit struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	ClassName string `json:"className"`
}

// SearchStudents finds students by part of a name, email or class, for the "student forgot their phone" lookups.
func (a *App) SearchStudents(ctx context.Context, q string, limit int) ([]UserHit, error) {
	q = strings.TrimSpace(q)
	out := []UserHit{}
	if len(q) < 2 {
		return out, nil
	}
	like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(q)) + "%"
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT id, name, email, COALESCE(class_name, '') FROM users
		WHERE role = 'student' AND (LOWER(name) LIKE ?1 ESCAPE '\' OR LOWER(email) LIKE ?1 ESCAPE '\' OR LOWER(COALESCE(class_name, '')) LIKE ?1 ESCAPE '\')
		ORDER BY name LIMIT ?2`, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var x UserHit
		if err := rows.Scan(&x.ID, &x.Name, &x.Email, &x.ClassName); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
