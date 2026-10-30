package app

import (
	"context"
	"database/sql"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/auth"
)

// SeedDemo loads FAKE demo accounts and data (never use with real data) and returns the login codes by email.
// It does nothing, and returns nil, if the demo teacher already exists.
func (a *App) SeedDemo(ctx context.Context) (map[string]string, error) {
	var exists int
	if err := a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE email = 'teacher@demo.school'`).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, nil
	}
	codes := map[string]string{}
	err := a.tx(ctx, func(t *sql.Tx) error {
		if err := ensureAwards(ctx, t); err != nil {
			return err
		}
		for _, u := range []struct{ name, email, role, class string }{
			{"Ms Teacher", "teacher@demo.school", "teacher", ""},
			{"Demo Student", "student@demo.school", "student", "10A"},
		} {
			code := a.Cfg.DemoLoginCode
			if code == "" {
				code = auth.GenerateCode(8)
			}
			codes[u.email] = code
			if _, err := t.ExecContext(ctx, `INSERT INTO users (email, name, role, class_name, login_code_hash) VALUES (?, ?, ?, NULLIF(?, ''), ?)`, u.email, u.name, u.role, u.class, auth.HashCode(code)); err != nil {
				return err
			}
		}
		now := a.Now()
		at := func(days int, hours int) int64 {
			return unix(now.Add(time.Duration(days)*24*time.Hour + time.Duration(hours)*time.Hour))
		}
		ids := make([]int64, 3)
		for i, e := range []struct {
			title, subject, venue, desc string
			start, end                  int64
			capacity                    any
		}{
			{"Opening Assembly: Physics Meets CS", "both", "Main Hall", "Kick-off with live demos.", at(0, -1), at(0, 3), 400},
			{"Hackathon", "cs", "Lab 2", "4-hour build challenge.", at(3, 0), at(3, 4), nil},
			{"Rube Goldberg Contest", "physics", "Gym", "Chain reactions.", at(7, 0), at(7, 2), nil},
		} {
			if err := t.QueryRowContext(ctx, `INSERT INTO events (title, subject, venue, description, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
				e.title, e.subject, e.venue, e.desc, e.start, e.end, e.capacity).Scan(&ids[i]); err != nil {
				return err
			}
		}
		if _, err := t.ExecContext(ctx, `INSERT INTO competitions (event_id, name) VALUES (?, 'Hackathon')`, ids[1]); err != nil {
			return err
		}
		for _, x := range [][5]string{
			{"double-pendulum", "Double Pendulum", "physics", "Chaos you can see.", "## What you're seeing\nTwo linked pendulums. Tiny changes in the start give wildly different paths.\n\n## Try this\nRelease it twice from *almost* the same angle."},
			{"sorting-wall", "Sorting Wall", "cs", "Algorithms as motion.", "## How it works\n1. Bars represent numbers.\n2. Each algorithm swaps them differently.\n\n## Try this\nWhich algorithm finishes first on a nearly sorted list?"},
		} {
			if _, err := t.ExecContext(ctx, `INSERT INTO exhibits (slug, title, subject, summary, body_md) VALUES (?, ?, ?, ?, ?)`, x[0], x[1], x[2], x[3], x[4]); err != nil {
				return err
			}
		}
		return nil
	})
	return codes, err
}

// EnsureAdmins (roster mode) creates the ADMIN_EMAILS accounts that don't exist yet and returns their one-time
// login codes. In Microsoft mode admins are granted at sign-in instead, so there is nothing to create.
func (a *App) EnsureAdmins(ctx context.Context) (map[string]string, error) {
	codes := map[string]string{}
	if a.Cfg.AuthMode == "entra" {
		return codes, nil
	}
	for _, email := range a.Cfg.AdminEmails {
		if _, err := a.UserByEmail(ctx, email); err == nil {
			continue
		}
		code := auth.GenerateCode(8)
		name, _, _ := stringsCut(email)
		if _, err := a.DB.Write.ExecContext(ctx, `INSERT INTO users (email, name, role, login_code_hash) VALUES (?, ?, 'admin', ?)`, email, name, auth.HashCode(code)); err != nil {
			return codes, err
		}
		codes[email] = code
	}
	return codes, nil
}

func stringsCut(s string) (string, string, bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == '@' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}
