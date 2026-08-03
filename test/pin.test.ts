import { describe, expect, it } from 'vitest';
import { decidePinAttempt } from '../src/lib/pin';

const LIMITS = { maxAttempts: 5, windowSeconds: 900 };

describe('decidePinAttempt', () => {
  it('allows an empty log', () => {
    expect(decidePinAttempt([], 10_000, LIMITS)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('allows when failures are under the limit', () => {
    const attempts = [
      { real_ts: 9_900, success: 0 },
      { real_ts: 9_950, success: 0 },
    ];
    expect(decidePinAttempt(attempts, 10_000, LIMITS).allowed).toBe(true);
  });

  it('refuses at exactly the limit', () => {
    const attempts = Array.from({ length: 5 }, (_, i) => ({ real_ts: 10_000 - i * 10, success: 0 }));
    expect(decidePinAttempt(attempts, 10_000, LIMITS).allowed).toBe(false);
  });

  it('attempts older than the window do not count', () => {
    const attempts = [
      { real_ts: 10_000 - LIMITS.windowSeconds - 1, success: 0 },
      { real_ts: 10_000 - LIMITS.windowSeconds - 1, success: 0 },
      { real_ts: 10_000 - LIMITS.windowSeconds - 1, success: 0 },
      { real_ts: 10_000 - LIMITS.windowSeconds - 1, success: 0 },
      { real_ts: 10_000 - LIMITS.windowSeconds - 1, success: 0 },
    ];
    expect(decidePinAttempt(attempts, 10_000, LIMITS).allowed).toBe(true);
  });

  it('a success does not count toward the lockout', () => {
    const attempts = [
      { real_ts: 9_990, success: 1 },
      { real_ts: 9_980, success: 1 },
      { real_ts: 9_970, success: 1 },
      { real_ts: 9_960, success: 1 },
      { real_ts: 9_950, success: 1 },
    ];
    expect(decidePinAttempt(attempts, 10_000, LIMITS).allowed).toBe(true);
  });

  it('retryAfterSeconds counts from the oldest attempt still inside the window, not the newest', () => {
    const attempts = [
      { real_ts: 10_000 - 800, success: 0 }, // oldest still in window (900s)
      { real_ts: 10_000 - 100, success: 0 },
      { real_ts: 10_000 - 90, success: 0 },
      { real_ts: 10_000 - 80, success: 0 },
      { real_ts: 10_000 - 10, success: 0 }, // newest
    ];
    const decision = decidePinAttempt(attempts, 10_000, LIMITS);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(LIMITS.windowSeconds - 800);
  });
});
