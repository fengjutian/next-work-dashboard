package service

import (
	"sync"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"github.com/fjutian/nwd-admin/internal/repository"
	"gorm.io/gorm"
)

// fakeRepo is an in-memory implementation of
// repository.PluginRepository used by service-level tests. It
// supports the full interface so the test exercises the real
// service code paths without needing SQLite + CGO.
type fakeRepo struct {
	mu       sync.Mutex
	plugins  map[string]model.Plugin
	versions map[string]map[string]model.PluginVersion // key: pluginID -> version -> row
	tsMu     sync.Mutex
	lastTS   time.Time
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		plugins:  make(map[string]model.Plugin),
		versions: make(map[string]map[string]model.PluginVersion),
		lastTS:   time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
	}
}

func key(pluginID, version string) string { return pluginID + "|" + version }

func (r *fakeRepo) pluginByID(id string) (model.Plugin, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.plugins[id]
	return p, ok
}

func (r *fakeRepo) versionByID(pluginID, version string) (model.PluginVersion, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	vs, ok := r.versions[pluginID]
	if !ok {
		return model.PluginVersion{}, false
	}
	v, ok := vs[version]
	return v, ok
}

func (r *fakeRepo) Count() (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return int64(len(r.plugins)), nil
}

func (r *fakeRepo) SumDownloads() (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var total int64
	for _, p := range r.plugins {
		total += p.TotalDownloads
	}
	return total, nil
}

func (r *fakeRepo) CountSince(days int) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := time.Now().AddDate(0, 0, -days)
	var n int64
	for _, p := range r.plugins {
		if p.UpdatedAt.After(cutoff) {
			n++
		}
	}
	return n, nil
}

func (r *fakeRepo) ListRecent(limit int) ([]model.Plugin, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]model.Plugin, 0, len(r.plugins))
	for _, p := range r.plugins {
		out = append(out, p)
	}
	// Sort by UpdatedAt desc.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].UpdatedAt.After(out[i].UpdatedAt) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// ListPlugins implements a minimal LIKE match on id/name/author/description
// for the fake. The real repository uses SQLite JSON1 + LIKE.
func (r *fakeRepo) ListPlugins(q repository.PluginListQuery) ([]model.Plugin, error) {
	return r.listPluginsLike(q)
}

func (r *fakeRepo) CountPlugins(q repository.PluginListQuery) (int64, error) {
	return int64(len(r.filterPlugins(q))), nil
}

// listPluginsLike is a simple substring match across the fields the
// production repository filters. Tag matching is intentionally a
// substring of the JSON string for test simplicity — the real
// implementation uses JSON1 exact match.
func (r *fakeRepo) listPluginsLike(q repository.PluginListQuery) ([]model.Plugin, error) {
	filtered := r.filterPlugins(q)
	// Sort by UpdatedAt desc, tie-breaker ID desc, so the order
	// stays stable even when the fake's millisecond clock collides.
	for i := 0; i < len(filtered); i++ {
		for j := i + 1; j < len(filtered); j++ {
			if filtered[j].UpdatedAt.After(filtered[i].UpdatedAt) ||
				(filtered[j].UpdatedAt.Equal(filtered[i].UpdatedAt) && filtered[j].ID > filtered[i].ID) {
				filtered[i], filtered[j] = filtered[j], filtered[i]
			}
		}
	}
	page, size := clampPage(q.Page, q.Size)
	start := (page - 1) * size
	if start >= len(filtered) {
		return []model.Plugin{}, nil
	}
	end := start + size
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[start:end], nil
}

// filterPlugins returns all plugins matching q's filter predicates,
// without applying pagination. Used by both ListPlugins (which
// paginates after) and CountPlugins (which returns len).
func (r *fakeRepo) filterPlugins(q repository.PluginListQuery) []model.Plugin {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := make([]model.Plugin, 0, len(r.plugins))
	for _, p := range r.plugins {
		if q.Q != "" {
			needle := q.Q
			if !containsFold(p.ID, needle) && !containsFold(p.Name, needle) &&
				!containsFold(p.Author, needle) && !containsFold(p.Description, needle) {
				continue
			}
		}
		if q.Tag != "" && !containsFold(p.Tags, q.Tag) {
			continue
		}
		filtered = append(filtered, p)
	}
	return filtered
}

func clampPage(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 200 {
		size = 200
	}
	return page, size
}

func (r *fakeRepo) FindPluginByID(id string) (*model.Plugin, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.plugins[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return &p, nil
}

func (r *fakeRepo) ListVersions(pluginID string) ([]model.PluginVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	vs, ok := r.versions[pluginID]
	if !ok {
		return []model.PluginVersion{}, nil
	}
	out := make([]model.PluginVersion, 0, len(vs))
	for _, v := range vs {
		out = append(out, v)
	}
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].CreatedAt.After(out[i].CreatedAt) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, nil
}

func (r *fakeRepo) FindVersion(pluginID, version string) (*model.PluginVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	vs, ok := r.versions[pluginID]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	v, ok := vs[version]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return &v, nil
}

func (r *fakeRepo) SavePlugin(p *model.Plugin) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.plugins[p.ID]
	if ok {
		// refresh metadata
		existing.Name = p.Name
		existing.Author = p.Author
		existing.Description = p.Description
		existing.IconEmoji = p.IconEmoji
		existing.Tags = p.Tags
		existing.LatestVersion = p.LatestVersion
		existing.UpdatedAt = r.nextTimestamp()
		r.plugins[p.ID] = existing
		*p = existing
		return nil
	}
	now := r.nextTimestamp()
	p.CreatedAt = now
	p.UpdatedAt = now
	r.plugins[p.ID] = *p
	return nil
}

// nextTimestamp returns a monotonically increasing timestamp so
// tests that publish several plugins in quick succession still see
// a deterministic UpdatedAt ordering. Uses a separate mutex so it
// can be called from inside other locked methods without deadlocking.
func (r *fakeRepo) nextTimestamp() time.Time {
	r.tsMu.Lock()
	defer r.tsMu.Unlock()
	r.lastTS = r.lastTS.Add(time.Millisecond)
	return r.lastTS
}

func (r *fakeRepo) SaveVersion(v *model.PluginVersion) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	vs, ok := r.versions[v.PluginID]
	if !ok {
		vs = make(map[string]model.PluginVersion)
		r.versions[v.PluginID] = vs
	}
	existing, exists := vs[v.Version]
	if exists {
		existing.Bundle = v.Bundle
		existing.SizeBytes = v.SizeBytes
		vs[v.Version] = existing
		*v = existing
		return nil
	}
	v.CreatedAt = r.nextTimestamp()
	vs[v.Version] = *v
	return nil
}

func (r *fakeRepo) UpdateLatestVersion(pluginID, version string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.plugins[pluginID]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	p.LatestVersion = version
	p.UpdatedAt = time.Now()
	r.plugins[pluginID] = p
	return nil
}

func (r *fakeRepo) RecountVersionCount(pluginID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.plugins[pluginID]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	vs := r.versions[pluginID]
	p.VersionCount = int64(len(vs))
	p.UpdatedAt = time.Now()
	r.plugins[pluginID] = p
	return nil
}

func (r *fakeRepo) IncrementVersionDownloads(pluginID, version string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	vs, ok := r.versions[pluginID]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	v, ok := vs[version]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	v.Downloads++
	vs[version] = v
	p := r.plugins[pluginID]
	p.TotalDownloads++
	r.plugins[pluginID] = p
	return nil
}

func (r *fakeRepo) DeletePlugin(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.plugins[id]; !ok {
		return gorm.ErrRecordNotFound
	}
	delete(r.plugins, id)
	delete(r.versions, id)
	return nil
}

func (r *fakeRepo) DeleteVersion(pluginID, version string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	vs, ok := r.versions[pluginID]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	if _, ok := vs[version]; !ok {
		return gorm.ErrRecordNotFound
	}
	delete(vs, version)
	if p, ok := r.plugins[pluginID]; ok {
		if p.LatestVersion == version {
			var latest model.PluginVersion
			for _, v := range vs {
				if latest.Version == "" || v.CreatedAt.After(latest.CreatedAt) {
					latest = v
				}
			}
			if latest.Version != "" {
				p.LatestVersion = latest.Version
			}
		}
		p.VersionCount = int64(len(vs))
		p.UpdatedAt = time.Now()
		r.plugins[pluginID] = p
	}
	return nil
}

// containsFold is a tiny case-insensitive substring test. Avoids
// pulling strings into fake helpers.
func containsFold(s, substr string) bool {
	if substr == "" {
		return true
	}
	if len(substr) > len(s) {
		return false
	}
	for i := 0; i+len(substr) <= len(s); i++ {
		match := true
		for j := 0; j < len(substr); j++ {
			a := s[i+j]
			b := substr[j]
			if a >= 'A' && a <= 'Z' {
				a += 32
			}
			if b >= 'A' && b <= 'Z' {
				b += 32
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
