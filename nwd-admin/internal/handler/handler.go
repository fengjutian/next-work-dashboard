package handler

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
)

//go:embed ../view/layout.html
var layoutHTML string

//go:embed ../view/home.html ../view/plugins.html
var pageFS embed.FS

var (
	buildVersion  = "dev"
	pluginIDRegex = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$`)
	// Pre-parsed layout template (cloned per render with page injected).
	baseLayout *template.Template
)

func init() {
	if info, ok := debug.ReadBuildInfo(); ok {
		buildVersion = info.Main.Version
	}
	if buildVersion == "" || buildVersion == "(devel)" {
		buildVersion = "dev"
	}
	baseLayout = template.Must(template.New("layout").Parse(layoutHTML))
}

type Handler struct {
	DB *sql.DB
}

func New(db *sql.DB) *Handler {
	return &Handler{DB: db}
}

// ── Pages ──

func (h *Handler) HomePage(w http.ResponseWriter, r *http.Request) {
	pluginCount, _ := h.countPlugins()
	totalDownloads, _ := h.sumDownloads()
	recentCount, _ := h.countRecent(7)
	recent, _ := h.listRecent(10)

	data := map[string]any{
		"Version":        buildVersion,
		"PluginCount":    pluginCount,
		"TotalDownloads": totalDownloads,
		"RecentCount":    recentCount,
		"RecentPlugins":  recent,
	}
	h.render(w, "home.html", data)
}

func (h *Handler) PluginsPage(w http.ResponseWriter, r *http.Request) {
	plugins, _ := h.listAll()
	data := map[string]any{
		"Version": buildVersion,
		"Plugins": plugins,
	}
	h.render(w, "plugins.html", data)
}

// ── API ──

func (h *Handler) ListPlugins(w http.ResponseWriter, r *http.Request) {
	plugins, err := h.listAll()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if plugins == nil {
		plugins = []model.Plugin{}
	}
	writeJSON(w, 200, plugins)
}

func (h *Handler) UploadPlugin(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "文件过大（最大 10MB）", 400)
		return
	}
	file, header, err := r.FormFile("bundle")
	if err != nil {
		http.Error(w, "缺少 bundle 字段", 400)
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".nwd") {
		http.Error(w, "仅支持 .nwd 文件", 400)
		return
	}

	bundle, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "读取文件失败", 500)
		return
	}

	// Parse .nwd manifest to extract real metadata (Bug 4 fix).
	meta := parseNWDMeta(bundle, header.Filename)
	if !pluginIDRegex.MatchString(meta.ID) {
		http.Error(w, fmt.Sprintf("无效的插件 ID: %q（需 2-64 位字母/数字/._-）", meta.ID), 400)
		return
	}

	err = h.upsertPlugin(model.Plugin{
		ID:          meta.ID,
		Name:        meta.Name,
		Version:     meta.Version,
		Author:      meta.Author,
		Description: meta.Description,
		IconEmoji:   meta.IconEmoji,
		SizeBytes:   int64(len(bundle)),
	}, bundle)
	if err != nil {
		http.Error(w, "保存失败: "+err.Error(), 500)
		return
	}

	http.Redirect(w, r, "/plugins", 303)
}

func (h *Handler) DownloadPlugin(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !pluginIDRegex.MatchString(id) {
		http.Error(w, "invalid plugin id", 400)
		return
	}

	var bundle []byte
	var name, version string
	err := h.DB.QueryRow("SELECT bundle, name, version FROM plugins WHERE id = ?", id).Scan(&bundle, &name, &version)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	h.DB.Exec("UPDATE plugins SET downloads = downloads + 1 WHERE id = ?", id)

	filename := sanitizeFilename(fmt.Sprintf("%s-%s.nwd", name, version))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(bundle)))
	w.Write(bundle)
}

func (h *Handler) DeletePlugin(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if r.FormValue("_method") != "DELETE" {
		http.Error(w, "method not allowed", 405)
		return
	}
	h.DB.Exec("DELETE FROM plugins WHERE id = ?", id)
	http.Redirect(w, r, "/plugins", 303)
}

// ── render (template parsed once at init, cloned per request — Bug 1 fix) ──

func (h *Handler) render(w http.ResponseWriter, pageFile string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["Version"] = buildVersion

	pageBytes, err := pageFS.ReadFile(pageFile)
	if err != nil {
		http.Error(w, "template not found: "+pageFile, 500)
		return
	}

	tmpl, err := baseLayout.Clone()
	if err != nil {
		http.Error(w, "layout clone: "+err.Error(), 500)
		return
	}
	tmpl, err = tmpl.New("content").Parse(string(pageBytes))
	if err != nil {
		http.Error(w, "page parse: "+err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		http.Error(w, "render: "+err.Error(), 500)
	}
}

// ── DB helpers ──

func (h *Handler) countPlugins() (int64, error) {
	var n int64
	err := h.DB.QueryRow("SELECT COUNT(*) FROM plugins").Scan(&n)
	return n, err
}

func (h *Handler) sumDownloads() (int64, error) {
	var n int64
	err := h.DB.QueryRow("SELECT COALESCE(SUM(downloads), 0) FROM plugins").Scan(&n)
	return n, err
}

func (h *Handler) countRecent(days int) (int64, error) {
	var n int64
	err := h.DB.QueryRow("SELECT COUNT(*) FROM plugins WHERE created_at >= datetime('now', ?)", fmt.Sprintf("-%d days", days)).Scan(&n)
	return n, err
}

func (h *Handler) listRecent(limit int) ([]model.Plugin, error) {
	return h.queryPlugins("SELECT id, name, version, author, description, icon_emoji, tags, size_bytes, downloads, created_at, updated_at FROM plugins ORDER BY created_at DESC LIMIT ?", limit)
}

func (h *Handler) listAll() ([]model.Plugin, error) {
	return h.queryPlugins("SELECT id, name, version, author, description, icon_emoji, tags, size_bytes, downloads, created_at, updated_at FROM plugins ORDER BY updated_at DESC")
}

func (h *Handler) queryPlugins(query string, args ...any) ([]model.Plugin, error) {
	rows, err := h.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Plugin
	for rows.Next() {
		var p model.Plugin
		var ca, ua string
		if err := rows.Scan(&p.ID, &p.Name, &p.Version, &p.Author, &p.Description, &p.IconEmoji, &p.Tags, &p.SizeBytes, &p.Downloads, &ca, &ua); err != nil {
			return out, err
		}
		p.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", ca)
		p.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", ua)
		out = append(out, p)
	}
	return out, rows.Err()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func (h *Handler) upsertPlugin(p model.Plugin, bundle []byte) error {
	_, err := h.DB.Exec(`
		INSERT INTO plugins (id, name, version, author, description, icon_emoji, size_bytes, bundle, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			version=excluded.version, bundle=excluded.bundle, size_bytes=excluded.size_bytes, updated_at=datetime('now')
	`, p.ID, p.Name, p.Version, p.Author, p.Description, p.IconEmoji, p.SizeBytes, bundle)
	return err
}

// ── .nwd manifest parser (Bug 4 fix) ──

type nwdMeta struct {
	ID, Name, Version, Author, Description, IconEmoji string
}

// parseNWDMeta extracts metadata from a .nwd v1 bundle.
// Falls back to filename-based defaults if the bundle can't be parsed.
func parseNWDMeta(bundle []byte, filename string) nwdMeta {
	// Defaults from filename (Bug 3: safe fallback, validated by caller).
	id := sanitizeID(strings.TrimSuffix(filename, ".nwd"))
	name := id
	version := "0.1.0"
	author := ""
	desc := fmt.Sprintf("Uploaded %s", time.Now().Format("2006-01-02"))
	icon := "📊"

	// Try to parse as JSON .nwd v1 bundle.
	var raw struct {
		Format   string `json:"format"`
		Manifest struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Version     string `json:"version"`
			Author      string `json:"author"`
			Description string `json:"description"`
			IconEmoji   string `json:"iconEmoji"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(bundle, &raw); err == nil && raw.Format == "nwd-v1" {
		if raw.Manifest.Name != "" {
			name = raw.Manifest.Name
		}
		if raw.Manifest.Version != "" {
			version = raw.Manifest.Version
		}
		if raw.Manifest.Author != "" {
			author = raw.Manifest.Author
		}
		if raw.Manifest.Description != "" {
			desc = raw.Manifest.Description
		}
		if raw.Manifest.IconEmoji != "" {
			icon = raw.Manifest.IconEmoji
		}
		if raw.Manifest.ID != "" {
			id = raw.Manifest.ID
		}
	}

	return nwdMeta{ID: id, Name: name, Version: version, Author: author, Description: desc, IconEmoji: icon}
}

// ── Input sanitizers (Bug 2 & 3 fixes) ──

// sanitizeFilename strips characters unsafe for Content-Disposition header.
// Replaces "/", "\", `"`, newlines, and control chars with "_".
var unsafeFilenameRegex = regexp.MustCompile(`["/\x00-\x1f\x7f]`)

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	name = unsafeFilenameRegex.ReplaceAllString(name, "_")
	// Also strip path traversal sequences.
	name = filepath.Base(name)
	if name == "" || name == "." {
		name = "plugin.nwd"
	}
	return name
}

// sanitizeID strips all characters not allowed in a plugin ID.
var sanitizeIDRegex = regexp.MustCompile(`[^\p{L}\p{N}._-]`)

func sanitizeID(raw string) string {
	s := sanitizeIDRegex.ReplaceAllString(raw, "")
	if s == "" {
		return "unknown"
	}
	if len(s) > 64 {
		s = s[:64]
	}
	return s
}
