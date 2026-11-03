package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"unicode"
)

// StudentRecord is one line of the school's student list.
type StudentRecord struct {
	ID    string // the school id, e.g. "s10001"; the school email is made from it
	Name  string // as shown to teachers
	Class string // optional
}

// ImportReport says what an import did. It never contains names.
type ImportReport struct {
	Read        int `json:"read"`
	Added       int `json:"added"`
	Existing    int `json:"existing"`    // already had an account: nothing about them was overwritten
	ClassFilled int `json:"classFilled"` // existing accounts that had no class and got one
	Skipped     int `json:"skipped"`     // not usable (no id, or an id that can't be an email name)
}

var (
	// "Family (Given 中文名) Nickname", the way the school system writes names
	systemName = regexp.MustCompile(`^\s*([^()]*?)\s*\(\s*([^)]*?)\s*\)\s*(.*?)\s*$`)
	idForEmail = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,30}$`)
)

func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

// DisplayName turns the school system's "Wong (Mei Ling 黄美玲) Amy" into "Mei Ling Wong 黄美玲 (Amy)": given name
// first, the Chinese name kept so teachers can search either, and the nickname last. A name that doesn't follow the
// pattern is only tidied. Whatever Microsoft sends at a student's first sign-in replaces this.
func DisplayName(systemNameText string) string {
	// Chinese input methods produce full-width brackets and spaces; treat them like the ASCII ones
	systemNameText = strings.NewReplacer("\uFF08", "(", "\uFF09", ")", "\u3000", " ").Replace(systemNameText)
	m := systemName.FindStringSubmatch(systemNameText)
	if m == nil {
		return collapse(systemNameText)
	}
	family, inner, nick := collapse(m[1]), m[2], collapse(m[3])
	var han strings.Builder
	var rest strings.Builder
	for _, r := range inner {
		if unicode.Is(unicode.Han, r) {
			han.WriteRune(r)
		} else {
			rest.WriteRune(r)
		}
	}
	given := collapse(rest.String())
	out := collapse(given + " " + family)
	if han.Len() > 0 {
		out += " " + han.String()
	}
	if nick != "" && !strings.EqualFold(nick, given) && !strings.EqualFold(nick, family) {
		out += " (" + nick + ")"
	}
	return out
}

// ImportStudents makes sure each student has an account, so teachers can find them (to check in, enter in a
// competition or give an award) before they have ever signed in. It never gives anyone a login code, never changes
// an existing person's name or role (a teacher stays a teacher), and only fills an empty class. Safe to repeat.
// With dryRun it reports what would happen and changes nothing.
func (a *App) ImportStudents(ctx context.Context, recs []StudentRecord, dryRun bool) (ImportReport, error) {
	rep := ImportReport{Read: len(recs)}
	errDry := errors.New("dry run")
	err := a.tx(ctx, func(t *sql.Tx) error {
		for _, r := range recs {
			id := strings.ToLower(strings.TrimSpace(r.ID))
			name := collapse(r.Name)
			if !idForEmail.MatchString(id) || name == "" {
				rep.Skipped++
				continue
			}
			email := id + "@" + a.Cfg.StudentDomain
			class := strings.TrimSpace(r.Class)
			var curClass sql.NullString
			err := t.QueryRowContext(ctx, `SELECT class_name FROM users WHERE email = ? OR id = (SELECT user_id FROM user_aliases WHERE email = ?) ORDER BY email = ? DESC LIMIT 1`, email, email, email).Scan(&curClass)
			switch {
			case errors.Is(err, sql.ErrNoRows):
				if _, err := t.ExecContext(ctx, `INSERT INTO users (email, name, class_name, role) VALUES (?, ?, NULLIF(?, ''), 'student')`, email, name, class); err != nil {
					return err
				}
				rep.Added++
			case err != nil:
				return err
			default:
				rep.Existing++
				if class != "" && strings.TrimSpace(curClass.String) == "" {
					if _, err := t.ExecContext(ctx, `UPDATE users SET class_name = ? WHERE email = ? OR id = (SELECT user_id FROM user_aliases WHERE email = ?)`, class, email, email); err != nil {
						return err
					}
					rep.ClassFilled++
				}
			}
		}
		if dryRun {
			return errDry
		}
		return audit(ctx, t, nil, "students.import", rep)
	})
	if errors.Is(err, errDry) {
		return rep, nil
	}
	return rep, err
}

func isSQLiteFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 16)
	n, _ := io.ReadFull(f, head)
	return string(head[:n]) == "SQLite format 3\x00"
}

// ReadStudentsFile reads the school's student list: either the SQLite file the school system exports (a table
// "students" with id and system_name) or a CSV with a header row naming id (or email), name and optionally class.
func ReadStudentsFile(ctx context.Context, path string, studentDomain string) ([]StudentRecord, error) {
	if !isSQLiteFile(path) { // decided by the file's first bytes, not its name: uploads have no useful name
		return readStudentsCSV(path, studentDomain)
	}
	d, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1")
	if err != nil {
		return nil, err
	}
	defer d.Close()
	rows, err := d.QueryContext(ctx, `SELECT id, COALESCE(system_name, ''), COALESCE(english_name, ''), COALESCE(chinese_name, '') FROM students ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("%s is not a student list (expected a table named students): %w", path, err)
	}
	defer rows.Close()
	var out []StudentRecord
	for rows.Next() {
		var id, system, english, chinese string
		if err := rows.Scan(&id, &system, &english, &chinese); err != nil {
			return nil, err
		}
		name := DisplayName(system)
		if strings.TrimSpace(system) == "" { // fall back to the separate name columns if the school fills them
			name = collapse(english + " " + chinese)
		}
		out = append(out, StudentRecord{ID: id, Name: name})
	}
	return out, rows.Err()
}
