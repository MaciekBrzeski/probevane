// Bounded-concurrency pool — run independent async work with a cap. Used for the
// hybrid easy-band (each per-target draft is independent) and any per-target fan
// -out. Order-preserving; a worker that throws yields its rejection in-place when
// awaited, so wrap workers that should never abort the pool in a try/catch.

export async function runPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  limit = 4,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  async function lane(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
