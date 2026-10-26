// Package config loads settings from an optional KEY=value file plus environment variables.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	PublicURL string // exact public address, e.g. https://spotlight.example.cn (also the Microsoft redirect host)
	Listen    string
	DBPath    string
	Secret    string // signs sessions, QR/NFC tokens (CHECKIN_SECRET). Changing it invalidates printed tags.

	AuthMode string // "roster" (email + printed code) or "entra" (Microsoft only)
	OIDC     OIDC

	StaffDomain, StudentDomain string
	AdminEmails                []string

	TLSCert, TLSKey string // optional; leave empty behind a TLS-terminating proxy
	CronSecret      string // optional; enables POST /api/cron/awards for an external scheduler

	DemoSeed      bool   // seed fake demo accounts/data when the database is empty (dev, tests, demos)
	DemoLoginCode string // fixed login code for the demo accounts (tests only)
}

type OIDC struct {
	TenantID, ClientID      string
	Authorize, JWKS, Issuer string
}

// Load reads path (if non-empty) then lets the environment override it.
func Load(path string) (*Config, error) {
	vals := map[string]string{}
	if path != "" {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for n := 1; sc.Scan(); n++ {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				return nil, fmt.Errorf("%s:%d: expected KEY=value", path, n)
			}
			vals[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
	get := func(k, def string) string {
		if v, ok := os.LookupEnv(k); ok {
			return strings.TrimSpace(v)
		}
		if v, ok := vals[k]; ok {
			return v
		}
		return def
	}

	c := &Config{
		PublicURL:     strings.TrimRight(get("PUBLIC_URL", ""), "/"),
		Listen:        get("LISTEN", ":8080"),
		DBPath:        get("DB_PATH", "spotlight.db"),
		Secret:        get("CHECKIN_SECRET", ""),
		AuthMode:      get("AUTH_MODE", "roster"),
		StaffDomain:   strings.ToLower(get("STAFF_DOMAIN", "ykpaoschool.cn")),
		StudentDomain: strings.ToLower(get("STUDENT_DOMAIN", "stu.ykpaoschool.cn")),
		TLSCert:       get("TLS_CERT", ""),
		TLSKey:        get("TLS_KEY", ""),
		CronSecret:    get("CRON_SECRET", ""),
		DemoSeed:      get("DEMO_SEED", "") == "1",
		DemoLoginCode: get("DEMO_LOGIN_CODE", ""),
	}
	for _, e := range strings.Split(get("ADMIN_EMAILS", ""), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails = append(c.AdminEmails, e)
		}
	}
	c.OIDC.TenantID = get("OIDC_TENANT_ID", "")
	c.OIDC.ClientID = get("OIDC_CLIENT_ID", "")
	base := "https://login.microsoftonline.com/" + c.OIDC.TenantID
	c.OIDC.Authorize = get("OIDC_AUTHORIZE_URL", base+"/oauth2/v2.0/authorize")
	c.OIDC.JWKS = get("OIDC_JWKS_URL", base+"/discovery/v2.0/keys")
	c.OIDC.Issuer = get("OIDC_ISSUER", base+"/v2.0")
	return c, c.validate()
}

// validate refuses to start on placeholder or missing settings rather than running insecurely.
func (c *Config) validate() error {
	var errs []error
	if len(c.Secret) < 32 || strings.Contains(c.Secret, "CHANGE-ME") {
		errs = append(errs, errors.New("CHECKIN_SECRET must be set to a random string of at least 32 characters (openssl rand -hex 32)"))
	}
	if c.AuthMode != "roster" && c.AuthMode != "entra" {
		errs = append(errs, fmt.Errorf("AUTH_MODE must be roster or entra, got %q", c.AuthMode))
	}
	if c.PublicURL == "" {
		errs = append(errs, errors.New("PUBLIC_URL must be set (e.g. https://spotlight.example.cn); it is the exact address Microsoft redirects back to"))
	} else if u, err := url.Parse(c.PublicURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" {
		errs = append(errs, fmt.Errorf("PUBLIC_URL must look like https://host[:port] with no path, got %q", c.PublicURL))
	}
	if c.AuthMode == "entra" && (c.OIDC.TenantID == "" || strings.Contains(c.OIDC.ClientID+c.OIDC.TenantID, "CHANGE-ME") || c.OIDC.ClientID == "") {
		errs = append(errs, errors.New("AUTH_MODE=entra needs OIDC_TENANT_ID and OIDC_CLIENT_ID"))
	}
	if (c.TLSCert == "") != (c.TLSKey == "") {
		errs = append(errs, errors.New("TLS_CERT and TLS_KEY must be set together"))
	}
	return errors.Join(errs...)
}

// Secure says whether cookies should carry the Secure flag.
func (c *Config) Secure() bool { return strings.HasPrefix(c.PublicURL, "https://") }
