package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Log      LogConfig      `mapstructure:"log"`
	Admin    AdminConfig    `mapstructure:"admin"`
}

type ServerConfig struct {
	Addr         string `mapstructure:"addr"`
	ReadTimeout  int    `mapstructure:"read_timeout"`
	WriteTimeout int    `mapstructure:"write_timeout"`
	IdleTimeout  int    `mapstructure:"idle_timeout"`
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
