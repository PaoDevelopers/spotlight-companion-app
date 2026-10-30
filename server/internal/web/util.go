package web

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
)

const maxBody = 2 << 20 // 2 MB: the biggest request is a pasted roster CSV

type apiError struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func fail(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, apiError{Error: msg, Code: code})
}

// readJSON decodes a JSON body. It insists on a JSON content type, so a hostile web page can't make
// a visitor's browser submit a plain HTML form to us, and rejects unknown fields to catch client typos.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "bad_content_type", "send application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "too_large", "request too large")
		} else {
			fail(w, http.StatusBadRequest, "bad_json", "could not read the request")
		}
		return false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		fail(w, http.StatusBadRequest, "bad_json", "unexpected data after the request body")
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		fail(w, http.StatusNotFound, "not_found", "not found")
		return 0, false
	}
	return id, true
}

// serverError logs the real cause and tells the client nothing about it.
func (s *Server) serverError(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Error("request failed", slog.String("method", r.Method), slog.String("path", r.URL.Path), slog.Any("err", err))
	fail(w, http.StatusInternalServerError, "internal", "something went wrong")
}

// appError maps the service layer's errors to HTTP answers.
func (s *Server) appError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, app.ErrNotFound):
		fail(w, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, app.ErrInvalid):
		fail(w, http.StatusUnprocessableEntity, "invalid", "please check the form and try again")
	case errors.Is(err, app.ErrOwnExhibit):
		fail(w, http.StatusConflict, "own_exhibit", err.Error())
	case errors.Is(err, app.ErrForbidden):
		fail(w, http.StatusForbidden, "forbidden", err.Error())
	case errors.Is(err, app.ErrBadToken):
		fail(w, http.StatusUnprocessableEntity, "bad_token", err.Error())
	case errors.Is(err, app.ErrClosed):
		fail(w, http.StatusConflict, "closed", err.Error())
	case errors.Is(err, app.ErrFull):
		fail(w, http.StatusConflict, "full", err.Error())
	default:
		s.serverError(w, r, err)
	}
}

// limiter counts failures per key inside a sliding window (in memory; fine for one server process).
type limiter struct {
	mu     sync.Mutex
	fails  map[string][]time.Time
	max    int
	window time.Duration
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{fails: map[string][]time.Time{}, max: max, window: window}
}

func (l *limiter) prune(key string, now time.Time) []time.Time {
	kept := l.fails[key][:0]
	for _, t := range l.fails[key] {
		if now.Sub(t) < l.window {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.fails, key)
	} else {
		l.fails[key] = kept
	}
	return kept
}

func (l *limiter) blocked(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key, now)) >= l.max
}

func (l *limiter) fail(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(key, now)
	l.fails[key] = append(l.fails[key], now)
}

func (l *limiter) clear(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, key)
}

func cleanPath(next string) string {
	if strings.HasPrefix(next, "/") && !strings.HasPrefix(next, "//") && !strings.HasPrefix(next, `/\`) {
		return next
	}
	return "/"
}

func constantEq(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
