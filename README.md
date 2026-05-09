# Namer

A PyTorch transformer model that converts numbers to their English names.

## Features

- **Transformer architecture** with cross-attention mechanism
- **Infinite dataset** training with early stopping
- **Modular design** following Python best practices
- **Type hints** throughout for better IDE support
- **Comprehensive test suite** with pytest
- **Modern tooling**: ruff (linting/formatting), mypy (type checking)

## Installation

```bash
# Clone the repository
git clone https://github.com/example/namer.git
cd namer

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install in development mode
pip install -e ".[dev]"
```

## Usage

### Command Line Interface

```bash
# Show help
namer --help

# Run demonstrations
namer demo

# Train the model
namer train

# Train with custom settings
namer train --epochs 50 --steps 2000 --batch-size 64 --lr 0.0005

# Run interactive inference
namer infer

# Run quick test
namer test
```

### Python API

```python
from namer import NamerTransformer, load_namer_model, predict_number_name

# Load a trained model
model = load_namer_model("namer_model.pt")

# Predict number names
name = predict_number_name(model, 123456)
print(name)  # "one hundred twenty three thousand four hundred fifty six"
```

## Project Structure

```
namer/
├── namer/                  # Main package
│   ├── __init__.py        # Package exports
│   ├── main.py            # CLI entry point
│   ├── models.py          # Transformer model definitions
│   ├── data.py            # Dataset classes
│   ├── training.py        # Training loop
│   ├── inference.py       # Inference utilities
│   └── utils.py           # Number-to-name conversion utilities
├── tests/                 # Test suite
│   ├── test_utils.py
│   ├── test_models.py
│   ├── test_data.py
│   └── test_inference.py
├── pyproject.toml         # Project configuration
├── README.md
└── Makefile              # Convenience commands
```

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=namer --cov-report=html

# Run specific test file
pytest tests/test_utils.py
```

### Linting and Formatting

```bash
# Check code style
ruff check .

# Fix auto-fixable issues
ruff check --fix .

# Format code
ruff format .

# Type checking
mypy namer
```

### Makefile Commands

```bash
make help       # Show available commands
make install    # Install dependencies
make train      # Train the model
make inference  # Run interactive inference
make test       # Run tests
make clean      # Clean generated files
make distclean  # Deep clean including venv
```

## Model Architecture

The `NamerTransformer` uses an encoder-only architecture:

1. **Digit Embedding** - Embeds digits 0-9 (plus padding token)
2. **Positional Encoding** - Sinusoidal positional embeddings
3. **Transformer Encoder** - Multi-layer encoder with self-attention
4. **Cross-Attention** - Learned output queries attend to encoded digits
5. **Output Projection** - Projects to vocabulary for each output position

## Training

The model trains on an infinite dataset that generates random number-to-name mappings on-the-fly:

- Numbers up to 999,999 (configurable)
- Early stopping with patience (default: 10 epochs)
- Cross-entropy loss with -1 padding ignored
- Adam optimizer with configurable learning rate

## Requirements

- Python 3.10+
- PyTorch 2.0+
- CUDA-capable GPU (optional, falls back to CPU)

## License

MIT License - see LICENSE file for details.
