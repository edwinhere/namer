---
language: en
license: mit
library_name: pytorch
tags:
  - text-generation
  - number-to-text
  - pytorch
  - transformer
---

# Namer

[![HuggingFace](https://img.shields.io/badge/🤗_HuggingFace-Model_Card-yellow)](https://huggingface.co/edwinhere/namer)
[![GitHub](https://img.shields.io/badge/🐙_GitHub-Source_Code-blue)](https://github.com/edwinhere/namer)

A PyTorch transformer model that converts **integers to their English names** (e.g., `42` → "forty two", `123` → "one hundred twenty three").

> 🔗 **This repository is mirrored on both [HuggingFace](https://huggingface.co/edwinhere/namer) and [GitHub](https://github.com/edwinhere/namer). Use whichever you prefer!**

## Model Description

Namer is a sequence-to-sequence transformer trained to read digits of a number and generate the corresponding English textual representation. It handles numbers from 0 up to billions, learning the patterns of English number naming conventions.

**Example conversions:**
| Integer | English Name |
|---------|-------------|
| 0 | zero |
| 42 | forty two |
| 123 | one hundred twenty three |
| 1000 | one thousand |
| 1234567 | one million two hundred thirty four thousand five hundred sixty seven |

## Usage

### Quick Start

```python
import torch
from namer import load_namer_model, predict_number_name

# Load model
device = "cuda" if torch.cuda.is_available() else "cpu"
model = load_namer_model("namer_model.pt", device)

# Convert number to name
name = predict_number_name(model, 42)
print(f"42 -> '{name}'")  # Output: forty two
```

### Interactive Mode

```bash
python -m namer infer
```

Then enter numbers to convert interactively.

### API

```python
from namer.inference import predict_number_name

# Single prediction
name = predict_number_name(model, 123456)
# Returns: "one hundred twenty three thousand four hundred fifty six"
```

## Model Architecture

- **Type**: Sequence-to-sequence transformer
- **Input**: Digits of the integer (as token indices)
- **Output**: English words representing the number
- **Vocabulary**: English number words (zero-nineteen, twenty-ninety, hundred, thousand, million, billion, etc.)

## Files

| File | Description |
|------|-------------|
| `namer_model.pt` | Trained model weights |
| `namer/models.py` | Transformer architecture |
| `namer/inference.py` | Prediction utilities |
| `namer/utils.py` | Encoding/decoding utilities |

## Training

To train from scratch:

```bash
python -m namer train
```

## Installation

Choose either repository — both have identical code:

**Option 1: Clone from HuggingFace**
```bash
git clone https://huggingface.co/edwinhere/namer
cd namer
pip install -e .
```

**Option 2: Clone from GitHub**
```bash
git clone https://github.com/edwinhere/namer.git
cd namer
pip install -e .
```

**Option 3: Direct pip install (from GitHub)**
```bash
pip install git+https://github.com/edwinhere/namer.git
```

## Citation

If you use this model, please cite:

```bibtex
@software{namer,
  author = {Edwin Jose Palathinkal},
  title = {Namer: Integer to English Name Converter},
  url = {https://huggingface.co/edwinhere/namer}
}
```

## Links

| Platform | URL | Purpose |
|----------|-----|---------|
| 🤗 HuggingFace | [huggingface.co/edwinhere/namer](https://huggingface.co/edwinhere/namer) | Model card, inference API, downloads |
| 🐙 GitHub | [github.com/edwinhere/namer](https://github.com/edwinhere/namer) | Source code, issues, development |
