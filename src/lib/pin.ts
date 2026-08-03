// Slice 0016 §9.3/§9.4: the admin PIN's lockout, pure and untested against a database so it can be
// tested without one. The lockout is global (every attempt against the admin door, not per account
// or per session - §9.3's "a determined eleven-year-old farming attempts across a sibling's
// login"), and only failures count toward it.
//
// This is measured against the real wall clock, not world.game_day - a deliberate, named exception
// to CLAUDE.md §5.3 (see slice 0005 §7.5's three reasons, repeated at the comparison site in
// routes/admin.ts: a lockout measured in game days would stop while the world is paused and jump
// fifteen days a tick; the thing being defended against happens in real minutes; and it is a
// security control, not game logic - no horse, pregnancy, show or balance depends on it).

export interface PinAttemptRecord {
  real_ts: number;
  success: number;
}

export interface PinLockoutLimits {
  maxAttempts: number;
  windowSeconds: number;
}

export interface PinAttemptDecision {
  allowed: boolean;
  /** 0 when allowed. Otherwise how many real seconds until the oldest failure still inside the
   * window falls out of it. */
  retryAfterSeconds: number;
}

export function decidePinAttempt(recentAttempts: PinAttemptRecord[], nowSeconds: number, limits: PinLockoutLimits): PinAttemptDecision {
  const failuresInWindow = recentAttempts.filter((a) => a.success === 0 && nowSeconds - a.real_ts <= limits.windowSeconds);

  if (failuresInWindow.length < limits.maxAttempts) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const oldestStillInWindow = failuresInWindow.reduce((min, a) => Math.min(min, a.real_ts), failuresInWindow[0].real_ts);
  const retryAfterSeconds = Math.max(0, limits.windowSeconds - (nowSeconds - oldestStillInWindow));
  return { allowed: false, retryAfterSeconds };
}
