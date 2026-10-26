package db

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func open(t *testing.T) *DB {
	t.Helper()
	d, err := Open(context.Background(), filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestMigrationsApplyOnceAndReopenCleanly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")
	d, err := Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	d.Close()
	d, err = Open(context.Background(), path) // second start must not re-run migrations
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	var n int
	if err := d.Read.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("schema_migrations rows = %d, err %v", n, err)
	}
}

func mustExec(t *testing.T, d *DB, q string, args ...any) {
	t.Helper()
	if _, err := d.Write.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func TestConstraints(t *testing.T) {
	d := open(t)
	mustExec(t, d, `INSERT INTO users (email, name) VALUES ('a@x', 'A')`)
	mustExec(t, d, `INSERT INTO events (title, subject, starts_at, ends_at, capacity) VALUES ('E', 'cs', 100, 200, 5)`)

	cases := []struct{ name, query string }{
		{"duplicate email", `INSERT INTO users (email, name) VALUES ('a@x', 'B')`},
		{"bad role", `INSERT INTO users (email, name, role) VALUES ('b@x', 'B', 'wizard')`},
		{"bad subject", `INSERT INTO events (title, subject, starts_at, ends_at) VALUES ('E', 'art', 1, 2)`},
		{"event ends before it starts", `INSERT INTO events (title, subject, starts_at, ends_at) VALUES ('E', 'cs', 5, 5)`},
		{"zero capacity", `INSERT INTO events (title, subject, starts_at, ends_at, capacity) VALUES ('E', 'cs', 1, 2, 0)`},
		{"check-in for a missing user", `INSERT INTO checkins (event_id, user_id, method) VALUES (1, 99, 'qr')`},
		{"score above 100", `INSERT INTO exhibits (slug, title, subject) VALUES ('x','X','cs'); INSERT INTO judge_scores (category, exhibit_id, judge_id, score) VALUES ('c', 1, 1, 101)`},
		{"invalid json", `INSERT INTO awards (key, title, config) VALUES ('k', 'K', 'not json')`},
	}
	for _, c := range cases {
		if _, err := d.Write.Exec(c.query); err == nil {
			t.Errorf("%s: expected the database to refuse it", c.name)
		}
	}

	mustExec(t, d, `INSERT INTO checkins (event_id, user_id, method) VALUES (1, 1, 'qr')`)
	if _, err := d.Write.Exec(`INSERT INTO checkins (event_id, user_id, method) VALUES (1, 1, 'nfc')`); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("a second check-in for the same student and event must be refused, got %v", err)
	}
	mustExec(t, d, `DELETE FROM events WHERE id = 1`) // cascades
	var n int
	d.Read.QueryRow(`SELECT COUNT(*) FROM checkins`).Scan(&n)
	if n != 0 {
		t.Errorf("check-ins should cascade-delete with their event, %d left", n)
	}
}

// Many simultaneous writers must all succeed (queueing on the single write connection), never "database is locked".
func TestConcurrentWritesDoNotFail(t *testing.T) {
	d := open(t)
	mustExec(t, d, `INSERT INTO events (title, subject, starts_at, ends_at) VALUES ('E','cs',1,2)`)
	for i := 0; i < 200; i++ {
		mustExec(t, d, `INSERT INTO users (email, name) VALUES (?, 'u')`, "u"+string(rune('a'+i%26))+strings.Repeat("x", i/26)+"@s")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 200)
	for u := 1; u <= 200; u++ {
		wg.Add(1)
		go func(u int) {
			defer wg.Done()
			_, err := d.Write.Exec(`INSERT INTO checkins (event_id, user_id, method) VALUES (1, ?, 'qr')`, u)
			errs <- err
		}(u)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	d.Read.QueryRow(`SELECT COUNT(*) FROM checkins`).Scan(&n)
	if n != 200 {
		t.Fatalf("expected 200 check-ins, got %d", n)
	}
}

func TestBackupIsAConsistentCopyAndRefusesToOverwrite(t *testing.T) {
	d := open(t)
	mustExec(t, d, `INSERT INTO users (email, name) VALUES ('a@x', 'A')`)
	dest := filepath.Join(t.TempDir(), "backup.db")
	if err := d.Backup(context.Background(), dest); err != nil {
		t.Fatal(err)
	}
	if err := d.Backup(context.Background(), dest); err == nil {
		t.Fatal("overwriting an existing backup must be refused")
	}
	copyDB, err := Open(context.Background(), dest)
	if err != nil {
		t.Fatal(err)
	}
	defer copyDB.Close()
	var n int
	if err := copyDB.Read.QueryRow(`SELECT COUNT(*) FROM users WHERE email = 'a@x'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("backup is missing data: %d %v", n, err)
	}
}
