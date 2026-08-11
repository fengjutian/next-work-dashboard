// Package migrate carries the legacy single-table plugin layout
// (where model.Plugin held its own bundle column) to the new
// two-table layout (model.Plugin for metadata, model.PluginVersion
// for per-version bundles).
//
// The package is exposed as a CLI subcommand `nwd-admin migrate`
// so operators can run it once after upgrading from a build that
// pre-dates the schema split. The migration is idempotent —
// re-running it after a partial failure picks up where it left
// off without duplicating rows.
package migrate

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"gorm.io/gorm"
)

// SchemaState describes how the on-disk plugins table relates to
// the current model definition.
type SchemaState int

const (
	// StateUnknown means the schema could not be classified,
	// typically because the database could not be reached.
	StateUnknown SchemaState = iota
	// StateFresh means the plugins table has the post-split shape
	// and the plugin_versions table is also present. Nothing to
	// do; the migration is a no-op.
	StateFresh
	// StateLegacy means the plugins table still carries the
	// pre-split columns (version, bundle, size_bytes, downloads)
	// and plugin_versions is empty or missing. Migration will
	// move the bundle to plugin_versions.
	StateLegacy
	// StateMixed means the new shape is in place but some legacy
	// columns are still attached to the plugins table. Migration
	// drops them after copying the bundle across.
	StateMixed
)

func (s SchemaState) String() string {
	switch s {
	case StateFresh:
		return "fresh"
	case StateLegacy:
		return "legacy"
	case StateMixed:
		return "mixed"
	default:
		return "unknown"
	}
}

// Stats summarizes what Migrate did.
type Stats struct {
	PluginsSeen     int
	VersionsCreated int
	VersionsSkipped int
	ColumnsDropped  int
}

// Needs reports whether the state actually requires a migration.
// StateFresh is a no-op; the others return true.
func (s SchemaState) Needs() bool {
	return s == StateLegacy || s == StateMixed
}

// DetectState inspects the on-disk schema and returns the matching
// SchemaState. The function deliberately does not depend on
// GORM's auto-migration so a partially-upgraded database can be
// classified correctly.
func DetectState(db *gorm.DB) (SchemaState, error) {
	if !db.Migrator().HasTable(&model.Plugin{}) {
		return StateFresh, nil
	}
	hasVersionCol := db.Migrator().HasColumn(&model.Plugin{}, "version")
	hasBundleCol := db.Migrator().HasColumn(&model.Plugin{}, "bundle")
	hasVersionsTable := db.Migrator().HasTable(&model.PluginVersion{})

	switch {
	case hasVersionCol && hasBundleCol:
		return StateLegacy, nil
	case hasVersionCol && !hasBundleCol:
		// Defensive: columns got partially dropped before the
		// migration ran. Still safe to proceed.
		return StateMixed, nil
	case !hasVersionCol && hasVersionsTable:
		return StateFresh, nil
	default:
		// No version column and no plugin_versions table —
		// treat as fresh so the next AutoMigrate creates the
		// new tables.
		return StateFresh, nil
	}
}

// Migrate moves bundles from the legacy plugins table to
// plugin_versions, updates the metadata row, and drops the legacy
// columns. The operation is safe to re-run.
func Migrate(ctx context.Context, db *gorm.DB) (Stats, error) {
	state, err := DetectState(db)
	if err != nil {
		return Stats{}, fmt.Errorf("detect state: %w", err)
	}
	if !state.Needs() {
		slog.Info("migration skipped — schema is already up to date", "state", state.String())
		return Stats{}, nil
	}
	slog.Info("migration starting", "state", state.String())

	stats, err := copyBundles(ctx, db)
	if err != nil {
		return stats, err
	}

	if state == StateLegacy {
		dropped, err := dropLegacyColumns(db)
		if err != nil {
			return stats, err
		}
		stats.ColumnsDropped = dropped
	}

	slog.Info("migration complete",
		"plugins_seen", stats.PluginsSeen,
		"versions_created", stats.VersionsCreated,
		"versions_skipped", stats.VersionsSkipped,
		"columns_dropped", stats.ColumnsDropped,
	)
	return stats, nil
}

// copyBundles walks every row in the legacy plugins table, copies
// the bundle into plugin_versions (skipping rows that already
// exist), and updates the metadata row.
func copyBundles(ctx context.Context, db *gorm.DB) (Stats, error) {
	var stats Stats

	type legacyRow struct {
		ID          string
		Version     string
		Author      string
		Name        string
		Description string
		IconEmoji   string
		Tags        string
		Bundle      []byte
		SizeBytes   int64
		Downloads   int64
		CreatedAt   time.Time
		UpdatedAt   time.Time
	}

	rows, err := db.WithContext(ctx).
		Table("plugins").
		Select("id, version, author, name, description, icon_emoji, tags, bundle, size_bytes, downloads, created_at, updated_at").
		Rows()
	if err != nil {
		return stats, fmt.Errorf("read legacy rows: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var r legacyRow
		if err := db.ScanRows(rows, &r); err != nil {
			return stats, fmt.Errorf("scan legacy row: %w", err)
		}
		stats.PluginsSeen++

		// The legacy table had no `total_downloads`; treat the
		// per-row downloads counter as the cumulative count.
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// Skip if a version row already exists — makes the
			// migration idempotent across retries.
			existing := model.PluginVersion{}
			err := tx.Where("plugin_id = ? AND version = ?", r.ID, r.Version).First(&existing).Error
			if err == nil {
				stats.VersionsSkipped++
				// Still update metadata below in case the
				// operator re-ran the migration after a
				// partial failure that left the new plugin
				// row half-populated.
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("lookup version: %w", err)
			} else {
				version := model.PluginVersion{
					PluginID:  r.ID,
					Version:   r.Version,
					Bundle:    r.Bundle,
					SizeBytes: r.SizeBytes,
					Downloads: r.Downloads,
					CreatedAt: pickTime(r.CreatedAt, r.UpdatedAt),
				}
				if err := tx.Create(&version).Error; err != nil {
					return fmt.Errorf("insert version %q/%q: %w", r.ID, r.Version, err)
				}
				stats.VersionsCreated++
			}

			// Upsert the new plugin metadata row.
			plugin := model.Plugin{
				ID:             r.ID,
				Name:           r.Name,
				Author:         r.Author,
				Description:    r.Description,
				IconEmoji:      r.IconEmoji,
				Tags:           r.Tags,
				LatestVersion:  r.Version,
				TotalDownloads: r.Downloads,
				VersionCount:   1,
			}
			// Keep the original timestamps when present so the
			// "recently added" widget on the home page still
			// reflects the real history.
			if !r.CreatedAt.IsZero() {
				plugin.CreatedAt = r.CreatedAt
			}
			if !r.UpdatedAt.IsZero() {
				plugin.UpdatedAt = r.UpdatedAt
			}
			if err := tx.Save(&plugin).Error; err != nil {
				return fmt.Errorf("upsert plugin %q: %w", r.ID, err)
			}
			return nil
		})
		if err != nil {
			return stats, err
		}
	}
	return stats, rows.Err()
}

// dropLegacyColumns removes the pre-split columns. The list is
// hard-coded so a misconfiguration cannot accidentally drop a
// current column.
func dropLegacyColumns(db *gorm.DB) (int, error) {
	columns := []string{"version", "bundle", "size_bytes", "downloads"}
	dropped := 0
	for _, col := range columns {
		if !db.Migrator().HasColumn(&model.Plugin{}, col) {
			continue
		}
		if err := db.Migrator().DropColumn(&model.Plugin{}, col); err != nil {
			return dropped, fmt.Errorf("drop column plugins.%s: %w", col, err)
		}
		dropped++
	}
	return dropped, nil
}

// pickTime prefers the original CreatedAt but falls back to
// UpdatedAt when the legacy schema did not record a separate
// creation time.
func pickTime(created, updated time.Time) time.Time {
	if !created.IsZero() {
		return created
	}
	return updated
}
