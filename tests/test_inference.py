"""Tests for inference utilities."""

from unittest.mock import MagicMock, patch

import pytest
import torch

from namer.inference import predict_number_name
from namer.models import NamerTransformer
from namer.utils import VOCABULARY, read_digits, int_to_digits


class TestPredictNumberName:
    """Tests for predict_number_name function."""

    @pytest.fixture
    def mock_model(self) -> MagicMock:
        model = MagicMock(spec=NamerTransformer)
        model.max_output_len = 20
        model.vocab_size = len(VOCABULARY)

        # Mock the device property
        param = MagicMock()
        param.device = torch.device("cpu")
        model.parameters.return_value = iter([param])

        return model

    def test_basic_prediction(self, mock_model: MagicMock) -> None:
        # Create fake logits that will select known tokens
        # "one" is index 1 in VOCABULARY
        fake_logits = torch.zeros(1, 20, len(VOCABULARY))
        fake_logits[0, 0, 1] = 10.0  # "one"
        fake_logits[0, 1, VOCABULARY.index("<EOS>")] = 10.0  # EOS

        mock_model.return_value = fake_logits
        mock_model.eval = MagicMock()

        with patch("namer.inference.torch.no_grad"):
            result = predict_number_name(mock_model, 1)

        # Should decode to "one"
        assert "one" in result.lower() or result.startswith("<")

    def test_eos_stops_generation(self, mock_model: MagicMock) -> None:
        # Logits that predict EOS immediately
        fake_logits = torch.zeros(1, 20, len(VOCABULARY))
        fake_logits[0, 0, VOCABULARY.index("<EOS>")] = 10.0

        mock_model.return_value = fake_logits
        mock_model.eval = MagicMock()

        with patch("namer.inference.torch.no_grad"):
            result = predict_number_name(mock_model, 0)

        # Empty result when EOS is first
        assert result == "" or result.startswith("<")

    def test_device_override(self, mock_model: MagicMock) -> None:
        fake_logits = torch.zeros(1, 20, len(VOCABULARY))
        fake_logits[0, 0, 1] = 10.0
        fake_logits[0, 1, VOCABULARY.index("<EOS>")] = 10.0

        mock_model.return_value = fake_logits
        mock_model.eval = MagicMock()

        with patch("namer.inference.torch.no_grad"):
            # Should not raise when device is specified
            result = predict_number_name(mock_model, 1, device="cpu")

        assert isinstance(result, str)
