package app

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// All names here are invented.
func TestDisplayName(t *testing.T) {
	for in, want := range map[string]string{
		"Wong (Mei Ling 黄美玲) Amy": "Mei Ling Wong 黄美玲 (Amy)",
		"Chan (Tai Man 陳大文) AMY":  "Tai Man Chan 陳大文 (AMY)",
		"Wong(Mei 黄美) Amy":        "Mei Wong 黄美 (Amy)",
		"Wong (黄美) Amy":           "Wong 黄美 (Amy)",
		"Wong (Mei 黄美） Amy":       "Mei Wong 黄美 (Amy)", // full-width closing bracket
		"Wong\u3000（Mei 黄美）Amy":   "Mei Wong 黄美 (Amy)",
		"Wong (Mei 黄美) Mei":       "Mei Wong 黄美", // a nickname that repeats the given name adds nothing
		"Wong (Mei 黄美)":           "Mei Wong 黄美",
		"  Test   Account  ":      "Test Account",
		"Plain Name":              "Plain Name",
		"":                        "",
		"Lee (Jun) Jay Kay":       "Jun Lee (Jay Kay)",
	} {
		if got := DisplayName(in); got != want {
			t.Errorf("DisplayName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestImportStudentsIsSafeAndRepeatable(t *testing.T) {
	a := newApp(t)
	teacher := mkUser(t, a, "Teach", "s100@stu.ykpaoschool.cn", false) // an existing person who happens to match an id
	a.DB.Write.Exec(`UPDATE users SET role = 'teacher', class_name = NULL WHERE id = ?`, teacher.ID)
	signedIn := mkUser(t, a, "Name From Microsoft", "s200@stu.ykpaoschool.cn", false) // class_name '10A' from the helper

	recs := []StudentRecord{
		{ID: "s100", Name: "Imported Name", Class: "11B"},
		{ID: "S200", Name: "Another Name", Class: "9C"},
		{ID: "s300", Name: "Fresh Student", Class: ""},
		{ID: "s400", Name: "Other Fresh", Class: "12A"},
		{ID: "", Name: "No id"},
		{ID: "bad id!", Name: "Odd"},
		{ID: "s500", Name: "   "},
	}
	rep, err := a.ImportStudents(ctx, recs, true)
	if err != nil || rep.Added != 2 || rep.Existing != 2 || rep.Skipped != 3 {
		t.Fatalf("dry run report: %+v %v", rep, err)
	}
	if _, err := a.UserByEmail(ctx, "s300@stu.ykpaoschool.cn"); err == nil {
		t.Fatal("a dry run must change nothing")
	}

	rep, err = a.ImportStudents(ctx, recs, false)
	if err != nil || rep.Read != 7 || rep.Added != 2 || rep.Existing != 2 || rep.ClassFilled != 1 || rep.Skipped != 3 {
		t.Fatalf("report: %+v %v", rep, err)
	}
	// the existing teacher keeps role and name; only the empty class was filled
	got, _ := a.UserByEmail(ctx, "s100@stu.ykpaoschool.cn")
	if got.Role != "teacher" || got.Name != "Teach" || got.ClassName != "11B" {
		t.Fatalf("existing person changed wrongly: %+v", got)
	}
	// a student who already signed in keeps the name Microsoft gave and the class they have
	got, _ = a.UserByEmail(ctx, "s200@stu.ykpaoschool.cn")
	if got.ID != signedIn.ID || got.Name != "Name From Microsoft" || got.ClassName != "10A" {
		t.Fatalf("signed-in student overwritten: %+v", got)
	}
	// new accounts are students, can be found by teachers, and cannot log in with a code (none exists)
	fresh, err := a.UserByEmail(ctx, "s400@stu.ykpaoschool.cn")
	if err != nil || fresh.Role != "student" || fresh.ClassName != "12A" || fresh.Name != "Other Fresh" {
		t.Fatalf("%+v %v", fresh, err)
	}
	var hash sql.NullString
	a.DB.Read.QueryRow(`SELECT login_code_hash FROM users WHERE email = 's400@stu.ykpaoschool.cn'`).Scan(&hash)
	if hash.Valid {
		t.Fatal("importing must not create a login code")
	}
	if _, ok := a.LoginWithCode(ctx, "s400@stu.ykpaoschool.cn", "ANYTHING"); ok {
		t.Fatal("a student without a code must not be able to log in")
	}
	if hits, _ := a.SearchStudents(ctx, "other fresh", 8); len(hits) != 1 {
		t.Fatalf("teachers should find imported students: %+v", hits)
	}

	// running it again changes nothing
	rep, err = a.ImportStudents(ctx, recs, false)
	if err != nil || rep.Added != 0 || rep.Existing != 4 || rep.ClassFilled != 0 {
		t.Fatalf("second run: %+v %v", rep, err)
	}
	var n int
	a.DB.Read.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE action = 'students.import'`).Scan(&n)
	if n != 2 {
		t.Errorf("each real import is audited (dry runs are not): %d", n)
	}
	var detail string
	a.DB.Read.QueryRow(`SELECT detail FROM audit_log WHERE action = 'students.import' ORDER BY id LIMIT 1`).Scan(&detail)
	for _, secret := range []string{"Imported Name", "Fresh Student", "s300"} {
		if strings.Contains(detail, secret) {
			t.Errorf("the audit log must hold counts, not names: %s", detail)
		}
	}
}

func TestReadStudentsFileBothFormats(t *testing.T) {
	dir := t.TempDir()

	// the school system's SQLite export
	dbPath := filepath.Join(dir, "students.db")
	d, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE students (id TEXT PRIMARY KEY, english_name TEXT, chinese_name TEXT, system_name TEXT NOT NULL)`,
		`INSERT INTO students VALUES ('s111', '', '', 'Wong (Mei Ling 黄美玲) Amy')`,
		`INSERT INTO students VALUES ('s222', 'Sam Lee', '李三', '')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	d.Close()
	recs, err := ReadStudentsFile(ctx, dbPath, "stu.ykpaoschool.cn")
	if err != nil || len(recs) != 2 || recs[0].ID != "s111" || recs[0].Name != "Mei Ling Wong 黄美玲 (Amy)" || recs[1].Name != "Sam Lee 李三" {
		t.Fatalf("%+v %v", recs, err)
	}

	// a CSV, by id or by school email, with a BOM as spreadsheets write it
	csvPath := filepath.Join(dir, "students.csv")
	os.WriteFile(csvPath, []byte("\uFEFFid,name,class\ns333,\"Kim, Lee\",10A\n"), 0o600)
	if recs, err = ReadStudentsFile(ctx, csvPath, "stu.ykpaoschool.cn"); err != nil || len(recs) != 1 || recs[0].ID != "s333" || recs[0].Name != "Kim, Lee" || recs[0].Class != "10A" {
		t.Fatalf("%+v %v", recs, err)
	}
	os.WriteFile(csvPath, []byte("email,name\ns444@stu.ykpaoschool.cn,Pat Doe\n"), 0o600)
	if recs, err = ReadStudentsFile(ctx, csvPath, "stu.ykpaoschool.cn"); err != nil || len(recs) != 1 || recs[0].ID != "s444" {
		t.Fatalf("%+v %v", recs, err)
	}
	os.WriteFile(csvPath, []byte("nothing,useful\n1,2\n"), 0o600)
	if _, err = ReadStudentsFile(ctx, csvPath, "stu.ykpaoschool.cn"); err == nil {
		t.Fatal("a CSV without the right columns must be refused")
	}
	// something that is not a student list at all
	bogus := filepath.Join(dir, "other.db")
	os.WriteFile(bogus, []byte("not a database"), 0o600)
	if _, err = ReadStudentsFile(ctx, bogus, "stu.ykpaoschool.cn"); err == nil {
		t.Fatal("a file that is not a student list must be refused")
	}
}
