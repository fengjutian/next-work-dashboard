package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/fjutian/nwd-admin/internal/auth"
	"github.com/fjutian/nwd-admin/internal/config"
	"github.com/fjutian/nwd-admin/internal/db"
	"github.com/fjutian/nwd-admin/internal/handler"
	"github.com/fjutian/nwd-admin/internal/repository"
	"github.com/fjutian/nwd-admin/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// CLI subcommands. `serve` is the default; `gen-password` produces a
// bcrypt hash for the admin password_hash config field.
const (
	cmdServe         = "serve"
	cmdGenPassword   = "gen-password"
)

func main() {
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		switch os.Args[1] {
		case cmdGenPassword:
			if err := runGenPassword(os.Args[2:]); err != nil {
				fmt.Fprintf(os.Stderr, "gen-password: %v\n", err)
				os.Exit(1)
			}
			return
		case cmdServe:
			// fall through to runServe
		default:
			fmt.Fprintf(os.Stderr, "unknown command %q (use %q or %q)\n", os.Args[1], cmdServe, cmdGenPassword)
			os.Exit(2)
		}
	}

	if err := runServe(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "nwd-admin: %v\n", err)
		os.Exit(1)
	}
}

// runGenPassword prompts for a password (or reads it from -stdin) and
// prints a bcrypt hash suitable for the admin.password_hash field.
func runGenPassword(args []string) error {
	fs := flag.NewFlagSet(cmdGenPassword, flag.ContinueOnError)
	stdin := fs.Bool("stdin", false, "read password from stdin instead of prompting")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var password string
	if *stdin {
		buf, err := readPasswordStdin()
		if err != nil {
			return fmt.Errorf("read stdin: %w", err)
		}
		password = string(buf)
	} else {
		pw, err := promptPassword("admin password: ")
		if err != nil {
			return err
		}
		pw2, err := promptPassword("confirm:        ")
		if err != nil {
			return err
		}
		if pw != pw2 {
			return errors.New("passwords do not match")
		}
		password = pw
	}
	if password == "" {
		return errors.New("password must not be empty")
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash: %w", err)
	}
	fmt.Println(hash)
	return nil
}

func runServe(args []string) error {
	fs := flag.NewFlagSet(cmdServe, flag.ContinueOnError)
	configPath := fs.String("config", "", "config file path (yaml)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	logger, err := buildLogger(cfg.Log)
	if err != nil {
		return err
	}
	slog.SetDefault(logger)

	verifier, err := buildVerifier(cfg)
	if err != nil {
		return err
	}

	gormDB, err := db.Open(cfg.Database.DataDir)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return fmt.Errorf("get underlying sql.DB: %w", err)
	}
	defer sqlDB.Close()

	hdlr := handler.New(service.NewPluginService(repository.NewPluginRepository(gormDB)))

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(securityHeaders)

	// Public read endpoints and pages.
	r.Get("/", hdlr.HomePage)
	r.Get("/plugins", hdlr.PluginsPage)
	r.Get("/api/plugins", hdlr.ListPlugins)
	r.Get("/api/plugins/{id}/download", hdlr.DownloadPlugin)

	// Write endpoints require admin authentication when configured.
	r.Group(func(r chi.Router) {
		if verifier != nil {
			r.Use(verifier.Middleware)
		}
		r.Post("/api/plugins", hdlr.UploadPlugin)
		r.Delete("/api/plugins/{id}", hdlr.DeletePlugin)
	})

	srv := &http.Server{
		Addr:         cfg.Server.Addr,
		Handler:      r,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
		IdleTimeout:  time.Duration(cfg.Server.IdleTimeout) * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		slog.Info("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown error", "err", err)
		}
	}()

	if verifier != nil {
		slog.Info("server starting",
			"addr", cfg.Server.Addr,
			"log_level", cfg.Log.Level,
			"admin_user", cfg.Admin.Username,
			"admin_realm", cfg.Admin.Realm,
		)
	} else {
		slog.Warn("server starting WITHOUT admin authentication — write endpoints are unprotected",
			"addr", cfg.Server.Addr,
			"log_level", cfg.Log.Level,
		)
	}
	fmt.Printf("🧩 NWD Admin listening on http://localhost%s\n", cfg.Server.Addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}
	slog.Info("server stopped")
	return nil
}

// buildLogger wires the slog logger from config.
func buildLogger(cfg config.LogConfig) (*slog.Logger, error) {
	var level slog.Level
	switch strings.ToLower(cfg.Level) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if cfg.Format == "text" {
		h = slog.NewTextHandler(os.Stderr, opts)
	} else {
		h = slog.NewJSONHandler(os.Stderr, opts)
	}
	return slog.New(h), nil
}

// buildVerifier wires the admin verifier from config. A nil return
// means authentication is disabled (trusted-local mode).
func buildVerifier(cfg *config.Config) (*auth.Verifier, error) {
	if !cfg.Admin.Enabled() {
		return nil, nil
	}
	return auth.NewVerifier(cfg.Admin)
}

// securityHeaders adds defensive HTTP response headers to every
// response. These protect against common browser-side attacks; they
// do not replace authentication.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'")
		h.Set("Permissions-Policy", "interest-cohort=()")
		next.ServeHTTP(w, r)
	})
}
