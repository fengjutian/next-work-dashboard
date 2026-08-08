package model

import "time"

// Plugin is the GORM model for the plugins table.
type Plugin struct {
	ID          string `gorm:"primaryKey;size:64" json:"id"`
	Name        string `gorm:"not null;size:100" json:"name"`
	Version     string `gorm:"not null;size:20" json:"version"`
	Author      string `gorm:"size:100;default:''" json:"author"`
	Description string `gorm:"size:500;default:''" json:"description"`
	IconEmoji   string `gorm:"column:icon_emoji;size:10;default:📦" json:"icon_emoji"`
	Tags        string `gorm:"size:500;default:'[]'" json:"tags"` // JSON array string
	Bundle      []byte `gorm:"not null" json:"-"`
	SizeBytes   int64  `gorm:"column:size_bytes;default:0" json:"size_bytes"`
	Downloads   int64  `gorm:"default:0" json:"downloads"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Plugin) TableName() string {
	return "plugins"
}
