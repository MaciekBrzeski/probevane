use rust_calc::*;

#[test]
fn test_add() {
    assert_eq!(add(2, 3), 5);
    assert_eq!(add(-1, 1), 0);
}

#[test]
fn test_sub() {
    assert_eq!(sub(5, 2), 3);
}

#[test]
fn test_divide() {
    assert_eq!(divide(6, 2), Ok(3));
    assert!(divide(1, 0).is_err());
}

#[test]
fn test_is_even() {
    assert!(is_even(4));
    assert!(!is_even(3));
}
