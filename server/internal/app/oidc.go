package app

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// OIDCError says why a Microsoft sign-in was refused. The code, never the text, goes into the URL.
type OIDCError struct{ Code, Detail string }

func (e *OIDCError) Error() string { return e.Code + ": " + e.Detail }

// SigninMessages are the friendly messages for each code (also used by the login page).
var SigninMessages = map[string]string{
	"external":  "Sign-in failed at Microsoft. Please try again.",
	"expired":   "Sign-in session expired. Please try again.",
	"token":     "Microsoft's sign-in response could not be verified.",
	"nonce":     "This sign-in did not match the one that started. Please try again.",
	"bad_email": "Your account has no usable email address.",
	"domain":    "Please sign in with a school account.",
}

// AuthorizeURL is where the browser goes to ask Microsoft to sign the user in and post an ID token to redirectURI.
func (a *App) AuthorizeURL(redirectURI, nonce, state string) (string, error) {
	u, err := url.Parse(a.Cfg.OIDC.Authorize)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("client_id", a.Cfg.OIDC.ClientID)
	q.Set("response_type", "id_token")
	q.Set("redirect_uri", redirectURI)
	q.Set("response_mode", "form_post")
	q.Set("scope", "openid profile email")
	q.Set("nonce", nonce)
	q.Set("state", state)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

var (
	keysMu sync.Mutex
	keysBy = map[string]jwt.Keyfunc{}
)

// remoteKeys fetches Microsoft's published signing keys (refreshed automatically) the first time they're needed.
func (a *App) remoteKeys(ctx context.Context) (jwt.Keyfunc, error) {
	if a.Keys != nil {
		return a.Keys, nil
	}
	keysMu.Lock()
	defer keysMu.Unlock()
	if k, ok := keysBy[a.Cfg.OIDC.JWKS]; ok {
		return k, nil
	}
	// The refresh loop must outlive this request, so it gets its own context.
	k, err := keyfunc.NewDefaultCtx(context.Background(), []string{a.Cfg.OIDC.JWKS})
	if err != nil {
		return nil, &OIDCError{"external", "cannot fetch signing keys: " + err.Error()}
	}
	keysBy[a.Cfg.OIDC.JWKS] = k.Keyfunc
	return k.Keyfunc, nil
}

type idClaims struct {
	jwt.RegisteredClaims
	Name              string `json:"name"`
	Email             string `json:"email"`
	PreferredUsername string `json:"preferred_username"`
	Nonce             string `json:"nonce"`
}

// Identity is who Microsoft says signed in.
type Identity struct{ Email, Name string }

// VerifyIDToken checks the signature (RS256 only), issuer, audience (must be OUR client id, so tokens minted
// for other apps in the tenant are refused), expiry, and that the nonce is the one this sign-in started with.
func (a *App) VerifyIDToken(ctx context.Context, idToken, nonce string) (Identity, error) {
	keys, err := a.remoteKeys(ctx)
	if err != nil {
		return Identity{}, err
	}
	var c idClaims
	_, err = jwt.ParseWithClaims(idToken, &c, keys,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(a.Cfg.OIDC.Issuer),
		jwt.WithAudience(a.Cfg.OIDC.ClientID),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(time.Minute),
		jwt.WithTimeFunc(a.Now),
	)
	if err != nil {
		return Identity{}, &OIDCError{"token", err.Error()}
	}
	if c.Nonce == "" || !constEq(c.Nonce, nonce) {
		return Identity{}, &OIDCError{"nonce", "nonce mismatch"}
	}
	email := ""
	for _, v := range []string{c.Email, c.PreferredUsername} {
		if strings.Count(v, "@") == 1 && !strings.ContainsAny(v, " \t") {
			email = strings.ToLower(strings.TrimSpace(v))
			break
		}
	}
	if email == "" {
		return Identity{}, &OIDCError{"bad_email", "no usable email claim"}
	}
	name := strings.TrimSpace(c.Name)
	if name == "" {
		name, _, _ = strings.Cut(email, "@")
	}
	return Identity{Email: email, Name: name}, nil
}

// RoleForEmail: student domain -> student, staff domain -> teacher, anything else (including look-alike domains) -> "".
func (a *App) RoleForEmail(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return ""
	}
	switch email[at+1:] {
	case a.Cfg.StudentDomain:
		return "student"
	case a.Cfg.StaffDomain:
		return "teacher"
	}
	return ""
}

// Provision creates the account on first sign-in. Existing accounts keep their role (an admin may have promoted
// them); addresses in ADMIN_EMAILS are always admins.
func (a *App) Provision(ctx context.Context, who Identity) (User, error) {
	role := a.RoleForEmail(who.Email)
	if role == "" {
		return User{}, &OIDCError{"domain", who.Email}
	}
	isAdmin := false
	for _, e := range a.Cfg.AdminEmails {
		if e == who.Email {
			isAdmin = true
		}
	}
	var id int64
	err := a.tx(ctx, func(t *sql.Tx) error {
		var curRole, curName string
		err := t.QueryRowContext(ctx, `SELECT id, role, name FROM users WHERE email = ?`, who.Email).Scan(&id, &curRole, &curName)
		if errors.Is(err, sql.ErrNoRows) {
			if isAdmin {
				role = "admin"
			}
			return t.QueryRowContext(ctx, `INSERT INTO users (email, name, role) VALUES (?, ?, ?) RETURNING id`, who.Email, who.Name, role).Scan(&id)
		}
		if err != nil {
			return err
		}
		if curName != who.Name {
			if _, err := t.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, who.Name, id); err != nil {
				return err
			}
		}
		if isAdmin && curRole != "admin" {
			_, err = t.ExecContext(ctx, `UPDATE users SET role = 'admin' WHERE id = ?`, id)
		}
		return err
	})
	if err != nil {
		return User{}, err
	}
	return a.UserByID(ctx, id)
}
