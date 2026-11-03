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
	files, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := d.Read.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil || n != len(files) {
		t.Fatalf("schema_migrations rows = %d, want %d, err %v", n, len(files), err)
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
		{"award for a missing student", `INSERT INTO student_awards (title, user_id) VALUES ('Best', 99)`},
		{"award published flag out of range", `INSERT INTO users (id, email, name) VALUES (50, 'z@x', 'Z'); INSERT INTO student_awards (title, user_id, published) VALUES ('Best', 50, 2)`},
		{"invalid json in the audit log", `INSERT INTO audit_log (action, detail) VALUES ('x', 'not json')`},
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

// The chemistry migration rebuilds events and exhibits; the rows and everything that points at them must survive.
func TestChemistryMigrationKeepsDataAndChildren(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	d, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	// go back to the state before 0003, with data in tables that reference events and exhibits
	for _, q := range []string{
		`DELETE FROM schema_migrations WHERE version IN ('0003_chemistry.sql')`,
		`INSERT INTO users (id, email, name) VALUES (1, 'a@x', 'A')`,
		`INSERT INTO events (id, title, subject, starts_at, ends_at) VALUES (7, 'Talk', 'cs', 100, 200)`,
		`INSERT INTO checkins (event_id, user_id, method) VALUES (7, 1, 'qr')`,
		`INSERT INTO event_signups (event_id, user_id) VALUES (7, 1)`,
		`INSERT INTO competitions (event_id, name) VALUES (7, 'Quiz')`,
		`INSERT INTO exhibits (id, slug, title, subject) VALUES (3, 'pend', 'Pendulum', 'physics')`,
		`INSERT INTO exhibit_visits (exhibit_id, user_id) VALUES (3, 1)`,
	} {
		mustExec(t, d, q)
	}
	d.Close()
	d, err = Open(ctx, path) // runs 0003 again on data
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	for q, want := range map[string]int{
		`SELECT COUNT(*) FROM events`: 1, `SELECT COUNT(*) FROM checkins`: 1, `SELECT COUNT(*) FROM event_signups`: 1,
		`SELECT COUNT(*) FROM competitions`: 1, `SELECT COUNT(*) FROM exhibits`: 1, `SELECT COUNT(*) FROM exhibit_visits`: 1,
	} {
		var n int
		if err := d.Read.QueryRow(q).Scan(&n); err != nil || n != want {
			t.Errorf("%s = %d (err %v), want %d", q, n, err, want)
		}
	}
	mustExec(t, d, `INSERT INTO events (title, subject, starts_at, ends_at) VALUES ('Reactions', 'chemistry', 100, 200)`)
	mustExec(t, d, `INSERT INTO exhibits (slug, title, subject) VALUES ('ph', 'Indicators', 'chemistry')`)
	var on int
	d.Write.QueryRow(`PRAGMA foreign_keys`).Scan(&on)
	if on != 1 {
		t.Error("foreign keys must be switched back on")
	}
	// deleting the event still cascades to its children
	mustExec(t, d, `DELETE FROM events WHERE id = 7`)
	var n int
	d.Read.QueryRow(`SELECT COUNT(*) FROM checkins`).Scan(&n)
	if n != 0 {
		t.Errorf("checkins should cascade-delete with the event, %d left", n)
	}
}

// Moving to teacher-chosen awards drops the tables that computed them; it must work on a database that used them.
func TestManualAwardsMigrationOnUsedDatabase(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	d, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	// recreate the state before 0006: the old tables, with rows in them
	for _, q := range []string{
		`DELETE FROM schema_migrations WHERE version = '0006_manual_awards.sql'`,
		`DROP TABLE student_awards`,
		`CREATE TABLE awards (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}')`,
		`CREATE TABLE award_results (id INTEGER PRIMARY KEY AUTOINCREMENT, award_id INTEGER NOT NULL REFERENCES awards(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, rank INTEGER NOT NULL, metrics TEXT NOT NULL DEFAULT '{}', published INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE votes (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, exhibit_id INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE, voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE)`,
		`CREATE TABLE judge_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, exhibit_id INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE, judge_id INTEGER NOT NULL REFERENCES users(id), score INTEGER NOT NULL)`,
		`CREATE TABLE exhibit_owners (exhibit_id INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE)`,
		`INSERT INTO users (id, email, name) VALUES (1, 'a@x', 'A')`,
		`INSERT INTO exhibits (id, slug, title, subject) VALUES (1, 'x', 'X', 'cs')`,
		`INSERT INTO awards (id, key, title) VALUES (1, 'creative', 'Most Creative')`,
		`INSERT INTO award_results (award_id, user_id, rank) VALUES (1, 1, 1)`,
		`INSERT INTO votes (category, exhibit_id, voter_id) VALUES ('c', 1, 1)`,
		`INSERT INTO judge_scores (category, exhibit_id, judge_id, score) VALUES ('c', 1, 1, 80)`,
		`INSERT INTO exhibit_owners (exhibit_id, user_id) VALUES (1, 1)`,
	} {
		mustExec(t, d, q)
	}
	d.Close()
	d, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	for _, gone := range []string{"awards", "award_results", "votes", "judge_scores", "exhibit_owners"} {
		var n int
		d.Read.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, gone).Scan(&n)
		if n != 0 {
			t.Errorf("table %s should be dropped", gone)
		}
	}
	mustExec(t, d, `INSERT INTO student_awards (title, user_id, reason) VALUES ('Best', 1, 'why')`)
	var users, exhibits int
	d.Read.QueryRow(`SELECT (SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM exhibits)`).Scan(&users, &exhibits)
	if users != 1 || exhibits != 1 {
		t.Errorf("users and exhibits must be untouched: %d %d", users, exhibits)
	}
}
