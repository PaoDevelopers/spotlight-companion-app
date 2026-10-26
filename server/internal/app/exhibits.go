package app

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
)

type Exhibit struct {
	ID       int64   `json:"id"`
	Slug     string  `json:"slug"`
	Title    string  `json:"title"`
	Subject  string  `json:"subject"`
	Summary  string  `json:"summary"`
	BodyMD   string  `json:"bodyMd"`
	ImageURL *string `json:"imageUrl"`
}

type ExhibitInput struct {
	Slug, Title, Subject, Summary, BodyMD, ImageURL string
	OwnerEmails                                     []string
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify makes a URL-safe name: "Wave Tank!" -> "wave-tank".
func Slugify(s string) string {
	return strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

const exhibitCols = `id, slug, title, subject, summary, body_md, image_url`

func scanExhibit(r interface{ Scan(...any) error }) (Exhibit, error) {
	var x Exhibit
	err := r.Scan(&x.ID, &x.Slug, &x.Title, &x.Subject, &x.Summary, &x.BodyMD, &x.ImageURL)
	return x, err
}

func (a *App) Exhibits(ctx context.Context) ([]Exhibit, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT `+exhibitCols+` FROM exhibits ORDER BY title, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Exhibit{}
	for rows.Next() {
		x, err := scanExhibit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (a *App) ExhibitBySlug(ctx context.Context, slug string) (Exhibit, error) {
	x, err := scanExhibit(a.DB.Read.QueryRowContext(ctx, `SELECT `+exhibitCols+` FROM exhibits WHERE slug = ?`, slug))
	if errors.Is(err, sql.ErrNoRows) {
		return x, ErrNotFound
	}
	return x, err
}

// VisitedExhibitIDs lists the exhibits this student has scanned.
func (a *App) VisitedExhibitIDs(ctx context.Context, userID int64) (map[int64]bool, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT exhibit_id FROM exhibit_visits WHERE user_id = ?`, userID)
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

// SaveExhibit creates the exhibit, or updates it if the slug already exists. If creator emails are given
// they replace the current creators; unknown emails are ignored.
func (a *App) SaveExhibit(ctx context.Context, in ExhibitInput) (Exhibit, error) {
	title := strings.TrimSpace(in.Title)
	slug := Slugify(firstNonEmpty(in.Slug, title))
	if title == "" || slug == "" || (in.Subject != "physics" && in.Subject != "cs" && in.Subject != "both") {
		return Exhibit{}, ErrInvalid
	}
	var id int64
	err := a.tx(ctx, func(t *sql.Tx) error {
		err := t.QueryRowContext(ctx, `
			INSERT INTO exhibits (slug, title, subject, summary, body_md, image_url) VALUES (?, ?, ?, ?, ?, NULLIF(?, ''))
			ON CONFLICT(slug) DO UPDATE SET title=excluded.title, subject=excluded.subject, summary=excluded.summary, body_md=excluded.body_md, image_url=excluded.image_url
			RETURNING id`, slug, title, in.Subject, in.Summary, in.BodyMD, strings.TrimSpace(in.ImageURL)).Scan(&id)
		if err != nil {
			return err
		}
		if len(in.OwnerEmails) == 0 {
			return nil
		}
		if _, err := t.ExecContext(ctx, `DELETE FROM exhibit_owners WHERE exhibit_id = ?`, id); err != nil {
			return err
		}
		for _, e := range in.OwnerEmails {
			if _, err := t.ExecContext(ctx, `INSERT INTO exhibit_owners (exhibit_id, user_id) SELECT ?, id FROM users WHERE email = ? ON CONFLICT DO NOTHING`, id, strings.ToLower(strings.TrimSpace(e))); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Exhibit{}, err
	}
	x, err := scanExhibit(a.DB.Read.QueryRowContext(ctx, `SELECT `+exhibitCols+` FROM exhibits WHERE id = ?`, id))
	return x, err
}

func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
