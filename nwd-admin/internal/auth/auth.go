// Package auth implements HTTP Basic authentication for nwd-admin
// write endpoints (plugin upload and delete).
//
// Credentials live in configuration as a bcrypt-hashed password; the
// plaintext is never stored. Comparison uses bcrypt's constant-cost
// verification, and the username is matched with crypto/subtle to
// avoid timing-based user enumeration.
package auth

import (
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"

	"github.com/fjutian/nwd-admin/internal/audit"
	"github.com/fjutian/nwd-admin/internal/config"
	"golang.org/x/crypto/bcrypt"
)

// Verifier holds the credential pair to authenticate against.
type Verifier struct {
	username     string
	passwordHash []byte
	realm        string
}

// NewVerifier builds a Verifier from configuration. It returns
// ErrNotConfigured when either the username or the password hash is
// empty, so the caller can decide whether to enforce authentication.
func NewVerifier(cfg config.AdminConfig) (*Verifier, error) {
	if !cfg.Enabled() {
		return nil, ErrNotConfigured
	}
	if cfg.Realm == "" {
		cfg.Realm = "nwd-admin"
	}
	return &Verifier{
		username:     cfg.Username,
		passwordHash: []byte(cfg.PasswordHash),
		realm:        cfg.Realm,
	}, nil
}

// Errors returned by Verifier.
var (
	ErrNotConfigured  = errors.New("admin authentication is not configured")
	ErrInvalidFormat  = errors.New("invalid basic auth header")
	ErrInvalidCreds   = errors.New("invalid admin credentials")
	ErrMalformedHash  = errors.New("stored password hash is malformed")
)

// Verify checks the supplied Basic auth header value against the
// configured credentials. The header value is expected to be the raw
// payload (without the "Basic " prefix). Returns nil on success.
//
// Deprecated: use Authenticate, which also returns the username so
// downstream middleware can stamp the actor on audit log rows.
func (v *Verifier) Verify(header string) error {
	_, err := v.Authenticate(header)
	return err
}

// Middleware returns an http.Handler middleware that requires a valid
// Basic auth header on every request. On failure it short-circuits
// with 401 and a WWW-Authenticate challenge.
//
// On success the middleware stores the authenticated username in
// the request context via audit.WithActor so downstream middleware
// (notably the audit recorder) can stamp it on the resulting log
// row without re-parsing the Authorization header.
//
// The middleware is no-op when no Verifier is configured, which
// matches the trusted-local fallback. Callers should NOT mount this
// when the deployment intends write protection without a configured
// admin credential; the server entry point refuses to start in that
// case.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	if v == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, headerErr := v.Authenticate(r.Header.Get("Authorization"))
		if headerErr != nil {
			challenge := `Basic realm="` + v.realm + `", charset="UTF-8"`
			w.Header().Set("WWW-Authenticate", challenge)
			switch {
			case errors.Is(headerErr, ErrInvalidFormat):
				http.Error(w, "需要 Basic 认证", http.StatusUnauthorized)
			case errors.Is(headerErr, ErrInvalidCreds):
				http.Error(w, "管理员凭证无效", http.StatusUnauthorized)
			default:
				// Malformed stored hash or other server-side problem.
				http.Error(w, "管理员认证配置异常", http.StatusInternalServerError)
			}
			return
		}
		ctx := audit.WithActor(r.Context(), username)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Authenticate verifies the Basic auth header and, on success,
// returns the username. It exists separately from Middleware so
// other callers (e.g. tests) can reuse the credential check.
func (v *Verifier) Authenticate(header string) (string, error) {
	if v == nil {
		return "", ErrNotConfigured
	}
	username, password, err := parseBasic(header)
	if err != nil {
		return "", err
	}
	if subtle.ConstantTimeCompare([]byte(username), []byte(v.username)) != 1 {
		return "", ErrInvalidCreds
	}
	if err := bcrypt.CompareHashAndPassword(v.passwordHash, []byte(password)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return "", ErrInvalidCreds
		}
		slog.Error("verify admin password", "err", err)
		return "", ErrMalformedHash
	}
	return username, nil
}

// HashPassword wraps bcrypt for use by the gen-password command.
func HashPassword(password string) (string, error) {
	// Cost 12 is the 2026 default; high enough to resist offline
	// brute-force against a leaked config, low enough to stay
	// interactive on commodity hardware.
	h, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(h), nil
}
