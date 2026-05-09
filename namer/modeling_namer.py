"""HuggingFace compatible Namer model."""

from __future__ import annotations

import math
from typing import Optional, Union

import torch
import torch.nn as nn
from transformers import PreTrainedModel, PretrainedConfig
from transformers.modeling_outputs import CausalLMOutputWithCrossAttentions
from transformers.generation import GenerationMixin


class NamerConfig(PretrainedConfig):
    """Configuration class for NamerModel."""
    
    model_type = "custom"
    
    def __init__(
        self,
        vocab_size: int = 41,
        max_output_len: int = 20,
        d_model: int = 128,
        nhead: int = 4,
        num_encoder_layers: int = 4,
        dim_feedforward: int = 512,
        dropout: float = 0.1,
        pad_token_id: int = 10,
        eos_token_id: int = 40,  # <EOS> token index
        **kwargs,
    ):
        self.vocab_size = vocab_size
        self.max_output_len = max_output_len
        self.d_model = d_model
        self.nhead = nhead
        self.num_encoder_layers = num_encoder_layers
        self.dim_feedforward = dim_feedforward
        self.dropout = dropout
        
        super().__init__(
            pad_token_id=pad_token_id,
            eos_token_id=eos_token_id,
            **kwargs,
        )


class PositionalEncoding(nn.Module):
    """Sinusoidal positional encoding for transformer."""

    def __init__(self, d_model: int, max_len: int = 5000) -> None:
        super().__init__()

        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float()
            * (-math.log(10000.0) / d_model)
        )

        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)

        self.register_buffer("pe", pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Add positional encoding to input."""
        return x + self.pe[: x.size(1)]


class NamerModel(PreTrainedModel, GenerationMixin):
    """HuggingFace compatible Namer transformer model.
    
    Converts integer digit sequences to English number names.
    """
    
    config_class = NamerConfig
    base_model_prefix = "namer"
    
    def __init__(self, config: NamerConfig):
        super().__init__(config)
        
        self.vocab_size = config.vocab_size
        self.max_output_len = config.max_output_len
        self.d_model = config.d_model
        
        # Digit embedding (10 digits + 1 padding token = 11)
        self.digit_embedding = nn.Embedding(11, config.d_model, padding_idx=config.pad_token_id)
        
        # Positional encoding
        self.pos_encoder = PositionalEncoding(config.d_model, max_len=100)
        
        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.d_model,
            nhead=config.nhead,
            dim_feedforward=config.dim_feedforward,
            dropout=config.dropout,
            batch_first=True,
        )
        self.transformer_encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=config.num_encoder_layers
        )
        
        # Output projection
        self.output_projection = nn.Linear(config.d_model, config.vocab_size)
        
        # Learned queries for each output position
        self.output_queries = nn.Parameter(torch.randn(config.max_output_len, config.d_model))
        
        # Cross-attention from output positions to encoded input
        self.cross_attention = nn.MultiheadAttention(
            config.d_model, config.nhead, dropout=config.dropout, batch_first=True
        )
        
        # Final output layers
        self.output_norm = nn.LayerNorm(config.d_model)
        
        self.post_init()
    
    def forward(
        self,
        input_ids: Optional[torch.Tensor] = None,
        attention_mask: Optional[torch.Tensor] = None,
        labels: Optional[torch.Tensor] = None,
        **kwargs,
    ) -> CausalLMOutputWithCrossAttentions:
        """Forward pass for HF compatibility.
        
        Args:
            input_ids: (batch_size, seq_len) tensor of digit indices (0-9), padding=10
            attention_mask: Optional mask for padding
            labels: Optional target labels for training
            
        Returns:
            CausalLMOutputWithCrossAttentions with logits
        """
        if input_ids is None:
            raise ValueError("input_ids must be provided")
        
        batch_size, seq_len = input_ids.shape
        
        # Handle padding: convert -1 padding to 10 (our padding index)
        digits = input_ids.clone()
        digits[digits == -1] = self.config.pad_token_id
        
        # Create padding mask for transformer (True = padding)
        if attention_mask is None:
            src_key_padding_mask = digits == self.config.pad_token_id
        else:
            src_key_padding_mask = ~attention_mask.bool()
        
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
        
        loss = None
        if labels is not None:
            loss_fct = nn.CrossEntropyLoss(ignore_index=-100)
            loss = loss_fct(logits.view(-1, self.vocab_size), labels.view(-1))
        
        return CausalLMOutputWithCrossAttentions(
            loss=loss,
            logits=logits,
            hidden_states=None,
            attentions=None,
            cross_attentions=None,
        )
    
    def prepare_inputs_for_generation(self, input_ids, **kwargs):
        """Prepare inputs for text generation."""
        return {"input_ids": input_ids}
    
    def _reorder_cache(self, past_key_values, beam_idx):
        """Reorder cache for beam search."""
        return past_key_values


class NamerPipeline:
    """Simple pipeline for Namer model inference.
    
    Usage:
        from transformers import AutoModel
        
        # Load model
        model = AutoModel.from_pretrained(
            "edwinhere/namer", 
            trust_remote_code=True
        )
        
        # Create pipeline
        pipe = NamerPipeline(model)
        
        # Generate
        result = pipe.generate(42)  # "forty two"
        result = pipe(42)  # {"generated_text": "forty two"}
    """
    
    def __init__(self, model: NamerModel, tokenizer=None, device: str = None):
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = model.to(device)
        self.model.eval()
        self.device = device
        self.tokenizer = tokenizer  # Placeholder if we add a tokenizer later
        
        # Vocabulary mapping (index -> word)
        # Must match utils.py vocabulary exactly
        self.id2word = {
            0: "zero", 1: "one", 2: "two", 3: "three", 4: "four",
            5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
            10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen",
            15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
            20: "twenty", 21: "thirty", 22: "forty", 23: "fifty",
            24: "sixty", 25: "seventy", 26: "eighty", 27: "ninety",
            28: "hundred",
            29: "thousand", 30: "million", 31: "billion", 32: "trillion",
            33: "quadrillion", 34: "quintillion", 35: "sextillion",
            36: "septillion", 37: "octillion", 38: "nonillion", 39: "decillion",
            40: "<EOS>"
        }
        
        # Reverse mapping
        self.word2id = {v: k for k, v in self.id2word.items()}
    
    def _int_to_digits(self, n: int) -> list[int]:
        """Convert integer to list of digit indices."""
        if n == 0:
            return [0]
        digits = []
        while n > 0:
            digits.append(n % 10)
            n //= 10
        return digits[::-1]  # Reverse to get most significant digit first
    
    def _decode(self, token_ids: list[int]) -> str:
        """Decode token IDs to text, stopping at first EOS."""
        words = []
        eos_idx = self.model.config.eos_token_id  # Should be 40
        
        for idx in token_ids:
            if idx == eos_idx:  # Stop at EOS
                break
            if idx in self.id2word:
                word = self.id2word[idx]
                if word != "<EOS>":  # Skip EOS token itself
                    words.append(word)
        
        return " ".join(words) if words else "zero"
    
    def generate(self, text: Union[str, int], **kwargs) -> str:
        """Generate English name for a number.
        
        Args:
            text: Integer or string representation of integer
            
        Returns:
            English name of the number
        """
        # Parse input
        if isinstance(text, str):
            n = int(text.strip())
        else:
            n = int(text)
        
        # Convert to digits
        digits = self._int_to_digits(n)
        
        # Pad to max length (20)
        while len(digits) < 20:
            digits.append(10)  # padding token
        
        # Create tensor
        input_ids = torch.tensor([digits], dtype=torch.long).to(self.device)
        
        # Forward pass
        with torch.no_grad():
            outputs = self.model(input_ids)
            logits = outputs.logits
            predictions = logits.argmax(dim=-1)[0].cpu().tolist()
        
        # Decode
        return self._decode(predictions)
    
    def __call__(self, text: Union[str, int], **kwargs) -> dict:
        """Callable interface for pipeline.
        
        Returns dict with 'generated_text' key for HF pipeline compatibility.
        """
        result = self.generate(text, **kwargs)
        return {"generated_text": result}


def load_namer_pipeline(model_name_or_path: str = "edwinhere/namer", device: str = None, **kwargs):
    """Load a Namer pipeline with model.
    
    This is a convenience function that loads both the model and creates
    a pipeline for easy inference.
    
    Args:
        model_name_or_path: HuggingFace model ID or local path
        device: Device to run on ('cuda', 'cpu', or None for auto)
        **kwargs: Additional args passed to from_pretrained
        
    Returns:
        NamerPipeline instance ready for inference
        
    Example:
        >>> pipe = load_namer_pipeline("edwinhere/namer")
        >>> pipe.generate(42)
        'forty two'
        >>> pipe(123)
        {'generated_text': 'one hundred twenty three'}
    """
    from transformers import AutoModel
    
    model = AutoModel.from_pretrained(
        model_name_or_path,
        trust_remote_code=True,
        **kwargs
    )
    
    return NamerPipeline(model, device=device)
