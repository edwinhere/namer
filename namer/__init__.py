"""Namer - A PyTorch transformer model for converting numbers to English names."""

__version__ = "0.2.0"

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

# Import NamerPipeline from HuggingFace integration module
# This is available when the package is used with HuggingFace
import sys
from pathlib import Path

# Add parent directory to path to find modeling_namer.py
_parent_dir = Path(__file__).parent.parent
if str(_parent_dir) not in sys.path:
    sys.path.insert(0, str(_parent_dir))

try:
    from modeling_namer import NamerPipeline, load_namer_pipeline
    _has_hf_integration = True
except ImportError:
    _has_hf_integration = False
    NamerPipeline = None  # type: ignore
    load_namer_pipeline = None  # type: ignore

__all__ = [
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

# Add HF integration to exports if available
if _has_hf_integration:
    __all__.extend(["NamerPipeline", "load_namer_pipeline"])
