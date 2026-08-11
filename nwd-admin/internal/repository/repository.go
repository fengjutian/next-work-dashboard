package repository

import "github.com/fjutian/nwd-admin/internal/model"

// PluginListQuery is the filter set for ListPlugins / CountPlugins.
type PluginListQuery struct {
	// Q matches against id, name, author, and description using
	// a case-insensitive LIKE. Empty disables the filter.
	Q string
	// Tag filters plugins whose Tags JSON contains this value.
	// Empty disables the filter.
	Tag string
	// Page is 1-based; Size is the page size. Both must be
	// positive. Repository implementations should clamp to safe
	// defaults if either is invalid.
	Page int
	Size int
}

// PluginRepository is the data-access contract for plugins and
// their versions.
type PluginRepository interface {
	// Count returns the total number of plugin rows.
	Count() (int64, error)
	// SumDownloads returns the sum of total_downloads across all plugins.
	SumDownloads() (int64, error)
	// CountSince returns the number of plugin rows updated within
	// the last `days` days. Used by the dashboard "recent" stat.
	CountSince(days int) (int64, error)
	// ListRecent returns the most recently updated plugins.
	ListRecent(limit int) ([]model.Plugin, error)

	// ListPlugins returns plugins filtered by query, ordered by
	// updated_at DESC. The result is a single page.
	ListPlugins(query PluginListQuery) ([]model.Plugin, error)
	// CountPlugins returns the total plugin count for the same
	// filter as ListPlugins (used to compute pageCount).
	CountPlugins(query PluginListQuery) (int64, error)

	// FindPluginByID returns the metadata row for a plugin.
	FindPluginByID(id string) (*model.Plugin, error)
	// ListVersions returns every version row for a plugin, newest
	// first.
	ListVersions(pluginID string) ([]model.PluginVersion, error)
	// FindVersion returns one (plugin_id, version) row, or
	// gorm.ErrRecordNotFound if missing.
	FindVersion(pluginID, version string) (*model.PluginVersion, error)

	// SavePlugin upserts the plugin row.
	SavePlugin(p *model.Plugin) error
	// SaveVersion upserts a (plugin_id, version) row.
	SaveVersion(v *model.PluginVersion) error
	// UpdateLatestVersion sets plugins.latest_version.
	UpdateLatestVersion(pluginID, version string) error
	// RecountVersionCount recomputes plugins.version_count from
	// plugin_versions. Useful after direct version-table writes.
	RecountVersionCount(pluginID string) error

	// IncrementVersionDownloads bumps both plugin_versions.downloads
	// and plugins.total_downloads in a single transaction.
	IncrementVersionDownloads(pluginID, version string) error

	// DeletePlugin removes the metadata row and all its versions.
	DeletePlugin(id string) error
	// DeleteVersion removes a single (plugin_id, version) row.
	DeleteVersion(pluginID, version string) error
}
