package gocalc

import "errors"

// Add returns the sum of a and b.
func Add(a, b int) int { return a + b }

// Sub returns a minus b.
func Sub(a, b int) int { return a - b }

// Divide returns a/b, or an error on division by zero.
func Divide(a, b int) (int, error) {
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}

// IsEven reports whether n is even.
func IsEven(n int) bool { return n%2 == 0 }
