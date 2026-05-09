"""Main entry point for namer CLI."""

from __future__ import annotations

import argparse
import sys

import torch

from namer.data import InfiniteNamerDataset
from namer.inference import interactive_inference, predict_number_name
from namer.models import NamerTransformer, load_namer_model
from namer.training import save_model, train_namer_model
from namer.utils import VOCABULARY, encode, int_to_digits, read_digits


def demo_command(args: argparse.Namespace) -> None:
    """Run number name demonstration."""
    print("--- Number Names Demo ---")
    print("\nread_double (two digits):")
    double_cases = [(0, 7), (1, 1), (2, 3), (3, 0), (0, 0), (5, 9)]
    for a, b in double_cases:
        from namer.utils import read_double

        print(f"  read_double({a}, {b}) = '{read_double(a, b)}'")

    print("\nread_triplet (three digits):")
    triplet_cases = [(1, 0, 6), (0, 0, 0), (9, 1, 9), (2, 0, 0), (0, 5, 5), (4, 2, 0)]
    for a, b, c in triplet_cases:
        from namer.utils import read_triplet

        print(f"  read_triplet({a}, {b}, {c}) = '{read_triplet(a, b, c)}'")

    print(f"\nVOCABULARY ({len(VOCABULARY)} words):")
    print(f"  {VOCABULARY}")

    print("\nencode (text to vocabulary indices):")
    encode_cases = [
        "one million",
        "twenty three",
        "one hundred twenty three",
        "nine hundred nineteen",
        "zero",
    ]
    for text in encode_cases:
        print(f"  encode('{text}') = {encode(text)}")

    print("\nencode/decode round-trip:")
    for text in ["one million", "twenty three", "zero"]:
        encoded = encode(text)
        from namer.utils import decode

        decoded = decode(encoded)
        print(f"  '{text}' -> {encoded} -> '{decoded}'")

    print("\nint_to_digits (integer to digit list):")
    int_cases = [0, 7, 123, -456, 1002003, 9876543210]
    for n in int_cases:
        print(f"  int_to_digits({n}) = {int_to_digits(n)}")


# INT64_MAX: 9,223,372,036,854,775,807
INT64_MAX = 9223372036854775807


def train_command(
    num_epochs: int = 30,
    steps_per_epoch: int = 1000,
    batch_size: int = 128,
    learning_rate: float = 0.001,
    max_int: int = INT64_MAX,
    max_seq_len: int = 25,
    max_output_len: int = 35,
) -> None:
    """Train the Namer model.

    Args:
        num_epochs: Number of training epochs
        steps_per_epoch: Number of steps per epoch
        batch_size: Batch size for training
        learning_rate: Learning rate for optimizer
        max_int: Maximum integer value for training (default: INT64_MAX)
        max_seq_len: Maximum input sequence length (default: 25 for 19 digits)
        max_output_len: Maximum output sequence length (default: 35 for large numbers)
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        print(f"Using GPU: {torch.cuda.get_device_name(device)}")
    else:
        print("Warning: CUDA not available, using CPU")

    print(f"Training range: 0 to {max_int:,} ({len(str(max_int))} digits)")
    print(f"Model config: max_seq_len={max_seq_len}, max_output_len={max_output_len}")

    # Create infinite dataset for training with stratified sampling
    # Includes all numbers 0-99,999 and exact powers of 1000 as guaranteed samples
    infinite_dataset = InfiniteNamerDataset(
        max_int=max_int,
        max_seq_len=max_seq_len,
        max_output_len=max_output_len,
        seed=42,
        stratified=True,
        include_all_until=99999,
    )

    # Calculate guaranteed samples info
    guaranteed_count = 100000  # 0-99,999
    powers_of_1000 = [10**3, 10**6, 10**9, 10**12, 10**15, 10**18]
    extra_powers = sum(1 for p in powers_of_1000 if p > 99999 and p <= max_int)
    total_guaranteed = guaranteed_count + extra_powers
    print(f"Guaranteed samples: {total_guaranteed:,} (0-99,999 + {extra_powers} powers of 1000)")

    # Create model
    model = NamerTransformer(
        vocab_size=len(VOCABULARY),
        max_output_len=max_output_len,
        d_model=128,
        nhead=4,
        num_encoder_layers=4,
        dim_feedforward=512,
        dropout=0.1,
    )

    print(f"\nTransformer Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Train model
    trained_model = train_namer_model(
        model=model,
        infinite_dataset=infinite_dataset,
        num_epochs=num_epochs,
        steps_per_epoch=steps_per_epoch,
        val_steps=100,
        batch_size=batch_size,
        learning_rate=learning_rate,
    )

    # Save model
    save_model(trained_model)

    # Test predictions across all scales
    print("\n--- Model Predictions ---")
    trained_model.eval()

    test_numbers = [
        0, 42, 123, 1000, 999999,  # Small numbers
        1000000, 999999999,  # Millions
        1000000000, 999999999999,  # Billions, Trillions
        1000000000000, 999999999999999,  # Trillions, Quadrillions
        1000000000000000,  # Quintillion boundary
    ]
    # Add INT64_MAX if training for that range
    if max_int >= INT64_MAX:
        test_numbers.append(INT64_MAX)

    device_obj = next(trained_model.parameters()).device

    with torch.no_grad():
        for n in test_numbers:
            if n > max_int:
                continue
            pred = predict_number_name(trained_model, n, device_obj)
            actual = read_digits(int_to_digits(n))
            match = "✓" if pred == actual else "✗"
            print(f"  {n:,}: pred='{pred}', actual='{actual}' {match}")


def test_command() -> None:
    """Run quick inference test on saved model."""
    try:
        model = load_namer_model("namer_model.pt")
    except FileNotFoundError:
        print("Error: Model file 'namer_model.pt' not found.")
        print("Please train the model first: python -m namer train")
        sys.exit(1)

    print("Running inference on loaded model:")
    test_nums = [42, 123, 1000, 999999]
    for n in test_nums:
        pred = predict_number_name(model, n)
        actual = read_digits(int_to_digits(n))
        match = "✓" if pred == actual else "✗"
        print(f"  {n} -> '{pred}' (actual: '{actual}') {match}")


def main(argv: list[str] | None = None) -> int:
    """Main CLI entry point.

    Args:
        argv: Command line arguments (defaults to sys.argv)

    Returns:
        Exit code
    """
    parser = argparse.ArgumentParser(
        prog="namer",
        description="A PyTorch transformer model for converting numbers to their English names.",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Demo command
    demo_parser = subparsers.add_parser("demo", help="Run number name demonstrations")
    demo_parser.set_defaults(func=demo_command)

    # Train command
    train_parser = subparsers.add_parser("train", help="Train the model")
    train_parser.add_argument(
        "--epochs", type=int, default=30, help="Number of training epochs (default: 30)"
    )
    train_parser.add_argument(
        "--steps", type=int, default=1000, help="Steps per epoch (default: 1000)"
    )
    train_parser.add_argument(
        "--batch-size", type=int, default=128, help="Batch size (default: 128)"
    )
    train_parser.add_argument(
        "--lr", type=float, default=0.001, help="Learning rate (default: 0.001)"
    )
    train_parser.add_argument(
        "--max-int", type=int, default=INT64_MAX,
        help=f"Maximum integer for training (default: {INT64_MAX})"
    )
    train_parser.add_argument(
        "--max-seq-len", type=int, default=25,
        help="Maximum input sequence length (default: 25 for 19 digits)"
    )
    train_parser.add_argument(
        "--max-output-len", type=int, default=35,
        help="Maximum output sequence length (default: 35)"
    )
    train_parser.set_defaults(
        func=lambda args: train_command(
            num_epochs=args.epochs,
            steps_per_epoch=args.steps,
            batch_size=args.batch_size,
            learning_rate=args.lr,
            max_int=args.max_int,
            max_seq_len=args.max_seq_len,
            max_output_len=args.max_output_len,
        )
    )

    # Inference command
    infer_parser = subparsers.add_parser("infer", help="Run interactive inference")
    infer_parser.set_defaults(func=lambda args: interactive_inference())

    # Test command
    test_parser = subparsers.add_parser("test", help="Run quick inference test")
    test_parser.set_defaults(func=lambda args: test_command())

    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
