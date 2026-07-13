// Tiny text helpers shared by gate feedback — consolidated from three identical
// per-rune copies surfaced by `search --similar --fns`.

/** Last n chars — enough failure output to act on without flooding the transcript. */
export function tail(s: string, n = 2500): string {
  return s.length > n ? s.slice(-n) : s;
}
