// Package db opens the SQLite database and applies the embedded migrations.
package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite" // registers the pure-Go "sqlite" driver
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// DB holds two pools on one file: SQLite allows a single writer at a time, so writes go through a
// pool of one connection (callers queue instead of failing with "database is locked"), while reads
// run in parallel on their own connections (WAL lets readers proceed during a write).
type DB struct {
	Write *sql.DB
	Read  *sql.DB
}

func dsn(path string, readOnly bool) string {
	q := url.Values{}
	for _, p := range []string{"busy_timeout(5000)", "foreign_keys(1)", "journal_mode(WAL)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	q.Set("_txlock", "immediate") // take the write lock when a transaction starts, so it can't fail halfway
	if readOnly {
		q.Del("_txlock")
	}
	return "file:" + path + "?" + q.Encode()
}

// Open opens (and creates) the database file and brings the schema up to date.
func Open(ctx context.Context, path string) (*DB, error) {
	w, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	r, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		return nil, err
	}
	r.SetMaxOpenConns(8)
	r.SetConnMaxLifetime(time.Hour)

	d := &DB{Write: w, Read: r}
	if err := d.migrate(ctx); err != nil {
		d.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

func (d *DB) Close() error {
	e1, e2 := d.Write.Close(), d.Read.Close()
	if e1 != nil {
		return e1
	}
	return e2
}

// migrate applies each embedded migration once, in filename order, each in its own transaction.
func (d *DB) migrate(ctx context.Context) error {
	if _, err := d.Write.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`); err != nil {
		return err
	}
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied int
		if err := d.Write.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, name).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		body, err := migrationFiles.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if err := d.apply(ctx, name, string(body)); err != nil {
			return err
		}
	}
	return nil
}

// noFKMarker on the first line of a migration means "rebuild tables": SQLite can only change a CHECK by creating a
// new table, copying and dropping the old one, and dropping a parent table with foreign keys on would cascade-delete
// its children. The runner switches them off for that migration, then verifies nothing was left dangling.
const noFKMarker = "-- migrate:no-fk"

// apply runs one migration in its own transaction and records it.
func (d *DB) apply(ctx context.Context, name, body string) error {
	conn, err := d.Write.Conn(ctx) // the pool has one connection, so this is the only one that can write
	if err != nil {
		return err
	}
	defer conn.Close()
	rebuild := strings.HasPrefix(body, noFKMarker)
	if rebuild {
		// the pragma is ignored inside a transaction, so it must come first
		if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
			return err
		}
		defer conn.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`)
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, body); err != nil {
		tx.Rollback()
		return fmt.Errorf("%s: %w", name, err)
	}
	if rebuild {
		var table string
		err := tx.QueryRowContext(ctx, `SELECT "table" FROM pragma_foreign_key_check LIMIT 1`).Scan(&table)
		if err == nil {
			tx.Rollback()
			return fmt.Errorf("%s: foreign key violations in %s after rebuild", name, table)
		} else if !errors.Is(err, sql.ErrNoRows) {
			tx.Rollback()
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, name); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Backup writes a consistent snapshot of the live database to dest (which must not exist yet).
// It is safe while the app is running: SQLite builds the copy inside a read transaction.
func (d *DB) Backup(ctx context.Context, dest string) error {
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("%s already exists", dest)
	}
	_, err := d.Read.ExecContext(ctx, `VACUUM INTO ?`, dest)
	return err
}
