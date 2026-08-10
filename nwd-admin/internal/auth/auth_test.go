package auth

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fjutian/nwd-admin/internal/config"
)

func mustVerifier(t *testing.T, password string) *Verifier {
	t.Helper()
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	v, err := NewVerifier(config.AdminConfig{
		Username:     "admin",
		PasswordHash: hash,
		Realm:        "test",
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return v
}

func TestNewVerifierNotConfigured(t *testing.T) {
	cases := []config.AdminConfig{
		{},
		{Username: "admin"},
		{PasswordHash: "$2a$12$abcdef"},
	}
	for _, cfg := range cases {
		_, err := NewVerifier(cfg)
		if err != ErrNotConfigured {
			t.Errorf("expected ErrNotConfigured, got %v for %+v", err, cfg)
		}
	}
}

func TestVerifySuccess(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:s3cret-pw"))
	if err := v.Verify(header); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

func TestVerifyWrongPassword(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:nope"))
	if err := v.Verify(header); err != ErrInvalidCreds {
		t.Fatalf("expected ErrInvalidCreds, got %v", err)
	}
}

func TestVerifyWrongUsername(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("root:s3cret-pw"))
	if err := v.Verify(header); err != ErrInvalidCreds {
		t.Fatalf("expected ErrInvalidCreds, got %v", err)
	}
}

func TestVerifyEmptyHeader(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	if err := v.Verify(""); err != ErrInvalidFormat {
		t.Fatalf("expected ErrInvalidFormat, got %v", err)
	}
}

func TestVerifyMalformedBase64(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	if err := v.Verify("Basic !!!notbase64!!!"); err != ErrInvalidFormat {
		t.Fatalf("expected ErrInvalidFormat, got %v", err)
	}
}

func TestVerifyMissingColon(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("no-colon-here"))
	if err := v.Verify(header); err != ErrInvalidFormat {
		t.Fatalf("expected ErrInvalidFormat, got %v", err)
	}
}

func TestVerifyMalformedStoredHash(t *testing.T) {
	v := &Verifier{username: "admin", passwordHash: []byte("not-a-bcrypt-hash"), realm: "test"}
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:anything"))
	if err := v.Verify(header); err != ErrMalformedHash {
		t.Fatalf("expected ErrMalformedHash, got %v", err)
	}
}

func TestVerifyNilVerifier(t *testing.T) {
	var v *Verifier
	if err := v.Verify("Basic dGVzdA=="); err != ErrNotConfigured {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestMiddlewareRejectsUnauthenticated(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	called := false
	handler := v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/plugins", strings.NewReader(""))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if called {
		t.Fatal("downstream handler should not run on failed auth")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
	if challenge := rr.Header().Get("WWW-Authenticate"); !strings.HasPrefix(challenge, "Basic realm=\"test\"") {
		t.Fatalf("expected Basic challenge, got %q", challenge)
	}
}

func TestMiddlewarePassesAuthenticated(t *testing.T) {
	v := mustVerifier(t, "s3cret-pw")
	called := false
	handler := v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodDelete, "/api/plugins/foo", nil)
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("admin:s3cret-pw")))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if !called {
		t.Fatal("downstream handler should run on successful auth")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestMiddlewareNilIsNoop(t *testing.T) {
	var v *Verifier
	called := false
	handler := v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/plugins", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if !called {
		t.Fatal("nil verifier middleware should pass through")
	}
}
