package auth

import (
	"encoding/base64"
	"strings"
)

// parseBasic extracts the username and password from a raw HTTP Basic
// auth header value, e.g. "Basic dXNlcjpwYXNz".
//
// Returns ErrInvalidFormat for any input that does not parse cleanly.
// Callers should treat all parse failures the same: the client did
// not present a usable credential.
func parseBasic(header string) (username, password string, err error) {
	if header == "" {
		return "", "", ErrInvalidFormat
	}
	const prefix = "Basic "
	if !strings.HasPrefix(header, prefix) {
		return "", "", ErrInvalidFormat
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[len(prefix):]))
	if err != nil {
		return "", "", ErrInvalidFormat
	}
	decoded := string(raw)
	colon := strings.IndexByte(decoded, ':')
	if colon < 0 {
		return "", "", ErrInvalidFormat
	}
	username = decoded[:colon]
	password = decoded[colon+1:]
	if username == "" {
		return "", "", ErrInvalidFormat
	}
	return username, password, nil
}
