// Package auth holds the signed session cookie and login-code hashing.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"

	"golang.org/x/crypto/scrypt"
)

// SessionDays is how long a sign-in lasts.
const SessionDays = 45

func mac(secret, message string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// CreateSession returns the cookie value "userID.expiry.signature" (same format as the TypeScript app).
func CreateSession(secret string, userID, nowMs int64) string {
	exp := nowMs/1000 + SessionDays*86400
	body := strconv.FormatInt(userID, 10) + "." + strconv.FormatInt(exp, 10)
	return body + "." + mac(secret, body)
}

// ReadSession returns the user id from a valid, unexpired cookie value.
func ReadSession(secret, token string, nowMs int64) (int64, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return 0, false
	}
	if subtle.ConstantTimeCompare([]byte(mac(secret, parts[0]+"."+parts[1])), []byte(parts[2])) != 1 {
		return 0, false
	}
	exp, err1 := strconv.ParseInt(parts[1], 10, 64)
	id, err2 := strconv.ParseInt(parts[0], 10, 64)
	if err1 != nil || err2 != nil || float64(exp) < float64(nowMs)/1000 {
		return 0, false
	}
	return id, true
}

// Login codes use letters and digits that can't be mistaken for each other.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// GenerateCode makes a random login code of n characters.
func GenerateCode(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	out := make([]byte, n)
	for i, v := range b {
		out[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	return string(out)
}

func scryptHex(code, salt string) string {
	k, err := scrypt.Key([]byte(strings.ToUpper(code)), []byte(salt), 16384, 8, 1, 32)
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(k)
}

// HashCode returns "salt:hash" (compatible with the TypeScript app's format).
func HashCode(code string) string {
	s := make([]byte, 8)
	if _, err := rand.Read(s); err != nil {
		panic(err)
	}
	salt := hex.EncodeToString(s)
	return salt + ":" + scryptHex(code, salt)
}

// VerifyCode checks a typed code (case and surrounding spaces don't matter) against a stored hash.
func VerifyCode(code, stored string) bool {
	salt, hash, ok := strings.Cut(stored, ":")
	if !ok || stored == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(scryptHex(strings.TrimSpace(code), salt)), []byte(hash)) == 1
}
