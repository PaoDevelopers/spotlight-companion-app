//go:build !embedui

package ui

import (
	"io/fs"
	"testing/fstest"
)

// FS is a placeholder: the real web app was not embedded in this build.
func FS() fs.FS {
	return fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Spotlight Month</title><p>The web app is not built into this binary. Run <code>make</code> (it passes <code>-tags embedui</code>).</p>")}}
}
