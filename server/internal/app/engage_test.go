package app

import (
	"errors"
	"testing"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/token"
)

func tinyPNGBytes() []byte { return []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0} }

func stageTag(id int64) string { return token.MakeTag(secret, token.KindStage, id) }

func mkTeacher(t *testing.T, a *App, name, email string) User {
	t.Helper()
	u := mkUser(t, a, name, email, false)
	if _, err := a.DB.Write.Exec(`UPDATE users SET role = 'teacher' WHERE id = ?`, u.ID); err != nil {
		t.Fatal(err)
	}
	u.Role = "teacher"
	return u
}

func mkHunt(t *testing.T, a *App) int64 {
	t.Helper()
	id, err := a.SaveHunt(ctx, 0, HuntInput{Title: "Chem hunt", Subject: "chemistry", Published: true, Stages: []StageInput{
		{Title: "One", Clue: "c1", Answers: []string{"Sodium"}},
		{Title: "Two", Clue: "c2", Answers: []string{"Chlorine", "Cl"}},
		{Title: "Three", Clue: "c3", Answers: []string{"Argon"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestHuntStrictOrderAndRanking(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada@stu.ykpaoschool.cn", true)
	bo := mkUser(t, a, "Bo", "bo@stu.ykpaoschool.cn", false)
	id := mkHunt(t, a)

	out, err := a.SubmitCode(ctx, id, ada, "  SODIUM! ")
	if err != nil || out.Result != "done" || out.Done != 1 {
		t.Fatalf("first: %+v %v", out, err)
	}
	if out, _ = a.SubmitCode(ctx, id, ada, "argon"); out.Result != "locked" {
		t.Fatalf("later stage must be locked: %+v", out)
	}
	if out, _ = a.SubmitCode(ctx, id, ada, "sodium"); out.Result != "already" {
		t.Fatalf("repeat: %+v", out)
	}
	if out, _ = a.SubmitCode(ctx, id, ada, "nonsense"); out.Result != "wrong" {
		t.Fatalf("wrong: %+v", out)
	}
	if _, err := a.SubmitCode(ctx, id, ada, "  "); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blank: %v", err)
	}
	for _, c := range []string{"cl", "argon"} {
		out, _ = a.SubmitCode(ctx, id, ada, c)
	}
	if out.Result != "done" || !out.Finished {
		t.Fatalf("finish: %+v", out)
	}
	a.Now = func() time.Time { return during.Add(10 * time.Second) }
	for _, c := range []string{"sodium", "chlorine", "argon"} {
		a.SubmitCode(ctx, id, bo, c)
	}
	v, err := a.HuntFor(ctx, id, bo)
	if err != nil || !v.Finished || v.Rank == nil || *v.Rank != 2 {
		t.Fatalf("bo view: %+v %v", v, err)
	}
	// a name appears only for students who chose to show it; the viewer always sees their own line
	if len(v.Board) != 2 || v.Board[0].Label != "Ada" {
		t.Fatalf("board %+v", v.Board)
	}
	va, _ := a.HuntFor(ctx, id, ada)
	if va.Rank == nil || *va.Rank != 1 {
		t.Fatalf("ada rank %+v", va.Rank)
	}
	// the clue of a locked stage is never sent
	c := mkUser(t, a, "Cy", "cy@stu.ykpaoschool.cn", false)
	vc, _ := a.HuntFor(ctx, id, c)
	for _, s := range vc.StageList {
		if s.State == "locked" && s.Clue != "" {
			t.Fatalf("locked clue leaked: %+v", s)
		}
	}
}

func TestHuntTeacherMarkAndUnpublished(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada2@stu.ykpaoschool.cn", true)
	teacher := mkTeacher(t, a, "Tea", "tea@ykpaoschool.cn")
	id := mkHunt(t, a)
	_, stages, _ := a.HuntForEditing(ctx, id)
	if err := a.MarkStage(ctx, teacher.ID, id, ada.ID, stages[0].ID, true); err != nil {
		t.Fatal(err)
	}
	v, _ := a.HuntFor(ctx, id, ada)
	if v.Done != 1 || v.StageList[1].State != "current" {
		t.Fatalf("after mark: %+v", v)
	}
	if err := a.MarkStage(ctx, teacher.ID, id, teacher.ID, stages[0].ID, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("marking a non-student: %v", err)
	}
	if err := a.MarkStage(ctx, teacher.ID, id, ada.ID, stages[0].ID, false); err != nil {
		t.Fatal(err)
	}
	// unpublish hides it from students but not from teachers
	if _, err := a.SaveHunt(ctx, id, HuntInput{Title: "Chem hunt", Subject: "chemistry", Published: false, Stages: []StageInput{
		{ID: &stages[0].ID, Title: "One", Answers: []string{"Sodium"}},
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SubmitCode(ctx, id, ada, "sodium"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unpublished: %v", err)
	}
	if _, err := a.HuntFor(ctx, id, ada); !errors.Is(err, ErrNotFound) {
		t.Fatalf("student sees unpublished: %v", err)
	}
	if _, err := a.HuntFor(ctx, id, teacher); err != nil {
		t.Fatalf("teacher preview: %v", err)
	}
}

func TestHuntPhotosPrivateAndOwned(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada3@stu.ykpaoschool.cn", true)
	bo := mkUser(t, a, "Bo", "bo3@stu.ykpaoschool.cn", true)
	id := mkHunt(t, a)
	_, stages, _ := a.HuntForEditing(ctx, id)
	img, err := a.SaveStudentImage(ctx, ada, tinyPNGBytes(), ImageHunt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddHuntPhoto(ctx, ada, stages[1].ID, img, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("locked stage photo: %v", err)
	}
	if _, err := a.AddHuntPhoto(ctx, bo, stages[0].ID, img, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("someone else's picture: %v", err)
	}
	p, err := a.AddHuntPhoto(ctx, ada, stages[0].ID, img, "my find")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddHuntPhoto(ctx, ada, stages[0].ID, img, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("reusing a picture: %v", err)
	}
	f, _ := a.Image(ctx, img)
	teacher := mkTeacher(t, a, "Tea", "tea3@ykpaoschool.cn")
	if f.MayView(bo) || !f.MayView(ada) || !f.MayView(teacher) {
		t.Fatal("hunt pictures are for the owner and teachers only")
	}
	if err := a.DeleteHuntPhoto(ctx, p.ID, bo); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delete other's: %v", err)
	}
	if err := a.DeleteHuntPhoto(ctx, p.ID, ada); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Image(ctx, img); !errors.Is(err, ErrNotFound) {
		t.Fatalf("picture should be gone: %v", err)
	}
}

func TestStageScanNeedsRealTag(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada4@stu.ykpaoschool.cn", true)
	id := mkHunt(t, a)
	_, stages, _ := a.HuntForEditing(ctx, id)
	if _, err := a.ScanStage(ctx, ada, "stage.1.forged"); !errors.Is(err, ErrBadToken) {
		t.Fatalf("forged: %v", err)
	}
	out, err := a.ScanStage(ctx, ada, stageTag(stages[0].ID))
	if err != nil || out.Result != "done" {
		t.Fatalf("scan: %+v %v", out, err)
	}
	if out, _ = a.ScanStage(ctx, ada, stageTag(stages[2].ID)); out.Result != "locked" {
		t.Fatalf("scan later: %+v", out)
	}
}

func TestLibraryReadsAndComments(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada5@stu.ykpaoschool.cn", false)
	bo := mkUser(t, a, "Bo", "bo5@stu.ykpaoschool.cn", false)
	teacher := mkTeacher(t, a, "Tea", "tea5@ykpaoschool.cn")
	b, err := a.CreateBook(ctx, BookInput{Title: "The Periodic Table", Subject: "chemistry", Author: "Levi", Summary: "s", BodyMD: "# hi"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // marking twice counts once
		if err := a.SetRead(ctx, b.ID, ada.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	a.SetRead(ctx, b.ID, bo.ID, true)
	got, _ := a.Book(ctx, b.ID, ada.ID)
	if got.Reads != 2 || !got.IRead {
		t.Fatalf("reads %+v", got)
	}
	a.SetRead(ctx, b.ID, bo.ID, false)
	if got, _ = a.Book(ctx, b.ID, bo.ID); got.Reads != 1 || got.IRead {
		t.Fatalf("after unmark %+v", got)
	}
	c, err := a.AddComment(ctx, b.ID, ada, "  Loved it  ")
	if err != nil || c.Body != "Loved it" || c.Name != "Ada" {
		t.Fatalf("comment %+v %v", c, err)
	}
	if _, err := a.AddComment(ctx, b.ID, ada, "   "); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blank: %v", err)
	}
	if _, err := a.AddComment(ctx, 999, ada, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no book: %v", err)
	}
	if err := a.DeleteComment(ctx, c.ID, bo); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other student deleting: %v", err)
	}
	if err := a.DeleteComment(ctx, c.ID, teacher); err != nil {
		t.Fatalf("teacher delete: %v", err)
	}
	for i := 0; i < commentsPerHour; i++ {
		if _, err := a.AddComment(ctx, b.ID, bo, "hi"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.AddComment(ctx, b.ID, bo, "hi"); !errors.Is(err, ErrTooMany) {
		t.Fatalf("flood: %v", err)
	}
}

func TestWorksNeedCheckInAndOwnership(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada6@stu.ykpaoschool.cn", false)
	bo := mkUser(t, a, "Bo", "bo6@stu.ykpaoschool.cn", false)
	teacher := mkTeacher(t, a, "Tea", "tea6@ykpaoschool.cn")
	ev := mkEvent(t, a, "Art", nil)
	img, _ := a.SaveStudentImage(ctx, ada, tinyPNGBytes(), ImageWork)
	if _, err := a.AddWork(ctx, ev.ID, ada, img, "painting"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("not checked in: %v", err)
	}
	if _, err := a.ManualCheckInID(ctx, ev.ID, ada.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddWork(ctx, ev.ID, ada, 12345, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing picture: %v", err)
	}
	w, err := a.AddWork(ctx, ev.ID, ada, img, "painting")
	if err != nil {
		t.Fatal(err)
	}
	if list, _ := a.Works(ctx, ev.ID); len(list) != 1 || list[0].Name != "Ada" {
		t.Fatalf("works %+v", list)
	}
	if err := a.DeleteWork(ctx, w.ID, bo); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other deleting: %v", err)
	}
	if err := a.DeleteWork(ctx, w.ID, teacher); err != nil {
		t.Fatal(err)
	}
	if list, _ := a.Works(ctx, ev.ID); len(list) != 0 {
		t.Fatalf("still listed: %+v", list)
	}
}

func TestUploadLimitsAndKinds(t *testing.T) {
	a := newApp(t)
	ada := mkUser(t, a, "Ada", "ada7@stu.ykpaoschool.cn", false)
	if _, err := a.SaveStudentImage(ctx, ada, tinyPNGBytes(), "content"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("students may not upload page content: %v", err)
	}
	if _, err := a.SaveStudentImage(ctx, ada, []byte("<svg/>"), ImageWork); !errors.Is(err, ErrInvalid) {
		t.Fatalf("svg: %v", err)
	}
	for i := 0; i < studentImagesPerHour; i++ {
		if _, err := a.SaveStudentImage(ctx, ada, tinyPNGBytes(), ImageWork); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.SaveStudentImage(ctx, ada, tinyPNGBytes(), ImageWork); !errors.Is(err, ErrTooMany) {
		t.Fatalf("hourly cap: %v", err)
	}
}

func TestMergeMovesLibraryHuntAndWorks(t *testing.T) {
	a := newApp(t)
	keep := mkUser(t, a, "Keep", "keep@stu.ykpaoschool.cn", false)
	drop := mkUser(t, a, "Drop", "drop@stu.ykpaoschool.cn", false)
	admin := mkTeacher(t, a, "Boss", "boss@ykpaoschool.cn")
	b, _ := a.CreateBook(ctx, BookInput{Title: "B", Subject: "chemistry", Author: "A"})
	a.SetRead(ctx, b.ID, keep.ID, true)
	a.SetRead(ctx, b.ID, drop.ID, true)
	a.AddComment(ctx, b.ID, drop, "mine")
	id := mkHunt(t, a)
	a.SubmitCode(ctx, id, drop, "sodium")
	if _, err := a.MergeStudents(ctx, admin.ID, keep.ID, drop.ID, false); err != nil {
		t.Fatal(err)
	}
	if got, _ := a.Book(ctx, b.ID, keep.ID); got.Reads != 1 {
		t.Fatalf("reads %+v", got)
	}
	if cs, _ := a.Comments(ctx, b.ID); len(cs) != 1 || cs[0].UserID != keep.ID {
		t.Fatalf("comments %+v", cs)
	}
	if v, _ := a.HuntFor(ctx, id, keep); v.Done != 1 {
		t.Fatalf("hunt progress %+v", v)
	}
}
