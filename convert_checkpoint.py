"""Convert old checkpoint format to HuggingFace format."""

import torch
from modeling_namer import NamerModel, NamerConfig

# Load old checkpoint
checkpoint = torch.load("namer_model.pt", map_location="cpu")

# Create config from checkpoint
config = NamerConfig(
    vocab_size=checkpoint["vocab_size"],
    max_output_len=checkpoint["max_output_len"],
    d_model=checkpoint.get("d_model", 128),
    nhead=4,
    num_encoder_layers=4,
    dim_feedforward=512,
    dropout=0.0,
)

# Create new model
model = NamerModel(config)

# Load old weights into new model
model.load_state_dict(checkpoint["model_state_dict"], strict=False)

# Save in HF format
model.save_pretrained(".")
print("Model converted and saved to current directory")
print("Files saved: pytorch_model.bin, config.json")
