package app

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Works are pictures students share on an event they attended: a painting, a taken-apart computer, a finished model.

const (
	maxWorkCaptionRunes = 200
	maxWorksPerStudent  = 6 // per event
)

type Work struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	ClassName string `json:"className"`
	ImageURL  string `json:"imageUrl"`
	Caption   string `json:"caption"`
	At        string `json:"at"`
}

// Works lists the shared works of an event, newest first.
func (a *App) Works(ctx context.Context, eventID int64) ([]Work, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT w.id, u.id, u.name, COALESCE(u.class_name, ''), w.image_id, w.caption, w.at
		FROM event_works w JOIN users u ON u.id = w.user_id WHERE w.event_id = ? ORDER BY w.at DESC, w.id DESC`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Work{}
	for rows.Next() {
		var w Work
		var img, at int64
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &w.ClassName, &img, &w.Caption, &at); err != nil {
			return nil, err
		}
		w.ImageURL, w.At = "/api/images/"+strconv.FormatInt(img, 10), Time(fromUnix(at))
		out = append(out, w)
	}
	return out, rows.Err()
}

// AddWork shares an uploaded picture on an event. Only students who checked in to the event may, so the gallery holds what people made there.
func (a *App) AddWork(ctx context.Context, eventID int64, u User, imageID int64, caption string) (Work, error) {
	caption = strings.TrimSpace(caption)
	if utf8.RuneCountInString(caption) > maxWorkCaptionRunes {
		return Work{}, ErrInvalid
	}
	var w Work
	err := a.tx(ctx, func(t *sql.Tx) error {
		var n int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE id = ?`, eventID).Scan(&n); err != nil {
			return err
		} else if n == 0 {
			return ErrNotFound
		}
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM checkins WHERE event_id = ? AND user_id = ?`, eventID, u.ID).Scan(&n); err != nil {
			return err
		} else if n == 0 {
			return ErrForbidden
		}
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_works WHERE event_id = ? AND user_id = ?`, eventID, u.ID).Scan(&n); err != nil {
			return err
		} else if n >= maxWorksPerStudent {
			return ErrTooMany
		}
		if err := imageOwnedBy(ctx, t, imageID, u.ID, ImageWork); err != nil {
			return err
		}
		now := a.Now()
		res, err := t.ExecContext(ctx, `INSERT INTO event_works (event_id, user_id, image_id, caption, at) VALUES (?, ?, ?, ?, ?)`, eventID, u.ID, imageID, caption, unix(now))
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		w = Work{ID: id, UserID: u.ID, Name: u.Name, ClassName: u.ClassName, ImageURL: "/api/images/" + strconv.FormatInt(imageID, 10), Caption: caption, At: Time(now)}
		return nil
	})
	return w, err
}

// DeleteWork removes a shared work and its picture: its owner may, and so may a teacher.
func (a *App) DeleteWork(ctx context.Context, workID int64, actor User) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var owner, img, event int64
		if err := t.QueryRowContext(ctx, `SELECT user_id, image_id, event_id FROM event_works WHERE id = ?`, workID).Scan(&owner, &img, &event); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if owner != actor.ID && !actor.IsStaff() {
			return ErrForbidden
		}
		if _, err := t.ExecContext(ctx, `DELETE FROM images WHERE id = ?`, img); err != nil { // the work goes with it (cascade)
			return err
		}
		if owner != actor.ID {
			return audit(ctx, t, &actor.ID, "works.delete", map[string]any{"work": workID, "event": event, "student": owner})
		}
		return nil
	})
}
