// Command spotlight runs the Spotlight Month web app: one binary with the API, the database and the UI.
//
//	spotlight [-config file] serve        run the server (default)
//	spotlight [-config file] seed-demo    load FAKE demo data and print its login codes
//	spotlight [-config file] backup FILE  write a consistent copy of the database
//	spotlight version
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
	"syscall"
	"time"

	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/app"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/config"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/db"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/ui"
	"github.com/PaoDevelopers/spotlight-companion-app/server/internal/web"
)

var version = "dev" // set at build time: -ldflags "-X main.version=..."

func main() {
	cfgPath := flag.String("config", os.Getenv("SPOTLIGHT_CONFIG"), "path to the KEY=value settings file")
	flag.Parse()
	cmd := flag.Arg(0)
	if cmd == "" {
		cmd = "serve"
	}
	if cmd == "version" {
		fmt.Println(version)
		return
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(cmd, *cfgPath, log); err != nil {
		log.Error("fatal", slog.Any("err", err))
		os.Exit(1)
	}
}

func run(cmd, cfgPath string, log *slog.Logger) error {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("settings: %w", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	d, err := db.Open(ctx, cfg.DBPath)
	if err != nil {
		return err
	}
	defer d.Close()
	a := app.New(d, cfg)

	switch cmd {
	case "backup":
		dest := flag.Arg(1)
		if dest == "" {
			return errors.New("usage: spotlight backup FILE")
		}
		if err := d.Backup(ctx, dest); err != nil {
			return err
		}
		fmt.Println("backup written to", dest)
		return nil
	case "seed-demo":
		codes, err := a.SeedDemo(ctx)
		if err != nil {
			return err
		}
		if codes == nil {
			fmt.Println("demo data already present; nothing changed")
		}
		for email, code := range codes {
			fmt.Printf("%s  %s\n", email, code)
		}
		return nil
	case "serve":
		return serve(ctx, a, log)
	}
	return fmt.Errorf("unknown command %q", cmd)
}

func serve(ctx context.Context, a *app.App, log *slog.Logger) error {
	cfg := a.Cfg
	if admins, err := a.EnsureAdmins(ctx); err != nil {
		return err
	} else {
		for email, code := range admins {
			log.Info("admin account created; this one-time login code is not shown again", slog.String("email", email), slog.String("code", code))
		}
	}
	if cfg.DemoSeed {
		if codes, err := a.SeedDemo(ctx); err != nil {
			return err
		} else if codes != nil {
			log.Warn("loaded FAKE demo data (DEMO_SEED=1); never use this with real students")
		}
	}

	go dailyAwards(ctx, a, log)

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           web.New(a, log, ui.FS()),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    32 << 10,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", slog.String("addr", cfg.Listen), slog.String("public_url", cfg.PublicURL), slog.String("auth_mode", cfg.AuthMode), slog.String("version", version))
		if cfg.TLSCert != "" {
			errc <- srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			errc <- srv.ListenAndServe()
		}
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

// dailyAwards refreshes the DRAFT awards every night at 03:00 server time. It never publishes anything:
// a teacher still reviews and publishes by hand.
func dailyAwards(ctx context.Context, a *app.App, log *slog.Logger) {
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, now.Location())
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
		}
		if _, err := a.RunAwards(ctx, nil); err != nil {
			log.Error("daily awards run failed", slog.Any("err", err))
		} else {
			log.Info("daily award drafts refreshed")
		}
	}
}
