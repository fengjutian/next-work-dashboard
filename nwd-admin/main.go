package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

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
	r.Post("/api/plugins/{id}", h.DeletePlugin)

	// Graceful shutdown — let main's defer sqlDB.Close() handle cleanup.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		log.Println("shutting down...")
		os.Exit(0)
	}()

	fmt.Printf("🧩 NWD Admin listening on http://localhost%s\n", *addr)
	if err := http.ListenAndServe(*addr, r); err != nil {
		log.Fatalf("server: %v", err)
	}
}
