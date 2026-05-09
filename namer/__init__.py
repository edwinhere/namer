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
