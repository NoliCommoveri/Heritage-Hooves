import { describe, expect, it } from 'vitest';
import { localParts, formatLocal, parseSlot } from '../src/lib/time';

const CHICAGO = 'America/Chicago';

describe('localParts', () => {
  it('handles the moment just before the spring-forward jump (2026-03-08 01:59 CST)', () => {
    const p = localParts(1772956740, CHICAGO); // 2026-03-08T07:59:00Z
    expect(p.dateKey).toBe('2026-03-08');
    expect(p.hour).toBe(1);
    expect(p.minute).toBe(59);
  });

  it('handles the moment just after the spring-forward jump (2026-03-08 03:00 CDT - 2am does not exist)', () => {
    const p = localParts(1772956800, CHICAGO); // 2026-03-08T08:00:00Z
    expect(p.dateKey).toBe('2026-03-08');
    expect(p.hour).toBe(3);
    expect(p.minute).toBe(0);
  });

  it('handles the first 1:30am on the fall-back day (2026-11-01, still CDT)', () => {
    const p = localParts(1793514600, CHICAGO); // 2026-11-01T06:30:00Z
    expect(p.dateKey).toBe('2026-11-01');
    expect(p.hour).toBe(1);
    expect(p.minute).toBe(30);
  });

  it('handles the second 1:30am on the fall-back day (2026-11-01, now CST, one hour later in real time)', () => {
    const p = localParts(1793518200, CHICAGO); // 2026-11-01T07:30:00Z
    expect(p.dateKey).toBe('2026-11-01');
    expect(p.hour).toBe(1);
    expect(p.minute).toBe(30);
  });

  it('computes minutesOfDay', () => {
    const p = localParts(1772956740, CHICAGO);
    expect(p.minutesOfDay).toBe(1 * 60 + 59);
  });
});

describe('formatLocal', () => {
  it('renders YYYY-MM-DD HH:MM', () => {
    expect(formatLocal(1772956740, CHICAGO)).toBe('2026-03-08 01:59');
  });
});

describe('parseSlot', () => {
  it('converts HH:MM to minutes since local midnight', () => {
    expect(parseSlot('00:00')).toBe(0);
    expect(parseSlot('07:00')).toBe(420);
    expect(parseSlot('19:30')).toBe(1170);
  });
});
