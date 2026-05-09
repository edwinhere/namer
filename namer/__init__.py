"""Namer - A PyTorch transformer model for converting numbers to English names."""

__version__ = "0.3.0"

# Original API
from namer.models import NamerTransformer, load_namer_model
from namer.inference import predict_number_name
from namer.utils import (
    VOCABULARY,
    encode,
    decode,
    int_to_digits,
    digits_to_int,
    read_digits,
    read_triplet,
    read_double,
)

# HuggingFace compatible API
try:
    from .modeling_namer import (
        NamerModel,
        NamerConfig,
        NamerPipeline,
        load_namer_pipeline,
    )
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False

__all__ = [
    # Original API
    "NamerTransformer",
    "load_namer_model",
    "predict_number_name",
    "VOCABULARY",
    "encode",
    "decode",
    "int_to_digits",
    "digits_to_int",
    "read_digits",
    "read_triplet",
    "read_double",
]

if HF_AVAILABLE:
    __all__.extend([
        # HuggingFace API
        "NamerModel",
        "NamerConfig", 
        "NamerPipeline",
        "load_namer_pipeline",
    ])
