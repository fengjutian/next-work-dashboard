package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

// requestFromIP is a small builder so tests that want to
// exercise the per-IP path don't have to repeat the same six
// lines of httptest setup.
func requestFromIP(ip string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = ip + ":1234"
	return r
}

func TestPolicyEnabled(t *testing.T) {
	cases := []struct {
		p    Policy
		want bool
	}{
		{Policy{}, false},
		{Policy{Rate: 1}, false},
		{Policy{Burst: 1}, false},
		{Policy{Rate: 1, Burst: 1}, true},
		{Policy{Rate: 5, Burst: 10}, true},
	}
	for _, c := range cases {
		if got := c.p.Enabled(); got != c.want {
			t.Errorf("Policy%+v.Enabled = %v, want %v", c.p, got, c.want)
		}
	}
}

func TestPolicyWithDefaultsFillsBurst(t *testing.T) {
	p := Policy{Rate: 2}.WithDefaults()
	if p.Burst != 5 {
		t.Errorf("Burst = %d, want 5", p.Burst)
	}
	if p.IdleTTL != 10*time.Minute {
		t.Errorf("IdleTTL = %v, want 10m", p.IdleTTL)
	}
}

func TestLimiterAllowsBurstThenRejects(t *testing.T) {
	l := New(Policy{Rate: 1, Burst: 2})
	req := requestFromIP("1.2.3.4")
	// 2 calls in a row should pass.
	for i := 0; i < 2; i++ {
		if !l.allow(req) {
			t.Fatalf("call %d should have been allowed", i+1)
		}
	}
	// 3rd call (no time elapsed) should be rejected.
	if l.allow(req) {
		t.Fatal("3rd call should have been rejected")
	}
}

func TestLimiterPerIPIsolation(t *testing.T) {
	l := New(Policy{Rate: 1, Burst: 1})
	if !l.allow(requestFromIP("1.1.1.1")) {
		t.Fatal("first IP should pass")
	}
	if !l.allow(requestFromIP("2.2.2.2")) {
		t.Fatal("second IP should pass (separate bucket)")
	}
	if l.allow(requestFromIP("1.1.1.1")) {
		t.Fatal("first IP second call should fail")
	}
}

func TestLimiterReapsIdleBuckets(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := New(Policy{Rate: 1, Burst: 1, IdleTTL: time.Minute})
	l.now = func() time.Time { return now }

	l.allow(requestFromIP("1.1.1.1"))
	if got := len(l.buckets); got != 1 {
		t.Fatalf("buckets after first call = %d, want 1", got)
	}

	// Advance virtual time past the TTL, then explicitly trigger
	// the reaper. Production code only reaps opportunistically
	// past a bucket-count threshold, so the test reaches in
	// directly to verify the reaper logic.
	l.now = func() time.Time { return now.Add(2 * time.Minute) }
	l.Reap()

	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.buckets["1.1.1.1"]; ok {
		t.Fatal("idle bucket should have been reaped")
	}
}

func TestMiddlewareDisabledIsNoop(t *testing.T) {
	called := false
	h := New(Policy{}).Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))

	if !called {
		t.Fatal("disabled limiter should pass through")
	}
}

func TestMiddlewareRejectsWith429(t *testing.T) {
	called := 0
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	})
	h := New(Policy{Rate: 1, Burst: 1}).Middleware(handler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "9.9.9.9:1234"

	// First call passes.
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first call: want 200, got %d", rr.Code)
	}

	// Second call rejected.
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("second call: want 429, got %d", rr.Code)
	}
	if ra := rr.Header().Get("Retry-After"); ra != "1" {
		t.Errorf("Retry-After = %q, want 1", ra)
	}
	if called != 1 {
		t.Errorf("downstream called %d times, want 1", called)
	}
}

func TestClientIPHonorsXFFFromLoopback(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	req.Header.Set("X-Forwarded-For", "8.8.8.8, 1.1.1.1")
	if got := clientIP(req); got != "8.8.8.8" {
		t.Errorf("trusted proxy: got %q, want 8.8.8.8", got)
	}
}

func TestClientIPIgnoresXFFFromExternal(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "8.8.8.8:5555"
	req.Header.Set("X-Forwarded-For", "127.0.0.1")
	if got := clientIP(req); got != "8.8.8.8" {
		t.Errorf("untrusted XFF must be ignored: got %q", got)
	}
}

func TestClientIPFallbackToRemoteAddr(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:3333"
	if got := clientIP(req); got != "10.0.0.5" {
		t.Errorf("got %q, want 10.0.0.5", got)
	}
}

func TestRetryAfterIsAtLeastOne(t *testing.T) {
	// 0.5 req/s should still emit Retry-After >= 1 to satisfy
	// the HTTP spec (Retry-After in seconds, integer).
	h := New(Policy{Rate: 0.5, Burst: 1}).Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "5.5.5.5:0"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first call: want 200, got %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if ra, _ := strconv.Atoi(rr.Header().Get("Retry-After")); ra < 1 {
		t.Errorf("Retry-After must be >= 1, got %d", ra)
	}
}

// ── Custom KeyFunc ────────────────────────────────────────────────

func TestCustomKeySeparatesBuckets(t *testing.T) {
	constantKey := "tenant-1"
	l := NewWithKey(Policy{Rate: 1, Burst: 1}, func(*http.Request) string { return constantKey })

	// Two requests with different IPs but the same key should
	// share a single bucket.
	if !l.allow(requestFromIP("1.1.1.1")) {
		t.Fatal("first call should pass")
	}
	if l.allow(requestFromIP("2.2.2.2")) {
		t.Fatal("second call from different IP but same key should hit the same bucket")
	}
}

func TestNilKeyFallsBackToIP(t *testing.T) {
	l := NewWithKey(Policy{Rate: 1, Burst: 1}, nil)
	if !l.allow(requestFromIP("1.1.1.1")) {
		t.Fatal("first IP should pass with default IP key")
	}
	if l.allow(requestFromIP("1.1.1.1")) {
		t.Fatal("same IP should hit the same default bucket")
	}
	if !l.allow(requestFromIP("2.2.2.2")) {
		t.Fatal("different IP should hit its own bucket (with its own fresh burst)")
	}
}
