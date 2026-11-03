package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// Exhibition is a named group of installations, such as "Physics Exhibition".
type Exhibition struct {
	ID       int64   `json:"id"`
	Title    string  `json:"title"`
	Subject  string  `json:"subject"`
	Summary  string  `json:"summary"`
	BodyMD   string  `json:"bodyMd"`
	ImageURL *string `json:"imageUrl"`
	Total    int64   `json:"total"`   // installations in it
	Visited  int64   `json:"visited"` // how many of them the asking student has scanned (0 for teachers' views)
}

type ExhibitionInput struct {
	Title, Subject, Summary, BodyMD, ImageURL string
}

func (in ExhibitionInput) clean() (string, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" || len([]rune(title)) > 100 || !ValidSubject(in.Subject) {
		return "", ErrInvalid
	}
	if img := strings.TrimSpace(in.ImageURL); img != "" && !strings.HasPrefix(img, "https://") && (!strings.HasPrefix(img, "/") || strings.HasPrefix(img, "//")) {
		return "", ErrInvalid
	}
	return title, nil
}

const exhibitionSelect = `SELECT x.id, x.title, x.subject, x.summary, x.body_md, x.image_url,
	(SELECT COUNT(*) FROM exhibits e WHERE e.exhibition_id = x.id),
	(SELECT COUNT(*) FROM exhibits e JOIN exhibit_visits v ON v.exhibit_id = e.id AND v.user_id = ? WHERE e.exhibition_id = x.id)
	FROM exhibitions x`

// Exhibitions lists them with how many installations each has and, for a student, how many they have visited.
func (a *App) Exhibitions(ctx context.Context, forUser int64) ([]Exhibition, error) {
	rows, err := a.DB.Read.QueryContext(ctx, exhibitionSelect+` ORDER BY x.title, x.id`, forUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Exhibition{}
	for rows.Next() {
		var x Exhibition
		if err := rows.Scan(&x.ID, &x.Title, &x.Subject, &x.Summary, &x.BodyMD, &x.ImageURL, &x.Total, &x.Visited); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (a *App) exhibition(ctx context.Context, id int64) (Exhibition, error) {
	var x Exhibition
	err := a.DB.Read.QueryRowContext(ctx, exhibitionSelect+` WHERE x.id = ?`, 0, id).Scan(&x.ID, &x.Title, &x.Subject, &x.Summary, &x.BodyMD, &x.ImageURL, &x.Total, &x.Visited)
	if errors.Is(err, sql.ErrNoRows) {
		return x, ErrNotFound
	}
	return x, err
}

func (a *App) CreateExhibition(ctx context.Context, in ExhibitionInput) (Exhibition, error) {
	title, err := in.clean()
	if err != nil {
		return Exhibition{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO exhibitions (title, subject, summary, body_md, image_url) VALUES (?, ?, ?, ?, NULLIF(?, ''))`,
		title, in.Subject, in.Summary, in.BodyMD, strings.TrimSpace(in.ImageURL))
	if err != nil {
		return Exhibition{}, err
	}
	id, _ := res.LastInsertId()
	return a.exhibition(ctx, id)
}

func (a *App) UpdateExhibition(ctx context.Context, id int64, in ExhibitionInput) (Exhibition, error) {
	title, err := in.clean()
	if err != nil {
		return Exhibition{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `UPDATE exhibitions SET title = ?, subject = ?, summary = ?, body_md = ?, image_url = NULLIF(?, '') WHERE id = ?`,
		title, in.Subject, in.Summary, in.BodyMD, strings.TrimSpace(in.ImageURL), id)
	if err != nil {
		return Exhibition{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Exhibition{}, ErrNotFound
	}
	return a.exhibition(ctx, id)
}

// DeleteExhibition removes the grouping only: its installations stay and become standalone.
func (a *App) DeleteExhibition(ctx context.Context, id int64) error {
	res, err := a.DB.Write.ExecContext(ctx, `DELETE FROM exhibitions WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
