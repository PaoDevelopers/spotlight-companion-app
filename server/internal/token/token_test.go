package token

import (
	"encoding/json"
	"os"
	"testing"
)

type vectors struct {
	Secret      string `json:"secret"`
	EventTokens []struct {
		EventID int64  `json:"eventId"`
		NowMs   int64  `json:"nowMs"`
		Token   string `json:"token"`
	} `json:"eventTokens"`
	VerifyEvent []struct {
		Token string `json:"token"`
		NowMs int64  `json:"nowMs"`
		Want  *int64 `json:"want"`
	} `json:"verifyEvent"`
	TagTokens []struct {
		Kind  string `json:"kind"`
		ID    int64  `json:"id"`
		Token string `json:"token"`
	} `json:"tagTokens"`
	VerifyTag []struct {
		Token string `json:"token"`
		Want  *struct {
			Kind string `json:"kind"`
			ID   int64  `json:"id"`
		} `json:"want"`
	} `json:"verifyTag"`
	PassTokens []struct {
		UserID int64  `json:"userId"`
		Token  string `json:"token"`
	} `json:"passTokens"`
	VerifyPass []struct {
		Token string `json:"token"`
		Want  *int64 `json:"want"`
	} `json:"verifyPass"`
}

func load(t *testing.T) vectors {
	raw, err := os.ReadFile("../../testdata/token_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestMakeMatchesTypeScript(t *testing.T) {
	v := load(t)
	for _, c := range v.EventTokens {
		if got := MakeEvent(v.Secret, c.EventID, c.NowMs); got != c.Token {
			t.Errorf("MakeEvent(%d,%d) = %q, want %q", c.EventID, c.NowMs, got, c.Token)
		}
	}
	for _, c := range v.TagTokens {
		if got := MakeTag(v.Secret, Kind(c.Kind), c.ID); got != c.Token {
			t.Errorf("MakeTag(%s,%d) = %q, want %q", c.Kind, c.ID, got, c.Token)
		}
	}
	for _, c := range v.PassTokens {
		if got := MakePass(v.Secret, c.UserID); got != c.Token {
			t.Errorf("MakePass(%d) = %q, want %q", c.UserID, got, c.Token)
		}
	}
}

func TestVerifyMatchesTypeScript(t *testing.T) {
	v := load(t)
	for _, c := range v.VerifyEvent {
		id, ok := VerifyEvent(v.Secret, c.Token, c.NowMs)
		if (c.Want != nil) != ok || (ok && id != *c.Want) {
			t.Errorf("VerifyEvent(%q,%d) = %d,%v want %v", c.Token, c.NowMs, id, ok, c.Want)
		}
	}
	for _, c := range v.VerifyTag {
		kind, id, ok := VerifyTag(v.Secret, c.Token)
		if (c.Want != nil) != ok || (ok && (string(kind) != c.Want.Kind || id != c.Want.ID)) {
			t.Errorf("VerifyTag(%q) = %s,%d,%v want %+v", c.Token, kind, id, ok, c.Want)
		}
	}
	for _, c := range v.VerifyPass {
		id, ok := VerifyPass(v.Secret, c.Token)
		if (c.Want != nil) != ok || (ok && id != *c.Want) {
			t.Errorf("VerifyPass(%q) = %d,%v want %v", c.Token, id, ok, c.Want)
		}
	}
}

func TestRejectsNonCanonicalAndWrongSecret(t *testing.T) {
	now := int64(1_700_000_000_000)
	tok := MakeEvent("s", 7, now)
	if _, ok := VerifyEvent("other", tok, now); ok {
		t.Error("wrong secret accepted")
	}
	// "007" and "+7" would parse to 7 but are not what we issued.
	if _, ok := VerifyEvent("s", "00"+tok, now); ok {
		t.Error("non-canonical id accepted")
	}
	if _, _, ok := VerifyTag("s", "exhibit.+3."+"x"); ok {
		t.Error("non-canonical tag id accepted")
	}
	if _, ok := VerifyPass("s", MakePass("s", 9)+".extra"); ok {
		t.Error("pass token with trailing data accepted")
	}
}
