//go:build cgo

// migrate_test.go exercises the schema detection and copy logic
// against a real SQLite database. It is gated on cgo because
// go-sqlite3 cannot operate without a C toolchain; the same
// configuration the runtime uses at production.
package migrate

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openTestDB returns a fresh on-disk SQLite database in the test's
// temp dir. schemaSetup can be used to apply a hand-rolled legacy
// schema for migration tests.
func openTestDB(t *testing.T, schemaSetup func(*gorm.DB)) *gorm.DB {
	t.Helper()
	dir := t.TempDir()
	dsn := filepath.Join(dir, "test.db")
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	if schemaSetup != nil {
		schemaSetup(db)
	}
	return db
}

func TestDetectStateFreshEmptyDB(t *testing.T) {
	db := openTestDB(t, nil)
	// Empty database: no plugins table at all.
	state, err := DetectState(db)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if state != StateFresh {
		t.Errorf("state = %s, want fresh", state)
	}
}

func TestDetectStateLegacySingleTable(t *testing.T) {
	db := openTestDB(t, func(db *gorm.DB) {
		// Hand-rolled legacy schema. The fields mirror the
		// pre-split model.Plugin and include a BLOB column for
		// the bundle.
		err := db.Exec(`
			CREATE TABLE plugins (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				version TEXT NOT NULL,
				author TEXT,
				description TEXT,
				icon_emoji TEXT,
				tags TEXT,
				bundle BLOB,
				size_bytes INTEGER,
				downloads INTEGER,
				created_at DATETIME,
				updated_at DATETIME
			)
		`).Error
		if err != nil {
			t.Fatalf("create legacy: %v", err)
		}
	})
	state, err := DetectState(db)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if state != StateLegacy {
		t.Errorf("state = %s, want legacy", state)
	}
	if !state.Needs() {
		t.Error("legacy state should need migration")
	}
}

func TestDetectStateFreshAfterAutoMigrate(t *testing.T) {
	db := openTestDB(t, func(db *gorm.DB) {
		// Apply the current schema by running AutoMigrate
		// (which GORM does at server startup) before the
		// detect call.
		if err := db.AutoMigrate(&model.Plugin{}, &model.PluginVersion{}); err != nil {
			t.Fatalf("automigrate: %v", err)
		}
	})
	state, err := DetectState(db)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if state != StateFresh {
		t.Errorf("state = %s, want fresh", state)
	}
	if state.Needs() {
		t.Error("fresh state should not need migration")
	}
}

func TestMigrateLegacyToFresh(t *testing.T) {
	db := openTestDB(t, func(db *gorm.DB) {
		// Apply the legacy schema and seed two plugin rows.
		if err := db.Exec(`
			CREATE TABLE plugins (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				version TEXT NOT NULL,
				author TEXT,
				description TEXT,
				icon_emoji TEXT,
				tags TEXT,
				bundle BLOB,
				size_bytes INTEGER,
				downloads INTEGER,
				created_at DATETIME,
				updated_at DATETIME
			)
		`).Error; err != nil {
			t.Fatalf("create legacy: %v", err)
		}
		now := time.Now().Format("2006-01-02 15:04:05")
		inserts := []struct {
			id, ver, name string
			bundle        []byte
			downloads     int
		}{
			{"alpha", "1.0.0", "Alpha", []byte("alpha-v1-bundle"), 5},
			{"beta", "2.0.0", "Beta", []byte("beta-v2-bundle"), 12},
		}
		for _, r := range inserts {
			err := db.Exec(`INSERT INTO plugins
				(id, name, version, author, icon_emoji, bundle, size_bytes, downloads, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				r.id, r.name, r.ver, "alice", "🧪", r.bundle, len(r.bundle), r.downloads, now, now,
			).Error
			if err != nil {
				t.Fatalf("insert %s: %v", r.id, err)
			}
		}
	})

	// Sanity check: state is legacy.
	state, err := DetectState(db)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if state != StateLegacy {
		t.Fatalf("pre-migration state = %s, want legacy", state)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	stats, err := Migrate(ctx, db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if stats.PluginsSeen != 2 {
		t.Errorf("PluginsSeen = %d, want 2", stats.PluginsSeen)
	}
	if stats.VersionsCreated != 2 {
		t.Errorf("VersionsCreated = %d, want 2", stats.VersionsCreated)
	}
	if stats.ColumnsDropped != 4 {
		t.Errorf("ColumnsDropped = %d, want 4", stats.ColumnsDropped)
	}

	// post-migration: plugin_versions should contain both rows
	// and the legacy columns should be gone.
	var versionCount int64
	if err := db.Model(&model.PluginVersion{}).Count(&versionCount).Error; err != nil {
		t.Fatalf("count versions: %v", err)
	}
	if versionCount != 2 {
		t.Errorf("version count = %d, want 2", versionCount)
	}
	for _, m := range []struct {
		id, ver string
		bundle  []byte
		dl      int64
	}{
		{"alpha", "1.0.0", []byte("alpha-v1-bundle"), 5},
		{"beta", "2.0.0", []byte("beta-v2-bundle"), 12},
	} {
		var v model.PluginVersion
		if err := db.Where("plugin_id = ? AND version = ?", m.id, m.ver).First(&v).Error; err != nil {
			t.Errorf("version %s/%s missing: %v", m.id, m.ver, err)
			continue
		}
		if string(v.Bundle) != string(m.bundle) {
			t.Errorf("version %s/%s bundle = %q, want %q", m.id, m.ver, v.Bundle, m.bundle)
		}
		if v.Downloads != m.dl {
			t.Errorf("version %s/%s downloads = %d, want %d", m.id, m.ver, v.Downloads, m.dl)
		}
	}

	// Plugin metadata rows reflect the legacy values.
	for _, p := range []struct {
		id, name, latest string
		dl               int64
	}{
		{"alpha", "Alpha", "1.0.0", 5},
		{"beta", "Beta", "2.0.0", 12},
	} {
		var got model.Plugin
		if err := db.Where("id = ?", p.id).First(&got).Error; err != nil {
			t.Errorf("plugin %s missing: %v", p.id, err)
			continue
		}
		if got.Name != p.name {
			t.Errorf("%s name = %q, want %q", p.id, got.Name, p.name)
		}
		if got.LatestVersion != p.latest {
			t.Errorf("%s latest = %q, want %q", p.id, got.LatestVersion, p.latest)
		}
		if got.TotalDownloads != p.dl {
			t.Errorf("%s total_downloads = %d, want %d", p.id, got.TotalDownloads, p.dl)
		}
		if got.VersionCount != 1 {
			t.Errorf("%s version_count = %d, want 1", p.id, got.VersionCount)
		}
	}

	// legacy columns are gone.
	for _, col := range []string{"version", "bundle", "size_bytes", "downloads"} {
		if db.Migrator().HasColumn(&model.Plugin{}, col) {
			t.Errorf("legacy column %q still present", col)
		}
	}

	// State should now report fresh.
	state, err = DetectState(db)
	if err != nil {
		t.Fatalf("re-detect: %v", err)
	}
	if state != StateFresh {
		t.Errorf("post-migration state = %s, want fresh", state)
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	db := openTestDB(t, func(db *gorm.DB) {
		if err := db.Exec(`
			CREATE TABLE plugins (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				version TEXT NOT NULL,
				bundle BLOB,
				size_bytes INTEGER,
				downloads INTEGER
			)
		`).Error; err != nil {
			t.Fatalf("setup: %v", err)
		}
		if err := db.Exec(`INSERT INTO plugins (id, name, version, bundle, size_bytes, downloads)
			VALUES (?, ?, ?, ?, ?, ?)`,
			"x", "X", "1.0.0", []byte("bundle"), 6, 1,
		).Error; err != nil {
			t.Fatalf("insert: %v", err)
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := Migrate(ctx, db); err != nil {
		t.Fatalf("first migrate: %v", err)
	}

	// Manually re-introduce a legacy column to simulate a
	// partially failed migration. The second Migrate call
	// should report 0 created versions and re-drop the column.
	if err := db.Exec(`ALTER TABLE plugins ADD COLUMN bundle BLOB`).Error; err != nil {
		t.Fatalf("re-introduce bundle: %v", err)
	}
	stats, err := Migrate(ctx, db)
	if err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	if stats.VersionsSkipped != 1 {
		t.Errorf("VersionsSkipped = %d, want 1", stats.VersionsSkipped)
	}
	if stats.VersionsCreated != 0 {
		t.Errorf("VersionsCreated = %d, want 0 (already present)", stats.VersionsCreated)
	}
	if db.Migrator().HasColumn(&model.Plugin{}, "bundle") {
		t.Error("bundle column should be re-dropped")
	}
}

func TestMigrateSkipsFreshSchema(t *testing.T) {
	db := openTestDB(t, func(db *gorm.DB) {
		if err := db.AutoMigrate(&model.Plugin{}, &model.PluginVersion{}); err != nil {
			t.Fatalf("automigrate: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stats, err := Migrate(ctx, db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if stats.PluginsSeen != 0 || stats.VersionsCreated != 0 {
		t.Errorf("fresh migrate should be a no-op, got %+v", stats)
	}
}
