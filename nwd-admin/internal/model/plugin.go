package model

import "time"

// Plugin is the metadata row for an nwd plugin. It does NOT hold
// the plugin bundle — that lives in plugin_versions. One Plugin
// row can correspond to many PluginVersion rows.
type Plugin struct {
	ID            string    `gorm:"primaryKey;size:64" json:"id"`
	Name          string    `gorm:"not null;size:100" json:"name"`
	Author        string    `gorm:"size:100;default:''" json:"author"`
	Description   string    `gorm:"size:500;default:''" json:"description"`
	IconEmoji     string    `gorm:"column:icon_emoji;size:10;default:📦" json:"icon_emoji"`
	Tags          string    `gorm:"size:500;default:'[]'" json:"tags"` // JSON array string
	LatestVersion string    `gorm:"column:latest_version;size:32;not null;default:''" json:"latest_version"`
	TotalDownloads int64    `gorm:"column:total_downloads;default:0" json:"total_downloads"`
	VersionCount  int64     `gorm:"column:version_count;default:0" json:"version_count"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (Plugin) TableName() string {
	return "plugins"
}

// PluginVersion holds the actual .nwd bundle for a single version
// of a plugin. The composite primary key (PluginID, Version) makes
// "re-upload the same version" a clean UPSERT and naturally
// prevents accidental duplication.
type PluginVersion struct {
	PluginID   string    `gorm:"primaryKey;column:plugin_id;size:64" json:"plugin_id"`
	Version    string    `gorm:"primaryKey;size:32" json:"version"`
	Bundle     []byte    `gorm:"not null" json:"-"`
	SizeBytes  int64     `gorm:"column:size_bytes;default:0" json:"size_bytes"`
	Downloads  int64     `gorm:"default:0" json:"downloads"`
	CreatedAt  time.Time `gorm:"index" json:"created_at"`
}

func (PluginVersion) TableName() string {
	return "plugin_versions"
}
