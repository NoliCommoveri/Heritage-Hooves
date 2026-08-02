import { describe, expect, it } from 'vitest';
import { describeHorse } from '../../src/engines/genetics/describe';
import type { Phenotype } from '../../src/engines/genetics/expression';

function phenotype(overrides: Partial<Phenotype> = {}): Phenotype {
  return {
    baseColour: 'bay',
    dilution: 'none',
    dilutedColour: 'bay',
    greyStage: 'none',
    visibleColour: 'bay',
    bornColour: 'bay',
    gaited: false,
    ...overrides,
  };
}

describe('describeHorse', () => {
  it('describes an adult mare', () => {
    expect(describeHorse(phenotype(), 'mare', 4)).toBe('A bay mare, 4 years old.');
  });

  it('describes a young horse as a filly/colt and an under-a-year-old horse without a whole number', () => {
    const foal = phenotype({ dilutedColour: 'palomino', visibleColour: 'palomino' });
    expect(describeHorse(foal, 'mare', 0.4)).toBe('A palomino filly, under a year old.');
  });

  it('adds a "born X" clause once a grey horse has started visibly changing, but not while still foal_grey', () => {
    const stillLooksBase = phenotype({ greyStage: 'foal_grey', visibleColour: 'bay', bornColour: 'bay' });
    expect(describeHorse(stillLooksBase, 'mare', 0.5)).not.toMatch(/born/);

    const greying = phenotype({ greyStage: 'greying', visibleColour: 'greying', bornColour: 'chestnut' });
    expect(describeHorse(greying, 'stallion', 5)).toBe('A greying stallion, born chestnut, 5 years old.');
  });

  it('adds a gaited clause with the correct pronoun', () => {
    const gaitedMare = phenotype({ gaited: true });
    expect(describeHorse(gaitedMare, 'mare', 5)).toBe('A bay mare, 5 years old, and she is gaited.');
    const gaitedStallion = phenotype({ gaited: true });
    expect(describeHorse(gaitedStallion, 'stallion', 5)).toBe('A bay stallion, 5 years old, and he is gaited.');
  });
});
