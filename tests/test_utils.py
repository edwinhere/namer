"""Tests for utility functions."""

import pytest

from namer.utils import (
    EOS_IDX,
    VOCABULARY,
    decode,
    digits_to_int,
    encode,
    int_to_digits,
    read_digits,
    read_double,
    read_triplet,
)


class TestIntToDigits:
    """Tests for int_to_digits function."""

    def test_zero(self) -> None:
        assert int_to_digits(0) == [0]

    def test_positive(self) -> None:
        assert int_to_digits(123) == [1, 2, 3]
        assert int_to_digits(7) == [7]

    def test_negative(self) -> None:
        assert int_to_digits(-456) == [4, 5, 6]

    def test_large_number(self) -> None:
        assert int_to_digits(1002003) == [1, 0, 0, 2, 0, 0, 3]


class TestDigitsToInt:
    """Tests for digits_to_int function."""

    def test_empty(self) -> None:
        assert digits_to_int([]) == 0

    def test_single_digit(self) -> None:
        assert digits_to_int([5]) == 5

    def test_multiple_digits(self) -> None:
        assert digits_to_int([1, 2, 3]) == 123

    def test_with_zeros(self) -> None:
        assert digits_to_int([1, 0, 0, 2]) == 1002

    def test_invalid_digit(self) -> None:
        with pytest.raises(ValueError, match="Invalid digit"):
            digits_to_int([10])


class TestRoundTrip:
    """Tests for int_to_digits <-> digits_to_int round-trip."""

    def test_round_trip(self) -> None:
        for n in [0, 42, 123, 1000, 999999, 1000000]:
            assert digits_to_int(int_to_digits(n)) == abs(n)


class TestReadDouble:
    """Tests for read_double function."""

    def test_single_digit(self) -> None:
        assert read_double(0, 7) == "seven"
        assert read_double(0, 0) == "zero"

    def test_teens(self) -> None:
        assert read_double(1, 1) == "eleven"
        assert read_double(1, 9) == "nineteen"

    def test_tens(self) -> None:
        assert read_double(3, 0) == "thirty"
        assert read_double(5, 0) == "fifty"

    def test_tens_and_ones(self) -> None:
        assert read_double(2, 3) == "twenty three"
        assert read_double(5, 9) == "fifty nine"

    def test_invalid_digits(self) -> None:
        with pytest.raises(ValueError, match="must be between 0 and 9"):
            read_double(10, 5)


class TestReadTriplet:
    """Tests for read_triplet function."""

    def test_hundreds(self) -> None:
        assert read_triplet(1, 0, 6) == "one hundred six"
        assert read_triplet(2, 0, 0) == "two hundred"

    def test_zero_hundreds(self) -> None:
        assert read_triplet(0, 5, 5) == "fifty five"

    def test_all_zeros(self) -> None:
        assert read_triplet(0, 0, 0) == "zero"


class TestReadDigits:
    """Tests for read_digits function."""

    def test_empty(self) -> None:
        assert read_digits([]) == "zero"

    def test_zero(self) -> None:
        assert read_digits([0]) == "zero"
        assert read_digits([0, 0, 0]) == "zero"

    def test_single_digit(self) -> None:
        assert read_digits([5]) == "five"

    def test_double_digit(self) -> None:
        assert read_digits([4, 2]) == "forty two"

    def test_triple_digit(self) -> None:
        assert read_digits([1, 2, 3]) == "one hundred twenty three"

    def test_thousands(self) -> None:
        assert read_digits([1, 0, 0, 0]) == "one thousand"
        assert read_digits([1, 2, 3, 4]) == "one thousand two hundred thirty four"

    def test_millions(self) -> None:
        assert read_digits([1, 0, 0, 0, 0, 0, 0]) == "one million"

    def test_complex(self) -> None:
        # 1,234,567
        digits = [1, 2, 3, 4, 5, 6, 7]
        result = read_digits(digits)
        assert "one million" in result
        assert "two hundred thirty four thousand" in result
        assert "five hundred sixty seven" in result

    def test_invalid_digit(self) -> None:
        with pytest.raises(ValueError, match="must be digits"):
            read_digits([1, 10, 3])


class TestEncode:
    """Tests for encode function."""

    def test_simple(self) -> None:
        indices = encode("one million")
        assert len(indices) == 2
        assert all(0 <= i < len(VOCABULARY) for i in indices)

    def test_multi_word(self) -> None:
        indices = encode("twenty three")
        assert len(indices) == 2

    def test_empty(self) -> None:
        assert encode("") == []
        assert encode("   ") == []

    def test_unknown_word(self) -> None:
        with pytest.raises(ValueError, match="Unknown word"):
            encode("unknown")


class TestDecode:
    """Tests for decode function."""

    def test_simple(self) -> None:
        encoded = encode("one million")
        assert decode(encoded) == "one million"

    def test_with_eos(self) -> None:
        encoded = encode("one million") + [EOS_IDX]
        assert decode(encoded) == "one million"

    def test_empty(self) -> None:
        assert decode([]) == ""

    def test_invalid_index(self) -> None:
        with pytest.raises(ValueError, match="out of range"):
            decode([9999])


class TestEncodeDecodeRoundTrip:
    """Tests for encode/decode round-trip."""

    def test_round_trip(self) -> None:
        test_cases = [
            "one million",
            "twenty three",
            "one hundred twenty three",
            "zero",
            "nine hundred nineteen",
        ]
        for text in test_cases:
            encoded = encode(text)
            assert decode(encoded) == text
