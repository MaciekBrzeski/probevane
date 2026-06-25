# Unit patterns — Angular (jest-preset-angular)

Place the test next to its source as `<name>.spec.ts`.

## PATTERN NG1 — service (no DOM)
```ts
import { CounterService } from './counter.service';
describe('CounterService', () => {
  it('increments and resets', () => {
    const s = new CounterService();
    s.increment(); s.increment();
    expect(s.count).toBe(2);
    s.reset();
    expect(s.count).toBe(0);
  });
});
```

## PATTERN NG2 — component (TestBed)
```ts
import { TestBed } from '@angular/core/testing';
import { CounterComponent } from './counter.component';
it('renders the count', () => {
  const f = TestBed.configureTestingModule({ declarations: [CounterComponent] }).createComponent(CounterComponent);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('0');
});
```

## Rules
- Assert concrete values + error paths; one behavior per `it`. Use only the class/exports in the ground truth.
