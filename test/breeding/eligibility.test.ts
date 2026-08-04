import { describe, expect, it } from 'vitest';
import { mareIneligibility, type MareEligibilityInput } from '../../src/engines/breeding/eligibility';

const GAME_DAY = 2000;
const MIN_AGE = 1080;
const RECOVERY = 60;

function baseInput(overrides: Partial<MareEligibilityInput> = {}): MareEligibilityInput {
  return {
    bornGameDay: 0,
    gameDay: GAME_DAY,
    minBreedingAgeGameDays: MIN_AGE,
    availability: { available: true },
    lastFoaledGameDay: null,
    mareRecoveryGameDays: RECOVERY,
    inFoal: false,
    booked: false,
    ...overrides,
  };
}

describe('mareIneligibility', () => {
  it('returns undefined for a free, eligible mare', () => {
    expect(mareIneligibility(baseInput())).toBeUndefined();
  });

  it('flags a mare out at pasture', () => {
    expect(mareIneligibility(baseInput({ availability: { available: false, reason: 'at_pasture' } }))).toBe('at_pasture');
  });

  it('flags a mare still settling in from pasture', () => {
    expect(
      mareIneligibility(baseInput({ availability: { available: false, reason: 'settling_in', daysRemaining: 3 } }))
    ).toBe('settling_in');
  });

  it('flags a mare not yet old enough to breed', () => {
    expect(mareIneligibility(baseInput({ bornGameDay: GAME_DAY - (MIN_AGE - 1) }))).toBe('too_young');
  });

  it('flags a mare still recovering from foaling', () => {
    expect(mareIneligibility(baseInput({ lastFoaledGameDay: GAME_DAY - (RECOVERY - 1) }))).toBe('recovering');
  });

  it('flags a mare already in foal', () => {
    expect(mareIneligibility(baseInput({ inFoal: true }))).toBe('in_foal');
  });

  it('flags a mare already booked to a covering', () => {
    expect(mareIneligibility(baseInput({ booked: true }))).toBe('booked');
  });

  it('prioritises location over every other reason', () => {
    expect(
      mareIneligibility(
        baseInput({ availability: { available: false, reason: 'at_pasture' }, bornGameDay: GAME_DAY, inFoal: true, booked: true })
      )
    ).toBe('at_pasture');
  });

  it('prioritises age over recovery, pregnancy and booking', () => {
    expect(
      mareIneligibility(baseInput({ bornGameDay: GAME_DAY - (MIN_AGE - 1), inFoal: true, booked: true }))
    ).toBe('too_young');
  });
});
