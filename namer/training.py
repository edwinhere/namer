"""Training utilities for Namer models."""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

from namer.models import NamerTransformer
from namer.data import InfiniteNamerDataset


def train_namer_model(
    model: NamerTransformer,
    dataset: TensorDataset | None = None,
    infinite_dataset: InfiniteNamerDataset | None = None,
    num_epochs: int = 50,
    steps_per_epoch: int = 1000,
    val_steps: int = 100,
    batch_size: int = 64,
    learning_rate: float = 0.001,
    patience: int = 10,
    device: str | torch.device = "cuda" if torch.cuda.is_available() else "cpu",
) -> NamerTransformer:
    """Train the model on a finite dataset or infinite iterable dataset.

    Args:
        model: The model to train
        dataset: Finite TensorDataset with (digits, encoded_names) pairs
        infinite_dataset: Infinite IterableDataset for infinite training
        num_epochs: Number of training epochs
        steps_per_epoch: Number of steps per epoch (for infinite dataset)
        val_steps: Number of validation steps per epoch
        batch_size: Batch size for training
        learning_rate: Learning rate for optimizer
        patience: Early stopping patience
        device: Device to train on ('cuda' or 'cpu')

    Returns:
        Trained model
    """
    model = model.to(device)

    optimizer = optim.Adam(model.parameters(), lr=learning_rate)
    # Weight EOS token (last index) more heavily to improve EOS prediction
    vocab_size = model.vocab_size
    eos_idx = vocab_size - 1  # EOS is always last
    weights = torch.ones(vocab_size, device=device)
    weights[eos_idx] = 5.0  # 5x weight for EOS
    criterion = nn.CrossEntropyLoss(ignore_index=-1, weight=weights)

    print(f"Training on {device}")
    print(f"Early stopping patience: {patience} epochs")

    # Setup data loaders
    if infinite_dataset is not None:
        print(f"Using INFINITE dataset (max_int={infinite_dataset.max_int})")
        print(f"Steps per epoch: {steps_per_epoch}, Val steps: {val_steps}")

        train_loader = DataLoader(
            infinite_dataset,
            batch_size=batch_size,
            num_workers=0,
        )
        val_loader = DataLoader(
            infinite_dataset,
            batch_size=batch_size,
            num_workers=0,
        )
    else:
        if dataset is None:
            raise ValueError("Either dataset or infinite_dataset must be provided")

        train_size = int(0.9 * len(dataset))
        val_size = len(dataset) - train_size
        train_dataset, val_dataset = torch.utils.data.random_split(
            dataset, [train_size, val_size], generator=torch.Generator().manual_seed(42)
        )
        train_loader = DataLoader(
            train_dataset, batch_size=batch_size, shuffle=True
        )
        val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
        steps_per_epoch = len(train_loader)
        val_steps = len(val_loader)
        print(f"Train samples: {len(train_dataset)}, Val samples: {len(val_dataset)}")

    best_val_loss = float("inf")
    epochs_without_improvement = 0
    best_model_state: dict | None = None

    for epoch in range(num_epochs):
        # Training
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        train_iter = iter(train_loader)
        for _ in range(steps_per_epoch):
            digits_batch, target_batch = next(train_iter)
            digits_batch = digits_batch.to(device)
            target_batch = target_batch.to(device)

            optimizer.zero_grad()

            logits = model(digits_batch)
            loss = criterion(
                logits.view(-1, model.vocab_size), target_batch.view(-1)
            )

            loss.backward()
            optimizer.step()

            train_loss += loss.item()

            mask = target_batch != -1
            predictions = logits.argmax(dim=-1)
            train_correct += ((predictions == target_batch) & mask).sum().item()
            train_total += mask.sum().item()

        train_loss /= steps_per_epoch
        train_acc = train_correct / train_total if train_total > 0 else 0

        # Validation
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            val_iter = iter(val_loader)
            for _ in range(val_steps):
                digits_batch, target_batch = next(val_iter)
                digits_batch = digits_batch.to(device)
                target_batch = target_batch.to(device)

                logits = model(digits_batch)
                loss = criterion(
                    logits.view(-1, model.vocab_size), target_batch.view(-1)
                )

                val_loss += loss.item()

                mask = target_batch != -1
                predictions = logits.argmax(dim=-1)
                val_correct += ((predictions == target_batch) & mask).sum().item()
                val_total += mask.sum().item()

        val_loss /= val_steps
        val_acc = val_correct / val_total if val_total > 0 else 0

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            epochs_without_improvement = 0
            best_model_state = model.state_dict().copy()
        else:
            epochs_without_improvement += 1

        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(
                f"Epoch {epoch+1}/{num_epochs}: "
                f"train_loss={train_loss:.4f}, train_acc={train_acc:.4f}, "
                f"val_loss={val_loss:.4f}, val_acc={val_acc:.4f}, "
                f"patience={epochs_without_improvement}/{patience}"
            )

        if epochs_without_improvement >= patience:
            print(f"\nEarly stopping triggered! No improvement for {patience} epochs.")
            break

    print(f"\nBest validation loss: {best_val_loss:.4f}")

    if best_model_state is not None:
        model.load_state_dict(best_model_state)
        print("Restored best model from checkpoint.")

    return model


def save_model(model: NamerTransformer, model_path: str = "namer_model.pt") -> None:
    """Save a trained model to disk.

    Args:
        model: The model to save
        model_path: Path where to save the model
    """
    checkpoint = {
        "model_type": "transformer",
        "model_state_dict": model.state_dict(),
        "vocab_size": model.vocab_size,
        "max_output_len": model.max_output_len,
        "d_model": model.d_model,
    }

    torch.save(checkpoint, model_path)
    print(f"Model saved to {model_path}")
