import { describe, expect, it } from 'vitest';
import { validatePrefix, normalizePrefix } from '../src/lib/prefix';

describe('validatePrefix', () => {
  it('accepts a plain two-word prefix', () => {
    expect(validatePrefix('Willow Creek')).toEqual({ ok: true });
  });

  it('accepts the minimum length of 2', () => {
    expect(validatePrefix('Oz')).toEqual({ ok: true });
  });

  it('accepts the maximum length of 20', () => {
    expect(validatePrefix('A'.repeat(20))).toEqual({ ok: true });
  });

  it('accepts apostrophes and hyphens', () => {
    expect(validatePrefix("O'Malley").ok).toBe(true);
    expect(validatePrefix('Cross-Creek').ok).toBe(true);
  });

  it('trims surrounding whitespace before checking length', () => {
    expect(validatePrefix('  Oz  ')).toEqual({ ok: true });
  });

  it('rejects fewer than 2 characters', () => {
    const result = validatePrefix('A');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/between 2 and 20/);
  });

  it('rejects more than 20 characters', () => {
    const result = validatePrefix('A'.repeat(21));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/between 2 and 20/);
  });

  it('rejects digits', () => {
    const result = validatePrefix('Barn9');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/letters, spaces/);
  });

  it('rejects other punctuation', () => {
    const result = validatePrefix('Willow!');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/letters, spaces/);
  });

  it('rejects a prefix starting with a space', () => {
    // after trimming this becomes "Oz Creek" which is fine, so use a leading hyphen instead
    const result = validatePrefix('-Oz Creek');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/start and end with a letter/);
  });

  it('rejects a prefix ending with an apostrophe', () => {
    const result = validatePrefix("Oz Creek'");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/start and end with a letter/);
  });

  it('rejects consecutive spaces', () => {
    const result = validatePrefix('Willow  Creek');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/consecutive spaces/);
  });
});

describe('normalizePrefix', () => {
  it('trims but preserves capitalisation', () => {
    expect(normalizePrefix('  Willow Creek  ')).toBe('Willow Creek');
  });
});
