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
pipeline_tag: text-generation
---

# Namer

A PyTorch transformer model that converts **integers to their English names** — now supporting numbers up to **999,999,999,999** (nearly one trillion)!

## Quick Start

```python
from transformers import AutoModel
from namer import NamerPipeline

# Load model
model = AutoModel.from_pretrained(
    "edwinhere/namer",
    trust_remote_code=True
)

# Create pipeline
pipe = NamerPipeline(model)

# Generate number names
print(pipe.generate(42))                    # "forty two"
print(pipe.generate(1234567890))            # "one billion two hundred thirty four million..."
print(pipe.generate(999999999999))          # "nine hundred ninety nine billion..."
```

## Model Description

Namer is a sequence-to-sequence transformer trained to read digits of a number and generate the corresponding English textual representation.

### Key Features

- 🎯 **Stratified Training**: Balanced sampling across number scales ensures accurate performance on both small and large numbers
- 📈 **Large Range**: Handles numbers from 0 to ~1 trillion (12 digits)
- 🚀 **Fast Inference**: Single forward pass, no autoregressive generation needed
- 🎓 **High Accuracy**: >99.9% validation accuracy

### Example Conversions

| Integer | English Name |
|---------|-------------|
| 0 | zero |
| 42 | forty two |
| 123 | one hundred twenty three |
| 1000 | one thousand |
| 999999 | nine hundred ninety nine thousand nine hundred ninety nine |
| 1234567890 | one billion two hundred thirty four million five hundred sixty seven thousand eight hundred ninety |
| 999999999999 | nine hundred ninety nine billion nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine |

## Architecture

- **Type**: Transformer encoder with learned queries and cross-attention
- **Parameters**: ~869K
- **Vocabulary**: 41 tokens (number words + EOS)
- **Max Output Length**: 25 tokens
- **Input**: Digit sequences (0-9 + padding)

## Training Details

- **Dataset**: Infinite stratified sampling across 5 scales (units, thousands, millions, billions, trillions)
- **Optimizer**: Adam (lr=0.001)
- **Epochs**: 30 with early stopping (patience=10)
- **Hardware**: NVIDIA RTX 3070
- **Validation Accuracy**: >99.9%

### Why Stratified Sampling?

With uniform random sampling from 0-1T, 99.9% of samples would be >1M, causing the model to fail on small numbers. Stratified sampling gives each magnitude equal representation (20% each), ensuring robust performance across the entire range.

## Version History

**v2.0 (Current)**
- Range: 0 to 999,999,999,999 (trillions)
- Stratified sampling for balanced training
- Max output length: 25 tokens

**v1.0**
- Range: 0 to 999,999 (millions)
- Uniform random sampling
- Max output length: 20 tokens

## Limitations

- Maximum: 999,999,999,999 (12 digits)
- No negative numbers (uses absolute value)
- No decimal/fractional numbers

## Citation

```bibtex
@software{namer,
  author = {Edwin Jose Palathinkal},
  title = {Namer: Integer to English Name Converter},
  url = {https://huggingface.co/edwinhere/namer},
  year = {2025}
}
```

## Links

- GitHub: https://github.com/edwinhere/namer
- HuggingFace: https://huggingface.co/edwinhere/namer
