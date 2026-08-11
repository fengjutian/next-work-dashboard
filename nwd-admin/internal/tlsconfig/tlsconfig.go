// Package tlsconfig loads and validates the TLS configuration for
// nwd-admin. It supports two modes:
//
//   - Static: a PEM-encoded certificate and key file on disk.
//   - ACME: on-the-fly Let's Encrypt certificates via autocert.
//
// The package does NOT start any listeners itself; it returns
// either a *tls.Config (static) or a *autocert.Manager (ACME)
// that the caller wires into http.Server.
package tlsconfig

import (
	"crypto/tls"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/fjutian/nwd-admin/internal/config"
	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"
)

// Errors returned by this package. Each corresponds to a misconfig
// that should prevent the server from starting.
var (
	ErrCertKeyRequired  = errors.New("both cert_file and key_file are required for static TLS")
	ErrCertKeyExclusive = errors.New("cert_file/key_file and acme.hosts are mutually exclusive")
	ErrNoHosts          = errors.New("acme.hosts is empty")
	ErrBadMinVersion    = errors.New("invalid tls.min_version (expected 1.2 or 1.3)")
	ErrMinVersionOnACME = errors.New("tls.min_version only applies to static TLS, not ACME")
)

// LoadStatic reads a PEM cert+key pair from disk and returns a
// *tls.Config wired to the requested minimum version.
func LoadStatic(certFile, keyFile, minVersion string) (*tls.Config, error) {
	if certFile == "" || keyFile == "" {
		return nil, ErrCertKeyRequired
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load x509 key pair: %w", err)
	}
	version, err := parseMinVersion(minVersion)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   version,
	}, nil
}

// BuildAutocertManager constructs an autocert.Manager from the
// given ACME configuration. dataDir is used as the default cache
// location when ACME.CacheDir is empty.
func BuildAutocertManager(cfg config.ACMEConfig, dataDir string) (*autocert.Manager, error) {
	if len(cfg.Hosts) == 0 {
		return nil, ErrNoHosts
	}
	cacheDir := cfg.CacheDir
	if cacheDir == "" {
		cacheDir = filepath.Join(dataDir, "acme-cache")
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return nil, fmt.Errorf("create acme cache dir: %w", err)
	}
	m := &autocert.Manager{
		Cache:      autocert.DirCache(cacheDir),
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(cfg.Hosts...),
	}
	if cfg.Email != "" {
		m.Email = cfg.Email
	}
	if cfg.Staging {
		m.Client = &acme.Client{DirectoryURL: "https://acme-staging-v02.api.letsencrypt.org/directory"}
	}
	return m, nil
}

// Validate rejects TLS configurations that combine settings in
// ways the runtime cannot honor (e.g. a static cert + an ACME
// host list). The caller should run this at startup before
// attempting to load the cert or build the manager.
func Validate(cfg config.TLSConfig) error {
	if !cfg.Enabled {
		// Disabled: nothing to validate. Cert/ACME fields are
		// allowed to be set so a future "tls.enabled: true"
		// flip is a single-line config change.
		return nil
	}
	if cfg.StaticMode() && cfg.ACMEMode() {
		return ErrCertKeyExclusive
	}
	if cfg.StaticMode() {
		if _, err := parseMinVersion(cfg.MinVersion); err != nil {
			return err
		}
	}
	if cfg.ACMEMode() && cfg.MinVersion != "" && cfg.MinVersion != "1.2" {
		// autocert always negotiates TLS 1.2 minimum; an explicit
		// higher value on the ACME path is almost certainly a
		// copy-paste from the static block.
		return ErrMinVersionOnACME
	}
	return nil
}

func parseMinVersion(s string) (uint16, error) {
	switch strings.TrimSpace(s) {
	case "", "1.2":
		return tls.VersionTLS12, nil
	case "1.3":
		return tls.VersionTLS13, nil
	default:
		return 0, ErrBadMinVersion
	}
}
