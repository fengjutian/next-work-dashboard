package model

import "time"

type Plugin struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Version     string    `json:"version"`
	Author      string    `json:"author"`
	Description string    `json:"description"`
	IconEmoji   string    `json:"icon_emoji"`
	Tags        string    `json:"tags"` // JSON array
	SizeBytes   int64     `json:"size_bytes"`
	Downloads   int64     `json:"downloads"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Bundle is NOT returned in list queries — only on download.
type PluginBundle struct {
	Plugin
	Bundle []byte `json:"-"`
}
