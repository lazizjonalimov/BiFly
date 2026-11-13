# Shortcuts for local development. Run `make help`.
VENV := backend/.venv/bin

.PHONY: help install db migrate api web seed test lint e2e stack down

help: ## Show this help
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-9s %s\n", $$1, $$2}'

install: ## Install backend and web dependencies
	python3 -m venv backend/.venv
	$(VENV)/pip install -r backend/requirements-dev.txt
	cd apps/web && npm install

db: ## Start PostgreSQL (roles and databases are created on first start)
	docker compose up -d --wait db

migrate: ## Apply database migrations (as the schema owner)
	cd backend && .venv/bin/alembic upgrade head

api: ## Run the API with reload on http://localhost:8000
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web: ## Run the web app with reload on http://localhost:3000
	cd apps/web && npm run dev

seed: ## Create a demo company with sample data (the API must be running)
	cd backend && .venv/bin/python scripts/seed_demo.py

test: ## Run backend tests (needs `make db`)
	cd backend && .venv/bin/python -m pytest

lint: ## Lint and type-check backend and web
	cd backend && .venv/bin/ruff check app tests alembic scripts
	cd apps/web && npm run lint && npm run typecheck

e2e: ## Run the browser end-to-end tests (API and web app must be running)
	cd apps/web && npm run e2e

stack: ## Build and run everything in containers
	docker compose --profile app up --build

down: ## Stop containers (keeps the database volume)
	docker compose --profile app down
