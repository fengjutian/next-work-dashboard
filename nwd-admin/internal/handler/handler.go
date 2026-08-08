package handler

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"github.com/fjutian/nwd-admin/internal/service"
)

//go:embed ../view/*
var viewFS embed.FS

var (
	buildVersion  = "dev"
	pluginIDRegex = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$`)
	baseLayout    *template.Template
)

func init() {
	if info, ok := debug.ReadBuildInfo(); ok {
		buildVersion = info.Main.Version
	}
	if buildVersion == "" || buildVersion == "(devel)" {
		buildVersion = "dev"
	}
	layoutBytes, err := viewFS.ReadFile("view/layout.html")
	if err != nil {
		panic(fmt.Sprintf("embed layout: %v", err))
	}
	baseLayout = template.Must(template.New("layout").Parse(string(layoutBytes)))
	componentsBytes, err := viewFS.ReadFile("view/components.html")
	if err != nil {
		panic(fmt.Sprintf("embed components: %v", err))
	}
	template.Must(baseLayout.Parse(string(componentsBytes)))
}

type Handler struct {
	plugins *service.PluginService
}

func New(pluginSvc *service.PluginService) *Handler {
	return &Handler{plugins: pluginSvc}
}

// ── Pages ──

func (h *Handler) HomePage(w http.ResponseWriter, r *http.Request) {
	count, downloads, recentCount, recent := h.plugins.DashboardStats()
	h.render(w, "home.html", map[string]any{
		"Version":        buildVersion,
		"PluginCount":    count,
		"TotalDownloads": downloads,
		"RecentCount":    recentCount,
		"RecentPlugins":  recent,
	})
}

func (h *Handler) PluginsPage(w http.ResponseWriter, r *http.Request) {
	plugins, err := h.plugins.List()
	if err != nil {
		slog.Error("list plugins", "err", err)
	}
	h.render(w, "plugins.html", map[string]any{
		"Version": buildVersion,
		"Plugins": plugins,
	})
}

// ── API ──

func (h *Handler) ListPlugins(w http.ResponseWriter, r *http.Request) {
	plugins, err := h.plugins.List()
	if err != nil {
		slog.Error("list plugins api", "err", err)
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
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

	meta := parseNWDMeta(bundle, header.Filename)
	if !pluginIDRegex.MatchString(meta.ID) {
		http.Error(w, fmt.Sprintf("无效的插件 ID: %q（需 2-64 位字母/数字/._-）", meta.ID), 400)
		return
	}

	p := &model.Plugin{
		ID:          meta.ID,
		Name:        meta.Name,
		Version:     meta.Version,
		Author:      meta.Author,
		Description: meta.Description,
		IconEmoji:   meta.IconEmoji,
		Bundle:      bundle,
		SizeBytes:   int64(len(bundle)),
	}
	if err := h.plugins.Publish(p); err != nil {
		slog.Error("publish plugin", "id", p.ID, "err", err)
		http.Error(w, "保存失败", 500)
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

	p, err := h.plugins.Download(id)
	if err != nil {
		slog.Warn("download plugin", "id", id, "err", err)
		http.NotFound(w, r)
		return
	}

	filename := sanitizeFilename(fmt.Sprintf("%s-%s.nwd", p.Name, p.Version))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(p.Bundle)))
	w.Write(p.Bundle)
}

func (h *Handler) DeletePlugin(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.plugins.Remove(id); err != nil {
		slog.Error("delete plugin", "id", id, "err", err)
		writeJSON(w, 500, map[string]string{"error": "删除失败"})
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "deleted"})
}

// ── render ──

func (h *Handler) render(w http.ResponseWriter, pageFile string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["Version"] = buildVersion

	pageBytes, err := viewFS.ReadFile("view/" + pageFile)
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

// ── JSON helpers ──

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// ── .nwd manifest parser ──

type nwdMeta struct {
	ID, Name, Version, Author, Description, IconEmoji string
}

func parseNWDMeta(bundle []byte, filename string) nwdMeta {
	id := sanitizeID(strings.TrimSuffix(filename, ".nwd"))
	name := id
	version := "0.1.0"
	author := ""
	desc := fmt.Sprintf("Uploaded %s", time.Now().Format("2006-01-02"))
	icon := "📊"

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

// ── Input sanitizers ──

var unsafeFilenameRegex = regexp.MustCompile(`["/\x00-\x1f\x7f]`)

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	name = unsafeFilenameRegex.ReplaceAllString(name, "_")
	name = filepath.Base(name)
	if name == "" || name == "." {
		name = "plugin.nwd"
	}
	return name
}

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
