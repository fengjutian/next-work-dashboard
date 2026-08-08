package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/fjutian/nwd-admin/internal/db"
	"github.com/fjutian/nwd-admin/internal/handler"
)

func main() {
	addr := flag.String("addr", ":8090", "HTTP listen address")
	dataDir := flag.String("data-dir", "./data", "SQLite data directory")
	flag.Parse()

	sqlDB, err := db.Open(*dataDir)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer sqlDB.Close()

	h := handler.New(sqlDB)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	// Pages
	r.Get("/", h.HomePage)
	r.Get("/plugins", h.PluginsPage)

	// API
	r.Get("/api/plugins", h.ListPlugins)
	r.Post("/api/plugins", h.UploadPlugin)
	r.Get("/api/plugins/{id}/download", h.DownloadPlugin)
	r.Delete("/api/plugins/{id}", h.DeletePlugin)

	srv := &http.Server{
		Addr:         *addr,
		Handler:      r,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown via context (P0 fix).
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown error: %v", err)
		}
	}()

	fmt.Printf("🧩 NWD Admin listening on http://localhost%s\n", *addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
	log.Println("server stopped")
}
