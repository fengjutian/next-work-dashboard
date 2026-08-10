// Package server wires the HTTP router for nwd-admin.
//
// Extracted from main.go so the route layout (and the exact
// placement of the auth middleware) can be exercised by integration
// tests without standing up a real listener.
package server

import (
	"net/http"

	"github.com/fjutian/nwd-admin/internal/auth"
	"github.com/fjutian/nwd-admin/internal/handler"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

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
//
// The verifier is optional; when nil, the service runs in
// trusted-local mode and write endpoints are unprotected.
func NewRouter(h *handler.Handler, verifier *auth.Verifier) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(securityHeaders)

	r.Get("/", h.HomePage)
	r.Get("/plugins", h.PluginsPage)
	r.Get("/api/plugins", h.ListPlugins)
	r.Get("/api/plugins/{id}/download", h.DownloadPlugin)

	r.Group(func(r chi.Router) {
		if verifier != nil {
			r.Use(verifier.Middleware)
		}
		r.Post("/api/plugins", h.UploadPlugin)
		r.Delete("/api/plugins/{id}", h.DeletePlugin)
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
