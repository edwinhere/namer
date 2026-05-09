"""Model definitions for Namer."""

from __future__ import annotations

import torch
import torch.nn as nn


class PositionalEncoding(nn.Module):
    """Sinusoidal positional encoding for transformer."""

    def __init__(self, d_model: int, max_len: int = 5000) -> None:
        super().__init__()

        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float()
            * (-torch.log(torch.tensor(10000.0)) / d_model)
        )

        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)

        self.register_buffer("pe", pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Add positional encoding to input.

        Args:
            x: (batch_size, seq_len, d_model)

        Returns:
            Tensor with positional encoding added
        """
        return x + self.pe[: x.size(1)]


class NamerTransformer(nn.Module):
    """Transformer model for mapping digit sequences to number name tokens.

    Architecture:
    - Embedding layer for digits (11 values: 0-9 + padding)
    - Positional encoding
    - Transformer encoder layers
    - Output projection to vocabulary for each position
    """

    def __init__(
        self,
        vocab_size: int = 40,
        max_output_len: int = 20,
        d_model: int = 128,
        nhead: int = 4,
        num_encoder_layers: int = 4,
        dim_feedforward: int = 512,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.vocab_size = vocab_size
        self.max_output_len = max_output_len
        self.d_model = d_model

        # Digit embedding (10 digits + 1 padding token = 11)
        self.digit_embedding = nn.Embedding(11, d_model, padding_idx=10)

        # Positional encoding
        self.pos_encoder = PositionalEncoding(d_model, max_len=100)

        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            batch_first=True,
        )
        self.transformer_encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=num_encoder_layers
        )

        # Output projection
        self.output_projection = nn.Linear(d_model, vocab_size)

        # Learned queries for each output position
        self.output_queries = nn.Parameter(torch.randn(max_output_len, d_model))

        # Cross-attention from output positions to encoded input
        self.cross_attention = nn.MultiheadAttention(
            d_model, nhead, dropout=dropout, batch_first=True
        )

        # Final output layers
        self.output_norm = nn.LayerNorm(d_model)

    def forward(self, digits: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            digits: (batch_size, seq_len) tensor of digit indices (0-9), padding=10

        Returns:
            (batch_size, max_output_len, vocab_size) logits
        """
        batch_size, seq_len = digits.shape

        # Handle padding: convert -1 padding to 10 (our padding index)
        digits = digits.clone()
        digits[digits == -1] = 10

        # Create padding mask for transformer (True = padding)
        src_key_padding_mask = digits == 10

        # Embed digits: (batch, seq_len, d_model)
        embedded = self.digit_embedding(digits)

        # Add positional encoding
        embedded = self.pos_encoder(embedded)

        # Transformer encoder: (batch, seq_len, d_model)
        memory = self.transformer_encoder(
            embedded, src_key_padding_mask=src_key_padding_mask
        )

        # Expand queries for batch: (batch, max_output_len, d_model)
        queries = self.output_queries.unsqueeze(0).expand(batch_size, -1, -1)

        # Cross-attention from queries to encoded input
        attn_output, _ = self.cross_attention(
            queries, memory, memory, key_padding_mask=src_key_padding_mask
        )

        # Normalize and project to vocab
        output = self.output_norm(attn_output)
        logits = self.output_projection(output)

        return logits


def load_namer_model(
    model_path: str = "namer_model.pt",
    device: str | torch.device = "cuda" if torch.cuda.is_available() else "cpu",
) -> NamerTransformer:
    """Load a trained Namer model for inference.

    Args:
        model_path: Path to the saved model file
        device: Device to load the model on

    Returns:
        Loaded model in eval mode
    """
    checkpoint = torch.load(model_path, map_location=device)

    model = NamerTransformer(
        vocab_size=checkpoint["vocab_size"],
        max_output_len=checkpoint["max_output_len"],
        d_model=checkpoint.get("d_model", 128),
        nhead=4,
        num_encoder_layers=4,
        dim_feedforward=512,
        dropout=0.0,  # No dropout for inference
    )

    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device)
    model.eval()

    return model
