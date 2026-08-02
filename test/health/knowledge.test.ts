// The truth-versus-knowledge boundary (CLAUDE.md §12, slice 0010 §2.4/§7.3) - the thing most worth
// a test because it is invisible on screen the moment it is crossed by accident.
import { describe, expect, it } from 'vitest';
import { ownerVisibleStatus, type ConditionTrigger } from '../../src/engines/health/status';
import { breedingHealthWarnings } from '../../src/engines/health/breedingWarning';
import { GENOTYPE_VERSION, type Genotype } from '../../src/engines/genetics/genotype';

function genotypeWith(locus: string, a: string, b: string): Genotype {
  return { v: GENOTYPE_VERSION, mendelian: { [locus]: [a, b] }, polygenic: {} };
}

const HERDA: ConditionTrigger = { v: 1, locus: 'HERDA', mutant: 'Hrd', mode: 'recessive' }; // signs_visible = 1
const GBED: ConditionTrigger = { v: 1, locus: 'GBED', mutant: 'Gb', mode: 'recessive' }; // signs_visible = 0

describe('ownerVisibleStatus - no knowledge row', () => {
  it('a carrier is never visible without a test, even for a signs_visible condition', () => {
    const carrier = genotypeWith('HERDA', 'N', 'Hrd');
    expect(ownerVisibleStatus(carrier, HERDA, true, undefined).status).toBeNull();
  });

  it('a clear horse is never shown as anything without a test', () => {
    const clear = genotypeWith('HERDA', 'N', 'N');
    expect(ownerVisibleStatus(clear, HERDA, true, undefined).status).toBeNull();
  });

  it('an affected horse is visible for free when the condition is signs_visible', () => {
    const affected = genotypeWith('HERDA', 'Hrd', 'Hrd');
    const result = ownerVisibleStatus(affected, HERDA, true, undefined);
    expect(result.status).toBe('affected');
    expect(result.observedOnly).toBe(true);
  });

  it('an affected horse is NOT visible for free when the condition is not signs_visible (GBED)', () => {
    const affected = genotypeWith('GBED', 'Gb', 'Gb');
    expect(ownerVisibleStatus(affected, GBED, false, undefined).status).toBeNull();
  });
});

describe('ownerVisibleStatus - a paid-for result always wins', () => {
  it('a stored clear result is shown even if the genotype has since been reinterpreted (defensive, not expected in practice)', () => {
    const affected = genotypeWith('HERDA', 'Hrd', 'Hrd');
    const result = ownerVisibleStatus(affected, HERDA, true, { result: 'clear' });
    expect(result.status).toBe('clear');
    expect(result.observedOnly).toBe(false);
  });

  it('a carrier result is shown once tested, for a condition with no visible signs', () => {
    const carrier = genotypeWith('GBED', 'N', 'Gb');
    const result = ownerVisibleStatus(carrier, GBED, false, { result: 'carrier' });
    expect(result.status).toBe('carrier');
    expect(result.copies).toBe(1);
  });
});

describe('breedingHealthWarnings - the breeding preview health line (slice 0010 §7.3)', () => {
  const conditions = [{ code: 'GBED', name: 'GBED' }];

  it('given two carrier genotypes but no knowledge rows, returns nothing', () => {
    const warnings = breedingHealthWarnings(new Map(), new Map(), conditions);
    expect(warnings).toEqual([]);
  });

  it('given knowledge rows for both as carriers, returns the one-in-four warning', () => {
    const mare = new Map([['GBED', 'carrier' as const]]);
    const stallion = new Map([['GBED', 'carrier' as const]]);
    const warnings = breedingHealthWarnings(mare, stallion, conditions);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].sentence).toMatch(/one in four/);
    expect(warnings[0].sentence).toMatch(/one in two/); // carrier odds
  });

  it('knowing only one side as a carrier says so without giving odds', () => {
    const mare = new Map([['GBED', 'carrier' as const]]);
    const warnings = breedingHealthWarnings(mare, new Map(), conditions);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].sentence).toMatch(/has not been tested/);
    expect(warnings[0].sentence).not.toMatch(/one in four/);
  });

  it('knowing one side is clear produces no warning, regardless of the other side', () => {
    const mare = new Map([['GBED', 'clear' as const]]);
    const stallion = new Map([['GBED', 'carrier' as const]]);
    expect(breedingHealthWarnings(mare, stallion, conditions)).toEqual([]);
  });
});
