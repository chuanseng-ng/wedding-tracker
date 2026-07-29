# Wedding Tracker - task runner.
#
# Thin wrappers over the commands already documented in README.md / CLAUDE.md.
# npm scripts stay the source of truth; this file just gives them short names and
# groups the multi-step ones (CI order, demo-mode smoke, Supabase reset).
#
# Requires a POSIX shell: run from Git Bash on Windows (GNU Make + Git's bash.exe
# are both on PATH there). `make help` lists everything.

ifeq ($(OS),Windows_NT)
SHELL := bash.exe
else
SHELL := /bin/bash
endif
.SHELLFLAGS := -eu -o pipefail -c

PORT      ?= 5173
DEMO_PORT ?= 5199

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

.PHONY: setup
setup: install env ## First-time setup: install dependencies and create .env
	@echo ""
	@echo "Setup done. Next: fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env, then 'make dev'."

.PHONY: install
install: ## Install dependencies exactly as locked (npm ci)
	@# npm ci wipes node_modules first, so a running dev server holding
	@# rolldown's native .node binary makes it fail with EPERM on Windows.
	@# Stop `make dev` / `make smoke` before running this.
	npm ci

.PHONY: env
env: ## Create .env from .env.example (never overwrites an existing .env)
	@if [ -f .env ]; then \
		echo ".env already exists - leaving it untouched."; \
	else \
		cp .env.example .env; \
		echo "Created .env from .env.example - fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY."; \
	fi

# ---------------------------------------------------------------------------
# Dev servers
# ---------------------------------------------------------------------------

.PHONY: dev
dev: ## Vite dev server - / = admin, /rsvp = public form
	npm run dev -- --port $(PORT)

.PHONY: smoke
smoke: ## Dev server forced into demo mode (no Supabase, in-file DEMO_GUESTS)
	@echo "Demo mode on :$(DEMO_PORT) - public routes: /rsvp, /wedding/:slug, /wishes-wrapped"
	VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port $(DEMO_PORT) --strictPort

.PHONY: api
api: ## Run the api/ serverless functions locally (needs Vercel CLI + .env)
	vercel dev

.PHONY: preview
preview: build ## Build, then serve dist/ locally
	npm run preview

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------

.PHONY: ci
ci: ## Everything CI runs, in CI's order - run before committing
	@# Recipe lines, not prerequisites: `make -j ci` would start all four at once
	@# and report gates out of order, which defeats the point of this target.
	$(MAKE) lint
	$(MAKE) test
	$(MAKE) build
	$(MAKE) audit
	@echo ""
	@echo "All CI gates passed."

.PHONY: lint
lint: ## ESLint (flat config, --max-warnings 0)
	npm run lint

.PHONY: test
test: ## Vitest, single pass
	npm test

.PHONY: test-watch
test-watch: ## Vitest in watch mode
	npx vitest

.PHONY: test-file
test-file: ## One test file - make test-file FILE=src/lib/nameMatch.test.js
	@if [ -z "$(FILE)" ]; then echo "Usage: make test-file FILE=src/lib/nameMatch.test.js" >&2; exit 2; fi
	npx vitest run $(FILE)

.PHONY: test-name
test-name: ## Tests matching a name - make test-name NAME="fuzzy match"
	@if [ -z "$(NAME)" ]; then echo 'Usage: make test-name NAME="substring"' >&2; exit 2; fi
	npx vitest run -t "$(NAME)"

.PHONY: build
build: ## Production build -> dist/
	npm run build

.PHONY: audit
audit: ## Fail on un-allowlisted high/critical advisories
	node scripts/security-audit.mjs

.PHONY: versions
versions: ## Print resolved react / react-dom (must match - see CHANGELOG 2026-07-29)
	@node -e "for (const p of ['react', 'react-dom']) console.log(p.padEnd(10), require('./node_modules/' + p + '/package.json').version)"

# ---------------------------------------------------------------------------
# Supabase (local stack)
# ---------------------------------------------------------------------------

.PHONY: db-start
db-start: ## Start the local Postgres stack (Inbucket catches mail on :54324)
	supabase start

.PHONY: db-stop
db-stop: ## Stop the local Postgres stack
	supabase stop

.PHONY: db-reset
db-reset: ## Re-run every migration + seed.sql against the local DB
	supabase db reset

.PHONY: db-push
db-push: ## Apply pending migrations to the REMOTE project
	supabase db push

.PHONY: db-migration
db-migration: ## New migration file - make db-migration NAME=add_widget_column
	@if [ -z "$(NAME)" ]; then echo "Usage: make db-migration NAME=add_widget_column" >&2; exit 2; fi
	supabase migration new $(NAME)

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove build output
	rm -rf dist

.PHONY: clean-all
clean-all: clean ## Remove build output and node_modules
	rm -rf node_modules

.PHONY: help
help: ## List available targets
	@echo "Wedding Tracker - make targets"
	@echo ""
	@# Greedy .*## rather than the usual non-greedy .*?## : the latter is a gawk
	@# extension, and `awk` is mawk on Debian/Ubuntu. No target line here carries
	@# a second "## ", so the two forms produce identical output.
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_-]+:.*## / { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables: PORT=$(PORT)  DEMO_PORT=$(DEMO_PORT)  FILE=  NAME="
