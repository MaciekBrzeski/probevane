# Unit patterns — Rust (cargo test)

Integration test in `tests/<name>.rs`, using the crate's public API.

## PATTERN R1 — basic
```rust
use my_crate::*;

#[test]
fn adds() {
    assert_eq!(add(2, 3), 5);
    assert_eq!(add(-1, 1), 0);
}
```

## PATTERN R2 — Result / error path
```rust
#[test]
fn divide_by_zero_errs() {
    assert!(divide(1, 0).is_err());
    assert_eq!(divide(6, 2), Ok(3));
}
```

## Rules
- `use <crate>::*;` at the top; one `#[test] fn` per behavior.
- Assert with `assert_eq!` / `assert!`; cover happy paths and every error/`Result` path.
- No `thread::sleep`, no `#[ignore]`.
- Use only the pub fns in the ground truth.
