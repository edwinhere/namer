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
    
    Includes guaranteed samples:
    - All numbers from 0 to 99,999
    - Exact powers of 1000 (1,000; 1,000,000; 1,000,000,000; etc.)
    """

    def __init__(
        self,
        max_int: int = 999999,
        max_seq_len: int = 20,
        max_output_len: int = 20,
        seed: int | None = None,
        stratified: bool = True,
        include_all_until: int = 99999,
    ) -> None:
        """Initialize the infinite dataset.

        Args:
            max_int: Maximum random integer value
            max_seq_len: Maximum input sequence length for padding
            max_output_len: Maximum output sequence length for padding
            seed: Random seed (optional, for reproducibility)
            stratified: Whether to use stratified sampling across number scales
            include_all_until: Include all integers from 0 to this value (default: 99999)
        """
        self.max_int = max_int
        self.max_seq_len = max_seq_len
        self.max_output_len = max_output_len
        self.seed = seed
        self.stratified = stratified
        self.include_all_until = min(include_all_until, max_int)
        self.rng = random.Random(seed)
        self._guaranteed_samples: list[int] | None = None
        self._guaranteed_index: int = 0
        self._powers_of_1000: list[int] | None = None

    def _generate_sample(self) -> tuple[torch.Tensor, torch.Tensor]:
        """Generate a single (digits, encoded_name) sample."""
        if self.stratified:
            n = self._stratified_random_int()
        else:
            n = self.rng.randint(0, self.max_int)
        digits = int_to_digits(n)
        name = read_digits(digits)
        encoded = encode(name)

        # Pad digits with 10 (padding index)
        digits_padded = digits + [10] * (self.max_seq_len - len(digits))
        digits_padded = digits_padded[: self.max_seq_len]

        # Append EOS and pad with -1
        encoded_with_eos = encoded + [EOS_IDX]
        encoded_padded = encoded_with_eos + [-1] * (self.max_output_len - len(encoded_with_eos))
        encoded_padded = encoded_padded[: self.max_output_len]

        return (
            torch.tensor(digits_padded, dtype=torch.long),
            torch.tensor(encoded_padded, dtype=torch.long),
        )

    def _get_guaranteed_samples(self) -> list[int]:
        """Get the list of guaranteed samples (0-N and powers of 1000).

        Returns:
            List of integers that must be included in training
        """
        samples = []

        # All numbers from 0 to include_all_until
        samples.extend(range(0, self.include_all_until + 1))

        # Exact powers of 1000 (1,000; 1,000,000; 1,000,000,000; etc.)
        power = 1000
        while power <= self.max_int:
            if power > self.include_all_until:  # Avoid duplicates
                samples.append(power)
            power *= 1000

        return samples

    def _stratified_random_int(self) -> int:
        """Generate a random integer using stratified sampling across number scales.

        Divides the range [0, max_int] into logarithmic strata (units, thousands,
        millions, billions, etc.) and randomly selects one stratum, then generates
        a uniform random number within that stratum. This ensures balanced training
        across all scales rather than being biased toward larger numbers.

        Returns:
            Random integer uniformly selected from a randomly chosen stratum
        """
        # Define scale boundaries (powers of 1000)
        scales = [0, 1000, 1000_000, 1000_000_000, 1000_000_000_000,
                  1000_000_000_000_000, 1000_000_000_000_000_000]

        # Find which scales are within our max_int range
        valid_scales = [s for s in scales if s <= self.max_int]

        if len(valid_scales) == 1:
            # Only units scale available
            return self.rng.randint(0, min(999, self.max_int))

        # Randomly select a stratum (scale index)
        stratum_idx = self.rng.randint(0, len(valid_scales) - 1)

        # Determine the range for this stratum
        lower = valid_scales[stratum_idx]
        if stratum_idx + 1 < len(valid_scales):
            upper = valid_scales[stratum_idx + 1] - 1
        else:
            upper = self.max_int

        # Ensure upper doesn't exceed max_int
        upper = min(upper, self.max_int)

        # Generate random number in this stratum
        # Special case: units stratum includes 0
        if stratum_idx == 0:
            return self.rng.randint(0, min(999, self.max_int))

        return self.rng.randint(lower, upper)

    def __iter__(self) -> InfiniteNamerDataset:
        """Yield samples infinitely.

        First yields all guaranteed samples (0-99,999 and powers of 1000),
        then continues with stratified random sampling.

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

        # Generate and shuffle guaranteed samples
        self._guaranteed_samples = self._get_guaranteed_samples()
        self.rng.shuffle(self._guaranteed_samples)
        self._guaranteed_index = 0

        return self

    def __next__(self) -> tuple[torch.Tensor, torch.Tensor]:
        """Generate the next sample.

        First yields all guaranteed samples, then stratified random samples.
        """
        # Yield guaranteed samples first
        if self._guaranteed_samples and self._guaranteed_index < len(self._guaranteed_samples):
            n = self._guaranteed_samples[self._guaranteed_index]
            self._guaranteed_index += 1
            return self._generate_sample_from_n(n)

        # Then yield stratified random samples
        return self._generate_sample()

    def _generate_sample_from_n(self, n: int) -> tuple[torch.Tensor, torch.Tensor]:
        """Generate a sample for a specific integer n."""
        digits = int_to_digits(n)
        name = read_digits(digits)
        encoded = encode(name)

        # Pad digits with 10 (padding index)
        digits_padded = digits + [10] * (self.max_seq_len - len(digits))
        digits_padded = digits_padded[: self.max_seq_len]

        # Append EOS and pad with -1
        encoded_with_eos = encoded + [EOS_IDX]
        encoded_padded = encoded_with_eos + [-1] * (self.max_output_len - len(encoded_with_eos))
        encoded_padded = encoded_padded[: self.max_output_len]

        return (
            torch.tensor(digits_padded, dtype=torch.long),
            torch.tensor(encoded_padded, dtype=torch.long),
        )
