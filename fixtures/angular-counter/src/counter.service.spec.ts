import { CounterService } from './counter.service';
describe('CounterService', () => {
  it('increments', () => { const s = new CounterService(); expect(s.increment()).toBe(1); expect(s.count).toBe(1); });
  it('decrements + reset', () => { const s = new CounterService(); s.increment(); s.decrement(); expect(s.count).toBe(0); s.increment(); s.reset(); expect(s.count).toBe(0); });
  it('isPositive', () => { const s = new CounterService(); expect(s.isPositive()).toBe(false); s.increment(); expect(s.isPositive()).toBe(true); });
});
