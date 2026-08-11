package handler

import (
	"bytes"
	"context"
	"encoding/csv"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fjutian/nwd-admin/internal/audit"
)

func TestParseAuditQueryEmpty(t *testing.T) {
	req := httptest.NewRequest("GET", "/audit", nil)
	q := parseAuditQuery(req)
	if q.Actor != "" || q.Action != "" || q.Target != "" {
		t.Errorf("expected empty query, got %+v", q)
	}
	if q.StatusMin != 0 || q.StatusMax != 0 {
		t.Errorf("status range should be zero, got %d-%d", q.StatusMin, q.StatusMax)
	}
	if !q.From.IsZero() || !q.To.IsZero() {
		t.Errorf("times should be zero, got from=%v to=%v", q.From, q.To)
	}
}

func TestParseAuditQueryFields(t *testing.T) {
	req := httptest.NewRequest("GET", "/audit?actor=alice&action=upload_plugin&target=hello", nil)
	q := parseAuditQuery(req)
	if q.Actor != "alice" {
		t.Errorf("Actor = %q, want alice", q.Actor)
	}
	if q.Action != "upload_plugin" {
		t.Errorf("Action = %q", q.Action)
	}
	if q.Target != "hello" {
		t.Errorf("Target = %q", q.Target)
	}
}

func TestParseStatusRangeExact(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
	}{
		{"401", 401, 401},
		{"200", 200, 200},
		{"0", 0, 0},
	}
	for _, c := range cases {
		mn, mx := parseStatusRange(c.in)
		if mn != c.min || mx != c.max {
			t.Errorf("parseStatusRange(%q) = (%d, %d), want (%d, %d)", c.in, mn, mx, c.min, c.max)
		}
	}
}

func TestParseStatusRangeXXClass(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
	}{
		{"1xx", 100, 199},
		{"2xx", 200, 299},
		{"3xx", 300, 399},
		{"4xx", 400, 499},
		{"5xx", 500, 599},
		{"6xx", 0, 0}, // 6xx+ are not HTTP status classes
	}
	for _, c := range cases {
		mn, mx := parseStatusRange(c.in)
		if mn != c.min || mx != c.max {
			t.Errorf("parseStatusRange(%q) = (%d, %d), want (%d, %d)", c.in, mn, mx, c.min, c.max)
		}
	}
}

func TestParseStatusRangeInterval(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
	}{
		{"200-299", 200, 299},
		{"400-499", 400, 499},
		{"100-200", 100, 200},
		{"abc-xyz", 0, 0}, // invalid
	}
	for _, c := range cases {
		mn, mx := parseStatusRange(c.in)
		if mn != c.min || mx != c.max {
			t.Errorf("parseStatusRange(%q) = (%d, %d), want (%d, %d)", c.in, mn, mx, c.min, c.max)
		}
	}
}

func TestParseStatusRangeEmpty(t *testing.T) {
	if mn, mx := parseStatusRange(""); mn != 0 || mx != 0 {
		t.Errorf("empty range should yield zeros, got (%d, %d)", mn, mx)
	}
}

func TestParseTimeOrDate(t *testing.T) {
	now, ok := parseTimeOrDate("2026-08-11T10:00:00Z")
	if !ok {
		t.Fatal("RFC3339 should parse")
	}
	expected := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	if !now.Equal(expected) {
		t.Errorf("RFC3339: got %v, want %v", now, expected)
	}

	day, ok := parseTimeOrDate("2026-08-11")
	if !ok {
		t.Fatal("YYYY-MM-DD should parse")
	}
	// YYYY-MM-DD is parsed as the start of the day (UTC midnight),
	// not as 10:00 — the time portion is intentionally absent.
	dayStart := time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC)
	if !day.Equal(dayStart) {
		t.Errorf("date: got %v, want %v", day, dayStart)
	}

	if _, ok := parseTimeOrDate("not a date"); ok {
		t.Error("garbage should not parse")
	}
}

func TestParseAuditQueryCombined(t *testing.T) {
	req := httptest.NewRequest("GET",
		"/audit?actor=alice&action=upload_plugin&status=4xx&from=2026-08-01&to=2026-08-11", nil)
	q := parseAuditQuery(req)
	if q.Actor != "alice" || q.Action != "upload_plugin" {
		t.Errorf("text fields wrong: %+v", q)
	}
	if q.StatusMin != 400 || q.StatusMax != 499 {
		t.Errorf("status range: %d-%d", q.StatusMin, q.StatusMax)
	}
	if q.From.IsZero() || q.To.IsZero() {
		t.Errorf("times should be set: from=%v to=%v", q.From, q.To)
	}
}

func TestKnownActionsList(t *testing.T) {
	actions := knownActions()
	if len(actions) == 0 {
		t.Fatal("knownActions should not be empty")
	}
	seen := map[string]bool{}
	for _, a := range actions {
		if seen[a] {
			t.Errorf("duplicate action %q", a)
		}
		seen[a] = true
	}
	// Sanity: the canonical actions should all be there.
	for _, want := range []string{"upload_plugin", "delete_plugin", "auth_failure", "rate_limited"} {
		if !seen[want] {
			t.Errorf("knownActions missing %q", want)
		}
	}
}

// ── CSV export ──────────────────────────────────────────────────────

// csvRepo is a minimal in-memory audit.Repository used to feed
// the export handler without dragging SQLite + CGO into the
// handler unit tests.
type csvRepo struct {
	mu      sync.Mutex
	entries []audit.Entry
}

func (r *csvRepo) Insert(_ context.Context, e audit.Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, e)
	return nil
}

func (r *csvRepo) List(_ context.Context, q audit.Query, limit, offset int) ([]audit.Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	matched := make([]audit.Entry, 0, len(r.entries))
	for _, e := range r.entries {
		if q.Action != "" && e.Action != q.Action {
			continue
		}
		if q.Actor != "" && !strings.Contains(strings.ToLower(e.Actor), strings.ToLower(q.Actor)) {
			continue
		}
		matched = append(matched, e)
	}
	// Mirror the GORM implementation: newest first by id.
	for i := 0; i < len(matched); i++ {
		for j := i + 1; j < len(matched); j++ {
			if matched[j].ID > matched[i].ID {
				matched[i], matched[j] = matched[j], matched[i]
			}
		}
	}
	if offset >= len(matched) {
		return nil, nil
	}
	matched = matched[offset:]
	if limit > 0 && len(matched) > limit {
		matched = matched[:limit]
	}
	return matched, nil
}

func (r *csvRepo) Count(_ context.Context, _ audit.Query) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return int64(len(r.entries)), nil
}

func (r *csvRepo) Prune(_ context.Context, _ time.Time) (int64, error) { return 0, nil }

func newHandlerWithAudit(t *testing.T, repo audit.Repository) *Handler {
	t.Helper()
	return &Handler{audits: repo}
}

func TestExportAuditCSVFormatDetection(t *testing.T) {
	repo := &csvRepo{}
	h := newHandlerWithAudit(t, repo)
	req := httptest.NewRequest("GET", "/api/audit-logs?format=csv", nil)
	rr := httptest.NewRecorder()
	h.ListAuditLogs(rr, req)
	if got := rr.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/csv") {
		t.Errorf("Content-Type = %q, want text/csv...", got)
	}
	if got := rr.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
		t.Errorf("Content-Disposition = %q, want attachment", got)
	}
	if !strings.Contains(rr.Header().Get("Content-Disposition"), "audit-logs-") {
		t.Errorf("Content-Disposition should include filename, got %q", rr.Header().Get("Content-Disposition"))
	}
}

func TestExportAuditCSVHeaderAndRows(t *testing.T) {
	repo := &csvRepo{}
	now := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	for i, e := range []audit.Entry{
		{CreatedAt: now, Actor: "admin", ActorIP: "127.0.0.1", Action: audit.ActionUploadPlugin, Target: "hello", HTTPStatus: 303, HTTPMethod: "POST", HTTPPath: "/api/plugins", UserAgent: "curl/8", DurationMS: 12, Message: ""},
		{CreatedAt: now.Add(time.Second), Actor: "anonymous", ActorIP: "1.1.1.1", Action: audit.ActionAuthFailure, Target: "", HTTPStatus: 401, HTTPMethod: "POST", HTTPPath: "/api/plugins", UserAgent: "curl/8", DurationMS: 5, Message: "bad"},
	} {
		e.ID = uint64(i + 1)
		if err := repo.Insert(context.Background(), e); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}

	h := newHandlerWithAudit(t, repo)
	req := httptest.NewRequest("GET", "/api/audit-logs?format=csv", nil)
	rr := httptest.NewRecorder()
	h.ListAuditLogs(rr, req)

	reader := csv.NewReader(bytes.NewReader(rr.Body.Bytes()))
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	if len(rows) < 3 {
		t.Fatalf("rows = %d, want >=3 (header + 2 entries)", len(rows))
	}
	wantHeader := []string{"id", "created_at", "actor", "actor_ip", "action", "target", "http_method", "http_path", "http_status", "user_agent", "duration_ms", "message"}
	if !equalStringSlice(rows[0], wantHeader) {
		t.Errorf("header row = %v, want %v", rows[0], wantHeader)
	}
	// First data row is the most recent (DESC order from
	// audit.List). The auth failure is newer, so check that.
	authRow := rows[1]
	if authRow[2] != "anonymous" || authRow[4] != audit.ActionAuthFailure || authRow[8] != "401" {
		t.Errorf("first data row = %v, expected anonymous+auth_failure+401", authRow)
	}
}

func TestExportAuditCSVRespectsFilter(t *testing.T) {
	repo := &csvRepo{}
	for i, e := range []audit.Entry{
		{Actor: "admin", Action: audit.ActionUploadPlugin, HTTPStatus: 200},
		{Actor: "admin", Action: audit.ActionDeletePlugin, HTTPStatus: 200},
		{Actor: "anonymous", Action: audit.ActionAuthFailure, HTTPStatus: 401},
	} {
		e.ID = uint64(i + 1)
		if err := repo.Insert(context.Background(), e); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}

	h := newHandlerWithAudit(t, repo)
	req := httptest.NewRequest("GET", "/api/audit-logs?format=csv&action=auth_failure", nil)
	rr := httptest.NewRecorder()
	h.ListAuditLogs(rr, req)

	reader := csv.NewReader(bytes.NewReader(rr.Body.Bytes()))
	rows, _ := reader.ReadAll()
	// header + 1 matching row.
	if len(rows) != 2 {
		t.Errorf("rows = %d, want 2 (header + 1 auth_failure)", len(rows))
	}
}

func equalStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
