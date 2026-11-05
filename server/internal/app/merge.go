package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// A person can end up with two accounts: a record loaded from the school's student list (s12345@...), and the account
// created when they signed in with Microsoft under another address. These functions make them one account, keeping
// everything that was recorded for either: check-ins, sign-ups, competition entries, exhibit visits and awards.

// tables that hold one row per (something, student), so moving a row could collide with one the other account already has
var mergeUnique = []struct{ table, key string }{
	{"checkins", "event_id"},
	{"event_signups", "event_id"},
	{"competition_entries", "competition_id"},
	{"exhibit_visits", "exhibit_id"},
	{"student_awards", "title"},
	{"book_reads", "book_id"},
	{"hunt_progress", "stage_id"},
}

// columns that only record who did something, with no uniqueness to worry about
var mergeActor = []struct{ table, col string }{
	{"audit_log", "actor_id"},
	{"images", "uploaded_by"},
	{"student_awards", "created_by"},
	{"book_comments", "user_id"},
	{"event_works", "user_id"},
	{"hunt_photos", "user_id"},
}

// MergeReport says what a merge moved. It holds counts only.
type MergeReport struct {
	Moved     map[string]int `json:"moved"`     // rows that now belong to the account that stays
	Duplicate map[string]int `json:"duplicate"` // rows the staying account already had, so nothing is added twice
}

// aliasOwner returns the account an address belongs to: the account whose own address it is, else the one that has it as an alias.
func aliasOwner(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, email string) (int64, bool, error) {
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, email).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		err = q.QueryRowContext(ctx, `SELECT user_id FROM user_aliases WHERE email = ?`, email).Scan(&id)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	return id, err == nil, err
}

// mergeTx folds the account drop into keep. With dry=true it only counts. Role is the higher of the two, and a class the
// staying account lacks is taken from the other. The dropped account's address stays usable as an alias.
func mergeTx(ctx context.Context, t *sql.Tx, keep, drop int64, dry bool) (MergeReport, error) {
	rep := MergeReport{Moved: map[string]int{}, Duplicate: map[string]int{}}
	for _, m := range mergeUnique {
		var total, dup int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+m.table+` WHERE user_id = ?`, drop).Scan(&total); err != nil {
			return rep, err
		}
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+m.table+` d WHERE d.user_id = ? AND EXISTS (SELECT 1 FROM `+m.table+` k WHERE k.user_id = ? AND k.`+m.key+` = d.`+m.key+`)`, drop, keep).Scan(&dup); err != nil {
			return rep, err
		}
		rep.Moved[m.table], rep.Duplicate[m.table] = total-dup, dup
		if !dry {
			if _, err := t.ExecContext(ctx, `UPDATE OR IGNORE `+m.table+` SET user_id = ? WHERE user_id = ?`, keep, drop); err != nil {
				return rep, err
			}
		}
	}
	if dry {
		return rep, nil
	}
	for _, m := range mergeActor {
		if _, err := t.ExecContext(ctx, `UPDATE `+m.table+` SET `+m.col+` = ? WHERE `+m.col+` = ?`, keep, drop); err != nil {
			return rep, err
		}
	}
	var dropEmail, dropClass, dropRole, keepClass, keepRole sql.NullString
	if err := t.QueryRowContext(ctx, `SELECT email, class_name, role FROM users WHERE id = ?`, drop).Scan(&dropEmail, &dropClass, &dropRole); err != nil {
		return rep, err
	}
	if err := t.QueryRowContext(ctx, `SELECT class_name, role FROM users WHERE id = ?`, keep).Scan(&keepClass, &keepRole); err != nil {
		return rep, err
	}
	rank := map[string]int{"student": 0, "teacher": 1, "admin": 2}
	role := keepRole.String
	if rank[dropRole.String] > rank[role] {
		role = dropRole.String
	}
	class := keepClass.String
	if strings.TrimSpace(class) == "" {
		class = dropClass.String
	}
	// the other account's addresses now belong to this one, so signing in under any of them (or loading the school list
	// again) leads here
	if _, err := t.ExecContext(ctx, `UPDATE user_aliases SET user_id = ? WHERE user_id = ?`, keep, drop); err != nil {
		return rep, err
	}
	// what is left on the dropped account (rows that duplicated one the staying account has) goes with it
	if _, err := t.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, drop); err != nil {
		return rep, err
	}
	if _, err := t.ExecContext(ctx, `INSERT OR IGNORE INTO user_aliases (email, user_id) VALUES (?, ?)`, dropEmail.String, keep); err != nil {
		return rep, err
	}
	_, err := t.ExecContext(ctx, `UPDATE users SET role = ?, class_name = NULLIF(?, '') WHERE id = ?`, role, class, keep)
	return rep, err
}

// MergeStudents makes two student accounts one: keepID stays (with its name and address), dropID is folded into it.
// It is for duplicates that already exist. With dryRun it reports what would happen and changes nothing.
func (a *App) MergeStudents(ctx context.Context, actorID, keepID, dropID int64, dryRun bool) (MergeReport, error) {
	if keepID == dropID || keepID <= 0 || dropID <= 0 {
		return MergeReport{}, ErrInvalid
	}
	var rep MergeReport
	errDry := errors.New("dry run")
	err := a.tx(ctx, func(t *sql.Tx) error {
		for _, id := range []int64{keepID, dropID} {
			var role string
			if err := t.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, id).Scan(&role); errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			} else if err != nil {
				return err
			} else if role != "student" {
				return ErrInvalid // staff accounts are never merged by hand
			}
		}
		var err error
		if rep, err = mergeTx(ctx, t, keepID, dropID, dryRun); err != nil {
			return err
		}
		if dryRun {
			return errDry
		}
		return audit(ctx, t, &actorID, "users.merge", map[string]any{"kept": keepID, "dropped": dropID, "moved": rep.Moved, "duplicate": rep.Duplicate})
	})
	if errors.Is(err, errDry) {
		return rep, nil
	}
	return rep, err
}
