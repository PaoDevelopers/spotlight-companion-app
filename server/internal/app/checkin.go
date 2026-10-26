package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/kenny-21342/events-tracker/server/internal/token"
)

// Check-in opens an hour before an event starts and closes when it ends.
const checkinEarly = time.Hour

type CheckinResult struct {
	EventID   int64
	Title     string
	Duplicate bool
}

// record is the one place a check-in is written. Doing the checks and the insert inside one write
// transaction means two students can't both take the last place, and a repeat scan is harmless.
func (a *App) record(ctx context.Context, userID, eventID int64, method string, now time.Time) (CheckinResult, error) {
	var res CheckinResult
	err := a.tx(ctx, func(t *sql.Tx) error {
		var title string
		var starts, ends int64
		var capacity sql.NullInt64
		err := t.QueryRowContext(ctx, `SELECT title, starts_at, ends_at, capacity FROM events WHERE id = ?`, eventID).Scan(&title, &starts, &ends, &capacity)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		res = CheckinResult{EventID: eventID, Title: title}
		if method != "manual" && (now.Before(fromUnix(starts).Add(-checkinEarly)) || now.After(fromUnix(ends))) {
			return ErrClosed
		}
		var existing int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM checkins WHERE event_id = ? AND user_id = ?`, eventID, userID).Scan(&existing); err != nil {
			return err
		}
		if existing > 0 {
			res.Duplicate = true
			return nil
		}
		if capacity.Valid && method != "manual" {
			var n int64
			if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM checkins WHERE event_id = ?`, eventID).Scan(&n); err != nil {
				return err
			}
			if n >= capacity.Int64 {
				return ErrFull
			}
		}
		_, err = t.ExecContext(ctx, `INSERT INTO checkins (event_id, user_id, method, at) VALUES (?, ?, ?, ?)`, eventID, userID, method, unix(now))
		return err
	})
	return res, err
}

// CheckInStudent handles a student's scan of the rotating screen QR (method qr) or a static NFC/printed tag (method nfc).
func (a *App) CheckInStudent(ctx context.Context, userID int64, code string) (CheckinResult, error) {
	now := a.Now()
	if id, ok := token.VerifyEvent(a.Cfg.Secret, code, now.UnixMilli()); ok {
		return a.record(ctx, userID, id, "qr", now)
	}
	if kind, id, ok := token.VerifyTag(a.Cfg.Secret, code); ok && kind == token.KindEvent {
		return a.record(ctx, userID, id, "nfc", now)
	}
	return CheckinResult{}, ErrBadToken
}

// CheckInByPass lets a teacher check a student in by scanning their personal pass QR.
func (a *App) CheckInByPass(ctx context.Context, eventID int64, passToken string) (User, CheckinResult, error) {
	uid, ok := token.VerifyPass(a.Cfg.Secret, strings.TrimSpace(passToken))
	if !ok {
		return User{}, CheckinResult{}, ErrBadToken
	}
	u, err := a.UserByID(ctx, uid)
	if err != nil {
		return User{}, CheckinResult{}, err
	}
	r, err := a.record(ctx, uid, eventID, "pass", a.Now())
	return u, r, err
}

// ManualCheckIn is a teacher adding someone by hand: always allowed, even outside the window or when full.
func (a *App) ManualCheckIn(ctx context.Context, eventID int64, email string) (User, error) {
	u, err := a.UserByEmail(ctx, email)
	if err != nil {
		return User{}, err
	}
	_, err = a.record(ctx, u.ID, eventID, "manual", a.Now())
	return u, err
}

func (a *App) UndoCheckIn(ctx context.Context, eventID, userID int64) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM checkins WHERE event_id = ? AND user_id = ?`, eventID, userID)
	return err
}

type Attendee struct {
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	ClassName string `json:"className"`
	Method    string `json:"method"`
	At        string `json:"at"`
}

func (a *App) Attendees(ctx context.Context, eventID int64) ([]Attendee, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT u.id, u.name, COALESCE(u.class_name, ''), c.method, c.at
		FROM checkins c JOIN users u ON u.id = c.user_id WHERE c.event_id = ? ORDER BY c.at, c.id`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Attendee{}
	for rows.Next() {
		var x Attendee
		var at int64
		if err := rows.Scan(&x.UserID, &x.Name, &x.ClassName, &x.Method, &at); err != nil {
			return nil, err
		}
		x.At = Time(fromUnix(at))
		out = append(out, x)
	}
	return out, rows.Err()
}

// AttendeesCSV renders the attendance list. Cells that a spreadsheet would run as a formula are neutralised.
func AttendeesCSV(rows []Attendee) string {
	cell := func(v string) string {
		if v != "" && strings.ContainsRune("=+-@", rune(v[0])) {
			v = "'" + v
		}
		return `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
	}
	var b strings.Builder
	b.WriteString("name,class,method,time\n")
	for _, r := range rows {
		at, _ := time.Parse(time.RFC3339, r.At)
		fmt.Fprintf(&b, "%s,%s,%s,%s\n", cell(r.Name), cell(r.ClassName), cell(r.Method), cell(at.Format("2006-01-02T15:04:05.000Z")))
	}
	return strings.TrimRight(b.String(), "\n")
}

// VisitExhibit records a student scanning an exhibit's QR/NFC tag and returns its slug.
func (a *App) VisitExhibit(ctx context.Context, userID int64, code string) (string, error) {
	kind, id, ok := token.VerifyTag(a.Cfg.Secret, code)
	if !ok || kind != token.KindExhibit {
		return "", ErrBadToken
	}
	var slug string
	err := a.tx(ctx, func(t *sql.Tx) error {
		if err := t.QueryRowContext(ctx, `SELECT slug FROM exhibits WHERE id = ?`, id).Scan(&slug); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		_, err := t.ExecContext(ctx, `INSERT INTO exhibit_visits (exhibit_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, id, userID, unix(a.Now()))
		return err
	})
	return slug, err
}
