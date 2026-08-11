package handler

import (
	"net/http/httptest"
	"testing"
	"time"
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
