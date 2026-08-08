package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/fjutian/nwd-admin/internal/config"
	"github.com/fjutian/nwd-admin/internal/db"
	"github.com/fjutian/nwd-admin/internal/handler"
)

func main() {
	configPath := flag.String("config", "", "config file path (yaml)")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}

	// Structured logging with level from config.
	var level slog.Level
	switch strings.ToLower(cfg.Log.Level) {
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
	if cfg.Log.Format == "text" {
		h = slog.NewTextHandler(os.Stderr, opts)
	} else {
		h = slog.NewJSONHandler(os.Stderr, opts)
	}
	slog.SetDefault(slog.New(h))

	gormDB, err := db.Open(cfg.Database.DataDir)
	if err != nil {
		slog.Error("open database", "err", err)
		os.Exit(1)
	}

	sqlDB, err := gormDB.DB()
	if err != nil {
		slog.Error("get underlying sql.DB", "err", err)
		os.Exit(1)
	}
	defer sqlDB.Close()

	hdlr := handler.New(gormDB)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	r.Get("/", hdlr.HomePage)
	r.Get("/plugins", hdlr.PluginsPage)
	r.Get("/api/plugins", hdlr.ListPlugins)
	r.Post("/api/plugins", hdlr.UploadPlugin)
	r.Get("/api/plugins/{id}/download", hdlr.DownloadPlugin)
	r.Delete("/api/plugins/{id}", hdlr.DeletePlugin)

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

	slog.Info("server starting", "addr", cfg.Server.Addr, "log_level", cfg.Log.Level)
	fmt.Printf("🧩 NWD Admin listening on http://localhost%s\n", cfg.Server.Addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
