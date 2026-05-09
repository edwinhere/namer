# Changelog

All notable changes to the Namer project will be documented in this file.

## [2.0.0] - 2025-05-09

### Added
- Support for numbers up to 999,999,999,999 (trillions) - increased from 999,999
- Stratified sampling during training for balanced representation across number scales
- Extended max output length from 20 to 25 tokens
- Extended max sequence length from 20 to 25 tokens
- Special case handling for zero in inference
- New test cases for billion and trillion ranges

### Changed
- `InfiniteNamerDataset` now uses stratified sampling by default
- Default `max_int` changed from 999,999 to 999,999,999,999
- Training now samples equally across: units, thousands, millions, billions, trillions
- Model architecture unchanged but supports longer outputs

### Fixed
- Small numbers (under 1M) now work correctly with large-range model
- Zero is now handled as a special case to prevent token repetition

### Technical Details
- Training uses 5 stratified buckets (20% each):
  - 0-999 (units)
  - 1,000-999,999 (thousands)
  - 1M-999M (millions)
  - 1B-999B (billions)
  - 1T-999T (trillions)
- Validation accuracy: >99.9%
- Model parameters: ~869K

## [1.0.0] - 2025-05-08

### Added
- Initial release
- Support for numbers 0-999,999 (millions)
- Transformer-based sequence-to-sequence model
- HuggingFace Transformers integration
- PyTorch native model format
- Interactive inference mode
- Training pipeline with infinite dataset

### Features
- 41-token vocabulary (number words + EOS)
- 20-token max output length
- 20-digit max input sequence length
- 4-layer transformer encoder
- Cross-attention mechanism with learned queries

---

[2.0.0]: https://github.com/edwinhere/namer/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/edwinhere/namer/releases/tag/v1.0.0
