// Package ui embeds the built React app. `make` builds web/ and copies web/dist into internal/ui/dist before compiling.
// When only the placeholder (.gitkeep) is there, the server still runs and answers with a short "not built" message.
package ui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS is the built web app.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
