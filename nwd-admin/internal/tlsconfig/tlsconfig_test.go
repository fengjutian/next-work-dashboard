package tlsconfig

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fjutian/nwd-admin/internal/config"
)

// writeSelfSignedPair writes a fresh self-signed cert + key to
// the test's temp dir and returns their paths.
func writeSelfSignedPair(t *testing.T) (certPath, keyPath string) {
	t.Helper()
	dir := t.TempDir()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen rsa: %v", err)
	}
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	return certPath, keyPath
}

func TestLoadStaticHappyPath(t *testing.T) {
	cert, key := writeSelfSignedPair(t)
	cfg, err := LoadStatic(cert, key, "1.2")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Errorf("MinVersion = %d, want TLS 1.2", cfg.MinVersion)
	}
	if len(cfg.Certificates) != 1 {
		t.Errorf("Certificates len = %d, want 1", len(cfg.Certificates))
	}
}

func TestLoadStaticRespects13(t *testing.T) {
	cert, key := writeSelfSignedPair(t)
	cfg, err := LoadStatic(cert, key, "1.3")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.MinVersion != tls.VersionTLS13 {
		t.Errorf("MinVersion = %d, want TLS 1.3", cfg.MinVersion)
	}
}

func TestLoadStaticMissingFields(t *testing.T) {
	if _, err := LoadStatic("", "k", "1.2"); err != ErrCertKeyRequired {
		t.Errorf("missing cert: err = %v, want ErrCertKeyRequired", err)
	}
	if _, err := LoadStatic("c", "", "1.2"); err != ErrCertKeyRequired {
		t.Errorf("missing key: err = %v, want ErrCertKeyRequired", err)
	}
}

func TestLoadStaticInvalidMinVersion(t *testing.T) {
	cert, key := writeSelfSignedPair(t)
	if _, err := LoadStatic(cert, key, "1.0"); err != ErrBadMinVersion {
		t.Errorf("err = %v, want ErrBadMinVersion", err)
	}
}

func TestLoadStaticMissingFile(t *testing.T) {
	if _, err := LoadStatic("does-not-exist.pem", "k", "1.2"); err == nil {
		t.Fatal("expected error for missing cert file")
	}
}

func TestValidateDisabledAllowsAnything(t *testing.T) {
	cfg := config.TLSConfig{Enabled: false, CertFile: "x"}
	if err := Validate(cfg); err != nil {
		t.Errorf("disabled should validate to nil, got %v", err)
	}
}

func TestValidateRejectsExclusiveConfig(t *testing.T) {
	cfg := config.TLSConfig{
		Enabled:  true,
		CertFile: "c", KeyFile: "k",
		ACME: config.ACMEConfig{Hosts: []string{"example.com"}},
	}
	if err := Validate(cfg); err != ErrCertKeyExclusive {
		t.Errorf("err = %v, want ErrCertKeyExclusive", err)
	}
}

func TestValidateRejectsMinVersionOnACME(t *testing.T) {
	cfg := config.TLSConfig{
		Enabled:    true,
		MinVersion: "1.3",
		ACME:       config.ACMEConfig{Hosts: []string{"example.com"}},
	}
	if err := Validate(cfg); err != ErrMinVersionOnACME {
		t.Errorf("err = %v, want ErrMinVersionOnACME", err)
	}
}

func TestValidateAcceptsCleanStatic(t *testing.T) {
	cfg := config.TLSConfig{
		Enabled: true,
		CertFile: "c", KeyFile: "k",
		MinVersion: "1.2",
	}
	if err := Validate(cfg); err != nil {
		t.Errorf("clean static should validate, got %v", err)
	}
}

func TestValidateAcceptsCleanACME(t *testing.T) {
	cfg := config.TLSConfig{
		Enabled: true,
		ACME:    config.ACMEConfig{Hosts: []string{"a.example.com"}},
	}
	if err := Validate(cfg); err != nil {
		t.Errorf("clean ACME should validate, got %v", err)
	}
}

func TestBuildAutocertManagerDefaultCache(t *testing.T) {
	dir := t.TempDir()
	mgr, err := BuildAutocertManager(config.ACMEConfig{
		Hosts: []string{"example.com"},
		Email: "ops@example.com",
	}, dir)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if mgr.Email != "ops@example.com" {
		t.Errorf("email = %q", mgr.Email)
	}
	if mgr.Client != nil {
		t.Errorf("default mode should not set staging client, got %+v", mgr.Client)
	}
}

func TestBuildAutocertManagerStaging(t *testing.T) {
	dir := t.TempDir()
	mgr, err := BuildAutocertManager(config.ACMEConfig{
		Hosts:   []string{"example.com"},
		Staging: true,
	}, dir)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if mgr.Client == nil {
		t.Fatal("staging mode should set client")
	}
}

func TestBuildAutocertManagerEmptyHosts(t *testing.T) {
	dir := t.TempDir()
	if _, err := BuildAutocertManager(config.ACMEConfig{}, dir); err != ErrNoHosts {
		t.Errorf("err = %v, want ErrNoHosts", err)
	}
}
