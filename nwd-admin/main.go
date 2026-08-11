package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/fjutian/nwd-admin/internal/audit"
	"github.com/fjutian/nwd-admin/internal/auth"
	"github.com/fjutian/nwd-admin/internal/config"
	"github.com/fjutian/nwd-admin/internal/csrf"
	"github.com/fjutian/nwd-admin/internal/db"
	"github.com/fjutian/nwd-admin/internal/handler"
	"github.com/fjutian/nwd-admin/internal/migrate"
	"github.com/fjutian/nwd-admin/internal/ratelimit"
	"github.com/fjutian/nwd-admin/internal/repository"
	"github.com/fjutian/nwd-admin/internal/server"
	"github.com/fjutian/nwd-admin/internal/service"
	"github.com/fjutian/nwd-admin/internal/tlsconfig"
	"golang.org/x/crypto/acme/autocert"
)

// CLI subcommands. `serve` is the default; `gen-password`,
// `gen-cert`, and `migrate` are operator helpers.
const (
	cmdServe       = "serve"
	cmdGenPassword = "gen-password"
	cmdGenCert     = "gen-cert"
	cmdMigrate     = "migrate"
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
		case cmdGenCert:
			if err := runGenCert(os.Args[2:]); err != nil {
				fmt.Fprintf(os.Stderr, "gen-cert: %v\n", err)
				os.Exit(1)
			}
			return
		case cmdMigrate:
			if err := runMigrateCmd(os.Args[2:]); err != nil {
				fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
				os.Exit(1)
			}
			return
		case cmdServe:
			// fall through to runServe
		default:
			fmt.Fprintf(os.Stderr, "unknown command %q (use %q, %q, %q, or %q)\n",
				os.Args[1], cmdServe, cmdGenPassword, cmdGenCert, cmdMigrate)
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

// runGenCert produces a self-signed certificate + key pair. The
// result is suitable for local development or trusted-network
// deployments; it is NOT a substitute for a CA-issued cert on
// the public Internet.
func runGenCert(args []string) error {
	fs := flag.NewFlagSet(cmdGenCert, flag.ContinueOnError)
	host := fs.String("host", "localhost", "comma-separated list of hostnames / IPs to include")
	outDir := fs.String("out", "./tls", "output directory (created if missing)")
	days := fs.Int("days", 365, "validity in days")
	rsaBits := fs.Int("rsa-bits", 2048, "RSA key size in bits (minimum 2048)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	hosts := splitCSV(*host)
	if len(hosts) == 0 {
		return errors.New("at least one -host value is required")
	}
	if *days <= 0 {
		return errors.New("-days must be positive")
	}
	if *rsaBits < 2048 {
		return errors.New("-rsa-bits must be at least 2048")
	}
	if err := os.MkdirAll(*outDir, 0o700); err != nil {
		return fmt.Errorf("create out dir: %w", err)
	}

	priv, err := rsa.GenerateKey(rand.Reader, *rsaBits)
	if err != nil {
		return fmt.Errorf("generate rsa key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return fmt.Errorf("generate serial: %w", err)
	}
	notBefore := time.Now()
	notAfter := notBefore.AddDate(0, 0, *days)

	template := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: hosts[0]},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			template.IPAddresses = append(template.IPAddresses, ip)
		} else {
			template.DNSNames = append(template.DNSNames, h)
		}
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return fmt.Errorf("create certificate: %w", err)
	}
	certPath := filepath.Join(*outDir, "cert.pem")
	keyPath := filepath.Join(*outDir, "key.pem")
	if err := writePEM(certPath, "CERTIFICATE", derBytes, 0o644); err != nil {
		return err
	}
	// On Windows, os.OpenFile with mode 0600 still ends up with
	// a permissive ACL because there is no POSIX umask to enforce
	// the bits. Force the chmod after the fact so private keys
	// stay private regardless of the host platform.
	if err := os.Chmod(certPath, 0o644); err != nil {
		return fmt.Errorf("chmod cert: %w", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return fmt.Errorf("marshal private key: %w", err)
	}
	if err := writePEM(keyPath, "PRIVATE KEY", keyDER, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(keyPath, 0o600); err != nil {
		return fmt.Errorf("chmod key: %w", err)
	}
	fmt.Printf("wrote %s and %s (valid %d days, hosts: %s)\n",
		certPath, keyPath, *days, strings.Join(hosts, ","))
	return nil
}

func writePEM(path, blockType string, der []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	if err := pem.Encode(f, &pem.Block{Type: blockType, Bytes: der}); err != nil {
		return fmt.Errorf("encode pem to %s: %w", path, err)
	}
	return nil
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// runMigrateCmd carries the on-disk database from the pre-split
// single-table layout to the current two-table layout. Safe to
// re-run; safe to interrupt and resume.
func runMigrateCmd(args []string) error {
	fs := flag.NewFlagSet(cmdMigrate, flag.ContinueOnError)
	configPath := fs.String("config", "", "config file path (yaml)")
	dryRun := fs.Bool("dry-run", false, "report what would be done without modifying the database")
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

	gormDB, err := db.Open(cfg.Database.DataDir)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return fmt.Errorf("get underlying sql.DB: %w", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	state, err := migrate.DetectState(gormDB)
	if err != nil {
		return fmt.Errorf("detect: %w", err)
	}
	fmt.Printf("schema state: %s\n", state)
	if !state.Needs() {
		fmt.Println("no migration needed")
		return nil
	}
	if *dryRun {
		fmt.Println("dry-run: would copy bundles from plugins to plugin_versions and drop legacy columns")
		return nil
	}

	stats, err := migrate.Migrate(ctx, gormDB)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	fmt.Printf("migrated %d plugin row(s): created %d version(s), skipped %d already-present version(s), dropped %d legacy column(s)\n",
		stats.PluginsSeen, stats.VersionsCreated, stats.VersionsSkipped, stats.ColumnsDropped)
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
	if err := tlsconfig.Validate(cfg.Server.TLS); err != nil {
		return fmt.Errorf("tls: %w", err)
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

	hdlr := handler.New(service.NewPluginService(repository.NewPluginRepository(gormDB)), audit.NewGormRepository(gormDB))
	recorder := audit.NewRecorder(hdlr.AuditRepo(), cfg.Audit.Disable)
	csrfCfg := buildCSRFConfig(cfg)
	opts := server.Options{
		Verifier:    verifier,
		ReadLimit:   ratelimit.New(ratelimit.Policy{Rate: cfg.RateLimit.Read.Rate, Burst: cfg.RateLimit.Read.Burst}),
		WriteLimit:  ratelimit.New(ratelimit.Policy{Rate: cfg.RateLimit.Write.Rate, Burst: cfg.RateLimit.Write.Burst}),
		AdminLimit:  ratelimit.New(ratelimit.Policy{Rate: cfg.RateLimit.Admin.Rate, Burst: cfg.RateLimit.Admin.Burst}),
		Recorder:    recorder,
		CSRF:        csrfCfg,
		CSRFEnabled: !cfg.Server.CSRF.Disable,
	}
	handler := server.NewRouter(hdlr, opts)

	srv := &http.Server{
		Addr:         cfg.Server.Addr,
		Handler:      handler,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
		IdleTimeout:  time.Duration(cfg.Server.IdleTimeout) * time.Second,
	}

	// Prune old audit rows on a background goroutine. Skipped
	// when the audit subsystem is disabled or retention is 0
	// (keep forever).
	if !cfg.Audit.Disable && cfg.Audit.RetentionDays > 0 {
		go runAuditPruner(hdlr.AuditRepo(), cfg.Audit.RetentionDays)
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

	// Wire up TLS. The "static" path is straightforward; the
	// "autocert" path also requires a sidecar HTTP→HTTPS redirect
	// listener on :80 so the http-01 ACME challenge succeeds.
	var autocertTLSConfig *tls.Config
	listenAndServe := srv.ListenAndServe
	listenAndServeTLS := func() error { return srv.ListenAndServeTLS(cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile) }
	scheme := "http"
	switch {
	case cfg.Server.TLS.StaticMode():
		tlsCfg, err := tlsconfig.LoadStatic(cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile, cfg.Server.TLS.MinVersion)
		if err != nil {
			return fmt.Errorf("load static tls: %w", err)
		}
		srv.TLSConfig = tlsCfg
		scheme = "https"
	case cfg.Server.TLS.ACMEMode():
		mgr, err := tlsconfig.BuildAutocertManager(cfg.Server.TLS.ACME, cfg.Database.DataDir)
		if err != nil {
			return fmt.Errorf("build autocert manager: %w", err)
		}
		srv.TLSConfig = mgr.TLSConfig()
		autocertTLSConfig = mgr.TLSConfig()
		scheme = "https"
		if cfg.Server.TLS.RedirectHTTP {
			if err := startHTTPRedirector(ctx, mgr, cfg.Server.TLS.ACME.Hosts); err != nil {
				return fmt.Errorf("start http redirector: %w", err)
			}
		}
		_ = autocertTLSConfig
	default:
		// Plain HTTP.
	}

	if verifier != nil {
		slog.Info("server starting",
			"addr", cfg.Server.Addr,
			"scheme", scheme,
			"log_level", cfg.Log.Level,
			"admin_user", cfg.Admin.Username,
			"admin_realm", cfg.Admin.Realm,
		)
	} else {
		slog.Warn("server starting WITHOUT admin authentication — write endpoints are unprotected",
			"addr", cfg.Server.Addr,
			"scheme", scheme,
			"log_level", cfg.Log.Level,
		)
	}
	fmt.Printf("🧩 NWD Admin listening on %s://localhost%s\n", scheme, cfg.Server.Addr)
	switch {
	case cfg.Server.TLS.StaticMode():
		if err := listenAndServeTLS(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("server error: %w", err)
		}
	default:
		if err := listenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("server error: %w", err)
		}
	}
	slog.Info("server stopped")
	_ = autocertTLSConfig // kept for future ACME-only hot paths
	return nil
}

// startHTTPRedirector runs a sidecar HTTP listener on :80 that
// redirects every non-ACME request to the HTTPS equivalent. The
// ACME http-01 challenge path is served by autocert directly so
// the redirector must NOT intercept it.
func startHTTPRedirector(ctx context.Context, mgr *autocert.Manager, hosts []string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Hand the http-01 challenge path back to autocert.
		if strings.HasPrefix(r.URL.Path, "/.well-known/acme-challenge/") {
			mgr.HTTPHandler(nil).ServeHTTP(w, r)
			return
		}
		target := "https://" + r.Host + r.URL.RequestURI()
		// Force a known host in the redirect target so a malformed
		// Host header (rare but possible) cannot steer clients
		// back to the HTTP port.
		if len(hosts) > 0 {
			target = "https://" + hosts[0] + r.URL.RequestURI()
		}
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
	})
	ln, err := net.Listen("tcp", ":80")
	if err != nil {
		return err
	}
	redirector := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = redirector.Shutdown(shutdownCtx)
	}()
	go func() {
		if err := redirector.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http redirector stopped", "err", err)
		}
	}()
	slog.Info("http→https redirector listening on :80")
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

// buildCSRFConfig translates the user-facing CSRFConfig into the
// runtime form, filling in the default origin allow-list when the
// operator left it empty.
func buildCSRFConfig(cfg *config.Config) csrf.Config {
	origins := cfg.Server.CSRF.AllowedOrigins
	if len(origins) == 0 {
		origins = cfg.Server.CSRF.DefaultOrigins(cfg.Server)
	}
	return csrf.Config{
		AllowedOrigins:      origins,
		RequireCustomHeader: cfg.Server.CSRF.RequireCustomHeader,
	}
}

// runAuditPruner periodically removes audit rows older than the
// configured retention window. It runs an initial prune at startup
// (so a fresh deployment drops any pre-existing rows) and then
// every hour. Errors are logged and swallowed.
func runAuditPruner(repo audit.Repository, retentionDays int) {
	if retentionDays <= 0 {
		return
	}
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		cutoff := time.Now().AddDate(0, 0, -retentionDays)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		removed, err := repo.Prune(ctx, cutoff)
		cancel()
		if err != nil {
			slog.Warn("audit prune failed", "err", err)
		} else if removed > 0 {
			slog.Info("audit pruned", "rows", removed, "cutoff", cutoff.Format(time.RFC3339))
		}
		<-tick.C
	}
}
