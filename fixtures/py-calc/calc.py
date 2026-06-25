"""A tiny calculator module — unit-test target for the python-pytest adapter."""


def add(a: float, b: float) -> float:
    return a + b


def subtract(a: float, b: float) -> float:
    return a - b


def divide(a: float, b: float) -> float:
    if b == 0:
        raise ValueError("division by zero")
    return a / b


def is_even(n: int) -> bool:
    return n % 2 == 0
