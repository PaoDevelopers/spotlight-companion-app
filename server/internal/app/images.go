package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

// MaxImageBytes is the biggest picture the server stores. The web app shrinks photos well below this first.
const MaxImageBytes = 6 << 20

// SaveImage stores an uploaded picture and returns its id. The type comes from the bytes, never from what the
// uploader claims, and only formats a browser shows as a plain picture are allowed (no svg).
func (a *App) SaveImage(ctx context.Context, data []byte, uploader int64) (int64, error) {
	if len(data) == 0 || len(data) > MaxImageBytes {
		return 0, ErrInvalid
	}
	ct := http.DetectContentType(data)
	switch ct {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
	default:
		return 0, ErrInvalid
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO images (content_type, data, uploaded_by) VALUES (?, ?, ?)`, ct, data, uploader)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (a *App) Image(ctx context.Context, id int64) (contentType string, data []byte, err error) {
	err = a.DB.Read.QueryRowContext(ctx, `SELECT content_type, data FROM images WHERE id = ?`, id).Scan(&contentType, &data)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return
}
