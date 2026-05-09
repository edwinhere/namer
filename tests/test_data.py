"""Tests for dataset classes."""

import torch
from torch.utils.data import DataLoader

from namer.data import InfiniteNamerDataset, NamerDataset
from namer.utils import EOS_IDX, VOCABULARY


class TestNamerDataset:
    """Tests for NamerDataset class."""

    def test_length(self) -> None:
        dataset = NamerDataset(num_samples=50, seed=42)
        assert len(dataset) == 50

    def test_sample_shape(self) -> None:
        dataset = NamerDataset(num_samples=10, max_seq_len=20, seed=42)
        digits, encoded = dataset[0]

        assert digits.shape == (20,)
        assert encoded.shape == (20,)
        assert digits.dtype == torch.long
        assert encoded.dtype == torch.long

    def test_padding_value(self) -> None:
        dataset = NamerDataset(num_samples=10, max_seq_len=20, seed=42)
        digits, _ = dataset[0]

        # Padding should be 10
        assert (digits == 10).any() or len([d for d in digits if d != 10]) <= 6

    def test_eos_present(self) -> None:
        dataset = NamerDataset(num_samples=10, seed=42)
        _, encoded = dataset[0]

        # EOS token should be present
        assert EOS_IDX in encoded.tolist()


class TestInfiniteNamerDataset:
    """Tests for InfiniteNamerDataset class."""

    def test_iteration(self) -> None:
        dataset = InfiniteNamerDataset(seed=42)
        iterator = iter(dataset)

        # Can get multiple samples
        for _ in range(10):
            digits, encoded = next(iterator)
            assert digits.shape == (20,)
            assert encoded.shape == (20,)

    def test_data_loader(self) -> None:
        dataset = InfiniteNamerDataset(seed=42)
        loader = DataLoader(dataset, batch_size=4, num_workers=0)

        iterator = iter(loader)
        digits_batch, encoded_batch = next(iterator)

        assert digits_batch.shape == (4, 20)
        assert encoded_batch.shape == (4, 20)

    def test_reproducibility(self) -> None:
        dataset1 = InfiniteNamerDataset(seed=42)
        dataset2 = InfiniteNamerDataset(seed=42)

        iter1 = iter(dataset1)
        iter2 = iter(dataset2)

        for _ in range(5):
            d1, e1 = next(iter1)
            d2, e2 = next(iter2)
            assert torch.equal(d1, d2)
            assert torch.equal(e1, e2)

    def test_vocab_range(self) -> None:
        dataset = InfiniteNamerDataset(seed=42)
        iterator = iter(dataset)

        for _ in range(20):
            _, encoded = next(iterator)
            # Valid tokens should be within vocab range (excluding -1 padding)
            valid_tokens = encoded[encoded != -1]
            assert (valid_tokens >= 0).all()
            assert (valid_tokens < len(VOCABULARY)).all()
