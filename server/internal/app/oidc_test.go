package app

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	issuer = "https://login.example/tenant/v2.0"
	client = "client-123"
)

type signer struct{ key *rsa.PrivateKey }

func newSigner(t *testing.T) signer {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return signer{k}
}

func (s signer) sign(t *testing.T, claims jwt.MapClaims, method jwt.SigningMethod, key any) string {
	out, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func claims(extra jwt.MapClaims) jwt.MapClaims {
	c := jwt.MapClaims{"iss": issuer, "aud": client, "exp": during.Add(5 * time.Minute).Unix(), "iat": during.Unix(),
		"nonce": "n1", "email": "Ada@Stu.YKPAOSchool.cn", "name": "Ada L"}
	for k, v := range extra {
		if v == nil {
			delete(c, k)
		} else {
			c[k] = v
		}
	}
	return c
}

func oidcApp(t *testing.T, s signer) *App {
	a := newApp(t)
	a.Cfg.AuthMode = "entra"
	a.Cfg.OIDC.Issuer, a.Cfg.OIDC.ClientID, a.Cfg.OIDC.Authorize = issuer, client, "https://login.example/tenant/oauth2/v2.0/authorize"
	a.Keys = func(*jwt.Token) (any, error) { return &s.key.PublicKey, nil }
	return a
}

func TestVerifyIDToken(t *testing.T) {
	s, other := newSigner(t), newSigner(t)
	a := oidcApp(t, s)

	id, err := a.VerifyIDToken(ctx, s.sign(t, claims(nil), jwt.SigningMethodRS256, s.key), "n1")
	if err != nil || id.Email != "ada@stu.ykpaoschool.cn" || id.Name != "Ada L" {
		t.Fatalf("valid token: %+v %v", id, err)
	}
	if id, err = a.VerifyIDToken(ctx, s.sign(t, claims(jwt.MapClaims{"email": nil, "preferred_username": "bo@ykpaoschool.cn", "name": nil}), jwt.SigningMethodRS256, s.key), "n1"); err != nil || id.Email != "bo@ykpaoschool.cn" || id.Name != "bo" {
		t.Fatalf("fallback to preferred_username: %+v %v", id, err)
	}

	b64 := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	unsigned := b64(map[string]string{"alg": "none", "typ": "JWT"}) + "." + b64(claims(nil)) + "."

	for name, tc := range map[string]struct {
		token string
		nonce string
		code  string
	}{
		"wrong audience (token minted for another app)": {s.sign(t, claims(jwt.MapClaims{"aud": "other-app"}), jwt.SigningMethodRS256, s.key), "n1", "token"},
		"wrong issuer (another tenant)":                 {s.sign(t, claims(jwt.MapClaims{"iss": "https://login.example/other/v2.0"}), jwt.SigningMethodRS256, s.key), "n1", "token"},
		"expired":                                       {s.sign(t, claims(jwt.MapClaims{"exp": during.Add(-10 * time.Minute).Unix()}), jwt.SigningMethodRS256, s.key), "n1", "token"},
		"no expiry":                                     {s.sign(t, claims(jwt.MapClaims{"exp": nil}), jwt.SigningMethodRS256, s.key), "n1", "token"},
		"signed by an unknown key":                      {s.sign(t, claims(nil), jwt.SigningMethodRS256, other.key), "n1", "token"},
		"unsigned (alg none)":                           {unsigned, "n1", "token"},
		"symmetric algorithm":                           {s.sign(t, claims(nil), jwt.SigningMethodHS256, []byte("secret")), "n1", "token"},
		"nonce from a different sign-in":                {s.sign(t, claims(nil), jwt.SigningMethodRS256, s.key), "other-nonce", "nonce"},
		"no nonce in token":                             {s.sign(t, claims(jwt.MapClaims{"nonce": nil}), jwt.SigningMethodRS256, s.key), "n1", "nonce"},
		"no usable email":                               {s.sign(t, claims(jwt.MapClaims{"email": nil}), jwt.SigningMethodRS256, s.key), "n1", "bad_email"},
		"two @ signs":                                   {s.sign(t, claims(jwt.MapClaims{"email": "a@b@stu.ykpaoschool.cn"}), jwt.SigningMethodRS256, s.key), "n1", "bad_email"},
	} {
		_, err := a.VerifyIDToken(ctx, tc.token, tc.nonce)
		var oe *OIDCError
		if !errors.As(err, &oe) || oe.Code != tc.code {
			t.Errorf("%s: got %v, want code %q", name, err, tc.code)
		}
	}
}

func TestRoleForEmailAndProvision(t *testing.T) {
	a := oidcApp(t, newSigner(t))
	for email, want := range map[string]string{
		"a@stu.ykpaoschool.cn": "student", "a@ykpaoschool.cn": "teacher", "a@gmail.com": "",
		"a@evil.ykpaoschool.cn": "", "a@ykpaoschool.cn.evil.com": "", "ykpaoschool.cn@evil.com": "", "noat": "",
	} {
		if got := a.RoleForEmail(email); got != want {
			t.Errorf("%s: %q want %q", email, got, want)
		}
	}

	s, err := a.Provision(ctx, Identity{"kid@stu.ykpaoschool.cn", "Kid"})
	if err != nil || s.Role != "student" {
		t.Fatalf("%+v %v", s, err)
	}
	tch, _ := a.Provision(ctx, Identity{"ms@ykpaoschool.cn", "Ms T"})
	if tch.Role != "teacher" {
		t.Fatalf("%+v", tch)
	}
	var oe *OIDCError
	if _, err := a.Provision(ctx, Identity{"x@gmail.com", "X"}); !errors.As(err, &oe) || oe.Code != "domain" {
		t.Fatalf("outsider: %v", err)
	}
	if u, _ := a.UserByEmail(ctx, "x@gmail.com"); u.ID != 0 {
		t.Error("nothing should be created for an outsider")
	}

	// an existing account keeps its (promoted) role and class, but the name refreshes
	if _, err := a.DB.Write.Exec(`UPDATE users SET role = 'teacher', class_name = '10A' WHERE email = 'kid@stu.ykpaoschool.cn'`); err != nil {
		t.Fatal(err)
	}
	u, _ := a.Provision(ctx, Identity{"kid@stu.ykpaoschool.cn", "Kid New"})
	if u.Role != "teacher" || u.Name != "Kid New" || u.ClassName != "10A" || u.ID != s.ID {
		t.Fatalf("%+v", u)
	}

	a.Cfg.AdminEmails = []string{"boss@ykpaoschool.cn", "ms@ykpaoschool.cn"}
	boss, _ := a.Provision(ctx, Identity{"boss@ykpaoschool.cn", "Boss"})
	promoted, _ := a.Provision(ctx, Identity{"ms@ykpaoschool.cn", "Ms T"})
	if boss.Role != "admin" || promoted.Role != "admin" {
		t.Fatalf("%+v %+v", boss, promoted)
	}
}

func TestAuthorizeURL(t *testing.T) {
	a := oidcApp(t, newSigner(t))
	raw, err := a.AuthorizeURL("https://app.example/auth", "n1", "n1.abc")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(raw)
	want := map[string]string{"client_id": client, "response_type": "id_token", "response_mode": "form_post",
		"redirect_uri": "https://app.example/auth", "nonce": "n1", "state": "n1.abc", "scope": "openid profile email"}
	for k, v := range want {
		if u.Query().Get(k) != v {
			t.Errorf("%s = %q, want %q", k, u.Query().Get(k), v)
		}
	}
}
