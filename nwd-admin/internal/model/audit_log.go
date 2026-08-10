package model

import "time"

// AuditLog is the GORM persistence model for the audit_logs table.
//
// One row is written per request that triggers an audit-worthy
// event (write endpoints, auth failures, rate-limit rejections).
// Rows are append-only; nothing in the service mutates them after
// insertion. Use the Prune operation in the audit package to keep
// the table size bounded.
type AuditLog struct {
	ID         uint64 `gorm:"primaryKey;autoIncrement" json:"id"`
	CreatedAt  time.Time `gorm:"index;column:created_at" json:"created_at"`
	Actor      string `gorm:"size:64;not null;default:'anonymous'" json:"actor"`
	ActorIP    string `gorm:"size:64;not null;default:'';column:actor_ip" json:"actor_ip"`
	Action     string `gorm:"size:64;not null;index" json:"action"`
	Target     string `gorm:"size:128;not null;default:''" json:"target"`
	HTTPMethod string `gorm:"size:16;not null;default:'';column:http_method" json:"http_method"`
	HTTPPath   string `gorm:"size:512;not null;default:'';column:http_path" json:"http_path"`
	HTTPStatus int    `gorm:"not null;default:0;column:http_status" json:"http_status"`
	UserAgent  string `gorm:"size:512;not null;default:'';column:user_agent" json:"user_agent"`
	DurationMS int64  `gorm:"not null;default:0;column:duration_ms" json:"duration_ms"`
	Message    string `gorm:"size:500;not null;default:''" json:"message"`
}

func (AuditLog) TableName() string {
	return "audit_logs"
}
