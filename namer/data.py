"""Dataset classes for Namer."""

from __future__ import annotations

import random

import torch
from torch.utils.data import IterableDataset, TensorDataset

from namer.utils import EOS_IDX, encode, int_to_digits, read_digits


class NamerDataset(TensorDataset):
    """Finite dataset mapping random integers to encoded number names."""

    def __init__(
        self,
        num_samples: int = 1000,
        max_int: int = 999999,
        max_seq_len: int = 20,
        seed: int = 42,
    ) -> None:
        """Create a PyTorch TensorDataset mapping random integers to encoded number names.

        Args:
            num_samples: Number of samples to generate
            max_int: Maximum random integer value
            max_seq_len: Maximum sequence length for padding
            seed: Random seed for reproducibility
        """
        rng = random.Random(seed)

        digit_sequences: list[list[int]] = []
        encoded_names: list[list[int]] = []

        for _ in range(num_samples):
            n = rng.randint(0, max_int)
            digits = int_to_digits(n)
            name = read_digits(digits)
            encoded = encode(name)

            digit_sequences.append(digits)
            encoded_names.append(encoded)

        # Pad sequences
        padded_digits: list[list[int]] = []
        padded_encoded: list[list[int]] = []

        for digits, encoded in zip(digit_sequences, encoded_names):
            # Pad digits with 10 to indicate padding
            digits_padded = digits + [10] * (max_seq_len - len(digits))
            digits_padded = digits_padded[:max_seq_len]

            # Append EOS token to encoded, then pad with -1
            encoded_with_eos = encoded + [EOS_IDX]
            encoded_padded = encoded_with_eos + [-1] * (max_seq_len - len(encoded_with_eos))
            encoded_padded = encoded_padded[:max_seq_len]

            padded_digits.append(digits_padded)
            padded_encoded.append(encoded_padded)

        # Convert to tensors
        digits_tensor = torch.tensor(padded_digits, dtype=torch.long)
        encoded_tensor = torch.tensor(padded_encoded, dtype=torch.long)

        super().__init__(digits_tensor, encoded_tensor)


class InfiniteNamerDataset(IterableDataset):
    """Infinite dataset that generates random number-to-name mappings on-the-fly.

    Uses Python generators to produce an endless stream of training samples.
    Each iteration yields fresh random samples.
    """

    def __init__(
        self,
        max_int: int = 999999,
        max_seq_len: int = 20,
        seed: int | None = None,
    ) -> None:
        """Initialize the infinite dataset.

        Args:
            max_int: Maximum random integer value
            max_seq_len: Maximum sequence length for padding
            seed: Random seed (optional, for reproducibility)
        """
        self.max_int = max_int
        self.max_seq_len = max_seq_len
        self.seed = seed
        self.rng = random.Random(seed)

    def _generate_sample(self) -> tuple[torch.Tensor, torch.Tensor]:
        """Generate a single (digits, encoded_name) sample."""
        n = self.rng.randint(0, self.max_int)
        digits = int_to_digits(n)
        name = read_digits(digits)
        encoded = encode(name)

        # Pad digits with 10 (padding index)
        digits_padded = digits + [10] * (self.max_seq_len - len(digits))
        digits_padded = digits_padded[: self.max_seq_len]

        # Append EOS and pad with -1
        encoded_with_eos = encoded + [EOS_IDX]
        encoded_padded = encoded_with_eos + [-1] * (self.max_seq_len - len(encoded_with_eos))
        encoded_padded = encoded_padded[: self.max_seq_len]

        return (
            torch.tensor(digits_padded, dtype=torch.long),
            torch.tensor(encoded_padded, dtype=torch.long),
        )

    def __iter__(self) -> InfiniteNamerDataset:
        """Yield samples infinitely.

        Each worker in multi-worker DataLoader gets its own iterator
        with a unique seed based on worker_id.
        """
        worker_info = torch.utils.data.get_worker_info()

        if worker_info is None:
            # Single-process loading
            rng_seed = self.seed if self.seed else random.randint(0, 2**32)
            self.rng = random.Random(rng_seed)
        else:
            # Multi-worker: each worker gets unique seed
            worker_id = worker_info.id
            base_seed = self.seed if self.seed else random.randint(0, 2**32)
            self.rng = random.Random(base_seed + worker_id * 1000)

        return self

    def __next__(self) -> tuple[torch.Tensor, torch.Tensor]:
        """Generate the next sample."""
        return self._generate_sample()
