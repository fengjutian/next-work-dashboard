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
	"unicode/utf8"

	"github.com/fjutian/nwd-admin/internal/model"
	"github.com/fjutian/nwd-admin/internal/service"
)

//go:embed ../view/*
var viewFS embed.FS

var (
	buildVersion  = "dev"
	pluginIDRegex = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$`)
	versionRegex  = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)
	baseLayout    *template.Template
)

const maxPluginFileSize int64 = 2 << 20

var allowedPermissions = map[string]struct{}{
	"store.read": {}, "clipboard": {}, "inject": {}, "external.open": {},
	"data": {}, "preview": {}, "file.read": {}, "file.write": {},
}

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
	// Multipart adds a small amount of framing data around the file itself.
	r.Body = http.MaxBytesReader(w, r.Body, maxPluginFileSize+(64<<10))
	if err := r.ParseMultipartForm(maxPluginFileSize); err != nil {
		http.Error(w, "请求无效或文件过大（插件最大 2 MB）", http.StatusBadRequest)
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

	bundle, err := io.ReadAll(io.LimitReader(file, maxPluginFileSize+1))
	if err != nil {
		http.Error(w, "读取文件失败", 500)
		return
	}
	if len(bundle) > int(maxPluginFileSize) {
		http.Error(w, "插件文件不能超过 2 MB", http.StatusRequestEntityTooLarge)
		return
	}

	meta, err := parseNWDMeta(bundle)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
	if !pluginIDRegex.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的插件 ID"})
		return
	}
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

func parseNWDMeta(bundle []byte) (nwdMeta, error) {
	var raw struct {
		Format   string `json:"format"`
		Manifest struct {
			ID          string   `json:"id"`
			Name        string   `json:"name"`
			Version     string   `json:"version"`
			Author      string   `json:"author"`
			Description string   `json:"description"`
			IconEmoji   string   `json:"iconEmoji"`
			APIVersion  string   `json:"apiVersion"`
			Runtime     string   `json:"runtime"`
			Permissions []string `json:"permissions"`
		} `json:"manifest"`
		Script string          `json:"script"`
		Style  json.RawMessage `json:"style"`
	}
	if err := json.Unmarshal(bundle, &raw); err != nil {
		return nwdMeta{}, fmt.Errorf("插件包不是有效的 JSON: %v", err)
	}
	if raw.Format != "nwd-v1" {
		return nwdMeta{}, fmt.Errorf("不支持的插件格式，需要 nwd-v1")
	}
	raw.Manifest.Name = strings.TrimSpace(raw.Manifest.Name)
	if raw.Manifest.Name == "" || utf8.RuneCountInString(raw.Manifest.Name) > 100 {
		return nwdMeta{}, fmt.Errorf("manifest.name 必须是 1–100 个字符")
	}
	if !versionRegex.MatchString(raw.Manifest.Version) {
		return nwdMeta{}, fmt.Errorf("manifest.version 必须是有效的语义版本，例如 1.0.0")
	}
	if raw.Manifest.APIVersion != "" && raw.Manifest.APIVersion != "1" {
		return nwdMeta{}, fmt.Errorf("不支持的插件 API 版本: %s", raw.Manifest.APIVersion)
	}
	if raw.Manifest.Runtime != "" && raw.Manifest.Runtime != "sandbox" {
		return nwdMeta{}, fmt.Errorf("仅支持 sandbox runtime")
	}
	if raw.Manifest.Permissions == nil {
		return nwdMeta{}, fmt.Errorf("manifest.permissions 必须是数组")
	}
	for _, permission := range raw.Manifest.Permissions {
		if _, ok := allowedPermissions[permission]; !ok {
			return nwdMeta{}, fmt.Errorf("manifest.permissions 包含未知权限: %s", permission)
		}
	}
	if strings.TrimSpace(raw.Script) == "" {
		return nwdMeta{}, fmt.Errorf("插件脚本为空")
	}
	if len(raw.Style) > 0 && string(raw.Style) != "null" {
		var style string
		if err := json.Unmarshal(raw.Style, &style); err != nil {
			return nwdMeta{}, fmt.Errorf("插件 style 必须是字符串")
		}
	}

	id := strings.TrimSpace(raw.Manifest.ID)
	if id == "" {
		id = strings.ToLower(strings.Join(strings.Fields(raw.Manifest.Name), "-"))
	}
	if !pluginIDRegex.MatchString(id) {
		return nwdMeta{}, fmt.Errorf("插件 ID 必须为 2–64 位字母、数字、点、下划线或连字符")
	}

	icon := strings.TrimSpace(raw.Manifest.IconEmoji)
	if icon == "" {
		icon = "📦"
	}
	return nwdMeta{
		ID: id, Name: raw.Manifest.Name, Version: raw.Manifest.Version,
		Author: strings.TrimSpace(raw.Manifest.Author), Description: strings.TrimSpace(raw.Manifest.Description), IconEmoji: icon,
	}, nil
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
