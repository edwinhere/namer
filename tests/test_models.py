"""Tests for model classes."""

import pytest
import torch

from namer.models import NamerTransformer, PositionalEncoding
from namer.utils import VOCABULARY


class TestPositionalEncoding:
    """Tests for PositionalEncoding module."""

    def test_shape(self) -> None:
        pe = PositionalEncoding(d_model=128)
        x = torch.randn(2, 10, 128)  # batch=2, seq=10, dim=128
        out = pe(x)
        assert out.shape == (2, 10, 128)

    def test_adds_position(self) -> None:
        pe = PositionalEncoding(d_model=64)
        x = torch.zeros(1, 5, 64)
        out = pe(x)
        # Output should be non-zero due to positional encoding
        assert not torch.allclose(out, x)


class TestNamerTransformer:
    """Tests for NamerTransformer model."""

    @pytest.fixture
    def model(self) -> NamerTransformer:
        return NamerTransformer(
            vocab_size=len(VOCABULARY),
            max_output_len=20,
            d_model=64,
            nhead=4,
            num_encoder_layers=2,
            dim_feedforward=128,
            dropout=0.0,
        )

    def test_forward_shape(self, model: NamerTransformer) -> None:
        batch_size = 4
        seq_len = 10
        digits = torch.randint(0, 10, (batch_size, seq_len))

        logits = model(digits)

        assert logits.shape == (batch_size, model.max_output_len, model.vocab_size)

    def test_forward_with_padding(self, model: NamerTransformer) -> None:
        batch_size = 2
        seq_len = 10
        digits = torch.full((batch_size, seq_len), 10)  # All padding
        digits[:, :5] = torch.randint(0, 10, (batch_size, 5))

        logits = model(digits)

        assert logits.shape == (batch_size, model.max_output_len, model.vocab_size)

    def test_forward_with_negative_padding(self, model: NamerTransformer) -> None:
        batch_size = 2
        seq_len = 10
        digits = torch.full((batch_size, seq_len), -1)  # -1 padding
        digits[:, :5] = torch.randint(0, 10, (batch_size, 5))

        logits = model(digits)

        assert logits.shape == (batch_size, model.max_output_len, model.vocab_size)

    def test_output_is_logits(self, model: NamerTransformer) -> None:
        digits = torch.randint(0, 10, (1, 5))
        logits = model(digits)

        # Logits should not be probabilities (no softmax applied)
        assert not torch.all((logits >= 0) & (logits <= 1))

    def test_gradient_flow(self, model: NamerTransformer) -> None:
        digits = torch.randint(0, 10, (2, 5))
        target = torch.randint(0, len(VOCABULARY), (2, model.max_output_len))

        logits = model(digits)
        loss = torch.nn.functional.cross_entropy(
            logits.view(-1, model.vocab_size),
            target.view(-1)
        )
        loss.backward()

        # Check that gradients exist
        for param in model.parameters():
            assert param.grad is not None
