// Package view owns the server-rendered HTML templates embedded in the binary.
package view

import "embed"

// FS contains all HTML templates in this directory.
//
//go:embed *.html
var FS embed.FS
