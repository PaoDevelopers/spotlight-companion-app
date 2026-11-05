package app

import (
	"context"
	"strconv"
)

// BookImport is a book to load from a prepared list, with its cover picture if there is one.
type BookImport struct {
	BookInput
	Cover []byte
}

// ImportBooks adds the books that are not in the library yet (matched by title) and reports how many it added and skipped. A cover
// that is not a usable picture is left out rather than failing the whole list.
func (a *App) ImportBooks(ctx context.Context, list []BookImport, dry bool) (added, skipped int, err error) {
	for _, b := range list {
		var n int
		if err = a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM books WHERE title = ?`, b.Title).Scan(&n); err != nil {
			return
		}
		if n > 0 {
			skipped++
			continue
		}
		if _, cerr := b.clean(); cerr != nil {
			return added, skipped, cerr
		}
		added++
		if dry {
			continue
		}
		if len(b.Cover) > 0 {
			if ct, derr := detectImage(b.Cover); derr == nil {
				res, ierr := a.DB.Write.ExecContext(ctx, `INSERT INTO images (content_type, data, uploaded_by, kind, at) VALUES (?, ?, NULL, 'content', ?)`, ct, b.Cover, unix(a.Now()))
				if ierr != nil {
					return added, skipped, ierr
				}
				id, _ := res.LastInsertId()
				b.ImageURL = "/api/images/" + strconv.FormatInt(id, 10)
			}
		}
		if _, err = a.CreateBook(ctx, b.BookInput); err != nil {
			return
		}
	}
	return
}
