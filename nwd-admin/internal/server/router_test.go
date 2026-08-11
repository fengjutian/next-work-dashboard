//go:build cgo

// The end-to-end router tests require a working SQLite driver,
// which in turn requires CGO. The CGO-enabled build is the same
// configuration used at runtime (see README), so a developer with
// the standard MSYS2 / MinGW-w64 toolchain installed can run:
//
//   go test -tags cgo ./...
//
// On hosts without a C toolchain the tests are skipped so
// `go test ./...` still reports a clean bill of health for the
// auth package and the rest of the codebase.
package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fjutian/nwd-admin/internal/auth"
	"github.com/fjutian/nwd-admin/internal/config"
	"github.com/fjutian/nwd-admin/internal/db"
	"github.com/fjutian/nwd-admin/internal/handler"
	"github.com/fjutian/nwd-admin/internal/repository"
	"github.com/fjutian/nwd-admin/internal/service"
)

const validPlugin = `{
  "format": "nwd-v1",
  "manifest": {
    "id": "hello-world",
    "name": "Hello World",
    "version": "1.0.0",
    "apiVersion": "1",
    "runtime": "sandbox",
    "permissions": []
  },
  "script": "console.log('hello')",
  "style": null
}`

// newTestHandler builds a fully wired Handler backed by a fresh
// on-disk SQLite database so each test gets isolation without
// touching the user's real ./data dir.
func newTestHandler(t *testing.T) *handler.Handler {
	t.Helper()
	dir := t.TempDir()
	gormDB, err := db.Open(dir)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := gormDB.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return handler.New(service.NewPluginService(repository.NewPluginRepository(gormDB)), nil, 50<<20)
}

func newTestVerifier(t *testing.T, password string) *auth.Verifier {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	v, err := auth.NewVerifier(config.AdminConfig{
		Username: "admin", PasswordHash: hash, Realm: "test",
	})
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	return v
}

func uploadRequest(t *testing.T) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("bundle", "hello.nwd")
	if err != nil {
		t.Fatalf("multipart create: %v", err)
	}
	if _, err := io.Copy(fw, strings.NewReader(validPlugin)); err != nil {
		t.Fatalf("multipart copy: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("multipart close: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/plugins", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

func basicHeader(user, pass string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
}

func TestUntrustedModeAllowsWrites(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{})

	// List returns empty.
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/plugins", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /api/plugins: want 200, got %d", rr.Code)
	}

	// Upload goes through.
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, uploadRequest(t))
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("POST /api/plugins: want 303, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestWriteRequiresAuth(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{Verifier: newTestVerifier(t, "s3cret")})

	// Unauthenticated POST is rejected.
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, uploadRequest(t))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated POST: want 401, got %d", rr.Code)
	}
	if challenge := rr.Header().Get("WWW-Authenticate"); !strings.HasPrefix(challenge, `Basic realm="test"`) {
		t.Fatalf("expected Basic challenge, got %q", challenge)
	}

	// Unauthenticated DELETE is rejected.
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/api/plugins/hello-world", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated DELETE: want 401, got %d", rr.Code)
	}
}

func TestWriteAcceptsValidCreds(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{Verifier: newTestVerifier(t, "s3cret")})

	req := uploadRequest(t)
	req.Header.Set("Authorization", basicHeader("admin", "s3cret"))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("authenticated POST: want 303, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestWriteRejectsBadCreds(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{Verifier: newTestVerifier(t, "s3cret")})

	req := uploadRequest(t)
	req.Header.Set("Authorization", basicHeader("admin", "wrong"))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad password: want 401, got %d", rr.Code)
	}
}

func TestReadEndpointsStayPublic(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{Verifier: newTestVerifier(t, "s3cret")})

	cases := []struct {
		method, path string
		wantStatus   int
	}{
		{http.MethodGet, "/", http.StatusOK},
		{http.MethodGet, "/plugins", http.StatusOK},
		{http.MethodGet, "/api/plugins", http.StatusOK},
		// download on a missing plugin still produces 404, but never 401.
		{http.MethodGet, "/api/plugins/hello-world/download", http.StatusNotFound},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, httptest.NewRequest(c.method, c.path, nil))
		if rr.Code != c.wantStatus {
			t.Errorf("%s %s: want %d, got %d", c.method, c.path, c.wantStatus, rr.Code)
		}
	}
}

func TestSecurityHeadersApplied(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{})

	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/plugins", nil))

	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
		"Permissions-Policy":      "interest-cohort=()",
	}
	for k, v := range want {
		if got := rr.Header().Get(k); got != v {
			t.Errorf("header %s: want %q, got %q", k, v, got)
		}
	}
	if csp := rr.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("CSP missing default-src: %q", csp)
	}
}

func TestFullUploadAndDownloadFlow(t *testing.T) {
	h := newTestHandler(t)
	router := NewRouter(h, Options{Verifier: newTestVerifier(t, "s3cret")})

	// Upload as admin.
	req := uploadRequest(t)
	req.Header.Set("Authorization", basicHeader("admin", "s3cret"))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusSeeOther {
		t.Fatalf("upload: want 303, got %d", rr.Code)
	}

	// List now contains the plugin.
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/plugins", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d", rr.Code)
	}
	var list []map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0]["id"] != "hello-world" {
		t.Fatalf("unexpected list: %+v", list)
	}

	// Download is public and returns the original bytes.
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/plugins/hello-world/download", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("download: want 200, got %d", rr.Code)
	}
	body, _ := io.ReadAll(rr.Body)
	if !bytes.Contains(body, []byte("hello from NWD")) &&
		!bytes.Contains(body, []byte("console.log('hello')")) {
		t.Fatalf("download body unexpected: %s", body)
	}

	// Delete requires auth.
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/api/plugins/hello-world", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauth delete: want 401, got %d", rr.Code)
	}

	// Authenticated delete succeeds.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodDelete, "/api/plugins/hello-world", nil)
	req.Header.Set("Authorization", basicHeader("admin", "s3cret"))
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("auth delete: want 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

// make sure handler compilation does not break when DB dir is the
// system temp; mostly guards the import path of filepath.
func TestTempDirHelper(t *testing.T) {
	d := t.TempDir()
	if _, err := os.Stat(filepath.Clean(d)); err != nil {
		t.Fatalf("temp dir missing: %v", err)
	}
}
