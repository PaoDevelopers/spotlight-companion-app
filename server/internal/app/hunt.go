package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

// Scavenger hunts. A hunt is a row of stages done in strict order. A stage is completed by typing one of its code words/answers,
// or by scanning the station's QR code; either way it only counts if it is the student's NEXT stage. Photos are optional evidence,
// private to the student and teachers. Finishers are ranked by the time they completed the last stage.

const (
	maxStages        = 30
	maxAnswers       = 10
	maxHuntPhotos    = 5 // per student per stage
	maxClueRunes     = 2000
	maxAnswerRunes   = 100
	maxHuntTitleRune = 100
)

type Hunt struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	Subject     string  `json:"subject"`
	Description string  `json:"description"`
	ImageURL    *string `json:"imageUrl"`
	Published   bool    `json:"published"`
	Stages      int     `json:"stages"`
}

type StageInput struct {
	ID      *int64
	Title   string
	Clue    string
	Answers []string
}

type HuntInput struct {
	Title, Subject, Description, ImageURL string
	Published                             bool
	Stages                                []StageInput
}

// StageAdmin is a stage as a teacher sees it, with the accepted answers.
type StageAdmin struct {
	ID       int64    `json:"id"`
	Position int      `json:"position"`
	Title    string   `json:"title"`
	Clue     string   `json:"clue"`
	Answers  []string `json:"answers"`
}

// normalizeAnswer makes typed answers comparable: case, spacing and surrounding punctuation do not matter.
func normalizeAnswer(s string) string {
	s = strings.ToLower(strings.Join(strings.Fields(s), " "))
	return strings.Trim(s, ` .,;:!?'"`+"`")
}

func cleanStages(in []StageInput) ([]StageInput, error) {
	if len(in) == 0 || len(in) > maxStages {
		return nil, ErrInvalid
	}
	out := make([]StageInput, 0, len(in))
	for _, st := range in {
		st.Title, st.Clue = strings.TrimSpace(st.Title), strings.TrimSpace(st.Clue)
		if st.Title == "" || utf8.RuneCountInString(st.Title) > maxHuntTitleRune || utf8.RuneCountInString(st.Clue) > maxClueRunes || len(st.Answers) > maxAnswers {
			return nil, ErrInvalid
		}
		seen := map[string]bool{}
		var answers []string
		for _, a := range st.Answers {
			a = strings.TrimSpace(a)
			n := normalizeAnswer(a)
			if a == "" || n == "" {
				continue
			}
			if utf8.RuneCountInString(a) > maxAnswerRunes {
				return nil, ErrInvalid
			}
			if !seen[n] {
				seen[n] = true
				answers = append(answers, a)
			}
		}
		st.Answers = answers
		out = append(out, st)
	}
	return out, nil
}

func (in HuntInput) clean() (HuntInput, error) {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > maxHuntTitleRune || !ValidSubject(in.Subject) {
		return in, ErrInvalid
	}
	if img := strings.TrimSpace(in.ImageURL); img != "" && !strings.HasPrefix(img, "https://") && (!strings.HasPrefix(img, "/") || strings.HasPrefix(img, "//")) {
		return in, ErrInvalid
	}
	in.ImageURL = strings.TrimSpace(in.ImageURL)
	st, err := cleanStages(in.Stages)
	in.Stages = st
	return in, err
}

// SaveHunt creates a hunt (id 0) or replaces an existing one's details and stages. Stages that keep their id keep their progress
// and photos; a stage left out of the list is deleted with them. A stage's position is its place in the list.
func (a *App) SaveHunt(ctx context.Context, id int64, in HuntInput) (int64, error) {
	in, err := in.clean()
	if err != nil {
		return 0, err
	}
	err = a.tx(ctx, func(t *sql.Tx) error {
		if id == 0 {
			res, err := t.ExecContext(ctx, `INSERT INTO hunts (title, subject, description, image_url, published) VALUES (?, ?, ?, NULLIF(?, ''), ?)`,
				in.Title, in.Subject, in.Description, in.ImageURL, b2i(in.Published))
			if err != nil {
				return err
			}
			id, _ = res.LastInsertId()
		} else {
			res, err := t.ExecContext(ctx, `UPDATE hunts SET title=?, subject=?, description=?, image_url=NULLIF(?, ''), published=? WHERE id=?`,
				in.Title, in.Subject, in.Description, in.ImageURL, b2i(in.Published), id)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return ErrNotFound
			}
		}
		existing := map[int64]bool{}
		rows, err := t.QueryContext(ctx, `SELECT id FROM hunt_stages WHERE hunt_id = ?`, id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var sid int64
			if err := rows.Scan(&sid); err != nil {
				rows.Close()
				return err
			}
			existing[sid] = true
		}
		rows.Close()
		keep := map[int64]bool{}
		for _, st := range in.Stages {
			if st.ID != nil {
				if !existing[*st.ID] || keep[*st.ID] {
					return ErrInvalid // not this hunt's stage, or listed twice
				}
				keep[*st.ID] = true
			}
		}
		for sid := range existing {
			if !keep[sid] {
				if _, err := t.ExecContext(ctx, `DELETE FROM hunt_stages WHERE id = ?`, sid); err != nil {
					return err
				}
			}
		}
		for sid := range keep { // out of the way first, so reordering cannot collide
			if _, err := t.ExecContext(ctx, `UPDATE hunt_stages SET position = ? WHERE id = ?`, -sid, sid); err != nil {
				return err
			}
		}
		for i, st := range in.Stages {
			ans, _ := json.Marshal(append([]string{}, st.Answers...))
			if st.ID != nil {
				if _, err := t.ExecContext(ctx, `UPDATE hunt_stages SET position=?, title=?, clue=?, answers=? WHERE id=?`, i+1, st.Title, st.Clue, string(ans), *st.ID); err != nil {
					return err
				}
			} else if _, err := t.ExecContext(ctx, `INSERT INTO hunt_stages (hunt_id, position, title, clue, answers) VALUES (?, ?, ?, ?, ?)`, id, i+1, st.Title, st.Clue, string(ans)); err != nil {
				return err
			}
		}
		return nil
	})
	return id, err
}

func (a *App) DeleteHunt(ctx context.Context, id int64) error {
	res, err := a.DB.Write.ExecContext(ctx, `DELETE FROM hunts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func scanHunt(r interface{ Scan(...any) error }) (Hunt, error) {
	var h Hunt
	var pub int
	err := r.Scan(&h.ID, &h.Title, &h.Subject, &h.Description, &h.ImageURL, &pub, &h.Stages)
	h.Published = pub == 1
	return h, err
}

const huntSelect = `SELECT h.id, h.title, h.subject, h.description, h.image_url, h.published, (SELECT COUNT(*) FROM hunt_stages s WHERE s.hunt_id = h.id) FROM hunts h`

// AllHunts is the teacher's list.
func (a *App) AllHunts(ctx context.Context) ([]Hunt, error) {
	rows, err := a.DB.Read.QueryContext(ctx, huntSelect+` ORDER BY h.title, h.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Hunt{}
	for rows.Next() {
		h, err := scanHunt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (a *App) huntByID(ctx context.Context, id int64) (Hunt, error) {
	h, err := scanHunt(a.DB.Read.QueryRowContext(ctx, huntSelect+` WHERE h.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return h, ErrNotFound
	}
	return h, err
}

// HuntForEditing returns a hunt with its stages and accepted answers, for teachers.
func (a *App) HuntForEditing(ctx context.Context, id int64) (Hunt, []StageAdmin, error) {
	h, err := a.huntByID(ctx, id)
	if err != nil {
		return h, nil, err
	}
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT id, position, title, clue, answers FROM hunt_stages WHERE hunt_id = ? ORDER BY position`, id)
	if err != nil {
		return h, nil, err
	}
	defer rows.Close()
	out := []StageAdmin{}
	for rows.Next() {
		var s StageAdmin
		var ans string
		if err := rows.Scan(&s.ID, &s.Position, &s.Title, &s.Clue, &ans); err != nil {
			return h, nil, err
		}
		s.Answers = []string{}
		_ = json.Unmarshal([]byte(ans), &s.Answers)
		out = append(out, s)
	}
	return h, out, rows.Err()
}

// ---- progress ----

type HuntPhoto struct {
	ID       int64  `json:"id"`
	ImageURL string `json:"imageUrl"`
	Caption  string `json:"caption"`
	At       string `json:"at"`
}

type StageView struct {
	ID       int64       `json:"id"`
	Position int         `json:"position"`
	Title    string      `json:"title"`
	State    string      `json:"state"`          // "done", "current" or "locked"
	Clue     string      `json:"clue,omitempty"` // only once the stage is unlocked
	DoneAt   *string     `json:"doneAt"`
	Method   *string     `json:"method"`
	Photos   []HuntPhoto `json:"photos"`
}

type HuntRank struct {
	Rank  int    `json:"rank"`
	Label string `json:"label"`
	At    string `json:"at"`
	Me    bool   `json:"me"`
}

type HuntView struct {
	Hunt
	StageList  []StageView `json:"stageList"`
	Done       int         `json:"done"`
	Total      int         `json:"total"`
	Finished   bool        `json:"finished"`
	FinishedAt *string     `json:"finishedAt"`
	Rank       *int        `json:"rank"`
	Board      []HuntRank  `json:"board"`
}

type stageRow struct {
	ID, HuntID int64
	Position   int
	Title      string
	Clue       string
	Answers    []string
}

func (a *App) stagesOf(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, huntID int64) ([]stageRow, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, hunt_id, position, title, clue, answers FROM hunt_stages WHERE hunt_id = ? ORDER BY position`, huntID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []stageRow
	for rows.Next() {
		var s stageRow
		var ans string
		if err := rows.Scan(&s.ID, &s.HuntID, &s.Position, &s.Title, &s.Clue, &ans); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(ans), &s.Answers)
		out = append(out, s)
	}
	return out, rows.Err()
}

type finisher struct {
	userID   int64
	name     string
	class    string
	show     bool
	finished int64
}

// ranking lists the students who completed every stage, earliest finish first.
func (a *App) ranking(ctx context.Context, huntID int64) ([]finisher, error) {
	rows, err := a.DB.Read.QueryContext(ctx, `
		SELECT u.id, u.name, COALESCE(u.class_name, ''), u.show_on_leaderboard, MAX(p.at)
		FROM hunt_progress p JOIN hunt_stages s ON s.id = p.stage_id JOIN users u ON u.id = p.user_id
		WHERE s.hunt_id = ? GROUP BY u.id
		HAVING COUNT(*) = (SELECT COUNT(*) FROM hunt_stages WHERE hunt_id = ?)
		ORDER BY MAX(p.at), u.id`, huntID, huntID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []finisher
	for rows.Next() {
		var f finisher
		var show int
		if err := rows.Scan(&f.userID, &f.name, &f.class, &show, &f.finished); err != nil {
			return nil, err
		}
		f.show = show == 1
		out = append(out, f)
	}
	return out, rows.Err()
}

func (a *App) photosFor(ctx context.Context, stageIDs []int64, userID int64) (map[int64][]HuntPhoto, error) {
	out := map[int64][]HuntPhoto{}
	for _, sid := range stageIDs {
		rows, err := a.DB.Read.QueryContext(ctx, `SELECT id, image_id, caption, at FROM hunt_photos WHERE stage_id = ? AND user_id = ? ORDER BY at, id`, sid, userID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var p HuntPhoto
			var img, at int64
			if err := rows.Scan(&p.ID, &img, &p.Caption, &at); err != nil {
				rows.Close()
				return nil, err
			}
			p.ImageURL, p.At = "/api/images/"+strconv.FormatInt(img, 10), Time(fromUnix(at))
			out[sid] = append(out[sid], p)
		}
		rows.Close()
	}
	return out, nil
}

// PublishedHunts lists the hunts students can see, with their own progress.
func (a *App) PublishedHunts(ctx context.Context, userID int64) ([]HuntView, error) {
	rows, err := a.DB.Read.QueryContext(ctx, huntSelect+` WHERE h.published = 1 ORDER BY h.title, h.id`)
	if err != nil {
		return nil, err
	}
	var hunts []Hunt
	for rows.Next() {
		h, err := scanHunt(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		hunts = append(hunts, h)
	}
	rows.Close()
	out := []HuntView{}
	for _, h := range hunts {
		var done int
		if err := a.DB.Read.QueryRowContext(ctx, `SELECT COUNT(*) FROM hunt_progress p JOIN hunt_stages s ON s.id = p.stage_id WHERE s.hunt_id = ? AND p.user_id = ?`, h.ID, userID).Scan(&done); err != nil {
			return nil, err
		}
		out = append(out, HuntView{Hunt: h, Done: done, Total: h.Stages, Finished: h.Stages > 0 && done >= h.Stages, StageList: []StageView{}, Board: []HuntRank{}})
	}
	return out, nil
}

// HuntFor is one hunt as a student sees it: stages done, the current stage with its clue, later stages locked, their photos, and
// the ranking. Teachers may look at an unpublished hunt (to preview it).
func (a *App) HuntFor(ctx context.Context, huntID int64, u User) (HuntView, error) {
	h, err := a.huntByID(ctx, huntID)
	if err != nil {
		return HuntView{}, err
	}
	if !h.Published && !u.IsStaff() {
		return HuntView{}, ErrNotFound
	}
	stages, err := a.stagesOf(ctx, a.DB.Read, huntID)
	if err != nil {
		return HuntView{}, err
	}
	type prog struct {
		at     int64
		method string
	}
	progress := map[int64]prog{}
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT p.stage_id, p.at, p.method FROM hunt_progress p JOIN hunt_stages s ON s.id = p.stage_id WHERE s.hunt_id = ? AND p.user_id = ?`, huntID, u.ID)
	if err != nil {
		return HuntView{}, err
	}
	for rows.Next() {
		var sid int64
		var p prog
		if err := rows.Scan(&sid, &p.at, &p.method); err != nil {
			rows.Close()
			return HuntView{}, err
		}
		progress[sid] = p
	}
	rows.Close()
	ids := make([]int64, len(stages))
	for i, s := range stages {
		ids[i] = s.ID
	}
	photos, err := a.photosFor(ctx, ids, u.ID)
	if err != nil {
		return HuntView{}, err
	}
	v := HuntView{Hunt: h, Total: len(stages), StageList: []StageView{}, Board: []HuntRank{}}
	currentSeen := false
	var lastAt int64
	for _, s := range stages {
		sv := StageView{ID: s.ID, Position: s.Position, Title: s.Title, Photos: photos[s.ID]}
		if sv.Photos == nil {
			sv.Photos = []HuntPhoto{}
		}
		if p, ok := progress[s.ID]; ok && !currentSeen {
			sv.State, sv.Clue = "done", s.Clue
			at, m := Time(fromUnix(p.at)), p.method
			sv.DoneAt, sv.Method = &at, &m
			v.Done++
			lastAt = max(lastAt, p.at)
		} else if !currentSeen {
			sv.State, sv.Clue = "current", s.Clue
			currentSeen = true
		} else {
			sv.State = "locked"
		}
		v.StageList = append(v.StageList, sv)
	}
	v.Finished = v.Total > 0 && v.Done == v.Total
	rank, err := a.ranking(ctx, huntID)
	if err != nil {
		return HuntView{}, err
	}
	v.Board = boardOf(rank, u.ID)
	for _, b := range v.Board {
		if b.Me {
			rk := b.Rank
			v.Rank = &rk
		}
	}
	if v.Finished {
		at := Time(fromUnix(lastAt))
		v.FinishedAt = &at
	}
	return v, nil
}

// boardOf turns finishers into ranked lines (equal finish times share a place). Names follow the leaderboard rule: only students who chose
// to show their name appear by name. The viewer always sees their own line.
func boardOf(rank []finisher, me int64) []HuntRank {
	out := []HuntRank{}
	for i, f := range rank {
		r := i + 1
		if i > 0 && rank[i-1].finished == f.finished {
			r = out[i-1].Rank
		}
		label := PublicName(f.name, f.class, f.show)
		if f.userID == me {
			label = f.name
		}
		out = append(out, HuntRank{Rank: r, Label: label, At: Time(fromUnix(f.finished)), Me: f.userID == me})
	}
	if len(out) > 10 {
		top := out[:10]
		for _, b := range out[10:] {
			if b.Me {
				top = append(top, b)
			}
		}
		return top
	}
	return out
}

// ---- completing stages ----

// StageOutcome says what trying to complete a stage did.
type StageOutcome struct {
	Result   string `json:"result"` // "done", "already", "locked", "wrong"
	Message  string `json:"message"`
	StageID  int64  `json:"stageId,omitempty"`
	HuntID   int64  `json:"huntId,omitempty"`
	Done     int    `json:"done"`
	Total    int    `json:"total"`
	Finished bool   `json:"finished"`
}

// completeStage applies the strict-order rule: only the student's next stage can be completed.
func (a *App) completeStage(ctx context.Context, t *sql.Tx, userID int64, st stageRow, method string) (StageOutcome, error) {
	out := StageOutcome{StageID: st.ID, HuntID: st.HuntID}
	var next sql.NullInt64
	if err := t.QueryRowContext(ctx, `SELECT MIN(position) FROM hunt_stages s WHERE s.hunt_id = ? AND NOT EXISTS (SELECT 1 FROM hunt_progress p WHERE p.stage_id = s.id AND p.user_id = ?)`, st.HuntID, userID).Scan(&next); err != nil {
		return out, err
	}
	switch {
	case !next.Valid || int64(st.Position) < next.Int64:
		out.Result, out.Message = "already", "You have already completed stage "+strconv.Itoa(st.Position)+"."
	case int64(st.Position) > next.Int64:
		out.Result, out.Message = "locked", "That belongs to a later stage. Finish your current stage first."
	default:
		if _, err := t.ExecContext(ctx, `INSERT INTO hunt_progress (stage_id, user_id, at, method) VALUES (?, ?, ?, ?)`, st.ID, userID, unix(a.Now()), method); err != nil {
			return out, err
		}
		out.Result, out.Message = "done", "Stage "+strconv.Itoa(st.Position)+" complete!"
	}
	if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM hunt_progress p JOIN hunt_stages s ON s.id = p.stage_id WHERE s.hunt_id = ? AND p.user_id = ?`, st.HuntID, userID).Scan(&out.Done); err != nil {
		return out, err
	}
	if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM hunt_stages WHERE hunt_id = ?`, st.HuntID).Scan(&out.Total); err != nil {
		return out, err
	}
	out.Finished = out.Total > 0 && out.Done >= out.Total
	if out.Result == "done" && out.Finished {
		out.Message += " You finished the hunt!"
	}
	return out, nil
}

func (a *App) openHunt(ctx context.Context, t *sql.Tx, huntID int64) error {
	var pub int
	if err := t.QueryRowContext(ctx, `SELECT published FROM hunts WHERE id = ?`, huntID).Scan(&pub); errors.Is(err, sql.ErrNoRows) || (err == nil && pub == 0) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return nil
}

// SubmitCode takes a typed code word or answer. It finds which stage it belongs to by itself: the student does not say. A code for
// a later stage is refused without saying which stage it is.
func (a *App) SubmitCode(ctx context.Context, huntID int64, u User, code string) (StageOutcome, error) {
	n := normalizeAnswer(code)
	if n == "" || utf8.RuneCountInString(code) > 200 {
		return StageOutcome{}, ErrInvalid
	}
	var out StageOutcome
	err := a.tx(ctx, func(t *sql.Tx) error {
		if err := a.openHunt(ctx, t, huntID); err != nil {
			return err
		}
		stages, err := a.stagesOf(ctx, t, huntID)
		if err != nil {
			return err
		}
		for _, s := range stages {
			for _, ans := range s.Answers {
				if normalizeAnswer(ans) == n {
					out, err = a.completeStage(ctx, t, u.ID, s, "code")
					return err
				}
			}
		}
		out = StageOutcome{Result: "wrong", Message: "That doesn't match any stage. Check it and try again.", HuntID: huntID}
		return nil
	})
	return out, err
}

// ScanStage takes a scanned station QR code.
func (a *App) ScanStage(ctx context.Context, u User, code string) (StageOutcome, error) {
	kind, id, ok := token.VerifyTag(a.Cfg.Secret, code)
	if !ok || kind != token.KindStage {
		return StageOutcome{}, ErrBadToken
	}
	var out StageOutcome
	err := a.tx(ctx, func(t *sql.Tx) error {
		var s stageRow
		if err := t.QueryRowContext(ctx, `SELECT id, hunt_id, position, title FROM hunt_stages WHERE id = ?`, id).Scan(&s.ID, &s.HuntID, &s.Position, &s.Title); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if err := a.openHunt(ctx, t, s.HuntID); err != nil {
			return err
		}
		var err error
		out, err = a.completeStage(ctx, t, u.ID, s, "qr")
		return err
	})
	return out, err
}

// MarkStage is a teacher recording (or undoing) a student's stage by hand, for example when they have no phone.
func (a *App) MarkStage(ctx context.Context, actorID, huntID, userID, stageID int64, done bool) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var role string
		var posOK int
		if err := t.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, userID).Scan(&role); errors.Is(err, sql.ErrNoRows) || (err == nil && role != "student") {
			return ErrInvalid
		} else if err != nil {
			return err
		}
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM hunt_stages WHERE id = ? AND hunt_id = ?`, stageID, huntID).Scan(&posOK); err != nil {
			return err
		} else if posOK == 0 {
			return ErrNotFound
		}
		if done {
			if _, err := t.ExecContext(ctx, `INSERT INTO hunt_progress (stage_id, user_id, at, method) VALUES (?, ?, ?, 'teacher') ON CONFLICT DO NOTHING`, stageID, userID, unix(a.Now())); err != nil {
				return err
			}
		} else if _, err := t.ExecContext(ctx, `DELETE FROM hunt_progress WHERE stage_id = ? AND user_id = ?`, stageID, userID); err != nil {
			return err
		}
		return audit(ctx, t, &actorID, "hunt.mark", map[string]any{"hunt": huntID, "stage": stageID, "student": userID, "done": done})
	})
}

// ---- photos ----

// AddHuntPhoto attaches an uploaded picture to a stage the student has unlocked (done, or the current one).
func (a *App) AddHuntPhoto(ctx context.Context, u User, stageID, imageID int64, caption string) (HuntPhoto, error) {
	caption = strings.TrimSpace(caption)
	if utf8.RuneCountInString(caption) > 200 {
		return HuntPhoto{}, ErrInvalid
	}
	var photo HuntPhoto
	err := a.tx(ctx, func(t *sql.Tx) error {
		var huntID int64
		var pos int
		if err := t.QueryRowContext(ctx, `SELECT hunt_id, position FROM hunt_stages WHERE id = ?`, stageID).Scan(&huntID, &pos); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if err := a.openHunt(ctx, t, huntID); err != nil {
			return err
		}
		var next sql.NullInt64
		if err := t.QueryRowContext(ctx, `SELECT MIN(position) FROM hunt_stages s WHERE s.hunt_id = ? AND NOT EXISTS (SELECT 1 FROM hunt_progress p WHERE p.stage_id = s.id AND p.user_id = ?)`, huntID, u.ID).Scan(&next); err != nil {
			return err
		}
		if next.Valid && int64(pos) > next.Int64 {
			return ErrInvalid // a stage that is still locked
		}
		var have int
		if err := t.QueryRowContext(ctx, `SELECT COUNT(*) FROM hunt_photos WHERE stage_id = ? AND user_id = ?`, stageID, u.ID).Scan(&have); err != nil {
			return err
		}
		if have >= maxHuntPhotos {
			return ErrTooMany
		}
		if err := imageOwnedBy(ctx, t, imageID, u.ID, ImageHunt); err != nil {
			return err
		}
		now := a.Now()
		res, err := t.ExecContext(ctx, `INSERT INTO hunt_photos (stage_id, user_id, image_id, caption, at) VALUES (?, ?, ?, ?, ?)`, stageID, u.ID, imageID, caption, unix(now))
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		photo = HuntPhoto{ID: id, ImageURL: "/api/images/" + strconv.FormatInt(imageID, 10), Caption: caption, At: Time(now)}
		return nil
	})
	return photo, err
}

// DeleteHuntPhoto removes a photo (and the picture itself): its owner may, and so may a teacher.
func (a *App) DeleteHuntPhoto(ctx context.Context, photoID int64, actor User) error {
	return a.tx(ctx, func(t *sql.Tx) error {
		var owner, img int64
		if err := t.QueryRowContext(ctx, `SELECT user_id, image_id FROM hunt_photos WHERE id = ?`, photoID).Scan(&owner, &img); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if owner != actor.ID && !actor.IsStaff() {
			return ErrForbidden
		}
		_, err := t.ExecContext(ctx, `DELETE FROM images WHERE id = ?`, img) // the photo row goes with it (cascade)
		return err
	})
}

// ---- results for teachers ----

type ResultStage struct {
	StageID  int64       `json:"stageId"`
	Position int         `json:"position"`
	Title    string      `json:"title"`
	At       *string     `json:"at"`
	Method   *string     `json:"method"`
	Photos   []HuntPhoto `json:"photos"`
}

type ResultRow struct {
	UserID     int64         `json:"userId"`
	Name       string        `json:"name"`
	ClassName  string        `json:"className"`
	Done       int           `json:"done"`
	Total      int           `json:"total"`
	Finished   bool          `json:"finished"`
	FinishedAt *string       `json:"finishedAt"`
	Rank       *int          `json:"rank"`
	Stages     []ResultStage `json:"stages"`
}

// HuntResults lists every student who has progress or photos, finishers first by finish time, with their evidence photos.
func (a *App) HuntResults(ctx context.Context, huntID int64) ([]ResultRow, error) {
	if _, err := a.huntByID(ctx, huntID); err != nil {
		return nil, err
	}
	stages, err := a.stagesOf(ctx, a.DB.Read, huntID)
	if err != nil {
		return nil, err
	}
	rows, err := a.DB.Read.QueryContext(ctx, `SELECT DISTINCT u.id, u.name, COALESCE(u.class_name, '') FROM users u
		WHERE u.id IN (SELECT p.user_id FROM hunt_progress p JOIN hunt_stages s ON s.id = p.stage_id WHERE s.hunt_id = ?)
		   OR u.id IN (SELECT p.user_id FROM hunt_photos p JOIN hunt_stages s ON s.id = p.stage_id WHERE s.hunt_id = ?)`, huntID, huntID)
	if err != nil {
		return nil, err
	}
	var people []ResultRow
	for rows.Next() {
		var r ResultRow
		if err := rows.Scan(&r.UserID, &r.Name, &r.ClassName); err != nil {
			rows.Close()
			return nil, err
		}
		people = append(people, r)
	}
	rows.Close()
	ids := make([]int64, len(stages))
	for i, s := range stages {
		ids[i] = s.ID
	}
	fin, err := a.ranking(ctx, huntID)
	if err != nil {
		return nil, err
	}
	rankOf := map[int64]HuntRank{}
	for i, f := range fin {
		r := i + 1
		if i > 0 && fin[i-1].finished == f.finished {
			r = rankOf[fin[i-1].userID].Rank
		}
		rankOf[f.userID] = HuntRank{Rank: r, At: Time(fromUnix(f.finished))}
	}
	for pi := range people {
		p := &people[pi]
		photos, err := a.photosFor(ctx, ids, p.UserID)
		if err != nil {
			return nil, err
		}
		p.Total = len(stages)
		p.Stages = []ResultStage{}
		for _, s := range stages {
			rs := ResultStage{StageID: s.ID, Position: s.Position, Title: s.Title, Photos: photos[s.ID]}
			if rs.Photos == nil {
				rs.Photos = []HuntPhoto{}
			}
			var at int64
			var method string
			err := a.DB.Read.QueryRowContext(ctx, `SELECT at, method FROM hunt_progress WHERE stage_id = ? AND user_id = ?`, s.ID, p.UserID).Scan(&at, &method)
			if err == nil {
				ts := Time(fromUnix(at))
				rs.At, rs.Method = &ts, &method
				p.Done++
			} else if !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
			p.Stages = append(p.Stages, rs)
		}
		if r, ok := rankOf[p.UserID]; ok {
			rk, at := r.Rank, r.At
			p.Rank, p.Finished, p.FinishedAt = &rk, true, &at
		}
	}
	sort.SliceStable(people, func(i, j int) bool {
		ri, rj := people[i].Rank, people[j].Rank
		switch {
		case ri != nil && rj != nil:
			return *ri < *rj
		case ri != nil:
			return true
		case rj != nil:
			return false
		case people[i].Done != people[j].Done:
			return people[i].Done > people[j].Done
		}
		return people[i].Name < people[j].Name
	})
	if people == nil {
		people = []ResultRow{}
	}
	return people, nil
}
