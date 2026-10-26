package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const good = "CHECKIN_SECRET=0123456789abcdef0123456789abcdef\nPUBLIC_URL=https://spotlight.example.cn/\n"

func write(t *testing.T, body string) string {
	p := filepath.Join(t.TempDir(), "c.conf")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadsAndNormalises(t *testing.T) {
	c, err := Load(write(t, "# comment\n"+good+"ADMIN_EMAILS= A@x.cn , b@x.cn\nSTAFF_DOMAIN=\"Staff.CN\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if c.PublicURL != "https://spotlight.example.cn" || c.StaffDomain != "staff.cn" || len(c.AdminEmails) != 2 || c.AdminEmails[0] != "a@x.cn" || !c.Secure() {
		t.Fatalf("unexpected config %+v", c)
	}
	if c.OIDC.Issuer != "https://login.microsoftonline.com//v2.0" && c.OIDC.TenantID != "" {
		t.Fatal("issuer should derive from tenant")
	}
}

func TestRefusesPlaceholdersAndMissingSettings(t *testing.T) {
	for name, body := range map[string]string{
		"short secret":       "CHECKIN_SECRET=abc\nPUBLIC_URL=https://x.cn\n",
		"placeholder secret": "CHECKIN_SECRET=CHANGE-ME-openssl-rand-hex-32-padding-padding\nPUBLIC_URL=https://x.cn\n",
		"no public url":      "CHECKIN_SECRET=0123456789abcdef0123456789abcdef\n",
		"url with a path":    "CHECKIN_SECRET=0123456789abcdef0123456789abcdef\nPUBLIC_URL=https://x.cn/app\n",
		"bad mode":           good + "AUTH_MODE=sso\n",
		"entra without ids":  good + "AUTH_MODE=entra\n",
		"half a tls pair":    good + "TLS_CERT=/a\n",
	} {
		t.Setenv("CHECKIN_SECRET", "")
		os.Unsetenv("CHECKIN_SECRET")
		if _, err := Load(write(t, body)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	if _, err := Load(write(t, "garbage line\n")); err == nil || !strings.Contains(err.Error(), "KEY=value") {
		t.Errorf("malformed line: %v", err)
	}
}

func TestEnvironmentOverridesFile(t *testing.T) {
	t.Setenv("LISTEN", ":9999")
	c, err := Load(write(t, good+"LISTEN=:1\n"))
	if err != nil || c.Listen != ":9999" {
		t.Fatalf("listen = %v, err %v", c, err)
	}
}
