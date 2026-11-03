// Command spotlight runs the Spotlight Month web app: one binary with the API, the database and the UI.
//
//	spotlight [-config file] serve        run the server (default)
//	spotlight [-config file] seed-demo    load FAKE demo data and print its login codes
//	spotlight [-config file] backup FILE  write a consistent copy of the database
//	spotlight [-config file] import-students [--dry-run] FILE  add the school's student list as accounts (no login codes)
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
	case "import-students":
		return importStudents(ctx, a, cfg.StudentDomain, flag.Args()[1:])
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

// importStudents loads the school's student list so teachers can find students who have never signed in.
// It prints counts only, never names: the list is about real students.
func importStudents(ctx context.Context, a *app.App, domain string, args []string) error {
	dry, path := false, ""
	for _, x := range args {
		switch {
		case x == "--dry-run" || x == "-n":
			dry = true
		case path == "":
			path = x
		default:
			return errors.New("usage: spotlight import-students [--dry-run] FILE")
		}
	}
	if path == "" {
		return errors.New("usage: spotlight import-students [--dry-run] FILE (a students.db from the school system, or a CSV with the columns id,name,class)")
	}
	recs, err := app.ReadStudentsFile(ctx, path, domain)
	if err != nil {
		return err
	}
	rep, err := a.ImportStudents(ctx, recs, dry)
	if err != nil {
		return err
	}
	verb := "imported"
	if dry {
		verb = "would import (dry run, nothing changed)"
	}
	fmt.Printf("%s: %d read, %d added, %d already had an account, %d got a class, %d skipped\n", verb, rep.Read, rep.Added, rep.Existing, rep.ClassFilled, rep.Skipped)
	if rep.Skipped > 0 {
		fmt.Println("skipped rows have no usable id or name; check the file")
	}
	return nil
}
