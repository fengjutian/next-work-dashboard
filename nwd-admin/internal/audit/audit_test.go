package audit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// fakeRepo is an in-memory Repository for tests. Safe for
// concurrent use so the middleware tests can run in parallel.
type fakeRepo struct {
	mu      sync.Mutex
	entries []Entry
	next    uint64
}

func (r *fakeRepo) Insert(_ context.Context, e Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.next++
	e.ID = r.next
	r.entries = append(r.entries, e)
	return nil
}

func (r *fakeRepo) List(_ context.Context, limit, offset int) ([]Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rows := append([]Entry(nil), r.entries...)
	if offset >= len(rows) {
		return nil, nil
	}
	rows = rows[offset:]
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func (r *fakeRepo) Count(_ context.Context) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return int64(len(r.entries)), nil
}

func (r *fakeRepo) Prune(_ context.Context, olderThan time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	kept := r.entries[:0]
	var removed int64
	for _, e := range r.entries {
		if e.CreatedAt.Before(olderThan) {
			removed++
			continue
		}
		kept = append(kept, e)
	}
	r.entries = kept
	return removed, nil
}

func newRequest(method, path, remoteAddr string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	r.RemoteAddr = remoteAddr
	return r
}

func TestWithActorRoundTrip(t *testing.T) {
	ctx := WithActor(context.Background(), "alice")
	if got := ActorFromContext(ctx); got != "alice" {
		t.Errorf("ActorFromContext = %q, want alice", got)
	}
	if got := ActorFromContext(context.Background()); got != "" {
		t.Errorf("missing actor should yield empty string, got %q", got)
	}
}

func TestDeriveAction(t *testing.T) {
	cases := []struct {
		method, path string
		status       int
		want         string
	}{
		{http.MethodPost, "/api/plugins", 303, ActionUploadPlugin},
		{http.MethodDelete, "/api/plugins/foo", 200, ActionDeletePlugin},
		{http.MethodDelete, "/api/plugins/foo/download", 200, ""},
		{http.MethodGet, "/api/audit-logs", 200, ActionListAuditLogs},
		{http.MethodGet, "/api/plugins", 200, ""},
		{http.MethodPost, "/api/plugins", 401, ActionAuthFailure},
		{http.MethodPost, "/api/plugins", 429, ActionRateLimited},
		{http.MethodPost, "/api/plugins", 400, ActionUploadPlugin},
		{http.MethodPut, "/api/things", 200, ActionUnknownWrite},
	}
	for _, c := range cases {
		req := newRequest(c.method, c.path, "1.2.3.4:0")
		got := deriveAction(req, c.status)
		if got != c.want {
			t.Errorf("deriveAction(%s %s, %d) = %q, want %q", c.method, c.path, c.status, got, c.want)
		}
	}
}

func TestExtractTarget(t *testing.T) {
	cases := []struct {
		path, want string
	}{
		{"/api/plugins/foo", "foo"},
		{"/api/plugins/foo/download", "foo"},
		{"/api/plugins", ""},
		{"/api/audit-logs", ""},
		{"/", ""},
	}
	for _, c := range cases {
		req := newRequest(http.MethodGet, c.path, "")
		if got := extractTarget(req); got != c.want {
			t.Errorf("extractTarget(%s) = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestRecorderRecordsSuccessfulRequest(t *testing.T) {
	repo := &fakeRepo{}
	rec := NewRecorder(repo, false)
	now := time.Unix(1_700_000_000, 0)
	rec.now = func() time.Time { return now }

	handler := rec.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := newRequest(http.MethodPost, "/api/plugins", "10.0.0.1:1234")
	req = req.WithContext(WithActor(req.Context(), "admin"))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	rows, _ := repo.List(context.Background(), 10, 0)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	got := rows[0]
	if got.Actor != "admin" {
		t.Errorf("Actor = %q, want admin", got.Actor)
	}
	if got.Action != ActionUploadPlugin {
		t.Errorf("Action = %q, want %q", got.Action, ActionUploadPlugin)
	}
	if got.HTTPStatus != 200 {
		t.Errorf("HTTPStatus = %d, want 200", got.HTTPStatus)
	}
	if got.ActorIP != "10.0.0.1" {
		t.Errorf("ActorIP = %q, want 10.0.0.1", got.ActorIP)
	}
}

func TestRecorderMarksAnonymousOn401(t *testing.T) {
	repo := &fakeRepo{}
	rec := NewRecorder(repo, false)
	handler := rec.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusUnauthorized)
	}))

	req := newRequest(http.MethodPost, "/api/plugins", "10.0.0.1:1234")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	rows, _ := repo.List(context.Background(), 10, 0)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].Actor != "anonymous" {
		t.Errorf("Actor = %q, want anonymous", rows[0].Actor)
	}
	if rows[0].Action != ActionAuthFailure {
		t.Errorf("Action = %q, want %q", rows[0].Action, ActionAuthFailure)
	}
}

func TestRecorderDisabledIsNoop(t *testing.T) {
	repo := &fakeRepo{}
	rec := NewRecorder(repo, true)
	handler := rec.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := newRequest(http.MethodPost, "/api/plugins", "1.1.1.1:0")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rows, _ := repo.List(context.Background(), 10, 0); len(rows) != 0 {
		t.Errorf("disabled recorder should not write rows, got %d", len(rows))
	}
}

func TestStatusWriterOnlyFirstWins(t *testing.T) {
	rr := httptest.NewRecorder()
	w := &statusWriter{ResponseWriter: rr, status: 0}
	w.WriteHeader(200)
	w.WriteHeader(500)
	if w.status != 200 {
		t.Errorf("status = %d, want 200 (first WriteHeader wins)", w.status)
	}
}
