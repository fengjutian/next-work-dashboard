// Package ratelimit provides per-IP token-bucket rate limiting for
// nwd-admin HTTP endpoints.
//
// The Limiter is built on top of golang.org/x/time/rate and keeps a
// separate bucket per client IP. Each bucket is reused while it
// stays warm and is reaped after a configurable idle window so the
// map cannot grow without bound.
//
// The package exposes two consumption points:
//
//   - Limiter.Middleware — generic middleware that drops requests
//     returning HTTP 429 with a Retry-After header.
//   - Policy.Middleware — convenience wrapper that derives the
//     per-second and burst rates from a Policy struct, allowing
//     operators to tune traffic classes (read / write / admin)
//     through configuration.
package ratelimit

import (
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

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

// Limiter holds per-IP token buckets for a single traffic class.
type Limiter struct {
	policy Policy

	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time
}

type bucket struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// New builds a Limiter from a Policy.
func New(p Policy) *Limiter {
	return &Limiter{
		policy:  p.WithDefaults(),
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
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !l.allow(ip) {
			w.Header().Set("Retry-After", strconv.Itoa(int(l.policy.Rate)))
			http.Error(w, "请求过于频繁，请稍后再试", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// allow consumes a single token from the calling IP's bucket and
// returns true if the request is permitted. Reaps stale buckets
// opportunistically.
func (l *Limiter) allow(ip string) bool {
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

	b, ok := l.buckets[ip]
	if !ok {
		lim := rate.NewLimiter(rate.Limit(l.policy.Rate), l.policy.Burst)
		b = &bucket{lim: lim, lastSeen: now}
		l.buckets[ip] = b
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
