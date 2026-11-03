package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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

// uniqueSlug returns base if no exhibit uses it, otherwise base-2, base-3 ...
func uniqueSlug(ctx context.Context, t *sql.Tx, base string) (string, error) {
	for i := 1; ; i++ {
		slug := base
		if i > 1 {
			slug = fmt.Sprintf("%s-%d", base, i)
		}
		var n int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM exhibits WHERE slug = ?`, slug).Scan(&n); err != nil {
			return "", err
		}
		if n == 0 {
			return slug, nil
		}
	}
}

func (in ExhibitInput) clean() (title string, err error) {
	title = strings.TrimSpace(in.Title)
	if title == "" || !ValidSubject(in.Subject) {
		return "", ErrInvalid
	}
	if img := strings.TrimSpace(in.ImageURL); img != "" && !strings.HasPrefix(img, "https://") && (!strings.HasPrefix(img, "/") || strings.HasPrefix(img, "//")) {
		return "", ErrInvalid // no javascript: or data: addresses
	}
	return title, nil
}

// CreateExhibit adds a new exhibit. Its web address comes from the title (a title with no Latin letters, such as a
// Chinese one, becomes "exhibit"), made unique with -2, -3... if taken. A web address the teacher asked for that is
// already used is refused (ErrExists) rather than overwriting that exhibit.
func (a *App) CreateExhibit(ctx context.Context, in ExhibitInput) (Exhibit, error) {
	title, err := in.clean()
	if err != nil {
		return Exhibit{}, err
	}
	var id int64
	err = a.tx(ctx, func(t *sql.Tx) error {
		slug := Slugify(in.Slug)
		if slug != "" {
			var n int
			if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM exhibits WHERE slug = ?`, slug).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				return ErrExists
			}
		} else {
			base := Slugify(title)
			if base == "" {
				base = "exhibit"
			}
			var err error
			if slug, err = uniqueSlug(ctx, t, base); err != nil {
				return err
			}
		}
		return t.QueryRowContext(ctx, `INSERT INTO exhibits (slug, title, subject, summary, body_md, image_url) VALUES (?, ?, ?, ?, ?, NULLIF(?, '')) RETURNING id`,
			slug, title, in.Subject, in.Summary, in.BodyMD, strings.TrimSpace(in.ImageURL)).Scan(&id)
	})
	if err != nil {
		return Exhibit{}, err
	}
	return scanExhibit(a.DB.Read.QueryRowContext(ctx, `SELECT `+exhibitCols+` FROM exhibits WHERE id = ?`, id))
}

// UpdateExhibit changes an exhibit's text, subject and picture. Its web address and its QR/NFC tag never change.
func (a *App) UpdateExhibit(ctx context.Context, id int64, in ExhibitInput) (Exhibit, error) {
	title, err := in.clean()
	if err != nil {
		return Exhibit{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `UPDATE exhibits SET title = ?, subject = ?, summary = ?, body_md = ?, image_url = NULLIF(?, '') WHERE id = ?`,
		title, in.Subject, in.Summary, in.BodyMD, strings.TrimSpace(in.ImageURL), id)
	if err != nil {
		return Exhibit{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Exhibit{}, ErrNotFound
	}
	return scanExhibit(a.DB.Read.QueryRowContext(ctx, `SELECT `+exhibitCols+` FROM exhibits WHERE id = ?`, id))
}

// ExhibitVisitCounts is how many students have scanned each exhibit.
func (a *App) ExhibitVisitCounts(ctx context.Context) (map[int64]int64, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT exhibit_id, COUNT(*) FROM exhibit_visits GROUP BY exhibit_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var id, n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// DeleteExhibit removes an exhibit with its visits (they cascade).
func (a *App) DeleteExhibit(ctx context.Context, id int64) error {
	res, err := a.DB.Write.ExecContext(ctx, `DELETE FROM exhibits WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
