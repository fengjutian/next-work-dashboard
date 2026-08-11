package csrf

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// run is a thin wrapper that drives the middleware with a
// synthesized request and returns the recorded response.
func run(t *testing.T, cfg Config, method, target, origin, referer, customHeader string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	if customHeader != "" {
		req.Header.Set(HeaderName, customHeader)
	}
	called := false
	handler := Middleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code == http.StatusOK && !called {
		t.Fatal("downstream not called on success")
	}
	return rr
}

func TestWriteRequiresCustomHeaderByDefault(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}}, http.MethodPost, "/api/x", "http://example.com", "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "CSRF") {
		t.Errorf("error body should mention CSRF, got %q", rr.Body.String())
	}
}

func TestWriteAcceptsValidOriginAndHeader(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "http://example.com", "", HeaderValue)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestGetIsNeverChecked(t *testing.T) {
	// No origin, no header; GET must still pass.
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}}, http.MethodGet, "/", "", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET should be unchecked, got %d", rr.Code)
	}
}

func TestWriteRejectsForeignOrigin(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "http://attacker.example.org", "", HeaderValue)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("foreign origin should be 403, got %d", rr.Code)
	}
}

func TestWriteFallsBackToReferer(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "", "http://example.com/some/page", HeaderValue)
	if rr.Code != http.StatusOK {
		t.Fatalf("Referer fallback should pass, got %d", rr.Code)
	}
}

func TestWriteRejectsWhenNeitherOriginNorReferer(t *testing.T) {
	// Non-browser clients (curl) won't set either. The
	// RequireCustomHeader check still gives them a path: as
	// long as they set X-Requested-With, they can omit
	// Origin. Without that header we reject.
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "", "", HeaderValue)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("missing origin + Referer should be 403, got %d", rr.Code)
	}
}

func TestWriteRejectsUnknownCustomHeader(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "http://example.com", "", "wrong-value")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("wrong header value should be 403, got %d", rr.Code)
	}
}

func TestWildcardOriginAllowsAnywhere(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"*"}},
		http.MethodPost, "/api/x", "http://anything.example.org", "", HeaderValue)
	if rr.Code != http.StatusOK {
		t.Fatalf("wildcard origin should pass, got %d", rr.Code)
	}
}

func TestCustomHeaderCanBeDisabled(t *testing.T) {
	disabled := false
	rr := run(t, Config{
		AllowedOrigins:      []string{"example.com"},
		RequireCustomHeader: &disabled,
	}, http.MethodPost, "/api/x", "http://example.com", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("origin-only check should pass, got %d", rr.Code)
	}
}

func TestPortStripping(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "http://example.com:8090", "", HeaderValue)
	if rr.Code != http.StatusOK {
		t.Fatalf("port should be stripped, got %d", rr.Code)
	}
}

func TestCaseInsensitiveOrigin(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"Example.COM"}},
		http.MethodPost, "/api/x", "http://example.com", "", HeaderValue)
	if rr.Code != http.StatusOK {
		t.Fatalf("origin comparison should be case-insensitive, got %d", rr.Code)
	}
}

func TestMethodsChecked(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		rr := run(t, Config{AllowedOrigins: []string{"example.com"}}, method, "/api/x", "http://attacker.org", "", HeaderValue)
		if rr.Code != http.StatusForbidden {
			t.Errorf("%s should be checked, got %d", method, rr.Code)
		}
	}
}

func TestMethodsUnchecked(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		rr := run(t, Config{AllowedOrigins: []string{"example.com"}}, method, "/", "", "", "")
		if rr.Code != http.StatusOK {
			t.Errorf("%s should pass, got %d", method, rr.Code)
		}
	}
}

func TestMalformedOrigin(t *testing.T) {
	rr := run(t, Config{AllowedOrigins: []string{"example.com"}},
		http.MethodPost, "/api/x", "not a url", "", HeaderValue)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("malformed origin should be rejected, got %d", rr.Code)
	}
}
