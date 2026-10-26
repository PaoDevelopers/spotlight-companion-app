package auth

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestSessionMatchesTypeScript(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/session_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Secret string `json:"secret"`
		Create []struct {
			UserID int64  `json:"userId"`
			NowMs  int64  `json:"nowMs"`
			Token  string `json:"token"`
		} `json:"create"`
		Read []struct {
			Token string `json:"token"`
			NowMs int64  `json:"nowMs"`
			Want  *int64 `json:"want"`
		} `json:"read"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Create {
		if got := CreateSession(v.Secret, c.UserID, c.NowMs); got != c.Token {
			t.Errorf("CreateSession(%d,%d) = %q, want %q", c.UserID, c.NowMs, got, c.Token)
		}
	}
	for _, c := range v.Read {
		id, ok := ReadSession(v.Secret, c.Token, c.NowMs)
		if (c.Want != nil) != ok || (ok && id != *c.Want) {
			t.Errorf("ReadSession(%q,%d) = %d,%v want %v", c.Token, c.NowMs, id, ok, c.Want)
		}
	}
}

func TestCodeHashMatchesTypeScript(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/code_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct{ Code, Salt, Hash string }
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if got := v.Salt + ":" + scryptHex(v.Code, v.Salt); got != v.Hash {
		t.Fatalf("hash = %q, want %q", got, v.Hash)
	}
	if !VerifyCode("  "+strings.ToLower(v.Code)+" ", v.Hash) {
		t.Error("lowercase code with spaces should verify")
	}
	if VerifyCode("WRONG123", v.Hash) || VerifyCode(v.Code, "") || VerifyCode(v.Code, "nocolon") {
		t.Error("wrong code or malformed hash verified")
	}
}

func TestGeneratedCodesAreHashable(t *testing.T) {
	c := GenerateCode(8)
	if len(c) != 8 || strings.ContainsAny(c, "01OIL") {
		t.Fatalf("bad code %q", c)
	}
	if !VerifyCode(c, HashCode(c)) {
		t.Error("round trip failed")
	}
}
