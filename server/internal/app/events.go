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
	ImageURL    *string `json:"imageUrl"`
	Host        *string `json:"host"`
	// SignupEnabled lets students reserve a place ahead of time. SignupCount is how many have.
	SignupEnabled bool  `json:"signupEnabled"`
	SignupCount   int64 `json:"signupCount"`
	// Competition is null for an ordinary event, otherwise "individual", "team" or "house".
	Competition *string `json:"competition"`
}

type EventInput struct {
	Title       string
	Subject     string
	Description string
	Venue       string
	StartsAt    time.Time
	EndsAt      time.Time
	Capacity    *int64
	ImageURL    string
	Host        string
	// NoSignup switches advance sign-up off (the default is on).
	NoSignup bool
	// Competition turns the event into a competition: "", "individual", "team" or "house".
	Competition string
}

func (in EventInput) validate() error {
	if in.Competition != "" && !ValidKind(in.Competition) {
		return ErrInvalid
	}
	if u := strings.TrimSpace(in.ImageURL); u != "" && !strings.HasPrefix(u, "https://") && !(strings.HasPrefix(u, "/") && !strings.HasPrefix(u, "//")) {
		return ErrInvalid
	}
	if strings.TrimSpace(in.Title) == "" || in.StartsAt.IsZero() || in.EndsAt.IsZero() || !in.EndsAt.After(in.StartsAt) {
		return ErrInvalid
	}
	if !ValidSubject(in.Subject) {
		return ErrInvalid
	}
	if in.Capacity != nil && *in.Capacity <= 0 {
		return ErrInvalid
	}
	return nil
}

const eventCols = `id, title, subject, description, venue, starts_at, ends_at, capacity, image_url, host, signup_enabled,
	(SELECT COUNT(*) FROM event_signups WHERE event_id = events.id),
	(SELECT kind FROM competitions WHERE event_id = events.id ORDER BY id LIMIT 1)`

func scanEvent(r interface{ Scan(...any) error }) (Event, error) {
	var e Event
	var s, en int64
	var signup int
	err := r.Scan(&e.ID, &e.Title, &e.Subject, &e.Description, &e.Venue, &s, &en, &e.Capacity, &e.ImageURL, &e.Host, &signup, &e.SignupCount, &e.Competition)
	e.SignupEnabled = signup == 1
	e.StartsAt, e.EndsAt = Time(fromUnix(s)), Time(fromUnix(en))
	return e, err
}

// Events lists events by start time; subject "" means all, otherwise that subject plus "both".
func (a *App) Events(ctx context.Context, subject string) ([]Event, error) {
	q, args := `SELECT `+eventCols+` FROM events`, []any{}
	if subject != "" && subject != "both" && ValidSubject(subject) {
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
	var id int64
	err := a.tx(ctx, func(t *sql.Tx) error {
		res, err := t.ExecContext(ctx, `INSERT INTO events (title, subject, description, venue, starts_at, ends_at, capacity, image_url, host, signup_enabled) VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?)`,
			strings.TrimSpace(in.Title), in.Subject, in.Description, in.Venue, unix(in.StartsAt), unix(in.EndsAt), in.Capacity, strings.TrimSpace(in.ImageURL), strings.TrimSpace(in.Host), b2i(!in.NoSignup))
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		return setCompetition(ctx, t, id, in.Competition, strings.TrimSpace(in.Title))
	})
	if err != nil {
		return Event{}, err
	}
	return a.Event(ctx, id)
}

func (a *App) UpdateEvent(ctx context.Context, id int64, in EventInput) (Event, error) {
	if err := in.validate(); err != nil {
		return Event{}, err
	}
	err := a.tx(ctx, func(t *sql.Tx) error {
		res, err := t.ExecContext(ctx, `UPDATE events SET title=?, subject=?, description=?, venue=NULLIF(?, ''), starts_at=?, ends_at=?, capacity=?, image_url=NULLIF(?, ''), host=NULLIF(?, ''), signup_enabled=? WHERE id=?`,
			strings.TrimSpace(in.Title), in.Subject, in.Description, in.Venue, unix(in.StartsAt), unix(in.EndsAt), in.Capacity, strings.TrimSpace(in.ImageURL), strings.TrimSpace(in.Host), b2i(!in.NoSignup), id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return setCompetition(ctx, t, id, in.Competition, strings.TrimSpace(in.Title))
	})
	if err != nil {
		return Event{}, err
	}
	return a.Event(ctx, id)
}

func (a *App) DeleteEvent(ctx context.Context, id int64) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM events WHERE id = ?`, id)
	return err
}

// ValidSubject says whether s is a subject an event or exhibit can have. "both" means a mix of several.
func ValidSubject(s string) bool {
	return s == "physics" || s == "chemistry" || s == "cs" || s == "both"
}
