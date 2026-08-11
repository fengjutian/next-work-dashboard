// Package service contains the business logic for nwd-admin.
//
// The service layer is responsible for coordinating the metadata
// row (model.Plugin) and the per-version row (model.PluginVersion)
// so callers don't have to know the two-table split exists.
package service

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/fjutian/nwd-admin/internal/model"
	"github.com/fjutian/nwd-admin/internal/repository"
	"gorm.io/gorm"
)

// PluginService exposes the operations handlers call.
type PluginService struct {
	repo repository.PluginRepository
}

// NewPluginService wires a service around a repository.
func NewPluginService(repo repository.PluginRepository) *PluginService {
	return &PluginService{repo: repo}
}

// PublishInput is the structured payload of an upload.
type PublishInput struct {
	ID          string
	Name        string
	Version     string
	Author      string
	Description string
	IconEmoji   string
	Tags        []string
	Bundle      []byte
}

// DashboardStats returns the four numbers shown on the home page.
func (s *PluginService) DashboardStats() (pluginCount, totalDownloads, recentCount int64, recent []model.Plugin) {
	var err error
	pluginCount, err = s.repo.Count()
	if err != nil {
		slog.Warn("count plugins", "err", err)
	}
	totalDownloads, err = s.repo.SumDownloads()
	if err != nil {
		slog.Warn("sum downloads", "err", err)
	}
	recentCount, err = s.repo.CountSince(7)
	if err != nil {
		slog.Warn("count recent", "err", err)
	}
	recent, err = s.repo.ListRecent(10)
	if err != nil {
		slog.Warn("list recent", "err", err)
	}
	return
}

// List returns a single page of plugins filtered by the given query.
func (s *PluginService) List(q repository.PluginListQuery) ([]model.Plugin, int64, error) {
	plugins, err := s.repo.ListPlugins(q)
	if err != nil {
		return nil, 0, fmt.Errorf("list plugins: %w", err)
	}
	if plugins == nil {
		plugins = []model.Plugin{}
	}
	total, err := s.repo.CountPlugins(q)
	if err != nil {
		// Count failure is not fatal for rendering the page; just
		// report 0 so the paginator can degrade.
		slog.Warn("count plugins", "err", err)
	}
	return plugins, total, nil
}

// Versions returns all versions of a single plugin, newest first.
func (s *PluginService) Versions(pluginID string) ([]model.PluginVersion, error) {
	versions, err := s.repo.ListVersions(pluginID)
	if err != nil {
		return nil, fmt.Errorf("list versions %q: %w", pluginID, err)
	}
	return versions, nil
}

// Publish stores a plugin (or a new version of an existing plugin).
//
// Behavior:
//   - If the plugin id is new, a fresh metadata row is inserted.
//   - If the (id, version) tuple already exists, its bundle is
//     overwritten and the metadata is refreshed.
//   - If the id exists but the version is new, the metadata is
//     refreshed and a new version row is appended.
//   - In every case, plugins.latest_version is updated to the
//     incoming version (a re-upload of the same version is a no-op
//     for latest_version).
//   - plugins.version_count is recomputed from the version table.
func (s *PluginService) Publish(in PublishInput) error {
	tags := normalizeTags(in.Tags)
	tagsJSON := encodeTags(tags)

	plugin := &model.Plugin{
		ID:            in.ID,
		Name:          in.Name,
		Author:        in.Author,
		Description:   in.Description,
		IconEmoji:     in.IconEmoji,
		Tags:          tagsJSON,
		LatestVersion: in.Version,
	}
	if err := s.repo.SavePlugin(plugin); err != nil {
		return fmt.Errorf("save plugin %q: %w", in.ID, err)
	}

	version := &model.PluginVersion{
		PluginID:  in.ID,
		Version:   in.Version,
		Bundle:    in.Bundle,
		SizeBytes: int64(len(in.Bundle)),
	}
	if err := s.repo.SaveVersion(version); err != nil {
		return fmt.Errorf("save version %q/%q: %w", in.ID, in.Version, err)
	}

	if err := s.repo.RecountVersionCount(in.ID); err != nil {
		slog.Warn("recount version count", "id", in.ID, "err", err)
	}
	slog.Info("plugin published",
		"id", in.ID,
		"version", in.Version,
		"size_bytes", version.SizeBytes,
		"tags", tags,
	)
	return nil
}

// Download returns the bundle for a single version.
//
// When version is empty the latest known version is returned. The
// download counter on both the version row and the parent plugin
// row is incremented atomically.
func (s *PluginService) Download(id, version string) (*model.Plugin, *model.PluginVersion, error) {
	plugin, err := s.repo.FindPluginByID(id)
	if err != nil {
		return nil, nil, fmt.Errorf("find plugin %q: %w", id, err)
	}
	if version == "" {
		version = plugin.LatestVersion
	}
	if version == "" {
		// Plugin row exists but has no versions attached — treat
		// as not found so the handler can 404 instead of 500.
		return nil, nil, ErrVersionNotFound
	}
	v, err := s.repo.FindVersion(id, version)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrVersionNotFound
		}
		return nil, nil, fmt.Errorf("find version %q/%q: %w", id, version, err)
	}
	if err := s.repo.IncrementVersionDownloads(id, version); err != nil {
		slog.Warn("increment version downloads", "id", id, "version", version, "err", err)
	}
	return plugin, v, nil
}

// RemoveOptions controls what Remove deletes.
type RemoveOptions struct {
	// AllVersions removes the whole plugin (all versions + metadata).
	// Version is ignored when this is true.
	AllVersions bool
	// Version is the single version to remove. Empty + !AllVersions
	// returns an error.
	Version string
}

// ErrVersionRequired is returned when a single-version remove is
// requested without specifying a version.
var (
	ErrVersionRequired = errors.New("version is required (or pass all=true)")
	ErrVersionNotFound = errors.New("plugin version not found")
)

// Remove deletes a plugin or one of its versions.
func (s *PluginService) Remove(id string, opts RemoveOptions) error {
	if opts.AllVersions {
		if err := s.repo.DeletePlugin(id); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrVersionNotFound
			}
			return fmt.Errorf("delete plugin %q: %w", id, err)
		}
		slog.Info("plugin removed", "id", id, "all_versions", true)
		return nil
	}
	if opts.Version == "" {
		return ErrVersionRequired
	}
	if err := s.repo.DeleteVersion(id, opts.Version); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrVersionNotFound
		}
		return fmt.Errorf("delete version %q/%q: %w", id, opts.Version, err)
	}
	if err := s.repo.RecountVersionCount(id); err != nil {
		slog.Warn("recount version count after remove", "id", id, "err", err)
	}
	slog.Info("plugin version removed", "id", id, "version", opts.Version)
	return nil
}

// normalizeTags trims, dedupes (case-insensitive), and drops empty
// entries. The order is preserved.
func normalizeTags(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(tags))
	out := make([]string, 0, len(tags))
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		lower := strings.ToLower(t)
		if _, dup := seen[lower]; dup {
			continue
		}
		seen[lower] = struct{}{}
		out = append(out, t)
	}
	return out
}

// encodeTags serializes tags to a JSON array string suitable for
// the SQLite JSON1 column. Empty slice yields "[]".
func encodeTags(tags []string) string {
	if len(tags) == 0 {
		return "[]"
	}
	var b strings.Builder
	b.WriteByte('[')
	for i, t := range tags {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		for _, r := range t {
			switch r {
			case '"', '\\':
				b.WriteByte('\\')
				b.WriteRune(r)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				if r < 0x20 {
					continue
				}
				b.WriteRune(r)
			}
		}
		b.WriteByte('"')
	}
	b.WriteByte(']')
	return b.String()
}
