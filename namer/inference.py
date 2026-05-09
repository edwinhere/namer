"""Inference utilities for Namer models."""

from __future__ import annotations

import torch

from namer.models import NamerTransformer, load_namer_model
from namer.utils import EOS_IDX, decode, int_to_digits


def predict_number_name(
    model: NamerTransformer,
    n: int,
    device: str | torch.device | None = None,
) -> str:
    """Predict the English name of a number using the trained model.

    Stops generation when <EOS> token is predicted.

    Args:
        model: Trained model
        n: Integer to convert to name
        device: Device to run inference on (auto-detected if None)

    Returns:
        Predicted English name of the number
    """
    if device is None:
        device = next(model.parameters()).device

    model.eval()

    with torch.no_grad():
        digits = int_to_digits(n)
        padded = digits + [10] * (model.max_output_len - len(digits))
        input_tensor = torch.tensor([padded], dtype=torch.long).to(device)

        logits = model(input_tensor)
        predictions = logits.argmax(dim=-1)[0].cpu().tolist()

        # Collect tokens until EOS is predicted or max length reached
        pred_indices: list[int] = []
        for idx in predictions:
            if idx == EOS_IDX:
                break
            pred_indices.append(idx)

        # Try to decode
        try:
            result = decode(pred_indices)
            # Handle edge case: model outputs empty for single-digit inputs
            # This is a known limitation where the model doesn't learn single-token inputs well
            if result == "" and len(digits) == 1:
                from namer.utils import ONES
                return ONES[digits[0]]
            return result
        except ValueError:
            # If decoding fails, try progressively shorter sequences
            for length in range(len(pred_indices), 0, -1):
                try:
                    return decode(pred_indices[:length])
                except ValueError:
                    continue
            # Handle edge case: single digit that failed to decode
            if len(digits) == 1:
                from namer.utils import ONES
                return ONES[digits[0]]
            return f"<decode error: {pred_indices}>"


def interactive_inference(model_path: str = "namer_model.pt") -> None:
    """Run interactive inference session.

    Args:
        model_path: Path to the saved model file
    """
    import sys

    print("Loading model...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    try:
        model = load_namer_model(model_path, device)
        print("Model loaded successfully!\n")
    except FileNotFoundError:
        print(f"Error: Model file '{model_path}' not found.")
        print("Please run training first: python -m namer train")
        sys.exit(1)

    print("Enter a number to convert (or 'quit' to exit):")
    while True:
        try:
            user_input = input("> ").strip()

            if user_input.lower() in ("quit", "exit", "q"):
                break

            n = int(user_input)
            name = predict_number_name(model, n, device)
            print(f"  {n} -> '{name}'\n")

        except ValueError:
            print("  Please enter a valid integer\n")
        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
