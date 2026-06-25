import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CounterService {
  count = 0;
  increment(): number { return ++this.count; }
  decrement(): number { return --this.count; }
  reset(): void { this.count = 0; }
  isPositive(): boolean { return this.count > 0; }
}
