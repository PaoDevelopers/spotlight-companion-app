# Build the single spotlight binary: the React app, embedded into the Go server.
#   make          build ./spotlight
#   make test     Go tests + web type check
#   make clean
.POSIX:

GO ?= go

.PHONY: all
all: spotlight

web/node_modules: web/package.json web/package-lock.json
	cd web && npm ci
	touch web/node_modules

.PHONY: web
web: web/node_modules
	cd web && npm run build
	rm -rf server/internal/ui/dist
	cp -r web/dist server/internal/ui/dist

spotlight: web
	cd server && $(GO) build -tags embedui -ldflags "-s -w -X main.version=$$(git describe --tags --always --dirty 2>/dev/null || echo dev)" -o ../spotlight ./cmd/spotlight

.PHONY: test
test: web/node_modules
	cd server && $(GO) vet ./... && $(GO) test -race ./...
	cd web && npm run typecheck

.PHONY: clean
clean:
	rm -rf spotlight web/dist server/internal/ui/dist
