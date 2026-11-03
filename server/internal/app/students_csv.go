package app

import (
	"encoding/csv"
	"fmt"
	"os"
	"strings"
)

// readStudentsCSV reads "id,name,class" (the id may instead be given as a school email in an "email" column).
func readStudentsCSV(path, studentDomain string) ([]StudentRecord, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	all, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return nil, fmt.Errorf("%s is empty", path)
	}
	col := map[string]int{}
	for i, h := range all[0] {
		col[strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, "\uFEFF")))] = i
	}
	idCol, hasID := col["id"]
	emailCol, hasEmail := col["email"]
	nameCol, hasName := col["name"]
	if (!hasID && !hasEmail) || !hasName {
		return nil, fmt.Errorf("%s: the first row must name the columns: id (or email), name and optionally class", path)
	}
	classCol, hasClass := col["class"]
	get := func(row []string, i int) string {
		if i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}
	var out []StudentRecord
	for _, row := range all[1:] {
		id := ""
		if hasID {
			id = get(row, idCol)
		}
		if id == "" && hasEmail {
			id = strings.TrimSuffix(strings.ToLower(get(row, emailCol)), "@"+studentDomain)
		}
		rec := StudentRecord{ID: id, Name: collapse(get(row, nameCol))}
		if hasClass {
			rec.Class = get(row, classCol)
		}
		out = append(out, rec)
	}
	return out, nil
}
