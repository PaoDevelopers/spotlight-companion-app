package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"
)

// The Spotlight Month reading list. Teachers add books with an introduction; students mark "I've read this" (a public count) and
// leave comments, with their real names (the school's decision), which a teacher can delete.

const (
	maxCommentRunes     = 1000
	commentsPerHour     = 10
	maxBookTitleRunes   = 200
	maxBookSummaryRunes = 300
)

type Book struct {
	ID       int64   `json:"id"`
	Title    string  `json:"title"`
	Author   string  `json:"author"`
	Subject  string  `json:"subject"`
	Summary  string  `json:"summary"`
	BodyMD   string  `json:"bodyMd"`
	ImageURL *string `json:"imageUrl"`
	Reads    int64   `json:"reads"`    // how many students have read it
	Comments int64   `json:"comments"` // how many comments it has
	IRead    bool    `json:"iRead"`    // whether the asking student has marked it read
}

type BookInput struct{ Title, Author, Subject, Summary, BodyMD, ImageURL string }

func (in BookInput) clean() (BookInput, error) {
	in.Title, in.Author, in.Summary = strings.TrimSpace(in.Title), strings.TrimSpace(in.Author), strings.TrimSpace(in.Summary)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > maxBookTitleRunes || utf8.RuneCountInString(in.Summary) > maxBookSummaryRunes || !ValidSubject(in.Subject) {
		return in, ErrInvalid
	}
	if img := strings.TrimSpace(in.ImageURL); img != "" && !strings.HasPrefix(img, "https://") && (!strings.HasPrefix(img, "/") || strings.HasPrefix(img, "//")) {
		return in, ErrInvalid
	}
	in.ImageURL = strings.TrimSpace(in.ImageURL)
	return in, nil
}

const bookSelect = `SELECT b.id, b.title, b.author, b.subject, b.summary, b.body_md, b.image_url,
	(SELECT COUNT(*) FROM book_reads r WHERE r.book_id = b.id),
	(SELECT COUNT(*) FROM book_comments c WHERE c.book_id = b.id),
	EXISTS (SELECT 1 FROM book_reads r WHERE r.book_id = b.id AND r.user_id = ?)
	FROM books b`

func scanBook(r interface{ Scan(...any) error }) (Book, error) {
	var b Book
	var read int
	err := r.Scan(&b.ID, &b.Title, &b.Author, &b.Subject, &b.Summary, &b.BodyMD, &b.ImageURL, &b.Reads, &b.Comments, &read)
	b.IRead = read == 1
	return b, err
}

// Books lists the reading list; userID says whose "read" marks to show (0 for none).
func (a *App) Books(ctx context.Context, userID int64) ([]Book, error) {
	rows, err := a.DB.Read.QueryContext(ctx, bookSelect+` ORDER BY b.title, b.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Book{}
	for rows.Next() {
		b, err := scanBook(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (a *App) Book(ctx context.Context, id, userID int64) (Book, error) {
	b, err := scanBook(a.DB.Read.QueryRowContext(ctx, bookSelect+` WHERE b.id = ?`, userID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

func (a *App) CreateBook(ctx context.Context, in BookInput) (Book, error) {
	in, err := in.clean()
	if err != nil {
		return Book{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO books (title, author, subject, summary, body_md, image_url) VALUES (?, ?, ?, ?, ?, NULLIF(?, ''))`,
		in.Title, in.Author, in.Subject, in.Summary, in.BodyMD, in.ImageURL)
	if err != nil {
		return Book{}, err
	}
	id, _ := res.LastInsertId()
	return a.Book(ctx, id, 0)
}

func (a *App) UpdateBook(ctx context.Context, id int64, in BookInput) (Book, error) {
	in, err := in.clean()
	if err != nil {
		return Book{}, err
	}
	res, err := a.DB.Write.ExecContext(ctx, `UPDATE books SET title=?, author=?, subject=?, summary=?, body_md=?, image_url=NULLIF(?, '') WHERE id=?`,
		in.Title, in.Author, in.Subject, in.Summary, in.BodyMD, in.ImageURL, id)
	if err != nil {
		return Book{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Book{}, ErrNotFound
	}
	return a.Book(ctx, id, 0)
}

// DeleteBook removes a book with its read marks and comments.
func (a *App) DeleteBook(ctx context.Context, id int64) error {
	res, err := a.DB.Write.ExecContext(ctx, `DELETE FROM books WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetRead marks a book read (or un-marks it). Marking twice is harmless.
func (a *App) SetRead(ctx context.Context, bookID, userID int64, read bool) error {
	if _, err := a.Book(ctx, bookID, 0); err != nil {
		return err
	}
	if read {
		_, err := a.DB.Write.ExecContext(ctx, `INSERT INTO book_reads (book_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, bookID, userID, unix(a.Now()))
		return err
	}
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM book_reads WHERE book_id = ? AND user_id = ?`, bookID, userID)
	return err
}

type Comment struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	ClassName string `json:"className"`
	Body      string `json:"body"`
	At        string `json:"at"`
}

// Comments lists a book's comments, oldest first, with the writers' real names.
func (a *App) Comments(ctx context.Context, bookID int64) ([]Comment, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT c.id, u.id, u.name, COALESCE(u.class_name, ''), c.body, c.at
		FROM book_comments c JOIN users u ON u.id = c.user_id WHERE c.book_id = ? ORDER BY c.at, c.id`, bookID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		var at int64
		if err := rows.Scan(&c.ID, &c.UserID, &c.Name, &c.ClassName, &c.Body, &at); err != nil {
			return nil, err
		}
		c.At = Time(fromUnix(at))
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddComment posts a comment as the student. Plain text only (it is shown as text, never as markup), 1 to 1000 characters, and at most
// ten an hour per student, which stops a flood.
func (a *App) AddComment(ctx context.Context, bookID int64, u User, body string) (Comment, error) {
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > maxCommentRunes {
		return Comment{}, ErrInvalid
	}
	if _, err := a.Book(ctx, bookID, 0); err != nil {
		return Comment{}, err
	}
	var recent int
	if err := a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM book_comments WHERE user_id = ? AND at > ?`, u.ID, unix(a.Now())-3600).Scan(&recent); err != nil {
		return Comment{}, err
	}
	if recent >= commentsPerHour {
		return Comment{}, ErrTooMany
	}
	now := a.Now()
	res, err := a.DB.Write.ExecContext(ctx, `INSERT INTO book_comments (book_id, user_id, body, at) VALUES (?, ?, ?, ?)`, bookID, u.ID, body, unix(now))
	if err != nil {
		return Comment{}, err
	}
	id, _ := res.LastInsertId()
	return Comment{ID: id, UserID: u.ID, Name: u.Name, ClassName: u.ClassName, Body: body, At: Time(now)}, nil
}

// DeleteComment removes a comment: its writer may, and so may any teacher.
func (a *App) DeleteComment(ctx context.Context, commentID int64, actor User) error {
	var owner int64
	err := a.DB.Read.QueryRowContext(ctx, `SELECT user_id FROM book_comments WHERE id = ?`, commentID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if owner != actor.ID && !actor.IsStaff() {
		return ErrForbidden
	}
	return a.tx(ctx, func(t *sql.Tx) error {
		if _, err := t.ExecContext(ctx, `DELETE FROM book_comments WHERE id = ?`, commentID); err != nil {
			return err
		}
		if owner != actor.ID { // a teacher removing someone else's comment is recorded
			return audit(ctx, t, &actor.ID, "comments.delete", map[string]any{"comment": commentID, "writer": owner})
		}
		return nil
	})
}
