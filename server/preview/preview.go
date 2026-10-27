// Package preview runs the Go app as a Vercel serverless function (api/index.go calls Handle) for PREVIEWS only.
// It lives outside internal/ because Vercel compiles the function in its own module, which may not import internal packages.
//
// Vercel runs this as a serverless function, so the database is a temporary SQLite file in /tmp that is filled with
// FAKE demo data when the function starts. Data does not survive a restart and can differ between function instances.
// That is fine for looking at the app, and wrong for real use: the real deployment is the long-running `spotlight`
// program on the school server (see deploy/INSTALL.md).
package preview

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"sync"

	"github.com/kenny-21342/events-tracker/server/internal/app"
	"github.com/kenny-21342/events-tracker/server/internal/config"
	"github.com/kenny-21342/events-tracker/server/internal/db"
	"github.com/kenny-21342/events-tracker/server/internal/ui"
	"github.com/kenny-21342/events-tracker/server/internal/web"
)

var (
	once    sync.Once
	handler http.Handler
	initErr error
)

func setup() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg, err := config.Load("") // settings come from the project's environment variables
	if err != nil {
		initErr = err
		log.Error("settings", slog.Any("err", err))
		return
	}
	ctx := context.Background()
	d, err := db.Open(ctx, cfg.DBPath)
	if err != nil {
		initErr = err
		log.Error("database", slog.Any("err", err))
		return
	}
	a := app.New(d, cfg)
	if cfg.DemoSeed {
		if _, err := a.SeedDemo(ctx); err != nil {
			initErr = err
			log.Error("demo data", slog.Any("err", err))
			return
		}
	}
	handler = web.New(a, log, ui.FS())
}

// Handle serves every request (vercel.json rewrites all paths here).
func Handle(w http.ResponseWriter, r *http.Request) {
	once.Do(setup)
	if initErr != nil {
		http.Error(w, "The preview is misconfigured. See the function logs.", http.StatusInternalServerError)
		return
	}
	handler.ServeHTTP(w, r)
}
