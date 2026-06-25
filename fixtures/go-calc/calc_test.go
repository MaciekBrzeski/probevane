package gocalc

import "testing"

func TestAdd(t *testing.T) {
	cases := []struct{ a, b, want int }{{2, 3, 5}, {-1, 1, 0}, {0, 0, 0}}
	for _, c := range cases {
		if got := Add(c.a, c.b); got != c.want {
			t.Errorf("Add(%d,%d)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestSub(t *testing.T) {
	if got := Sub(5, 2); got != 3 {
		t.Errorf("Sub(5,2)=%d want 3", got)
	}
}

func TestDivide(t *testing.T) {
	if got, err := Divide(6, 2); err != nil || got != 3 {
		t.Errorf("Divide(6,2)=%d,%v want 3,nil", got, err)
	}
	if _, err := Divide(1, 0); err == nil {
		t.Fatalf("Divide(1,0) expected error")
	}
}

func TestIsEven(t *testing.T) {
	if !IsEven(4) || IsEven(3) {
		t.Errorf("IsEven wrong")
	}
}
