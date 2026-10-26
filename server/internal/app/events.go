package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type Event struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	Subject     string  `json:"subject"`
	Description string  `json:"description"`
	Venue       *string `json:"venue"`
	StartsAt    string  `json:"startsAt"`
	EndsAt      string  `json:"endsAt"`
	Capacity    *int64  `json:"capacity"`
}

type EventInput struct {
	Title       string
	Subject     string
	Description string
	Venue       string
	StartsAt    time.Time
	EndsAt      time.Time
	Capacity    *int64
}

func (in EventInput) validate() error {
	if strings.TrimSpace(in.Title) == "" || in.StartsAt.IsZero() || in.EndsAt.IsZero() || !in.EndsAt.After(in.StartsAt) {
		return ErrInvalid
	}
	if in.Subject != "physics" && in.Subject != "cs" && in.Subject != "both" {
		return ErrInvalid
	}
	if in.Capacity != nil && *in.Capacity <= 0 {
		return ErrInvalid
	}
	return nil
}

const eventCols = `id, title, subject, description, venue, starts_at, ends_at, capacity`

func scanEvent(r interface{ Scan(...any) error }) (Event, error) {
	var e Event
	var s, en int64
	err := r.Scan(&e.ID, &e.Title, &e.Subject, &e.Description, &e.Venue, &s, &en, &e.Capacity)
	e.StartsAt, e.EndsAt = Time(fromUnix(s)), Time(fromUnix(en))
	return e, err
}

// Events lists events by start time; subject "" means all, otherwise that subject plus "both".
func (a *App) Events(ctx context.Context, subject string) ([]Event, error) {
	q, args := `SELECT `+eventCols+` FROM events`, []any{}
	if subject == "physics" || subject == "cs" {
		q += ` WHERE subject IN (?, 'both')`
		args = append(args, subject)
	}
	rows, err := a.DB.Read.QueryContext(ctx, q+` ORDER BY starts_at, id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Upcoming returns up to n events that haven't ended yet.
func (a *App) Upcoming(ctx context.Context, n int) ([]Event, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT `+eventCols+` FROM events WHERE ends_at >= ? ORDER BY starts_at, id LIMIT ?`, unix(a.Now()), n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (a *App) Event(ctx context.Context, id int64) (Event, error) {
	e, err := scanEvent(a.DB.Read.QueryRowContext(ctx, `SELECT `+eventCols+` FROM events WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return e, ErrNotFound
	}
	return e, err
}

func (a *App) CreateEvent(ctx context.Context, in EventInput) (Event, error) {
	if err := in.validate(); err != nil {
		return Event{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO events (title, subject, description, venue, starts_at, ends_at, capacity) VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?)`,
		strings.TrimSpace(in.Title), in.Subject, in.Description, in.Venue, unix(in.StartsAt), unix(in.EndsAt), in.Capacity)
	if err != nil {
		return Event{}, err
	}
	id, _ := res.LastInsertId()
	return a.Event(ctx, id)
}

func (a *App) UpdateEvent(ctx context.Context, id int64, in EventInput) (Event, error) {
	if err := in.validate(); err != nil {
		return Event{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `UPDATE events SET title=?, subject=?, description=?, venue=NULLIF(?, ''), starts_at=?, ends_at=?, capacity=? WHERE id=?`,
		strings.TrimSpace(in.Title), in.Subject, in.Description, in.Venue, unix(in.StartsAt), unix(in.EndsAt), in.Capacity, id)
	if err != nil {
		return Event{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Event{}, ErrNotFound
	}
	return a.Event(ctx, id)
}

func (a *App) DeleteEvent(ctx context.Context, id int64) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM events WHERE id = ?`, id)
	return err
}
