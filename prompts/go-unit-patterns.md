# Unit patterns — Go stdlib testing

One `<name>_test.go` per source file, in the SAME package.

## PATTERN G1 — table-driven
```go
func TestAdd(t *testing.T) {
	cases := []struct {
		name    string
		a, b, want int
	}{
		{"positives", 2, 3, 5},
		{"with zero", 5, 0, 5},
		{"negatives", -1, -1, -2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Add(c.a, c.b); got != c.want {
				t.Errorf("Add(%d,%d)=%d, want %d", c.a, c.b, got, c.want)
			}
		})
	}
}
```

## PATTERN G2 — error path
```go
func TestDivideByZero(t *testing.T) {
	if _, err := Divide(1, 0); err == nil {
		t.Fatal("expected error for division by zero")
	}
}
```

## Rules
- Assert with `t.Errorf` (continue) or `t.Fatalf` (stop). Every `TestXxx` must assert.
- Cover happy paths, boundaries, and every error return.
- No `time.Sleep`, no unconditional `t.Skip()`.
- Use only exported funcs/types from the ground truth.
