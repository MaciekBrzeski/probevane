"""Golden hand-written suite — the baseline a good generated run should match."""
import pytest

from calc import add, subtract, divide, is_even


def test_add():
    assert add(2, 3) == 5


def test_subtract():
    assert subtract(5, 2) == 3


def test_divide():
    assert divide(6, 2) == 3


def test_divide_by_zero_raises():
    with pytest.raises(ValueError):
        divide(1, 0)


def test_is_even():
    assert is_even(4) is True
    assert is_even(3) is False
