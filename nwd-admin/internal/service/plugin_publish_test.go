package service

import (
	"bytes"
	"testing"

	"github.com/fjutian/nwd-admin/internal/repository"
)

func TestPublishCreatesPluginAndVersion(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	if err := svc.Publish(PublishInput{
		ID: "hello-world", Name: "Hello World", Version: "1.0.0",
		Author: "alice", Description: "greeting plugin", IconEmoji: "👋",
		Tags:   []string{"greeting", "demo"},
		Bundle: []byte("plugin-bytes-v1"),
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	p, ok := repo.pluginByID("hello-world")
	if !ok {
		t.Fatal("plugin row not created")
	}
	if p.LatestVersion != "1.0.0" {
		t.Errorf("LatestVersion = %q, want 1.0.0", p.LatestVersion)
	}
	if p.VersionCount != 1 {
		t.Errorf("VersionCount = %d, want 1", p.VersionCount)
	}
	if p.Name != "Hello World" || p.Author != "alice" {
		t.Errorf("metadata mismatch: %+v", p)
	}
	if p.Tags != `["greeting","demo"]` {
		t.Errorf("Tags JSON = %q, want [\"greeting\",\"demo\"]", p.Tags)
	}

	v, ok := repo.versionByID("hello-world", "1.0.0")
	if !ok {
		t.Fatal("version row not created")
	}
	if v.SizeBytes != int64(len("plugin-bytes-v1")) {
		t.Errorf("SizeBytes = %d, want %d", v.SizeBytes, len("plugin-bytes-v1"))
	}
}

func TestPublishNewVersionUpdatesLatest(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("a")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.1.0", Bundle: []byte("b")})

	p, _ := repo.pluginByID("x")
	if p.LatestVersion != "1.1.0" {
		t.Errorf("LatestVersion = %q, want 1.1.0", p.LatestVersion)
	}
	if p.VersionCount != 2 {
		t.Errorf("VersionCount = %d, want 2", p.VersionCount)
	}
}

func TestPublishSameVersionOverwritesBundle(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("old")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("new-bytes")})

	v, _ := repo.versionByID("x", "1.0.0")
	if !bytes.Equal(v.Bundle, []byte("new-bytes")) {
		t.Errorf("bundle not overwritten: %q", v.Bundle)
	}
	p, _ := repo.pluginByID("x")
	if p.VersionCount != 1 {
		t.Errorf("VersionCount = %d, want 1", p.VersionCount)
	}
}

func TestPublishRefreshesMetadataOnRepublish(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "Old Name", Version: "1.0.0", Bundle: []byte("a")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "New Name", Version: "1.0.0", Bundle: []byte("b")})

	p, _ := repo.pluginByID("x")
	if p.Name != "New Name" {
		t.Errorf("Name = %q, want New Name", p.Name)
	}
}

func TestPublishNormalizesTags(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{
		ID: "x", Name: "X", Version: "1.0.0",
		Tags:   []string{" alpha ", "beta", "ALPHA", "", "beta", "gamma"},
		Bundle: []byte("a"),
	})
	p, _ := repo.pluginByID("x")
	// Order preserved, dupes (case-insensitive) removed, empties dropped.
	if p.Tags != `["alpha","beta","gamma"]` {
		t.Errorf("Tags = %q, want [\"alpha\",\"beta\",\"gamma\"]", p.Tags)
	}
}

func TestDownloadReturnsLatestByDefault(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("v1")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.1.0", Bundle: []byte("v2")})

	p, v, err := svc.Download("x", "")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if v.Version != "1.1.0" {
		t.Errorf("Version = %q, want 1.1.0", v.Version)
	}
	if !bytes.Equal(v.Bundle, []byte("v2")) {
		t.Errorf("Bundle = %q, want v2", v.Bundle)
	}
	_ = p
}

func TestDownloadAcceptsExplicitVersion(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("v1")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "2.0.0", Bundle: []byte("v2")})

	_, v, err := svc.Download("x", "1.0.0")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if v.Version != "1.0.0" || !bytes.Equal(v.Bundle, []byte("v1")) {
		t.Errorf("got %q/%q, want 1.0.0/v1", v.Version, v.Bundle)
	}
}

func TestDownloadIncrementsCounters(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("v1")})
	if _, _, err := svc.Download("x", ""); err != nil {
		t.Fatalf("download: %v", err)
	}
	if _, _, err := svc.Download("x", "1.0.0"); err != nil {
		t.Fatalf("download: %v", err)
	}
	v, _ := repo.versionByID("x", "1.0.0")
	if v.Downloads != 2 {
		t.Errorf("version downloads = %d, want 2", v.Downloads)
	}
	p, _ := repo.pluginByID("x")
	if p.TotalDownloads != 2 {
		t.Errorf("total downloads = %d, want 2", p.TotalDownloads)
	}
}

func TestDownloadUnknownVersion(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("v1")})
	_, _, err := svc.Download("x", "9.9.9")
	if err != ErrVersionNotFound {
		t.Errorf("err = %v, want ErrVersionNotFound", err)
	}
}

func TestDownloadUnknownPlugin(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	_, _, err := svc.Download("missing", "")
	if err == nil {
		t.Fatal("expected error for missing plugin")
	}
}

func TestRemoveSingleVersionPromotesNextLatest(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("a")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.1.0", Bundle: []byte("b")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.2.0", Bundle: []byte("c")})

	if err := svc.Remove("x", RemoveOptions{Version: "1.2.0"}); err != nil {
		t.Fatalf("remove: %v", err)
	}
	p, _ := repo.pluginByID("x")
	if p.LatestVersion != "1.1.0" {
		t.Errorf("LatestVersion = %q, want 1.1.0", p.LatestVersion)
	}
	if p.VersionCount != 2 {
		t.Errorf("VersionCount = %d, want 2", p.VersionCount)
	}
	if _, ok := repo.versionByID("x", "1.2.0"); ok {
		t.Error("1.2.0 should be removed")
	}
}

func TestRemoveAllVersions(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "1.0.0", Bundle: []byte("a")})
	mustPublish(t, svc, PublishInput{ID: "x", Name: "X", Version: "2.0.0", Bundle: []byte("b")})

	if err := svc.Remove("x", RemoveOptions{AllVersions: true}); err != nil {
		t.Fatalf("remove all: %v", err)
	}
	if _, ok := repo.pluginByID("x"); ok {
		t.Error("plugin row should be removed")
	}
	if vs, err := svc.Versions("x"); err != nil || len(vs) != 0 {
		t.Errorf("versions = %d (err=%v), want 0", len(vs), err)
	}
}

func TestRemoveRequiresVersionOrAll(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	err := svc.Remove("x", RemoveOptions{})
	if err != ErrVersionRequired {
		t.Errorf("err = %v, want ErrVersionRequired", err)
	}
}

func TestRemoveMissingPlugin(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	if err := svc.Remove("missing", RemoveOptions{AllVersions: true}); err != ErrVersionNotFound {
		t.Errorf("err = %v, want ErrVersionNotFound", err)
	}
}

func TestListFiltersByQuery(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	mustPublish(t, svc, PublishInput{ID: "alpha", Name: "Alpha", Version: "1.0.0", Bundle: []byte("a")})
	mustPublish(t, svc, PublishInput{ID: "beta", Name: "Beta", Version: "1.0.0", Bundle: []byte("b"), Author: "alice"})
	mustPublish(t, svc, PublishInput{ID: "gamma", Name: "Gamma", Version: "1.0.0", Bundle: []byte("c")})

	cases := []struct {
		q     string
		tag   string
		want  []string
	}{
		{"", "", []string{"gamma", "beta", "alpha"}}, // ordered by updated_at desc, all set in this order
		{"beta", "", []string{"beta"}},
		{"alice", "", []string{"beta"}},
		{"", "missing", nil},
	}
	for _, c := range cases {
		got, _, err := svc.List(repoListQuery(c.q, c.tag, 1, 20))
		if err != nil {
			t.Fatalf("q=%q tag=%q: %v", c.q, c.tag, err)
		}
		gotIDs := make([]string, 0, len(got))
		for _, p := range got {
			gotIDs = append(gotIDs, p.ID)
		}
		if !stringSlicesEqual(gotIDs, c.want) {
			t.Errorf("q=%q tag=%q got %v, want %v", c.q, c.tag, gotIDs, c.want)
		}
	}
}

func TestListPaginates(t *testing.T) {
	repo := newFakeRepo()
	svc := NewPluginService(repo)
	for _, id := range []string{"a", "b", "c", "d", "e"} {
		mustPublish(t, svc, PublishInput{ID: id, Name: id, Version: "1.0.0", Bundle: []byte(id)})
	}
	page1, total, _ := svc.List(repoListQuery("", "", 1, 2))
	if total != 5 {
		t.Errorf("total = %d, want 5", total)
	}
	if len(page1) != 2 {
		t.Errorf("page1 size = %d, want 2", len(page1))
	}
	page3, _, _ := svc.List(repoListQuery("", "", 3, 2))
	if len(page3) != 1 {
		t.Errorf("page3 size = %d, want 1 (last page)", len(page3))
	}
}

func mustPublish(t *testing.T, svc *PluginService, in PublishInput) {
	t.Helper()
	if err := svc.Publish(in); err != nil {
		t.Fatalf("publish %q/%q: %v", in.ID, in.Version, err)
	}
}

func repoListQuery(q, tag string, page, size int) repository.PluginListQuery {
	return repository.PluginListQuery{Q: q, Tag: tag, Page: page, Size: size}
}

func stringSlicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
