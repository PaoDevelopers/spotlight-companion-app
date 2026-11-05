package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

// MaxImageBytes is the biggest picture the server stores. The web app shrinks photos well below this first.
const MaxImageBytes = 6 << 20

// Student uploads are limited so one account cannot fill the school's database.
const (
	studentImagesPerHour = 30
	studentImagesTotal   = 300
)

// Picture kinds. 'content' is what teachers put into pages; 'work' is a student's shared work on an event; 'hunt' is evidence for a
// scavenger hunt, visible only to its owner and to teachers.
const (
	ImageContent = "content"
	ImageWork    = "work"
	ImageHunt    = "hunt"
)

// ErrTooMany says someone is doing something too often, or has too many of something.
var ErrTooMany = errors.New("that is too many too quickly; please wait a little")

func detectImage(data []byte) (string, error) {
	if len(data) == 0 || len(data) > MaxImageBytes {
		return "", ErrInvalid
	}
	switch ct := http.DetectContentType(data); ct {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return ct, nil
	}
	return "", ErrInvalid // the type comes from the bytes, never from what the uploader claims; no svg (it can carry scripts)
}

// SaveImage stores a picture a teacher puts into a page and returns its id.
func (a *App) SaveImage(ctx context.Context, data []byte, uploader int64) (int64, error) {
	return a.saveImage(ctx, data, uploader, ImageContent)
}

func (a *App) saveImage(ctx context.Context, data []byte, uploader int64, kind string) (int64, error) {
	ct, err := detectImage(data)
	if err != nil {
		return 0, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO images (content_type, data, uploaded_by, kind, at) VALUES (?, ?, ?, ?, ?)`, ct, data, uploader, kind, unix(a.Now()))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// SaveStudentImage stores a picture a student uploads (a shared work, or hunt evidence), within the limits above.
func (a *App) SaveStudentImage(ctx context.Context, u User, data []byte, kind string) (int64, error) {
	if kind != ImageWork && kind != ImageHunt {
		return 0, ErrInvalid
	}
	var hour, total int
	if err := a.DB.Read.QueryRowContext(ctx, `SELECT
		COALESCE(SUM(at > ?), 0), COUNT(*) FROM images WHERE uploaded_by = ? AND kind != 'content'`, unix(a.Now())-3600, u.ID).Scan(&hour, &total); err != nil {
		return 0, err
	}
	if hour >= studentImagesPerHour || total >= studentImagesTotal {
		return 0, ErrTooMany
	}
	return a.saveImage(ctx, data, u.ID, kind)
}

// ImageFile is a stored picture with who may see it.
type ImageFile struct {
	Type  string
	Data  []byte
	Kind  string
	Owner int64 // 0 when unknown
}

func (a *App) Image(ctx context.Context, id int64) (ImageFile, error) {
	var f ImageFile
	var owner sql.NullInt64
	err := a.DB.Read.QueryRowContext(ctx, `SELECT content_type, data, kind, uploaded_by FROM images WHERE id = ?`, id).Scan(&f.Type, &f.Data, &f.Kind, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	f.Owner = owner.Int64
	return f, err
}

// MayView says whether u may see the picture. Hunt evidence is private to its owner and to teachers.
func (f ImageFile) MayView(u User) bool {
	return f.Kind != ImageHunt || u.IsStaff() || f.Owner == u.ID
}

// imageOwnedBy checks a picture was uploaded by this student with the expected kind, and is not already attached somewhere.
func imageOwnedBy(ctx context.Context, t *sql.Tx, id, userID int64, kind string) error {
	var owner sql.NullInt64
	var k string
	var used int
	err := t.QueryRowContext(ctx, `SELECT uploaded_by, kind,
		(SELECT COUNT(*) FROM event_works WHERE image_id = images.id) + (SELECT COUNT(*) FROM hunt_photos WHERE image_id = images.id)
		FROM images WHERE id = ?`, id).Scan(&owner, &k, &used)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (owner.Int64 != userID || k != kind || used > 0)) {
		return ErrInvalid
	}
	return err
}
