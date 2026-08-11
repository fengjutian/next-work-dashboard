package repository

import (
	"errors"
	"strings"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type gormPluginRepo struct {
	db *gorm.DB
}

func NewPluginRepository(db *gorm.DB) PluginRepository {
	return &gormPluginRepo{db: db}
}

// ── Dashboard aggregations ──────────────────────────────────────────

func (r *gormPluginRepo) Count() (int64, error) {
	var n int64
	err := r.db.Model(&model.Plugin{}).Count(&n).Error
	return n, err
}

func (r *gormPluginRepo) SumDownloads() (int64, error) {
	var n int64
	err := r.db.Model(&model.Plugin{}).
		Select("COALESCE(SUM(total_downloads), 0)").
		Scan(&n).Error
	return n, err
}

func (r *gormPluginRepo) CountSince(days int) (int64, error) {
	var n int64
	err := r.db.Model(&model.Plugin{}).
		Where("updated_at >= ?", time.Now().AddDate(0, 0, -days)).
		Count(&n).Error
	return n, err
}

func (r *gormPluginRepo) ListRecent(limit int) ([]model.Plugin, error) {
	var plugins []model.Plugin
	err := r.db.Order("updated_at DESC").Limit(limit).Find(&plugins).Error
	return plugins, err
}

// ── Filtered listing & counting ─────────────────────────────────────

// safePage clamps Page/Size to safe values, returning 1/20 by default.
func (q PluginListQuery) safePage() (page, size int) {
	page = q.Page
	size = q.Size
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 200 {
		size = 200
	}
	return
}

// buildFilter applies the Q and Tag filters to a GORM query for the
// plugins table and returns the modified query.
func (r *gormPluginRepo) buildFilter(q PluginListQuery) *gorm.DB {
	query := r.db.Model(&model.Plugin{})
	if q.Q != "" {
		like := "%" + strings.TrimSpace(q.Q) + "%"
		// SQLite LIKE is case-insensitive for ASCII by default.
		query = query.Where(
			"id LIKE ? OR name LIKE ? OR author LIKE ? OR description LIKE ?",
			like, like, like, like,
		)
	}
	if q.Tag != "" {
		tag := strings.TrimSpace(q.Tag)
		if tag != "" {
			// json_each is a SQLite JSON1 table-valued function. It
			// expands the tags JSON array into one row per element,
			// letting us filter on a specific value with an EXISTS
			// subquery. This is exact-match (no LIKE wildcards),
			// which matches how a tag chip should behave.
			query = query.Where(
				"EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)",
				tag,
			)
		}
	}
	return query
}

func (r *gormPluginRepo) ListPlugins(q PluginListQuery) ([]model.Plugin, error) {
	page, size := q.safePage()
	var plugins []model.Plugin
	err := r.buildFilter(q).
		Order("updated_at DESC").
		Limit(size).
		Offset((page - 1) * size).
		Find(&plugins).Error
	return plugins, err
}

func (r *gormPluginRepo) CountPlugins(q PluginListQuery) (int64, error) {
	var n int64
	err := r.buildFilter(q).Count(&n).Error
	return n, err
}

// ── Single-row lookups ──────────────────────────────────────────────

func (r *gormPluginRepo) FindPluginByID(id string) (*model.Plugin, error) {
	var p model.Plugin
	if err := r.db.First(&p, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *gormPluginRepo) ListVersions(pluginID string) ([]model.PluginVersion, error) {
	var versions []model.PluginVersion
	err := r.db.Where("plugin_id = ?", pluginID).
		Order("created_at DESC").
		Find(&versions).Error
	return versions, err
}

func (r *gormPluginRepo) FindVersion(pluginID, version string) (*model.PluginVersion, error) {
	var v model.PluginVersion
	err := r.db.First(&v, "plugin_id = ? AND version = ?", pluginID, version).Error
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ── Writes ──────────────────────────────────────────────────────────

func (r *gormPluginRepo) SavePlugin(p *model.Plugin) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name", "author", "description", "icon_emoji",
			"tags", "updated_at",
		}),
	}).Create(p).Error
}

func (r *gormPluginRepo) SaveVersion(v *model.PluginVersion) error {
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "plugin_id"}, {Name: "version"}},
		// On conflict: replace bundle + size_bytes so a re-upload
		// of the same version overwrites the existing one.
		DoUpdates: clause.AssignmentColumns([]string{
			"bundle", "size_bytes",
		}),
	}).Create(v).Error
}

func (r *gormPluginRepo) UpdateLatestVersion(pluginID, version string) error {
	return r.db.Model(&model.Plugin{}).
		Where("id = ?", pluginID).
		Updates(map[string]any{
			"latest_version": version,
			"updated_at":     time.Now(),
		}).Error
}

func (r *gormPluginRepo) RecountVersionCount(pluginID string) error {
	var n int64
	if err := r.db.Model(&model.PluginVersion{}).
		Where("plugin_id = ?", pluginID).Count(&n).Error; err != nil {
		return err
	}
	return r.db.Model(&model.Plugin{}).
		Where("id = ?", pluginID).
		Update("version_count", n).Error
}

func (r *gormPluginRepo) IncrementVersionDownloads(pluginID, version string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.PluginVersion{}).
			Where("plugin_id = ? AND version = ?", pluginID, version).
			UpdateColumn("downloads", gorm.Expr("downloads + 1"))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Plugin{}).
			Where("id = ?", pluginID).
			UpdateColumn("total_downloads", gorm.Expr("total_downloads + 1")).Error
	})
}

func (r *gormPluginRepo) DeletePlugin(id string) error {
	// GORM's default association cascade isn't enabled here; do
	// it explicitly so a plugin deletion never leaves orphan
	// version rows.
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("plugin_id = ?", id).Delete(&model.PluginVersion{}).Error; err != nil {
			return err
		}
		res := tx.Where("id = ?", id).Delete(&model.Plugin{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *gormPluginRepo) DeleteVersion(pluginID, version string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Where("plugin_id = ? AND version = ?", pluginID, version).
			Delete(&model.PluginVersion{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		// If we just removed the version that plugins.latest_version
		// pointed at, pick the most recent remaining version and
		// promote it. If none remain, the caller should delete the
		// plugin row instead.
		var p model.Plugin
		if err := tx.First(&p, "id = ?", pluginID).Error; err != nil {
			return err
		}
		if p.LatestVersion == version {
			var latest model.PluginVersion
			err := tx.Where("plugin_id = ?", pluginID).
				Order("created_at DESC").
				First(&latest).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// No versions left; leave latest_version as-is
				// (the plugin row should be deleted by the caller).
				return nil
			}
			if err != nil {
				return err
			}
			return tx.Model(&model.Plugin{}).
				Where("id = ?", pluginID).
				Updates(map[string]any{
					"latest_version": latest.Version,
					"updated_at":     time.Now(),
				}).Error
		}
		return nil
	})
}
