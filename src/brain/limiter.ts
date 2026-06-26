// Shared concurrency limiter for API calls. Per-call retry/backoff handles a
// momentary 429; this bounds how many requests are IN FLIGHT at once so concurrent
// targets/repos (Phase-3 factory) don't all hit the API together and blow the
// per-minute token limit (the runestone 50k-TPM lesson). PROBEVANE_MAX_INFLIGHT=0
// / unset = unlimited (single-run default). A token/min bucket is a Phase-3 refinement.

export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export const apiLimiter = new Limiter(Number(process.env.PROBEVANE_MAX_INFLIGHT ?? 0) || Infinity);
