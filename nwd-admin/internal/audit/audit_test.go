package audit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// containsFold is a tiny case-insensitive substring check. Used
// only by the in-memory fake repo to mimic the SQLite LIKE
// behavior the GORM implementation relies on.
func containsFold(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	if len(needle) > len(haystack) {
		return false
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			a := haystack[i+j]
			b := needle[j]
			if a >= 'A' && a <= 'Z' {
				a += 32
			}
			if b >= 'A' && b <= 'Z' {
				b += 32
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

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

func (r *fakeRepo) List(_ context.Context, q Query, limit, offset int) ([]Entry, error) {
	matched := r.filter(q)
	if offset >= len(matched) {
		return nil, nil
	}
	matched = matched[offset:]
	if limit > 0 && len(matched) > limit {
		matched = matched[:limit]
	}
	return matched, nil
}

func (r *fakeRepo) Count(_ context.Context, q Query) (int64, error) {
	return int64(len(r.filter(q))), nil
}

// filter returns a copy of the entries that match q, ordered by
// id descending (newest first) to mirror the GORM Order("id DESC").
func (r *fakeRepo) filter(q Query) []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Entry, 0, len(r.entries))
	for _, e := range r.entries {
		if q.Actor != "" && !containsFold(e.Actor, q.Actor) {
			continue
		}
		if q.Action != "" && e.Action != q.Action {
			continue
		}
		if q.Target != "" && !containsFold(e.Target, q.Target) {
			continue
		}
		if q.StatusMin > 0 && e.HTTPStatus < q.StatusMin {
			continue
		}
		if q.StatusMax > 0 && e.HTTPStatus > q.StatusMax {
			continue
		}
		if !q.From.IsZero() && e.CreatedAt.Before(q.From) {
			continue
		}
		if !q.To.IsZero() && e.CreatedAt.After(q.To) {
			continue
		}
		out = append(out, e)
	}
	// Newest first.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].ID > out[i].ID {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
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

	rows, _ := repo.List(context.Background(), Query{}, 10, 0)
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

	rows, _ := repo.List(context.Background(), Query{}, 10, 0)
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

	if rows, _ := repo.List(context.Background(), Query{}, 10, 0); len(rows) != 0 {
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

// ── Query filtering ────────────────────────────────────────────────

// seedFilterFixtures populates the fake repo with a known mix of
// entries so the filter tests have something deterministic to
// reason about. The "now" anchor is the current test time so
// relative age queries work regardless of when the test runs.
func seedFilterFixtures(t *testing.T, repo *fakeRepo) {
	t.Helper()
	now := time.Now()
	specs := []struct {
		actor, action, target string
		status                int
		age                   time.Duration
	}{
		{"admin", ActionUploadPlugin, "hello-world", 303, 0},
		{"admin", ActionDeletePlugin, "hello-world", 200, 24 * time.Hour},
		{"anonymous", ActionAuthFailure, "", 401, 2 * 24 * time.Hour},
		{"anonymous", ActionRateLimited, "", 429, 3 * 24 * time.Hour},
		{"admin", ActionListAuditLogs, "", 200, 4 * 24 * time.Hour},
	}
	for i, s := range specs {
		entry := Entry{
			CreatedAt:  now.Add(-s.age),
			Actor:      s.actor,
			Action:     s.action,
			Target:     s.target,
			HTTPStatus: s.status,
		}
		if err := repo.Insert(context.Background(), entry); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
}

func TestQueryActorSubstring(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	got, err := repo.List(context.Background(), Query{Actor: "anon"}, 100, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("got %d, want 2 (both anonymous entries)", len(got))
	}
	for _, e := range got {
		if e.Actor != "anonymous" {
			t.Errorf("unexpected actor %q in result", e.Actor)
		}
	}
}

func TestQueryActionExact(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	got, err := repo.List(context.Background(), Query{Action: ActionAuthFailure}, 100, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d, want 1", len(got))
	}
	if got[0].Action != ActionAuthFailure {
		t.Errorf("action = %q, want %q", got[0].Action, ActionAuthFailure)
	}
}

func TestQueryStatusRange(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	cases := []struct {
		min, max int
		want     int
	}{
		{400, 499, 2}, // 401 + 429
		{200, 299, 2}, // 200 (delete) + 200 (list)
		{300, 399, 1}, // 303 (upload)
		{500, 599, 0},
		{0, 0, 5},     // no filter
	}
	for _, c := range cases {
		got, _ := repo.List(context.Background(), Query{StatusMin: c.min, StatusMax: c.max}, 100, 0)
		if len(got) != c.want {
			t.Errorf("status %d-%d: got %d, want %d", c.min, c.max, len(got), c.want)
		}
	}
}

func TestQueryTargetSubstring(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	got, _ := repo.List(context.Background(), Query{Target: "hello"}, 100, 0)
	if len(got) != 2 {
		t.Errorf("got %d, want 2 (upload + delete target=hello-world)", len(got))
	}
}

func TestQueryTimeRange(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	// Only entries from the last 36 hours: upload (now) and
	// delete (24h ago).
	cutoff := time.Now().Add(-36 * time.Hour)
	got, _ := repo.List(context.Background(), Query{From: cutoff}, 100, 0)
	if len(got) != 2 {
		t.Errorf("got %d, want 2 entries within last 36h", len(got))
	}
}

func TestQueryCombines(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	got, _ := repo.List(context.Background(), Query{
		Actor: "admin",
		Action: ActionUploadPlugin,
	}, 100, 0)
	if len(got) != 1 {
		t.Fatalf("got %d, want 1 (admin+upload)", len(got))
	}
	if got[0].Action != ActionUploadPlugin || got[0].Actor != "admin" {
		t.Errorf("unexpected row %+v", got[0])
	}
}

func TestCountMatchesList(t *testing.T) {
	repo := &fakeRepo{}
	seedFilterFixtures(t, repo)
	queries := []Query{
		{},
		{Actor: "admin"},
		{Action: ActionAuthFailure},
		{StatusMin: 400, StatusMax: 499},
		{Target: "hello"},
	}
	for _, q := range queries {
		count, err := repo.Count(context.Background(), q)
		if err != nil {
			t.Fatalf("count: %v", err)
		}
		rows, _ := repo.List(context.Background(), q, 100, 0)
		if int64(len(rows)) != count {
			t.Errorf("query %+v: count=%d, list=%d", q, count, len(rows))
		}
	}
}

func TestQueryEncodeEmpty(t *testing.T) {
	if got := (Query{}).Encode(); got != "" {
		t.Errorf("empty query should encode to empty string, got %q", got)
	}
}

func TestQueryEncodeFields(t *testing.T) {
	q := Query{
		Actor:  "alice",
		Action: "upload_plugin",
		Target: "hello-world",
	}
	got := q.Encode()
	for _, want := range []string{"actor=alice", "action=upload_plugin", "target=hello-world"} {
		if !strings.Contains(got, want) {
			t.Errorf("Encode() = %q, missing %q", got, want)
		}
	}
}

func TestQueryEncodeStatusRange(t *testing.T) {
	cases := []struct {
		min, max int
		want     string
	}{
		{0, 0, ""},
		{401, 401, "status=401"},
		{400, 499, "status=4xx"},
		{200, 299, "status=2xx"},
		{100, 200, "status=100-200"},
	}
	for _, c := range cases {
		q := Query{StatusMin: c.min, StatusMax: c.max}
		got := q.Encode()
		if !strings.Contains(got, c.want) {
			t.Errorf("status %d-%d: Encode() = %q, want to contain %q", c.min, c.max, got, c.want)
		}
	}
}

func TestQueryWithPage(t *testing.T) {
	q := Query{Actor: "admin", Action: "upload_plugin"}
	got := q.WithPage(3, 50)
	for _, want := range []string{"actor=admin", "action=upload_plugin", "page=3", "size=50"} {
		if !strings.Contains(got, want) {
			t.Errorf("WithPage(3, 50) = %q, missing %q", got, want)
		}
	}
}

func TestQueryWithPageIgnoresZeroArgs(t *testing.T) {
	q := Query{Actor: "admin"}
	got := q.WithPage(0, 0)
	if !strings.Contains(got, "actor=admin") {
		t.Errorf("should still encode filter fields, got %q", got)
	}
	if strings.Contains(got, "page=") || strings.Contains(got, "size=") {
		t.Errorf("zero page/size should be omitted, got %q", got)
	}
}
