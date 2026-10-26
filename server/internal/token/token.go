// Package token makes and checks the signed codes behind QR codes and NFC tags.
//
// The formats are byte-for-byte those of the original TypeScript implementation
// (lib/checkin/token.ts), so QR codes and tags printed earlier keep working.
package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"strconv"
	"strings"
)

// WindowSeconds is how long a rotating event token stays current.
const WindowSeconds = 30

// A scan right at a rollover still works: the previous window is accepted too.
const acceptedWindowsBack = 1

func sign(secret, message string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

func window(nowMs int64) int64 { return floorDiv(nowMs, 1000*WindowSeconds) }

// canonicalInt parses a non-negative decimal integer written the one canonical way ("7", not "007" or "+7").
func canonicalInt(s string) (int64, bool) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || strconv.FormatInt(n, 10) != s {
		return 0, false
	}
	return n, true
}

// MakeEvent is the rotating token shown as a QR code on the teacher's projector or tablet.
func MakeEvent(secret string, eventID, nowMs int64) string {
	w := window(nowMs)
	id, ws := strconv.FormatInt(eventID, 10), strconv.FormatInt(w, 10)
	return id + "." + ws + "." + sign(secret, id+"."+ws)
}

// VerifyEvent returns the event id when the token is authentic and recent.
func VerifyEvent(secret, token string, nowMs int64) (int64, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 3 || parts[2] == "" {
		return 0, false
	}
	eventID, ok1 := canonicalInt(parts[0])
	w, ok2 := canonicalInt(parts[1])
	if !ok1 || !ok2 {
		return 0, false
	}
	now := window(nowMs)
	if w > now || now-w > acceptedWindowsBack {
		return 0, false
	}
	if !equal(sign(secret, parts[0]+"."+parts[1]), parts[2]) {
		return 0, false
	}
	return eventID, true
}

// Kind says what a static tag token points at.
type Kind string

const (
	KindEvent   Kind = "event"
	KindExhibit Kind = "exhibit"
)

// MakeTag is the permanent token for a physical NFC tag or printed exhibit QR code.
func MakeTag(secret string, kind Kind, id int64) string {
	ids := strconv.FormatInt(id, 10)
	return string(kind) + "." + ids + "." + sign(secret, "tag."+string(kind)+"."+ids)
}

// VerifyTag checks a tag token and says what it points at.
func VerifyTag(secret, token string) (Kind, int64, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 3 || parts[2] == "" {
		return "", 0, false
	}
	kind := Kind(parts[0])
	id, ok := canonicalInt(parts[1])
	if (kind != KindEvent && kind != KindExhibit) || !ok {
		return "", 0, false
	}
	if !equal(MakeTag(secret, kind, id), token) {
		return "", 0, false
	}
	return kind, id, true
}

// MakePass is a student's personal QR code for a teacher to scan.
func MakePass(secret string, userID int64) string {
	ids := strconv.FormatInt(userID, 10)
	return "pass." + ids + "." + sign(secret, "pass."+ids)
}

// VerifyPass returns the user id of a valid pass token.
func VerifyPass(secret, token string) (int64, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 || parts[0] != "pass" {
		return 0, false
	}
	id, ok := canonicalInt(parts[1])
	if !ok || !equal(MakePass(secret, id), token) {
		return 0, false
	}
	return id, true
}
