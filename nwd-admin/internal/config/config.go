package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	Database  DatabaseConfig  `mapstructure:"database"`
	Log       LogConfig       `mapstructure:"log"`
	Admin     AdminConfig     `mapstructure:"admin"`
	RateLimit RateLimitConfig `mapstructure:"rate_limit"`
	Audit     AuditConfig     `mapstructure:"audit"`
}

type ServerConfig struct {
	Addr         string     `mapstructure:"addr"`
	ReadTimeout  int        `mapstructure:"read_timeout"`
	WriteTimeout int        `mapstructure:"write_timeout"`
	IdleTimeout  int        `mapstructure:"idle_timeout"`
	TLS          TLSConfig  `mapstructure:"tls"`
}

// TLSConfig controls optional TLS termination.
//
// Two modes are supported:
//
//  1. Static: when CertFile + KeyFile are set, the server runs
//     ListenAndServeTLS. Suitable for self-signed dev certs or
//     a cert obtained from any CA (Let's Encrypt via certbot,
//     internal PKI, etc.).
//
//  2. ACME (autocert): when ACME.Hosts is non-empty, the server
//     fetches and renews certificates from Let's Encrypt
//     automatically. Requires the binary to be reachable on port
//     80 for the http-01 challenge.
//
// Setting only one of CertFile / KeyFile is treated as a misconfig
// and the server refuses to start.
type TLSConfig struct {
	// Enabled is a convenience flag for deployments that want
	// TLS turned on/off without removing the rest of the block.
	// When false, neither static nor ACME takes effect even if
	// configured.
	Enabled bool `mapstructure:"enabled"`

	// CertFile / KeyFile point at a PEM-encoded certificate +
	// private key pair. Used in static mode.
	CertFile string `mapstructure:"cert_file"`
	KeyFile  string `mapstructure:"key_file"`

	// MinVersion is the minimum TLS version accepted. Defaults
	// to TLS 1.2 when empty.
	MinVersion string `mapstructure:"min_version"`

	// ACME configures on-the-fly Let's Encrypt certificates.
	ACME ACMEConfig `mapstructure:"acme"`

	// RedirectHTTP, when true, spawns a sidecar HTTP listener
	// on :80 that 308-redirects every request to HTTPS. Useful
	// when terminating TLS on the same host.
	RedirectHTTP bool `mapstructure:"redirect_http"`
}

// Enabled reports whether TLS termination should run, taking the
// explicit Enabled flag and the cert/ACME settings into account.
func (t TLSConfig) EnabledMode() bool {
	if !t.Enabled {
		return false
	}
	return t.StaticMode() || t.ACMEMode()
}

// StaticMode reports whether a static cert+key pair is configured.
func (t TLSConfig) StaticMode() bool {
	return t.CertFile != "" || t.KeyFile != ""
}

// ACMEMode reports whether autocert is configured.
func (t TLSConfig) ACMEMode() bool {
	return len(t.ACME.Hosts) > 0
}

// ACMEConfig drives the autocert manager.
type ACMEConfig struct {
	// Hosts is the list of fully-qualified domain names the
	// server should obtain certificates for. The first entry
	// becomes the primary cert; the rest are SAN entries.
	Hosts []string `mapstructure:"hosts"`
	// CacheDir holds the certificate cache. Defaults to
	// "<data_dir>/acme-cache" when empty.
	CacheDir string `mapstructure:"cache_dir"`
	// Email is the contact address for the Let's Encrypt
	// account. Empty disables email contact (still valid but
	// not recommended for production).
	Email string `mapstructure:"email"`
	// Staging uses Let's Encrypt's staging environment. Useful
	// for testing; never set this in production.
	Staging bool `mapstructure:"staging"`
}

type DatabaseConfig struct {
	DataDir string `mapstructure:"data_dir"`
}

type LogConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"` // json or text
}

// AdminConfig controls write-side authentication.
//
// Authentication is OPT-IN: if both Username and PasswordHash are empty,
// the service runs in trusted-local mode and write endpoints are
// unprotected. As soon as either field is set, the server refuses to
// start without a matching pair, so a misconfigured deployment cannot
// accidentally ship a half-protected admin surface.
//
// PasswordHash must be a bcrypt hash produced by `nwd-admin gen-password`.
type AdminConfig struct {
	Username     string `mapstructure:"username"`
	PasswordHash string `mapstructure:"password_hash"`
	Realm        string `mapstructure:"realm"`
}

// Enabled reports whether admin authentication is configured.
func (a AdminConfig) Enabled() bool {
	return a.Username != "" && a.PasswordHash != ""
}

// RateLimitConfig defines per-traffic-class throttling.
//
// Each class is a separate token bucket per client IP. Set Rate to
// 0 to disable a class entirely. Defaults aim at "annoying enough
// to deter casual abuse, generous enough to keep interactive use
// smooth":
//
//	read:   60 req/s, burst 30   (pages + JSON listing + download)
//	write:  5  req/s, burst 5    (upload + delete, requires auth)
//	admin:  30 req/s, burst 10   (admin UI + audit log API)
type RateLimitConfig struct {
	Read   PolicyConfig `mapstructure:"read"`
	Write  PolicyConfig `mapstructure:"write"`
	Admin  PolicyConfig `mapstructure:"admin"`
}

// PolicyConfig is the YAML form of a single rate-limit policy.
type PolicyConfig struct {
	Rate  float64 `mapstructure:"rate"`
	Burst int     `mapstructure:"burst"`
}

// AuditConfig controls the audit log subsystem.
//
// Disable=true turns the recorder into a no-op without removing the
// table; useful for performance-sensitive deployments.
//
// RetentionDays controls how long rows are kept. Set to 0 to keep
// forever. A periodic prune goroutine trims older rows at startup
// and then once an hour.
type AuditConfig struct {
	Disable       bool `mapstructure:"disable"`
	RetentionDays int  `mapstructure:"retention_days"`
}

// Load reads config from file, environment variables, and defaults.
func Load(configPath string) (*Config, error) {
	v := viper.New()

	// Defaults
	v.SetDefault("server.addr", ":8090")
	v.SetDefault("server.read_timeout", 5)
	v.SetDefault("server.write_timeout", 10)
	v.SetDefault("server.idle_timeout", 120)
	v.SetDefault("database.data_dir", "./data")
	v.SetDefault("log.level", "info")
	v.SetDefault("log.format", "json")
	v.SetDefault("admin.username", "")
	v.SetDefault("admin.password_hash", "")
	v.SetDefault("admin.realm", "nwd-admin")

	// Rate limit defaults. A zero value disables a class.
	v.SetDefault("rate_limit.read.rate", 60.0)
	v.SetDefault("rate_limit.read.burst", 30)
	v.SetDefault("rate_limit.write.rate", 5.0)
	v.SetDefault("rate_limit.write.burst", 5)
	v.SetDefault("rate_limit.admin.rate", 30.0)
	v.SetDefault("rate_limit.admin.burst", 10)

	// Audit defaults.
	v.SetDefault("audit.disable", false)
	v.SetDefault("audit.retention_days", 90)

	// TLS defaults. Off by default — operators opt in explicitly.
	v.SetDefault("server.tls.enabled", false)
	v.SetDefault("server.tls.cert_file", "")
	v.SetDefault("server.tls.key_file", "")
	v.SetDefault("server.tls.min_version", "1.2")
	v.SetDefault("server.tls.redirect_http", false)
	v.SetDefault("server.tls.acme.hosts", []string{})
	v.SetDefault("server.tls.acme.cache_dir", "")
	v.SetDefault("server.tls.acme.email", "")
	v.SetDefault("server.tls.acme.staging", false)

	// Config file
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath(".")
		v.AddConfigPath("./configs")
	}
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config: %w", err)
		}
		// Config file not found is OK — use defaults + env.
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	return &cfg, nil
}
