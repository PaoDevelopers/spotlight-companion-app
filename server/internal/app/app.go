// Package app holds the business rules: check-in, competitions, exhibits, votes, awards and accounts.
// It is a port of the TypeScript lib/services/*. HTTP lives in internal/web.
package app

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/config"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/db"
)

// App wires the database and settings together. Now is replaceable so tests control time.
type App struct {
	DB  *db.DB
	Cfg *config.Config
	Now func() time.Time

	// Keys verifies Microsoft ID tokens. Left nil, Microsoft's published keys are fetched on first use;
	// tests set it.
	Keys jwt.Keyfunc
}

func New(d *db.DB, cfg *config.Config) *App {
	return &App{DB: d, Cfg: cfg, Now: time.Now}
}

// Errors the HTTP layer turns into friendly messages.
var (
	ErrNotFound   = errors.New("not found")
	ErrClosed     = errors.New("check-in is not open for this event")
	ErrFull       = errors.New("this event is full")
	ErrBadToken   = errors.New("invalid or expired code")
	ErrOwnExhibit = errors.New("you can't vote for your own project")
	ErrInvalid    = errors.New("invalid input")
	ErrForbidden  = errors.New("not allowed")
)

// tx runs fn in a write transaction (the write pool has one connection and takes the lock up front,
// so everything inside is atomic, e.g. the capacity check and the insert of a check-in).
func (a *App) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	t, err := a.DB.Write.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(t); err != nil {
		t.Rollback()
		return err
	}
	return t.Commit()
}

func unix(t time.Time) int64     { return t.Unix() }
func fromUnix(s int64) time.Time { return time.Unix(s, 0).UTC() }
func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// Time is how times appear in API responses.
func Time(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func constEq(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
