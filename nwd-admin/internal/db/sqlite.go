package db

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/fjutian/nwd-admin/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Open(dataDir string) (*gorm.DB, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dsn := filepath.Join(dataDir, "nwd-admin.db")
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Enable WAL via raw SQL (GORM sqlite driver supports this).
	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA foreign_keys=ON")
	db.Exec("PRAGMA busy_timeout=5000")

	if err := db.AutoMigrate(&model.Plugin{}, &model.AuditLog{}); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}
