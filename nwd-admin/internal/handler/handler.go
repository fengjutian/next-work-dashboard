package handler

import (
	"encoding/json"
	"errors"
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
	"unicode/utf8"

	"github.com/fjutian/nwd-admin/internal/audit"
	"github.com/fjutian/nwd-admin/internal/repository"
	"github.com/fjutian/nwd-admin/internal/service"
	viewfiles "github.com/fjutian/nwd-admin/internal/view"
)

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
	layoutBytes, err := viewfiles.FS.ReadFile("layout.html")
	if err != nil {
		panic(fmt.Sprintf("embed layout: %v", err))
	}
	funcs := template.FuncMap{
		"add":      func(a, b int) int { return a + b },
		"subtract": func(a, b int) int { return a - b },
		"splitTags": func(raw string) []string {
			var out []string
			if raw == "" {
				return out
			}
			_ = json.Unmarshal([]byte(raw), &out)
			return out
		},
		"statusText": func(min, max int) string {
			switch {
			case min == 0 && max == 0:
				return ""
			case min == max:
				return strconv.Itoa(min)
			case min%100 == 0 && max == min+99 && min >= 100 && min < 600:
				return strconv.Itoa(min/100) + "xx"
			default:
				return strconv.Itoa(min) + "-" + strconv.Itoa(max)
			}
		},
		"dateInput": func(t time.Time) string {
			if t.IsZero() {
				return ""
			}
			return t.UTC().Format("2006-01-02")
		},
	}
	baseLayout = template.Must(template.New("layout").Funcs(funcs).Parse(string(layoutBytes)))
	componentsBytes, err := viewfiles.FS.ReadFile("components.html")
	if err != nil {
		panic(fmt.Sprintf("embed components: %v", err))
	}
	template.Must(baseLayout.Parse(string(componentsBytes)))
}

type Handler struct {
	plugins *service.PluginService
	audits  audit.Repository
}

// New builds a Handler. The audit repository is optional; when nil
// the audit log endpoints return 503 so the UI degrades gracefully
// instead of crashing.
func New(pluginSvc *service.PluginService, auditRepo audit.Repository) *Handler {
	return &Handler{plugins: pluginSvc, audits: auditRepo}
}

// AuditRepo returns the audit repository, which is also the right
// handle to give to the audit.Recorder middleware and to the
// background prune goroutine.
func (h *Handler) AuditRepo() audit.Repository {
	return h.audits
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
	page, size := parsePluginPagination(r)
	query := buildPluginListQuery(r, page, size)
	plugins, total, err := h.plugins.List(query)
	if err != nil {
		slog.Error("list plugins", "err", err)
	}
	h.render(w, "plugins.html", map[string]any{
		"Version":   buildVersion,
		"Plugins":   plugins,
		"Page":      page,
		"Size":      size,
		"Total":     total,
		"PageCount": pageCount(total, size),
		"Q":         query.Q,
		"Tag":       query.Tag,
	})
}

// ── API ──

// ListPlugins returns plugins as JSON, paginated and filterable.
//
// Query parameters:
//   - q       : substring search across id, name, author, description
//   - tag     : filter to plugins containing the tag
//   - page    : 1-based page number (default 1)
//   - size    : page size (default 20, max 200)
func (h *Handler) ListPlugins(w http.ResponseWriter, r *http.Request) {
	page, size := parsePluginPagination(r)
	query := buildPluginListQuery(r, page, size)
	plugins, total, err := h.plugins.List(query)
	if err != nil {
		slog.Error("list plugins api", "err", err)
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, 200, map[string]any{
		"plugins":   plugins,
		"page":      page,
		"size":      size,
		"total":     total,
		"pageCount": pageCount(total, size),
		"q":         query.Q,
		"tag":       query.Tag,
	})
}

// ListPluginVersions returns the version history of a single plugin.
func (h *Handler) ListPluginVersions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !pluginIDRegex.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的插件 ID"})
		return
	}
	versions, err := h.plugins.Versions(id)
	if err != nil {
		slog.Error("list versions", "id", id, "err", err)
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, 200, map[string]any{
		"plugin_id": id,
		"versions":  versions,
	})
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

	if err := h.plugins.Publish(service.PublishInput{
		ID:          meta.ID,
		Name:        meta.Name,
		Version:     meta.Version,
		Author:      meta.Author,
		Description: meta.Description,
		IconEmoji:   meta.IconEmoji,
		Tags:        meta.Tags,
		Bundle:      bundle,
	}); err != nil {
		slog.Error("publish plugin", "id", meta.ID, "version", meta.Version, "err", err)
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

	requestedVersion := r.URL.Query().Get("version")
	plugin, version, err := h.plugins.Download(id, requestedVersion)
	if err != nil {
		if errors.Is(err, service.ErrVersionNotFound) {
			http.NotFound(w, r)
			return
		}
		slog.Warn("download plugin", "id", id, "version", requestedVersion, "err", err)
		http.Error(w, "下载失败", http.StatusInternalServerError)
		return
	}

	filename := sanitizeFilename(fmt.Sprintf("%s-%s.nwd", plugin.Name, version.Version))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(version.Bundle)))
	w.Write(version.Bundle)
}

func (h *Handler) DeletePlugin(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !pluginIDRegex.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的插件 ID"})
		return
	}
	opts := service.RemoveOptions{
		AllVersions: r.URL.Query().Get("all") == "true",
		Version:     r.URL.Query().Get("version"),
	}
	if err := h.plugins.Remove(id, opts); err != nil {
		switch {
		case errors.Is(err, service.ErrVersionRequired):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "需要指定 version 或 all=true"})
		case errors.Is(err, service.ErrVersionNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "插件或版本不存在"})
		default:
			slog.Error("delete plugin", "id", id, "opts", opts, "err", err)
			writeJSON(w, 500, map[string]string{"error": "删除失败"})
		}
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "deleted"})
}

// ── Audit log ──

const (
	auditPageSize    = 50
	auditMaxPageSize = 500
)

// AuditPage renders the audit log page. Pagination is read from
// ?page=N (1-based) and ?size=N. Optional filters: ?actor=,
// ?action=, ?status=, ?target=, ?from= (RFC3339), ?to= (RFC3339).
func (h *Handler) AuditPage(w http.ResponseWriter, r *http.Request) {
	if h.audits == nil {
		http.Error(w, "审计日志未启用", http.StatusServiceUnavailable)
		return
	}
	page, size := parseAuditPagination(r)
	offset := (page - 1) * size
	q := parseAuditQuery(r)

	entries, err := h.audits.List(r.Context(), q, size, offset)
	if err != nil {
		slog.Error("list audit logs", "err", err)
		http.Error(w, "读取审计日志失败", http.StatusInternalServerError)
		return
	}
	total, err := h.audits.Count(r.Context(), q)
	if err != nil {
		slog.Warn("count audit logs", "err", err)
		total = 0
	}

	h.render(w, "audit.html", map[string]any{
		"Entries":   entries,
		"Page":      page,
		"Size":      size,
		"Total":     total,
		"PageCount": pageCount(total, size),
		"Query":     q,
		"Actions":   knownActions(),
	})
}

// ListAuditLogs returns the audit log as JSON, paginated.
func (h *Handler) ListAuditLogs(w http.ResponseWriter, r *http.Request) {
	if h.audits == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "审计日志未启用"})
		return
	}
	page, size := parseAuditPagination(r)
	offset := (page - 1) * size
	q := parseAuditQuery(r)

	entries, err := h.audits.List(r.Context(), q, size, offset)
	if err != nil {
		slog.Error("list audit logs json", "err", err)
		writeJSON(w, 500, map[string]string{"error": "读取失败"})
		return
	}
	total, _ := h.audits.Count(r.Context(), q)
	writeJSON(w, 200, map[string]any{
		"entries":   entries,
		"page":      page,
		"size":      size,
		"total":     total,
		"pageCount": pageCount(total, size),
		"query":      q,
	})
}

func parseAuditPagination(r *http.Request) (page, size int) {
	page = 1
	size = auditPageSize
	if v, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && v > 0 {
		page = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("size")); err == nil && v > 0 {
		size = v
	}
	if size > auditMaxPageSize {
		size = auditMaxPageSize
	}
	return
}

// parseAuditQuery pulls the filter set from the URL query string.
// The status field accepts a single number (e.g. "401") or a range
// like "4xx" / "5xx" / "200-299". Times accept RFC3339 or YYYY-MM-DD.
func parseAuditQuery(r *http.Request) audit.Query {
	q := r.URL.Query()
	out := audit.Query{
		Actor:  strings.TrimSpace(q.Get("actor")),
		Action: strings.TrimSpace(q.Get("action")),
		Target: strings.TrimSpace(q.Get("target")),
	}
	if s := strings.TrimSpace(q.Get("status")); s != "" {
		out.StatusMin, out.StatusMax = parseStatusRange(s)
	}
	if s := strings.TrimSpace(q.Get("from")); s != "" {
		if t, ok := parseTimeOrDate(s); ok {
			out.From = t
		}
	}
	if s := strings.TrimSpace(q.Get("to")); s != "" {
		if t, ok := parseTimeOrDate(s); ok {
			out.To = t
		}
	}
	return out
}

// parseStatusRange converts "401" / "4xx" / "200-299" to a
// (min, max) pair. Returns (0, 0) when the input is unparseable,
// which the audit.Query treats as "no filter".
func parseStatusRange(s string) (min, max int) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return 0, 0
	}
	if strings.HasSuffix(s, "xx") && len(s) == 3 {
		// Class range: 2xx, 3xx, 4xx, 5xx.
		digit := s[0] - '0'
		if digit < 1 || digit > 5 {
			return 0, 0
		}
		return int(digit) * 100, int(digit)*100 + 99
	}
	if i := strings.Index(s, "-"); i >= 0 {
		mn, err1 := strconv.Atoi(s[:i])
		mx, err2 := strconv.Atoi(s[i+1:])
		if err1 == nil && err2 == nil {
			return mn, mx
		}
		return 0, 0
	}
	if n, err := strconv.Atoi(s); err == nil {
		return n, n
	}
	return 0, 0
}

func parseTimeOrDate(s string) (time.Time, bool) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, true
	}
	return time.Time{}, false
}

// knownActions returns the canonical action labels so the audit
// page can offer a dropdown instead of forcing the user to type.
func knownActions() []string {
	return []string{
		audit.ActionUploadPlugin,
		audit.ActionDeletePlugin,
		audit.ActionListAuditLogs,
		audit.ActionAuthFailure,
		audit.ActionRateLimited,
		audit.ActionUnknownWrite,
	}
}

func pageCount(total int64, size int) int {
	if size <= 0 || total <= 0 {
		return 0
	}
	n := int((total + int64(size) - 1) / int64(size))
	return n
}

// ── Plugin list query / pagination helpers ──────────────────────────

const (
	pluginPageSize    = 20
	pluginMaxPageSize = 200
)

func parsePluginPagination(r *http.Request) (page, size int) {
	page = 1
	size = pluginPageSize
	if v, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && v > 0 {
		page = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("size")); err == nil && v > 0 {
		size = v
	}
	if size > pluginMaxPageSize {
		size = pluginMaxPageSize
	}
	return
}

func buildPluginListQuery(r *http.Request, page, size int) repository.PluginListQuery {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	return repository.PluginListQuery{
		Q:    q,
		Tag:  tag,
		Page: page,
		Size: size,
	}
}

// ── render ──

func (h *Handler) render(w http.ResponseWriter, pageFile string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["Version"] = buildVersion

	pageBytes, err := viewfiles.FS.ReadFile(pageFile)
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
	Tags                                              []string
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
			Tags        []string `json:"tags"`
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
		Tags: raw.Manifest.Tags,
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
