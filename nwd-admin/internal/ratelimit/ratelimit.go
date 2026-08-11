// Package ratelimit provides per-client token-bucket rate
// limiting for nwd-admin HTTP endpoints.
//
// The Limiter is built on top of golang.org/x/time/rate and
// keeps a separate bucket per client key. The default key is
// the request's IP (extracted with the same loopback-only
// X-Forwarded-For rule as before), but operators that want to
// limit by authenticated user can supply a custom KeyFunc
// that returns the username once auth has stamped the context.
//
// The package exposes:
//
//   - Limiter.Middleware — generic middleware that drops
//     requests returning HTTP 429 with a Retry-After header.
//   - KeyFunc — pluggable bucket-key extractor.
//
// Buckets are reused while warm and reaped after a configurable
// idle window so the map cannot grow without bound.
package ratelimit

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/fjutian/nwd-admin/internal/audit"
	"golang.org/x/time/rate"
)

// KeyFunc derives the per-request bucket key. Returning a
// constant (or empty) string causes every request to share a
// single bucket, which is rarely what you want — keep the
// default IPKey unless you have a reason.
type KeyFunc func(*http.Request) string

// IPKey is the default key: best-effort client IP, honoring
// X-Forwarded-For only when the request arrived from a loopback
// address. This is the behavior the package shipped with before
// the per-actor keying was added, so existing deployments that
// only ever care about IPs see no change.
func IPKey(r *http.Request) string { return clientIP(r) }

// ActorKey throttles by the authenticated username, falling back
// to the client IP for anonymous traffic. The actor name is read
// from the request context (where auth.Middleware stamps it after
// a successful Basic Auth exchange), so a per-actor key only
// becomes meaningful on routes mounted behind the auth
// middleware — for unauthenticated endpoints the result is the
// same as IPKey.
func ActorKey(r *http.Request) string {
	actor := audit.ActorFromContext(r.Context())
	if actor == "" || actor == "anonymous" {
		return "ip:" + clientIP(r)
	}
	return "actor:" + actor
}

// Policy describes the allowed traffic for a single traffic class.
//
// Setting Rate to 0 disables the limiter for the class.
type Policy struct {
	// Rate is the sustained request rate per client IP, in
	// requests per second.
	Rate float64
	// Burst is the maximum number of requests allowed in a
	// short spike before the Rate limit applies.
	Burst int
	// IdleTTL is the time after which an unused per-IP bucket
	// is removed from the map. Defaults to 10 minutes.
	IdleTTL time.Duration
}

// Enabled reports whether the policy actually throttles traffic.
func (p Policy) Enabled() bool {
	return p.Rate > 0 && p.Burst > 0
}

// WithDefaults returns a copy of p with zero values filled in.
func (p Policy) WithDefaults() Policy {
	if p.IdleTTL == 0 {
		p.IdleTTL = 10 * time.Minute
	}
	if p.Burst <= 0 && p.Rate > 0 {
		p.Burst = int(p.Rate*2) + 1
	}
	return p
}

// Limiter holds per-key token buckets for a single traffic class.
type Limiter struct {
	policy Policy
	key    KeyFunc

	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time
}

type bucket struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// New builds a Limiter with the default IP-based key. This is
// the historical constructor; new code that needs per-actor
// keying should call NewWithKey directly.
func New(p Policy) *Limiter {
	return NewWithKey(p, IPKey)
}

// NewWithKey builds a Limiter that derives its bucket key with
// the supplied KeyFunc. The same KeyFunc instance is shared
// across requests, so it should be safe for concurrent use.
func NewWithKey(p Policy, key KeyFunc) *Limiter {
	if key == nil {
		key = IPKey
	}
	return &Limiter{
		policy:  p.WithDefaults(),
		key:     key,
		buckets: make(map[string]*bucket),
		now:     time.Now,
	}
}

// Middleware returns an http.Handler middleware that drops requests
// when the calling IP has exceeded the policy. On rejection it
// responds with 429 Too Many Requests and a Retry-After header
// derived from the limiter's reservation round.
//
// When the policy is disabled (Rate == 0 or Burst == 0) the
// middleware is a no-op pass-through.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	if !l.policy.Enabled() {
		return next
	}
	retryAfter := strconv.Itoa(int(math.Ceil(1.0 / l.policy.Rate)))
	if retryAfter == "0" {
		retryAfter = "1"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.allow(r) {
			w.Header().Set("Retry-After", retryAfter)
			http.Error(w, "请求过于频繁，请稍后再试", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Reap removes idle per-IP buckets. Exposed so callers (and tests)
// can trigger reaping without waiting for the opportunistic
// threshold inside allow.
func (l *Limiter) Reap() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.reapLocked(l.now())
}

// allow consumes a single token from the calling client's bucket
// and returns true if the request is permitted. Reaps stale
// buckets opportunistically.
func (l *Limiter) allow(r *http.Request) bool {
	key := l.key(r)
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// Opportunistic reaping. We cap the work at a small number of
	// entries to avoid the reaper dominating a request goroutine;
	// for a service of this size the bucket map is small enough
	// that even a full scan is cheap.
	if len(l.buckets) > 256 {
		l.reapLocked(now)
	}

	b, ok := l.buckets[key]
	if !ok {
		lim := rate.NewLimiter(rate.Limit(l.policy.Rate), l.policy.Burst)
		b = &bucket{lim: lim, lastSeen: now}
		l.buckets[key] = b
	}
	b.lastSeen = now
	return b.lim.Allow()
}

func (l *Limiter) reapLocked(now time.Time) {
	cutoff := now.Add(-l.policy.IdleTTL)
	for ip, b := range l.buckets {
		if b.lastSeen.Before(cutoff) {
			delete(l.buckets, ip)
		}
	}
}

// clientIP returns the best-effort client IP for an http.Request.
//
// Honors X-Forwarded-For only when the request arrived from a
// loopback address, since blindly trusting proxy headers lets any
// caller spoof their IP and bypass the limiter.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil && isTrustedProxy(host) {
			// Use the first entry (left-most original client).
			if i := indexComma(xff); i >= 0 {
				return trimSpace(xff[:i])
			}
			return trimSpace(xff)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func indexComma(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			return i
		}
	}
	return -1
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

func isTrustedProxy(host string) bool {
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback() || ip.IsLinkLocalUnicast()
	}
	return false
}
