---
language: en
license: mit
library_name: pytorch
tags:
  - text-generation
  - number-to-text
  - pytorch
  - transformer
  - stratified-sampling
---

# Namer

[![HuggingFace](https://img.shields.io/badge/🤗_HuggingFace-Model_Card-yellow)](https://huggingface.co/edwinhere/namer)
[![GitHub](https://img.shields.io/badge/🐙_GitHub-Source_Code-blue)](https://github.com/edwinhere/namer)

A PyTorch transformer model that converts **integers to their English names** (e.g., `42` → "forty two", `1234567890` → "one billion two hundred thirty four million five hundred sixty seven thousand eight hundred ninety").

> 🔗 **This repository is mirrored on both [HuggingFace](https://huggingface.co/edwinhere/namer) and [GitHub](https://github.com/edwinhere/namer). Use whichever you prefer!**

## Model Description

Namer is a sequence-to-sequence transformer trained to read digits of a number and generate the corresponding English textual representation. It handles numbers from **0 up to 9,223,372,036,854,775,807** (INT64_MAX), learning the patterns of English number naming conventions.

**Key Features:**
- 🎯 **Stratified Training**: Uses balanced sampling across 7 number scales (units to quintillions) to ensure accurate performance on both small and large numbers
- 📚 **Guaranteed Training Data**: Includes all numbers 0-99,999 and exact powers of 1000 to improve accuracy on edge cases
- 📈 **Large Range**: Handles numbers up to INT64_MAX (19 digits, ~9.2 quintillion)
- 🚀 **Fast Inference**: Single forward pass, no autoregressive generation needed

**Example conversions:**
| Integer | English Name |
|---------|-------------|
| 0 | zero |
| 42 | forty two |
| 123 | one hundred twenty three |
| 1000 | one thousand |
| 999999 | nine hundred ninety nine thousand nine hundred ninety nine |
| 1234567890 | one billion two hundred thirty four million five hundred sixty seven thousand eight hundred ninety |
| 999999999999 | nine hundred ninety nine billion nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine |
| 9223372036854775807 | nine quintillion two hundred twenty three quadrillion three hundred seventy two trillion thirty six billion eight hundred fifty four million seven hundred seventy five thousand eight hundred seven |

## Usage

### 🚀 HuggingFace Transformers (Recommended)

Load and use the model with HuggingFace's `AutoModel` API:

```python
from transformers import AutoModel
from namer import NamerPipeline

# Load model from HuggingFace
model = AutoModel.from_pretrained(
    "edwinhere/namer",
    trust_remote_code=True
)

# Create pipeline
pipe = NamerPipeline(model)

# Generate number names
result = pipe.generate(42)           # "forty two"
result = pipe.generate(1234567890)   # "one billion two hundred thirty four million..."

# Or use callable interface (HF compatible)
result = pipe(42)  # {"generated_text": "forty two"}
```

Alternatively, use the convenience function:

```python
from namer import load_namer_pipeline

pipe = load_namer_pipeline("edwinhere/namer")
print(pipe.generate(42))  # "forty two"
print(pipe.generate(999999999999))  # "nine hundred ninety nine billion..."
```

### 🔄 Original API (Local)

```python
import torch
from namer import load_namer_model, predict_number_name

# Load model
model = load_namer_model("namer_model.pt")

# Convert number to name
name = predict_number_name(model, 42)
print(f"42 -> '{name}'")

# Large numbers work too!
name = predict_number_name(model, 999999999999)
print(f"999999999999 -> '{name}'")
```

### 💻 Interactive Mode

```bash
python -m namer infer
```

Then enter numbers to convert interactively.

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

## Model Architecture

- **Type**: Sequence-to-sequence transformer with cross-attention
- **Input**: Digits of the integer (as token indices, 0-9 + padding)
- **Output**: English words representing the number
- **Vocabulary**: 41 tokens (zero-nineteen, twenty-ninety by tens, hundred, thousand, million, billion, trillion, quadrillion, quintillion, sextillion, septillion, octillion, nonillion, decillion, EOS)
- **Max Output Length**: 35 tokens (increased from 20 to support INT64_MAX)
- **Parameters**: ~870K

### Training Details

The model uses **stratified sampling** during training to ensure balanced representation across 7 scales:
- Units (0-999): ~14% of training data
- Thousands (1,000-999,999): ~14% of training data  
- Millions (1M-999M): ~14% of training data
- Billions (1B-999B): ~14% of training data
- Trillions (1T-999T): ~14% of training data
- Quadrillions (1Q-999Q): ~14% of training data
- Quintillions (1Qi-INT64_MAX): ~14% of training data

**Guaranteed Training Samples:**
- All integers from 0 to 99,999 (100,000 samples)
- Exact powers of 1000: 1,000; 1,000,000; 1,000,000,000; 1,000,000,000,000; 1,000,000,000,000,000
- Numbers just after powers of 1000 (e.g., 1,000,001 to 1,000,100): These edge cases with many zeros help the model correctly learn patterns like "one million one", "one billion one", etc.
- Zero-only sequences of all lengths: `[0]`, `[0,0]`, `[0,0,0]`, ... up to max sequence length. These ensure the model correctly learns that any sequence of just zeros (e.g., `0`, `00`, `000`) produces "zero".

This prevents the model from being biased toward larger numbers, which would happen with uniform random sampling (99.9% of 0-1T range is >1M).

## Files

| File | Description |
|------|-------------|
| `model.safetensors` | HuggingFace model weights (Safetensors format) |
| `pytorch_model.bin` | HuggingFace model weights (PyTorch format) |
| `config.json` | Model configuration |
| `generation_config.json` | Generation parameters |
| `namer_model.pt` | Original PyTorch checkpoint |
| `namer/` | Source code package |

## Training

To train from scratch with default settings (30 epochs, 1000 steps/epoch, INT64_MAX range):

```bash
python -m namer train
```

To customize training:

```bash
python -m namer train --epochs 20 --steps 500 --batch-size 256 --lr 0.001
```

The training uses stratified sampling by default with guaranteed samples. To modify the training range or sampling strategy, edit `namer/data.py`.

## Version History

### v3.0 (Current)
- **Range**: 0 to 9,223,372,036,854,775,807 (INT64_MAX, 19 digits)
- **Training**: Stratified sampling with guaranteed samples (0-99,999 + powers of 1000)
- **Max output length**: 35 tokens
- **Max sequence length**: 25 tokens
- **Accuracy**: >99.9% on validation set

### v2.0 (Previous)
- **Range**: 0 to 999,999,999,999 (trillions)
- **Training**: Stratified sampling for balanced representation
- **Max output length**: 25 tokens
- **Accuracy**: >99.9% on validation set

### v1.0 (Previous)
- **Range**: 0 to 999,999 (millions)
- **Training**: Uniform random sampling
- **Max output length**: 20 tokens

## Improvements in v3.1

### Fixed: Numbers with Many Zeroes
The model now correctly handles numbers immediately following powers of 1000 (e.g., 1,000,001 → "one million one", 1,000,000,001 → "one billion one"). This was achieved by adding **500 additional guaranteed training samples** - 100 numbers after each major power of 1000 (thousand, million, billion, trillion, quadrillion).

| Number | Output |
|--------|--------|
| 1,000,001 | one million one ✓ |
| 1,000,042 | one million forty two ✓ |
| 1,000,000,001 | one billion one ✓ |
| 1,000,000,000,001 | one trillion one ✓ |
| 1,000,000,000,000,001 | one quadrillion one ✓ |

### Fixed: Zero Handling
The model now correctly handles zero and single-digit inputs. A combination of **25 zero-only training samples** (one for each sequence length) plus an inference fallback ensures that any input of just zeros or single digits produces the correct output.

| Input | Output |
|-------|--------|
| 0 | zero ✓ |
| 1 | one ✓ |
| 5 | five ✓ |
| 00 | zero ✓ |
| 0000000000000000000 (19 zeros) | zero ✓ |

## Limitations

- **Exact powers of 1000 above million**: The model may occasionally produce extra words for exact powers at higher scales (e.g., "one million million" instead of "one million" for 1,000,000). This is an edge case in EOS prediction at trillion+ scales.
- **Negative numbers**: Not supported (absolute value is used)
- **Decimal numbers**: Not supported (integers only)

## Citation

If you use this model, please cite:

```bibtex
@software{namer,
  author = {Edwin Jose Palathinkal},
  title = {Namer: Integer to English Name Converter},
  url = {https://huggingface.co/edwinhere/namer},
  year = {2025}
}
```

## Links

| Platform | URL | Purpose |
|----------|-----|---------|
| 🤗 HuggingFace | [huggingface.co/edwinhere/namer](https://huggingface.co/edwinhere/namer) | Model card, inference API, downloads |
| 🐙 GitHub | [github.com/edwinhere/namer](https://github.com/edwinhere/namer) | Source code, issues, development |

---

*Model trained with PyTorch on an NVIDIA RTX 3070.*
