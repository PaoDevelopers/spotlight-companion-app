package app

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"strings"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/auth"
)

type User struct {
	ID                int64  `json:"id"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	ClassName         string `json:"className"`
	Role              string `json:"role"`
	ShowOnLeaderboard bool   `json:"showOnLeaderboard"`
	codeHash          string
}

func (u User) IsStaff() bool { return u.Role == "teacher" || u.Role == "admin" }

const userCols = `id, email, name, COALESCE(class_name,''), role, show_on_leaderboard, COALESCE(login_code_hash,'')`

func scanUser(r interface{ Scan(...any) error }) (User, error) {
	var u User
	var show int
	err := r.Scan(&u.ID, &u.Email, &u.Name, &u.ClassName, &u.Role, &show, &u.codeHash)
	u.ShowOnLeaderboard = show == 1
	return u, err
}

func (a *App) UserByID(ctx context.Context, id int64) (User, error) {
	u, err := scanUser(a.DB.Read.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func (a *App) UserByEmail(ctx context.Context, email string) (User, error) {
	u, err := scanUser(a.DB.Read.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(email))))
	if errors.Is(err, sql.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

// LoginWithCode checks an email + printed code (roster mode). A wrong email and a wrong code look the same.
func (a *App) LoginWithCode(ctx context.Context, email, code string) (User, bool) {
	u, err := a.UserByEmail(ctx, email)
	if err != nil {
		// Spend the same time hashing, so response time doesn't reveal which emails exist.
		auth.VerifyCode(code, auth.HashCode("x"))
		return User{}, false
	}
	return u, auth.VerifyCode(code, u.codeHash)
}

func (a *App) SetShowOnLeaderboard(ctx context.Context, userID int64, show bool) error {
	_, err := a.DB.Write.ExecContext(ctx, `UPDATE users SET show_on_leaderboard = ? WHERE id = ?`, b2i(show), userID)
	return err
}

// SetRole changes a user's role (admin only; the caller checks).
func (a *App) SetRole(ctx context.Context, actor User, email, role string) error {
	if role != "student" && role != "teacher" && role != "admin" {
		return ErrInvalid
	}
	return a.tx(ctx, func(t *sql.Tx) error {
		res, err := t.ExecContext(ctx, `UPDATE users SET role = ? WHERE email = ?`, role, strings.ToLower(strings.TrimSpace(email)))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return audit(ctx, t, &actor.ID, "role.set", map[string]any{"email": email, "role": role})
	})
}

type RosterRow struct{ Name, Email, ClassName string }

// ParseRosterCSV reads "name,email,class" (header required). Quotes are supported.
func ParseRosterCSV(text string) ([]RosterRow, error) {
	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	recs, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, errors.New("CSV needs name and email columns")
	}
	idx := map[string]int{}
	for i, h := range recs[0] {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	ni, ok1 := idx["name"]
	ei, ok2 := idx["email"]
	if !ok1 || !ok2 {
		return nil, errors.New("CSV needs name and email columns")
	}
	ci, hasClass := idx["class"]
	var out []RosterRow
	for _, rec := range recs[1:] {
		get := func(i int) string {
			if i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}
		row := RosterRow{Name: get(ni), Email: strings.ToLower(get(ei))}
		if hasClass {
			row.ClassName = get(ci)
		}
		if row.Name != "" && strings.Contains(row.Email, "@") {
			out = append(out, row)
		}
	}
	return out, nil
}

type Issued struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	ClassName string `json:"className"`
	Code      string `json:"code"`
}

// ImportRoster creates or refreshes student accounts and issues fresh login codes (shown once).
// Staff accounts are never touched, and are left out of the result so no useless code is printed.
func (a *App) ImportRoster(ctx context.Context, actor User, rows []RosterRow) ([]Issued, error) {
	var issued []Issued
	err := a.tx(ctx, func(t *sql.Tx) error {
		for _, r := range rows {
			code := auth.GenerateCode(8)
			res, err := t.ExecContext(ctx, `
				INSERT INTO users (email, name, class_name, role, login_code_hash) VALUES (?, ?, NULLIF(?, ''), 'student', ?)
				ON CONFLICT(email) DO UPDATE SET name = excluded.name, class_name = excluded.class_name, login_code_hash = excluded.login_code_hash
				WHERE users.role = 'student'`, r.Email, r.Name, r.ClassName, auth.HashCode(code))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				issued = append(issued, Issued{r.Name, r.Email, r.ClassName, code})
			}
		}
		return audit(ctx, t, &actor.ID, "roster.import", map[string]any{"rows": len(rows), "issued": len(issued)})
	})
	return issued, err
}

func audit(ctx context.Context, t *sql.Tx, actor *int64, action string, detail any) error {
	b, err := jsonText(detail)
	if err != nil {
		return err
	}
	_, err = t.ExecContext(ctx, `INSERT INTO audit_log (actor_id, action, detail) VALUES (?, ?, ?)`, actor, action, b)
	return err
}
