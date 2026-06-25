# Unit patterns — pytest

Tests live in `test_<module>.py`. Import the functions under test from their module. Use plain `assert`.

## PATTERN P1 — pure function
```python
from calc import add

def test_add_positive():
    assert add(2, 3) == 5

def test_add_negative():
    assert add(-1, -1) == -2
```

## PATTERN P2 — error path
```python
import pytest
from calc import divide

def test_divide_by_zero_raises():
    with pytest.raises(ValueError):
        divide(1, 0)
```

## PATTERN P3 — parametrize (table-driven)
```python
import pytest
from calc import is_even

@pytest.mark.parametrize("n,expected", [(2, True), (3, False), (0, True)])
def test_is_even(n, expected):
    assert is_even(n) is expected
```

## Rules
- One behavior per test; name it for the behavior (`test_<thing>_<case>`).
- Cover happy path, edge cases (0, empty, boundaries), and every error path with `pytest.raises`.
- Every test must contain an `assert` (or `pytest.raises`). No `time.sleep`. No `@pytest.mark.skip`.
- Import only names listed in the ground truth.
