// Package audit records security-relevant events for nwd-admin.
//
// Every request that hits a write endpoint, or that fails
// authentication or rate limiting, leaves a row in the audit_logs
// table. The rows are queryable through the admin-only
// /api/audit-logs endpoint and rendered on the /audit page.
//
// The package exposes a Recorder that wraps http.Handler to capture
// status code and duration, and an Entry repository backed by GORM.
package audit

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"gorm.io/gorm"
)

// Action names emitted by the recorder. Kept as constants so the
// admin UI can render stable labels and tests can assert on them.
const (
	ActionUploadPlugin   = "upload_plugin"
	ActionDeletePlugin   = "delete_plugin"
	ActionListAuditLogs  = "list_audit_logs"
	ActionAuthFailure    = "auth_failure"
	ActionRateLimited    = "rate_limited"
	ActionUnknownWrite   = "unknown_write"
)

// ctxKey is unexported so external packages must use WithActor
// rather than touching the context directly.
type ctxKey struct{}

// WithActor returns a derived context carrying the authenticated
// username. The auth middleware calls this on successful Basic Auth
// so the audit recorder can stamp the actor on the resulting row.
func WithActor(ctx context.Context, username string) context.Context {
	return context.WithValue(ctx, ctxKey{}, username)
}

// ActorFromContext returns the username previously set with
// WithActor, or "" if none.
func ActorFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

// Entry mirrors model.AuditLog; the duplication keeps the audit
// package decoupled from the persistence layer's GORM tags.
type Entry struct {
	ID         uint64
	CreatedAt  time.Time
	Actor      string
	ActorIP    string
	Action     string
	Target     string
	HTTPMethod string
	HTTPPath   string
	HTTPStatus int
	UserAgent  string
	DurationMS int64
	Message    string
}

// Repository persists audit entries.
type Repository interface {
	Insert(ctx context.Context, e Entry) error
	List(ctx context.Context, limit, offset int) ([]Entry, error)
	Count(ctx context.Context) (int64, error)
	Prune(ctx context.Context, olderThan time.Time) (int64, error)
}

// GormRepository is the GORM-backed Repository implementation.
type GormRepository struct {
	db *gorm.DB
}

// NewGormRepository wraps an open GORM handle. The caller is
// responsible for running AutoMigrate before issuing queries.
func NewGormRepository(db *gorm.DB) *GormRepository {
	return &GormRepository{db: db}
}

func (r *GormRepository) Insert(ctx context.Context, e Entry) error {
	row := model.AuditLog{
		Actor:      e.Actor,
		ActorIP:    e.ActorIP,
		Action:     e.Action,
		Target:     e.Target,
		HTTPMethod: e.HTTPMethod,
		HTTPPath:   e.HTTPPath,
		HTTPStatus: e.HTTPStatus,
		UserAgent:  e.UserAgent,
		DurationMS: e.DurationMS,
		Message:    e.Message,
	}
	return r.db.WithContext(ctx).Create(&row).Error
}

func (r *GormRepository) List(ctx context.Context, limit, offset int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	var rows []model.AuditLog
	if err := r.db.WithContext(ctx).Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(rows))
	for _, row := range rows {
		out = append(out, entryFromModel(row))
	}
	return out, nil
}

func (r *GormRepository) Count(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.AuditLog{}).Count(&n).Error
	return n, err
}

func (r *GormRepository) Prune(ctx context.Context, olderThan time.Time) (int64, error) {
	res := r.db.WithContext(ctx).Where("created_at < ?", olderThan).Delete(&model.AuditLog{})
	return res.RowsAffected, res.Error
}

func entryFromModel(row model.AuditLog) Entry {
	return Entry{
		ID:         row.ID,
		CreatedAt:  row.CreatedAt,
		Actor:      row.Actor,
		ActorIP:    row.ActorIP,
		Action:     row.Action,
		Target:     row.Target,
		HTTPMethod: row.HTTPMethod,
		HTTPPath:   row.HTTPPath,
		HTTPStatus: row.HTTPStatus,
		UserAgent:  row.UserAgent,
		DurationMS: row.DurationMS,
		Message:    row.Message,
	}
}

// Recorder is an http.Handler middleware that records a single
// audit entry per request, derived from the request outcome.
type Recorder struct {
	repo     Repository
	now      func() time.Time
	disabled bool
}

// NewRecorder wires a Recorder around a Repository. When disabled
// is true the middleware is a pass-through and Insert is never
// called.
func NewRecorder(repo Repository, disabled bool) *Recorder {
	return &Recorder{repo: repo, now: time.Now, disabled: disabled}
}

// SetNow overrides the clock for tests.
func (r *Recorder) SetNow(f func() time.Time) { r.now = f }

// Middleware returns an http.Handler middleware. It captures the
// downstream status code, derives an action label, and writes a
// single audit row on completion.
func (r *Recorder) Middleware(next http.Handler) http.Handler {
	if r.disabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		start := r.now()
		ww := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(ww, req)

		entry := Entry{
			CreatedAt:  r.now(),
			Actor:      actorOrAnonymous(req),
			ActorIP:    clientIP(req),
			Action:     deriveAction(req, ww.status),
			Target:     extractTarget(req),
			HTTPMethod: req.Method,
			HTTPPath:   req.URL.Path,
			HTTPStatus: ww.status,
			UserAgent:  req.UserAgent(),
			DurationMS: r.now().Sub(start).Milliseconds(),
			Message:    deriveMessage(req, ww.status),
		}
		if err := r.repo.Insert(req.Context(), entry); err != nil {
			slog.Error("audit insert failed",
				"action", entry.Action,
				"status", entry.HTTPStatus,
				"err", err,
			)
		}
	})
}

// actorOrAnonymous returns the authenticated username stamped on
// the context by the auth middleware, or "anonymous" if none.
func actorOrAnonymous(req *http.Request) string {
	if name := ActorFromContext(req.Context()); name != "" {
		return name
	}
	return "anonymous"
}

// clientIP duplicates the heuristic in the ratelimit package on
// purpose: keeping the audit column independent of that package
// means audit remains correct if a future refactor swaps the
// limiter for something else.
func clientIP(req *http.Request) string {
	host, _, err := splitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

func deriveAction(req *http.Request, status int) string {
	if status == http.StatusUnauthorized {
		return ActionAuthFailure
	}
	if status == http.StatusTooManyRequests {
		return ActionRateLimited
	}
	method := strings.ToUpper(req.Method)
	path := req.URL.Path
	isDownloadPath := strings.HasSuffix(path, "/download")

	switch {
	case method == http.MethodPost && path == "/api/plugins":
		return ActionUploadPlugin
	case method == http.MethodDelete && strings.HasPrefix(path, "/api/plugins/") && !isDownloadPath:
		return ActionDeletePlugin
	case method == http.MethodGet && path == "/api/audit-logs":
		return ActionListAuditLogs
	case (method == http.MethodPost || method == http.MethodDelete || method == http.MethodPut || method == http.MethodPatch) && !isDownloadPath:
		return ActionUnknownWrite
	}
	return ""
}

func extractTarget(req *http.Request) string {
	// /api/plugins/{id} and /api/plugins/{id}/download
	const pluginsPrefix = "/api/plugins/"
	if !strings.HasPrefix(req.URL.Path, pluginsPrefix) {
		return ""
	}
	rest := strings.TrimPrefix(req.URL.Path, pluginsPrefix)
	if rest == "" {
		return ""
	}
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		return rest[:i]
	}
	return rest
}

func deriveMessage(req *http.Request, status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "missing or invalid credentials"
	case http.StatusTooManyRequests:
		return "rate limit exceeded"
	case http.StatusBadRequest:
		return "bad request"
	}
	return ""
}

// statusWriter is a tiny http.ResponseWriter wrapper that records
// the status code so the audit middleware can persist it.
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  atomic.Bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wrote.Swap(true) {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote.Swap(true) && w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}
