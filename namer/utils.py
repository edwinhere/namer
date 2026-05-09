"""Utility functions for number-to-name conversion."""

from __future__ import annotations

# Global constants for number names
ONES: tuple[str, ...] = (
    "zero", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine"
)

TEENS: tuple[str, ...] = (
    "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"
)

TENS: tuple[str, ...] = (
    "", "", "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety"
)

# Scale words for powers of 1000
SCALES: tuple[str, ...] = (
    "", "thousand", "million", "billion", "trillion",
    "quadrillion", "quintillion", "sextillion", "septillion",
    "octillion", "nonillion", "decillion"
)

# Combined vocabulary of all number words
VOCABULARY: list[str] = []
VOCABULARY.extend(ONES)
VOCABULARY.extend(TEENS)
VOCABULARY.extend([t for t in TENS if t])  # Exclude empty strings
VOCABULARY.append("hundred")
VOCABULARY.extend([s for s in SCALES if s])  # Exclude empty string
VOCABULARY.append("<EOS>")  # End of sequence token

# Create a word-to-index lookup for efficient encoding
WORD_TO_INDEX: dict[str, int] = {word: idx for idx, word in enumerate(VOCABULARY)}

# Special token indices
EOS_IDX: int = VOCABULARY.index("<EOS>")


def int_to_digits(n: int) -> list[int]:
    """Convert an integer to a list of its decimal digits.

    Args:
        n: An integer (can be any size, positive, negative, or zero)

    Returns:
        List of digits (0-9). Returns [0] for zero.
        Negative numbers return digits without the sign.

    Example:
        >>> int_to_digits(123)
        [1, 2, 3]
        >>> int_to_digits(0)
        [0]
        >>> int_to_digits(-456)
        [4, 5, 6]
    """
    if n == 0:
        return [0]

    n = abs(n)

    digits: list[int] = []
    while n > 0:
        digits.append(n % 10)
        n //= 10

    return digits[::-1]


def digits_to_int(digits: list[int]) -> int:
    """Convert a list of decimal digits to an integer.

    This is the inverse of int_to_digits().

    Args:
        digits: List of digits (0-9)

    Returns:
        The integer value represented by the digits

    Raises:
        ValueError: If any digit is not 0-9

    Example:
        >>> digits_to_int([1, 2, 3])
        123
        >>> digits_to_int([0])
        0
    """
    if not digits:
        return 0

    result = 0
    for d in digits:
        if not (0 <= d <= 9):
            raise ValueError(f"Invalid digit {d}, must be 0-9")
        result = result * 10 + d

    return result


def encode(text: str) -> list[int]:
    """Encode a string of number words into a list of vocabulary indices.

    Args:
        text: String containing space-separated number words (e.g., "one million")

    Returns:
        List of indices corresponding to each word in VOCABULARY

    Raises:
        ValueError: If a word is not found in VOCABULARY

    Example:
        >>> encode("one million")
        [1, 29]
    """
    if not text or not text.strip():
        return []

    words = text.strip().lower().split()
    indices: list[int] = []

    for word in words:
        if word not in WORD_TO_INDEX:
            raise ValueError(f"Unknown word '{word}' not in VOCABULARY")
        indices.append(WORD_TO_INDEX[word])

    return indices


def decode(indices: list[int]) -> str:
    """Decode a list of vocabulary indices into a string of number words.

    This is the inverse of encode(). <EOS> tokens are ignored.

    Args:
        indices: List of indices into VOCABULARY (e.g., [1, 30])

    Returns:
        String of space-separated number words (e.g., "one million")

    Raises:
        ValueError: If an index is out of range

    Example:
        >>> decode([1, 30])
        'one million'
    """
    if not indices:
        return ""

    words: list[str] = []
    for idx in indices:
        if not (0 <= idx < len(VOCABULARY)):
            raise ValueError(f"Index {idx} out of range for VOCABULARY (size {len(VOCABULARY)})")
        word = VOCABULARY[idx]
        if word != "<EOS>":
            words.append(word)

    return " ".join(words)


def read_double(a: int, b: int) -> str:
    """Convert two digits (a, b) into the English name of the number they form.

    Args:
        a: Tens digit (0-9)
        b: Ones digit (0-9)

    Returns:
        English name of the number (e.g., "twenty three", "eleven", "seven")
    """
    if not (0 <= a <= 9 and 0 <= b <= 9):
        raise ValueError("Digits must be between 0 and 9")

    number = a * 10 + b

    if number < 10:
        return ONES[number]
    elif number < 20:
        return TEENS[number - 10]
    elif b == 0:
        return TENS[a]
    else:
        return f"{TENS[a]} {ONES[b]}"


def read_triplet(a: int, b: int, c: int) -> str:
    """Convert three digits (a, b, c) into the English name of the number they form.

    Args:
        a: Hundreds digit (0-9)
        b: Tens digit (0-9)
        c: Ones digit (0-9)

    Returns:
        English name of the number (e.g., "one hundred six", "zero", "nine hundred nineteen")
    """
    if not (0 <= a <= 9 and 0 <= b <= 9 and 0 <= c <= 9):
        raise ValueError("Digits must be between 0 and 9")

    if a == 0:
        return read_double(b, c)

    remainder = read_double(b, c)

    if b == 0 and c == 0:
        return f"{ONES[a]} hundred"
    else:
        return f"{ONES[a]} hundred {remainder}"


def read_digits(lst: list[int]) -> str:
    """Convert a list of digits into the English name of the number they form.

    Groups digits into triplets and combines with scale words (thousand, million, etc.)

    Args:
        lst: List of digits (0-9)

    Returns:
        English name of the number
    """
    if not lst:
        return "zero"

    for d in lst:
        if not (0 <= d <= 9):
            raise ValueError("All elements must be digits between 0 and 9")

    if all(d == 0 for d in lst):
        return "zero"

    # Pad with leading zeros to make length a multiple of 3
    padded = lst[:]
    while len(padded) % 3 != 0:
        padded = [0] + padded

    # Group into triplets
    triplets: list[tuple[int, int, int]] = []
    for i in range(0, len(padded), 3):
        triplets.append((padded[i], padded[i+1], padded[i+2]))

    # Build the result by processing each triplet with its scale
    parts: list[str] = []
    num_triplets = len(triplets)

    for i, (a, b, c) in enumerate(triplets):
        if a == 0 and b == 0 and c == 0:
            continue

        triplet_name = read_triplet(a, b, c)
        scale_index = num_triplets - 1 - i
        scale = SCALES[scale_index] if scale_index < len(SCALES) else ""

        if scale:
            parts.append(f"{triplet_name} {scale}")
        else:
            parts.append(triplet_name)

    return " ".join(parts)
