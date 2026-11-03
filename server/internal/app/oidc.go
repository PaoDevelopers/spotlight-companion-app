package app

import (
	"context"
	"database/sql"
	"net/url"
	"slices"
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

// Identity is who Microsoft says signed in. Email is the address used for the school-domain check and for a new account;
// Others are the person's other addresses in the token (Microsoft can send a mail address and a sign-in name that differ),
// used to recognise an account that was loaded or created under one of them.
type Identity struct {
	Email, Name string
	Others      []string
}

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
	var all []string
	// the sign-in name comes first: IT assigns it, whereas the mail address can be a different or editable attribute
	for _, v := range []string{c.PreferredUsername, c.Email} {
		v = strings.ToLower(strings.TrimSpace(v))
		if strings.Count(v, "@") == 1 && !strings.ContainsAny(v, " \t") && !slices.Contains(all, v) {
			all = append(all, v)
		}
	}
	if len(all) == 0 {
		return Identity{}, &OIDCError{"bad_email", "no usable email claim"}
	}
	// the main address is the first one on a school domain (so a stray personal address in one claim cannot decide the role)
	email := all[0]
	for _, v := range all {
		if a.RoleForEmail(v) != "" {
			email = v
			break
		}
	}
	var others []string
	for _, v := range all {
		if v != email {
			others = append(others, v)
		}
	}
	name := strings.TrimSpace(c.Name)
	if name == "" {
		name, _, _ = strings.Cut(email, "@")
	}
	return Identity{Email: email, Name: name, Others: others}, nil
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

// Provision finds or creates the account of the person who signed in. If there is a record for any of their addresses
// (for example one loaded from the school's student list) that is the account: Microsoft's name replaces the loaded name
// and everything recorded for it (check-ins, sign-ups, results, awards, class) stays. If addresses lead to two different
// accounts, they are merged into one. Existing accounts keep their role (an admin may have promoted them); addresses in
// ADMIN_EMAILS are always admins.
func (a *App) Provision(ctx context.Context, who Identity) (User, error) {
	role := a.RoleForEmail(who.Email)
	if role == "" {
		return User{}, &OIDCError{"domain", who.Email}
	}
	addresses := append([]string{who.Email}, who.Others...)
	isAdmin := false
	for _, e := range a.Cfg.AdminEmails {
		if slices.Contains(addresses, e) {
			isAdmin = true
		}
	}
	var id int64
	err := a.tx(ctx, func(t *sql.Tx) error {
		// every account any of these addresses leads to, oldest first
		var found []int64
		for _, e := range addresses {
			owner, ok, err := aliasOwner(ctx, t, e)
			if err != nil {
				return err
			}
			if !ok || slices.Contains(found, owner) {
				continue
			}
			if e != who.Email {
				// A second address in the token may only lead to a STUDENT account, for a student sign-in. It must never attach
				// someone to a teacher or admin account, whatever an address claim says.
				var ownerRole string
				if err := t.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, owner).Scan(&ownerRole); err != nil {
					return err
				}
				if ownerRole != "student" || role != "student" || a.RoleForEmail(e) != "student" {
					continue
				}
			}
			found = append(found, owner)
		}
		slices.Sort(found)
		if len(found) == 0 {
			if isAdmin {
				role = "admin"
			}
			if err := t.QueryRowContext(ctx, `INSERT INTO users (email, name, role) VALUES (?, ?, ?) RETURNING id`, who.Email, who.Name, role).Scan(&id); err != nil {
				return err
			}
		} else {
			id = found[0]
			for _, other := range found[1:] {
				if _, err := mergeTx(ctx, t, id, other, false); err != nil {
					return err
				}
			}
		}
		var curRole, curName, curEmail string
		if err := t.QueryRowContext(ctx, `SELECT role, name, email FROM users WHERE id = ?`, id).Scan(&curRole, &curName, &curEmail); err != nil {
			return err
		}
		if curName != who.Name { // the real account's name replaces the loaded record's
			if _, err := t.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, who.Name, id); err != nil {
				return err
			}
		}
		for _, e := range addresses { // remember the person's other addresses, so the next sign-in and a re-import find this same account
			if e == curEmail || a.RoleForEmail(e) != curRole && !(curRole == "admin" && a.RoleForEmail(e) == "teacher") {
				continue // only addresses of the same kind (a student's school address, a teacher's staff address)
			}
			// never take an address that is already someone's account
			if _, err := t.ExecContext(ctx, `INSERT OR IGNORE INTO user_aliases (email, user_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`, e, id, e); err != nil {
				return err
			}
		}
		if isAdmin && curRole != "admin" {
			_, err := t.ExecContext(ctx, `UPDATE users SET role = 'admin' WHERE id = ?`, id)
			return err
		}
		return nil
	})
	if err != nil {
		return User{}, err
	}
	return a.UserByID(ctx, id)
}
