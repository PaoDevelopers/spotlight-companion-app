// Package handler is the entry point Vercel looks for. It only forwards to package preview (see there for the caveats).
package handler

import (
	"net/http"

	"github.com/PaoDevelopers/spotlight-companion-app/server/preview"
)

// Handler serves every request.
func Handler(w http.ResponseWriter, r *http.Request) { preview.Handle(w, r) }
