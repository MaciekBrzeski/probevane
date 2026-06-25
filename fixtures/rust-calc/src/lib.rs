//! A tiny calculator crate — unit-test target.

pub fn add(a: i64, b: i64) -> i64 { a + b }

pub fn sub(a: i64, b: i64) -> i64 { a - b }

pub fn divide(a: i64, b: i64) -> Result<i64, String> {
    if b == 0 { return Err("division by zero".to_string()); }
    Ok(a / b)
}

pub fn is_even(n: i64) -> bool { n % 2 == 0 }
