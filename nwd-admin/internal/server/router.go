// Package server wires the HTTP router for nwd-admin.
//
// Extracted from main.go so the route layout (and the exact
// placement of auth, rate limit, audit, and CSRF middlewares)
// can be exercised by integration tests without standing up a
// real listener.
package server

import (
	"net/http"

	"github.com/fjutian/nwd-admin/internal/audit"
	"github.com/fjutian/nwd-admin/internal/auth"
	"github.com/fjutian/nwd-admin/internal/csrf"
	"github.com/fjutian/nwd-admin/internal/handler"
	"github.com/fjutian/nwd-admin/internal/ratelimit"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Options bundles every middleware factory the router needs.
// Each field is optional; nil values are treated as no-op.
type Options struct {
	Verifier    *auth.Verifier
	ReadLimit   *ratelimit.Limiter
	WriteLimit  *ratelimit.Limiter
	AdminLimit  *ratelimit.Limiter
	Recorder    *audit.Recorder
	CSRF        csrf.Config
	CSRFEnabled bool
}

// NewRouter builds the application HTTP handler.
//
// Public routes (no auth required):
//   - GET  /                                  landing page
//   - GET  /plugins                           admin UI
//   - GET  /api/plugins                       plugin list JSON
//   - GET  /api/plugins/{id}/download         download a bundle
//
// Admin routes (require Basic auth when a verifier is configured):
//   - POST   /api/plugins                     upload
//   - DELETE /api/plugins/{id}                delete
//   - GET    /audit                           audit log page
//   - GET    /api/audit-logs                  audit log JSON
func NewRouter(h *handler.Handler, opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(securityHeaders)

	// Public read endpoints. Recorder is global so it captures
	// status / duration regardless of which middleware short-
	// circuits later in the chain.
	if opts.Recorder != nil {
		r.Use(opts.Recorder.Middleware)
	}
	if opts.ReadLimit != nil {
		r.Use(opts.ReadLimit.Middleware)
	}
	r.Get("/", h.HomePage)
	r.Get("/plugins", h.PluginsPage)
	r.Get("/api/plugins", h.ListPlugins)
	r.Get("/api/plugins/{id}/download", h.DownloadPlugin)
	r.Get("/api/plugins/{id}/versions", h.ListPluginVersions)

	// Write endpoints: stricter per-IP throttling, CSRF guard,
	// and admin auth. The CSRF middleware is the outermost
	// gate so the rate limiter cannot be used to flood the
	// origin check with lookups from a hostile origin.
	//
	// CSRFEnabled is computed by the caller (main.go) because
	// the disable flag lives on config.CSRFConfig, not on the
	// runtime csrf.Config.
	if opts.CSRFEnabled {
		r.Group(func(r chi.Router) {
			r.Use(csrf.Middleware(opts.CSRF))
			if opts.WriteLimit != nil {
				r.Use(opts.WriteLimit.Middleware)
			}
			if opts.Verifier != nil {
				r.Use(opts.Verifier.Middleware)
			}
			r.Post("/api/plugins", h.UploadPlugin)
			r.Delete("/api/plugins/{id}", h.DeletePlugin)
		})
	} else {
		r.Group(func(r chi.Router) {
			if opts.WriteLimit != nil {
				r.Use(opts.WriteLimit.Middleware)
			}
			if opts.Verifier != nil {
				r.Use(opts.Verifier.Middleware)
			}
			r.Post("/api/plugins", h.UploadPlugin)
			r.Delete("/api/plugins/{id}", h.DeletePlugin)
		})
	}

	// Admin UI surface (audit log viewing). Requires admin auth
	// like the write endpoints, with its own per-IP bucket so a
	// busy admin tab cannot starve the write path.
	r.Group(func(r chi.Router) {
		if opts.AdminLimit != nil {
			r.Use(opts.AdminLimit.Middleware)
		}
		if opts.Verifier != nil {
			r.Use(opts.Verifier.Middleware)
		}
		r.Get("/audit", h.AuditPage)
		r.Get("/api/audit-logs", h.ListAuditLogs)
	})

	return r
}

// securityHeaders adds defensive HTTP response headers to every
// response. These protect against common browser-side attacks; they
// do not replace authentication.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'")
		h.Set("Permissions-Policy", "interest-cohort=()")
		next.ServeHTTP(w, r)
	})
}
