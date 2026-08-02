import { describe, expect, it } from 'vitest';
import { generateFoundingName } from '../../src/engines/founding/names';

describe('generateFoundingName', () => {
  it('is deterministic for a given seed and attempt', () => {
    expect(generateFoundingName(777)).toEqual(generateFoundingName(777));
    expect(generateFoundingName(777, 2)).toEqual(generateFoundingName(777, 2));
  });

  it('walks to a different name on a later attempt (the collision-retry sequence)', () => {
    const first = generateFoundingName(1234);
    const retried = generateFoundingName(1234, 1);
    expect(retried).not.toEqual(first);
  });
});
