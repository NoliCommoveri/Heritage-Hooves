import { describe, expect, it } from 'vitest';
import { parseAllelePool } from '../../src/engines/founding/pool';

describe('parseAllelePool', () => {
  it('parses a well-formed pool', () => {
    const pool = parseAllelePool(
      '{"E":{"E":0.55,"e":0.45},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.03,"g":0.97},"DMRT3":{"C":0.98,"A":0.02},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}'
    );
    expect(pool.E).toEqual({ E: 0.55, e: 0.45 });
  });

  it('accepts a locus fixed for a single allele', () => {
    const pool = parseAllelePool(
      '{"E":{"E":0.92,"e":0.08},"A":{"a":1.0},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}'
    );
    expect(pool.A).toEqual({ a: 1.0 });
  });

  it('throws naming the missing locus', () => {
    const missingDmrt3 = '{"E":{"E":0.5,"e":0.5},"A":{"A":0.5,"a":0.5},"CR":{"cr":1.0},"G":{"g":1.0}}';
    expect(() => parseAllelePool(missingDmrt3)).toThrow(/DMRT3/);
  });

  it('throws on an unknown allele symbol', () => {
    const badAllele = '{"E":{"E":0.5,"e":0.5},"A":{"A":0.5,"a":0.5},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":0.9,"X":0.1}}';
    expect(() => parseAllelePool(badAllele)).toThrow(/DMRT3/);
  });

  it('throws when a locus does not sum to 1.0', () => {
    const badSum = '{"E":{"E":0.5,"e":0.4},"A":{"A":0.5,"a":0.5},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":1.0}}';
    expect(() => parseAllelePool(badSum)).toThrow(/locus E frequencies sum/);
  });
});
