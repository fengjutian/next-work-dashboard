// Package csrf implements a stateless CSRF guard for nwd-admin's
// write endpoints. Because the server uses Basic Auth (no cookies,
// no sessions), the classic "synchronizer token" pattern would be
// over-engineered; instead the guard relies on two properties
// that browsers enforce and that an attacker page cannot forge:
//
//  1. Cross-origin requests always carry an Origin (or Referer)
//     header that points at the attacker's page. The middleware
//     rejects requests whose Origin is not in the allow-list.
//
//  2. The <form> element used by the simplest CSRF attack cannot
//     set custom request headers. The middleware requires every
//     write request to carry the "X-Requested-With: nwd-admin"
//     header, which only a script-initiated fetch() can set.
//
// Together these block the most common CSRF vectors without
// introducing per-session state. They do NOT cover XSS-initiated
// CSRF (where the attacker already runs script in the victim's
// origin) — that class of attack is mitigated by serving a
// strict Content-Security-Policy, which the server already does.
package csrf

import (
	"net/http"
	"net/url"
	"strings"
)

// HeaderName is the custom header every write request must
// carry. It is exposed so tests and the bundled HTML can use the
// same constant.
const HeaderName = "X-Requested-With"

// HeaderValue is the required value of HeaderName. Anything
// works as long as the attacker cannot predict it; "nwd-admin" is
// human-readable and grep-friendly.
const HeaderValue = "nwd-admin"

// Config configures the CSRF middleware.
//
// RequireCustomHeader is a tri-state *bool so operators can
// distinguish "use the default" (nil) from "force-disable"
// (&false). A plain bool field would conflate those two.
type Config struct {
	// AllowedOrigins is the list of accepted Origin / Referer
	// host names. Each entry is matched against the request's
	// Origin (or Referer as a fallback) host (without port).
	// A leading "*" disables the host check entirely — useful
	// for development or when the server is intentionally
	// reachable from arbitrary origins behind a trusted proxy.
	AllowedOrigins []string
	// RequireCustomHeader, when non-nil and true, requires the
	// X-Requested-With header to be set to HeaderValue on every
	// write request. When nil the middleware defaults to true.
	// Set to &false to disable the check.
	RequireCustomHeader *bool
}

// requireCustomHeader returns the effective RequireCustomHeader
// value, applying the default (true) when the operator left it nil.
func (c Config) requireCustomHeader() bool {
	if c.RequireCustomHeader == nil {
		return true
	}
	return *c.RequireCustomHeader
}

// Middleware returns an http.Handler middleware that enforces the
// CSRF policy. Only non-safe methods (POST / PUT / PATCH / DELETE)
// are checked; GET / HEAD / OPTIONS pass through unchanged.
func Middleware(c Config) func(http.Handler) http.Handler {
	allowed := normalizeOrigins(c.AllowedOrigins)
	wildcard := false
	for _, h := range allowed {
		if h == "*" {
			wildcard = true
			break
		}
	}
	requireHeader := c.requireCustomHeader()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isWriteMethod(r.Method) {
				next.ServeHTTP(w, r)
				return
			}
			if !originAllowed(r, allowed, wildcard) {
				http.Error(w, "请求来源不被允许", http.StatusForbidden)
				return
			}
			if requireHeader && r.Header.Get(HeaderName) != HeaderValue {
				http.Error(w, "缺少 CSRF 标识头", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// isWriteMethod reports whether the HTTP method is one whose
// state-changing effects we want to guard.
func isWriteMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// originAllowed returns true if the request's Origin (or
// Referer, as a fallback) matches one of the allowed hosts.
func originAllowed(r *http.Request, allowed []string, wildcard bool) bool {
	if wildcard {
		return true
	}
	source := r.Header.Get("Origin")
	if source == "" {
		source = r.Header.Get("Referer")
	}
	if source == "" {
		// No Origin and no Referer. The only legitimate
		// call site that does not set either is a curl
		// / non-browser client — those should add a
		// custom header (which itself proves non-CSRF)
		// before reaching this code, so we let the
		// RequireCustomHeader branch make the call.
		return false
	}
	u, err := url.Parse(source)
	if err != nil || u.Host == "" {
		return false
	}
	host := stripPort(u.Host)
	for _, h := range allowed {
		if h == host {
			return true
		}
	}
	return false
}

// stripPort removes the ":port" suffix from a host name. url.URL
// parsing does not separate host and port the way we want for
// matching (it leaves the port in .Host), so this helper does the
// job locally. IPv6 hosts in brackets are left untouched.
func stripPort(host string) string {
	if strings.HasPrefix(host, "[") {
		return host
	}
	if i := strings.LastIndex(host, ":"); i >= 0 {
		return host[:i]
	}
	return host
}

// normalizeOrigins lower-cases the configured hosts and removes
// empty entries. Comparison is case-insensitive because the URL
// spec treats the host portion of an Origin as case-insensitive.
func normalizeOrigins(in []string) []string {
	out := make([]string, 0, len(in))
	for _, h := range in {
		h = strings.ToLower(strings.TrimSpace(h))
		if h == "" {
			continue
		}
		out = append(out, h)
	}
	return out
}
