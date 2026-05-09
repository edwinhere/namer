.PHONY: help install dev train infer test lint format clean distclean

# Python environment
PYTHON := python3
VENV := .venv
VENV_PYTHON := $(VENV)/bin/python

# Default target
help:
	@echo "Namer - Number to Name Transformer"
	@echo ""
	@echo "Available targets:"
	@echo "  make install    - Install package in development mode"
	@echo "  make dev        - Install with dev dependencies"
	@echo "  make train      - Train the model"
	@echo "  make infer      - Run interactive inference"
	@echo "  make test       - Run test suite"
	@echo "  make lint       - Run linting (ruff)"
	@echo "  make format     - Format code (ruff)"
	@echo "  make typecheck  - Run type checking (mypy)"
	@echo "  make clean      - Remove generated files and caches"
	@echo "  make distclean  - Deep clean including venv"
	@echo ""

# Create virtual environment and install
$(VENV):
	@echo "Creating virtual environment..."
	$(PYTHON) -m venv $(VENV)
	$(VENV_PYTHON) -m pip install --upgrade pip

# Install package
install: $(VENV)
	@echo "Installing package..."
	$(VENV_PYTHON) -m pip install -e .

# Install with dev dependencies
dev: $(VENV)
	@echo "Installing with dev dependencies..."
	$(VENV_PYTHON) -m pip install -e ".[dev]"

# Run training
train: $(VENV)
	@echo "Starting training..."
	$(VENV_PYTHON) -m namer train

# Run interactive inference
infer: $(VENV)
	@echo "Starting inference..."
	$(VENV_PYTHON) -m namer infer

# Run tests
test: $(VENV)
	@echo "Running tests..."
	$(VENV_PYTHON) -m pytest -v

# Run tests with coverage
test-cov: $(VENV)
	@echo "Running tests with coverage..."
	$(VENV_PYTHON) -m pytest --cov=namer --cov-report=html --cov-report=term

# Run linting
lint: $(VENV)
	@echo "Running ruff linter..."
	$(VENV_PYTHON) -m ruff check namer tests

# Fix linting issues
lint-fix: $(VENV)
	@echo "Fixing linting issues..."
	$(VENV_PYTHON) -m ruff check --fix namer tests

# Format code
format: $(VENV)
	@echo "Formatting code..."
	$(VENV_PYTHON) -m ruff format namer tests

# Run type checking
typecheck: $(VENV)
	@echo "Running mypy..."
	$(VENV_PYTHON) -m mypy namer

# Run all checks
check: lint typecheck test
	@echo "All checks passed!"

# Clean generated files
clean:
	@echo "Cleaning generated files..."
	rm -f namer_model.pt
	rm -rf htmlcov .pytest_cache .coverage
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean complete!"

# Deep clean
distclean: clean
	@echo "Removing virtual environment..."
	rm -rf $(VENV)
	@echo "All clean! Run 'make dev' to start fresh."
