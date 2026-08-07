// Slice 0028: the type-gene ladder, the band deal, the founding specialist upgrade, and the two
// generational ratchets (baseline / mare prenatal care). See docs/slices/0028-conformation-genetics.md
// §7 for the numbered test list this file draws from, and CLAUDE.md's 2026-08-07 operator update for
// the ratchet mechanics themselves (a replacement for §2.7's original wording, not in the slice doc).

import { describe, expect, it } from 'vitest';
import {
  RUNG_COUNT,
  REACH_RUNGS,
  RUNGS_PER_BAND,
  DEFAULT_PAIR_SPECS,
  rungValue,
  alleleForRung,
  rungForAllele,
  nearestRung,
  shownValueFor,
  meanValueFor,
  alleleBuckets,
  dealForBand,
  applySpecialistUpgrade,
  applyBaselineRatchet,
  applyCareRatchet,
  TYPE_LOCUS_CODE,
  type TypeGenePairs,
} from '../../src/engines/conformation/typeGene';
import { CONFORMATION_TRAITS } from '../../src/engines/conformation/traits';
import { makeRng } from '../../src/lib/rng';
import type { IdealVector } from '../../src/engines/showing/score';

// A five-trait ideal vector with varied targets, one near an end of the scale (neck_length, 10) to
// exercise the "forced inward" side rule.
const IDEAL: IdealVector = {
  neck_length: { target: 10, weight: 1 },
  shoulder_angle: { target: 50, weight: 1 },
  back_length: { target: 74, weight: 1 },
  hock_set: { target: 34, weight: 1 },
  head_profile: { target: 58, weight: 1 },
};

describe('rung/allele round-trip', () => {
  it('rungValue and rungForAllele invert each other across the whole ladder', () => {
    for (let rung = 0; rung < RUNG_COUNT; rung++) {
      const value = rungValue(rung);
      expect(rungForAllele(String(value))).toBe(rung);
      expect(alleleForRung(rung)).toBe(String(value));
    }
  });

  it('nearestRung snaps a raw value to the closest rung, never more than half a step away', () => {
    for (let raw = 1; raw <= 99; raw++) {
      const snapped = rungValue(nearestRung(raw));
      expect(Math.abs(snapped - raw)).toBeLessThanOrEqual(2);
    }
  });
});

describe('shownValueFor (§2.3: faults dominant)', () => {
  it('a symmetric tie (both alleles equally far, opposite sides) picks the lower value - a stable, arbitrary choice that scores identically either way', () => {
    expect(shownValueFor(['42', '58'], 50)).toBe(42); // both 8 off
    expect(shownValueFor(['46', '54'], 50)).toBe(46); // both 4 off
  });

  it('a genuine asymmetric pair shows the worse one, whichever side', () => {
    expect(shownValueFor(['48', '38'], 50)).toBe(38); // 38 is 12 off, 48 is 2 off - 38 shows
    expect(shownValueFor(['52', '62'], 50)).toBe(62); // 62 is 12 off, 52 is 2 off - 62 shows
  });

  it('a homozygous pair always shows its own value', () => {
    expect(shownValueFor(['74', '74'], 50)).toBe(74);
  });
});

describe('meanValueFor (§2.8)', () => {
  it('is the plain average of both alleles', () => {
    expect(meanValueFor(['42', '58'])).toBe(50);
    expect(meanValueFor(['50', '50'])).toBe(50);
    expect(meanValueFor(['10', '90'])).toBe(50);
  });
});

describe('alleleBuckets', () => {
  it('covers 0..REACH_RUNGS in steps of RUNGS_PER_BAND, truncated at the reach', () => {
    const buckets = alleleBuckets();
    expect(buckets[0]).toEqual([0, RUNGS_PER_BAND - 1]);
    expect(buckets[buckets.length - 1][1]).toBe(REACH_RUNGS);
    // No bucket ever exceeds the reach.
    for (const [, hi] of buckets) expect(hi).toBeLessThanOrEqual(REACH_RUNGS);
  });
});

describe('dealForBand (§2.5, §7 test 2/3)', () => {
  it('every dealt allele is within REACH_RUNGS of the trait target - the breed-type guarantee', () => {
    for (const band of ['low', 'mid', 'high'] as const) {
      for (let seed = 0; seed < 200; seed++) {
        const rng = makeRng(seed * 7919 + 1);
        const pairs = dealForBand(DEFAULT_PAIR_SPECS[band], IDEAL, rng);
        for (const trait of CONFORMATION_TRAITS) {
          const pair = pairs[trait]!;
          const targetRung = nearestRung(IDEAL[trait]!.target);
          for (const allele of pair) {
            const dist = Math.abs(rungForAllele(allele) - targetRung);
            expect(dist, `${trait} at seed ${String(seed)}`).toBeLessThanOrEqual(REACH_RUNGS);
          }
        }
      }
    }
  });

  it('deals nothing for a null ideal vector - "still generates, not judged"', () => {
    const rng = makeRng(1);
    expect(dealForBand(DEFAULT_PAIR_SPECS.low, null, rng)).toEqual({});
  });

  it('deals nothing for a trait absent from a partial ideal vector', () => {
    const rng = makeRng(1);
    const partial: IdealVector = { neck_length: { target: 50, weight: 1 } };
    const pairs = dealForBand(DEFAULT_PAIR_SPECS.low, partial, rng);
    expect(Object.keys(pairs)).toEqual(['neck_length']);
  });

  it('every band deals exactly its stated word profile, per trait, every time (§7 test 3)', () => {
    // low: buckets [0,0,1,1,2,3] as bucket indices per DEFAULT_PAIR_SPECS.low, shown value is
    // whichever of the pair is in the WORSE (higher-index) bucket - so the shown bucket per trait,
    // across the five traits, is always the multiset {0,1,1,2,3} for low, regardless of shuffle.
    const expectedShownBuckets: Record<'low' | 'mid' | 'high', number[]> = {
      low: [0, 1, 2, 2, 3].sort(),
      mid: [0, 0, 1, 2, 3].sort(),
      high: [0, 0, 0, 1, 2].sort(),
    };
    for (const band of ['low', 'mid', 'high'] as const) {
      for (let seed = 0; seed < 50; seed++) {
        const rng = makeRng(seed * 104729 + 3);
        const pairs = dealForBand(DEFAULT_PAIR_SPECS[band], IDEAL, rng);
        const buckets = alleleBuckets();
        const shownBuckets = CONFORMATION_TRAITS.map((trait) => {
          const pair = pairs[trait]!;
          const targetRung = nearestRung(IDEAL[trait]!.target);
          const shown = shownValueFor(pair, rungValue(targetRung)); // shownValueFor wants a raw target value
          const dist = Math.abs(rungForAllele(String(shown)) - targetRung);
          return buckets.findIndex(([lo, hi]) => dist >= lo && dist <= hi);
        }).sort((a, b) => a - b);
        expect(shownBuckets, `band ${band} seed ${String(seed)}`).toEqual(expectedShownBuckets[band]);
      }
    }
  });
});

describe('applySpecialistUpgrade (§2.6)', () => {
  it('lands the assigned trait exactly on its breed target rung', () => {
    for (let seed = 0; seed < 30; seed++) {
      const rng = makeRng(seed * 811 + 2);
      const pairs = dealForBand(DEFAULT_PAIR_SPECS.low, IDEAL, rng);
      for (const trait of CONFORMATION_TRAITS) {
        const before: TypeGenePairs = { [trait]: [...pairs[trait]!] as [string, string] };
        applySpecialistUpgrade(before, IDEAL, trait);
        const targetRung = nearestRung(IDEAL[trait]!.target);
        const [a, b] = before[trait]!;
        expect([rungForAllele(a), rungForAllele(b)]).toContain(targetRung);
      }
    }
  });

  it('returns null and changes nothing for a trait absent from the ideal vector', () => {
    const pairs: TypeGenePairs = { neck_length: ['50', '50'] };
    const result = applySpecialistUpgrade(pairs, IDEAL, 'shoulder_angle');
    expect(result).toBeNull();
  });

  it('round-robin across a batch of five leaves no trait without an exact-target allele (§2.6, §7 test 6)', () => {
    // One founding batch of five candidates, each assigned a different round-robin index 0..4 -
    // between them, every one of the five traits must have been upgraded to its exact target by
    // at least one horse in the batch.
    const touchedTraits = new Set<string>();
    for (let index = 0; index < CONFORMATION_TRAITS.length; index++) {
      const rng = makeRng(index * 97 + 5);
      const pairs = dealForBand(DEFAULT_PAIR_SPECS.low, IDEAL, rng);
      const assignedTrait = CONFORMATION_TRAITS[index % CONFORMATION_TRAITS.length];
      const upgraded = applySpecialistUpgrade(pairs, IDEAL, assignedTrait);
      if (upgraded) touchedTraits.add(upgraded);
    }
    expect([...touchedTraits].sort()).toEqual([...CONFORMATION_TRAITS].sort());
  });
});

describe('applyBaselineRatchet (operator update 2026-08-07)', () => {
  it('moves exactly one trait, by exactly one rung, toward its target', () => {
    const pairs: TypeGenePairs = {
      neck_length: ['2', '2'], // 2 rungs (8 points) off a target of 10 - the only off-target trait
      shoulder_angle: ['50', '50'], // on target
      back_length: ['74', '74'], // on target
      hock_set: ['34', '34'], // on target
      head_profile: ['58', '58'], // on target
    };
    const rng = makeRng(42);
    const moved = applyBaselineRatchet(pairs, IDEAL, rng);
    expect(moved).toBe('neck_length');
    // '2' -> rung 0, target rung for 10 is rung 2 (nearestRung(10) = round((10-2)/4) = 2). Moving
    // one rung toward it from rung 0 means both alleles (homozygous, so both move) go to rung 1.
    expect(pairs.neck_length).toEqual(['6', '6']);
    // Every on-target trait is untouched.
    expect(pairs.shoulder_angle).toEqual(['50', '50']);
    expect(pairs.back_length).toEqual(['74', '74']);
    expect(pairs.hock_set).toEqual(['34', '34']);
    expect(pairs.head_profile).toEqual(['58', '58']);
  });

  it('does nothing when every trait already sits on its target', () => {
    const pairs: TypeGenePairs = {
      neck_length: ['10', '10'],
      shoulder_angle: ['50', '50'],
      back_length: ['74', '74'],
      hock_set: ['34', '34'],
      head_profile: ['58', '58'],
    };
    const before = JSON.parse(JSON.stringify(pairs)) as TypeGenePairs;
    const rng = makeRng(1);
    const moved = applyBaselineRatchet(pairs, IDEAL, rng);
    expect(moved).toBeNull();
    expect(pairs).toEqual(before);
  });

  it('never moves a trait past its target', () => {
    // One rung off, moving one rung must land exactly ON target, not overshoot.
    const pairs: TypeGenePairs = { neck_length: ['6', '6'] };
    const idealNeckOnly: IdealVector = { neck_length: { target: 10, weight: 1 } };
    const rng = makeRng(9);
    applyBaselineRatchet(pairs, idealNeckOnly, rng);
    expect(pairs.neck_length).toEqual(['10', '10']);
    // Applying again must leave it exactly on target, not moving further.
    applyBaselineRatchet(pairs, idealNeckOnly, rng);
    expect(pairs.neck_length).toEqual(['10', '10']);
  });

  it('a heterozygous pair only moves the worse-placed allele, costing one allele step', () => {
    // target 50: pair (30, 54) - 30 is 20 off, 54 is 4 off. 30 is worse and should move alone.
    const pairs: TypeGenePairs = { shoulder_angle: ['30', '54'] };
    const idealOnly: IdealVector = { shoulder_angle: { target: 50, weight: 1 } };
    const rng = makeRng(3);
    applyBaselineRatchet(pairs, idealOnly, rng);
    expect(pairs.shoulder_angle).toEqual(['34', '54']);
  });
});

describe('applyCareRatchet (mare prenatal care, replaces §2.7 baseline)', () => {
  it('moves up to three DISTINCT traits, one rung each, never the same trait twice', () => {
    const pairs: TypeGenePairs = {
      neck_length: ['2', '2'], // 8 rungs off target 10
      shoulder_angle: ['30', '30'], // 5 rungs off target 50
      back_length: ['62', '62'], // 3 rungs off target 74
      hock_set: ['34', '34'], // on target
      head_profile: ['58', '58'], // on target
    };
    const rng = makeRng(11);
    const moved = applyCareRatchet(pairs, IDEAL, rng);
    expect(moved.length).toBe(3);
    expect(new Set(moved).size).toBe(3); // all distinct
    // The three worst (neck_length, shoulder_angle, back_length) are the ones off-target - the two
    // already on-target traits must never be among the moved set or touched at all.
    expect(moved.sort()).toEqual(['back_length', 'neck_length', 'shoulder_angle'].sort());
    expect(pairs.hock_set).toEqual(['34', '34']);
    expect(pairs.head_profile).toEqual(['58', '58']);
    // Each moved trait shifted by exactly one rung (4 points) toward its target.
    expect(pairs.neck_length).toEqual(['6', '6']);
    expect(pairs.shoulder_angle).toEqual(['34', '34']);
    expect(pairs.back_length).toEqual(['66', '66']);
  });

  it('moves fewer than three when fewer than three traits are off target', () => {
    const pairs: TypeGenePairs = {
      neck_length: ['6', '6'], // 1 rung off
      shoulder_angle: ['50', '50'],
      back_length: ['74', '74'],
      hock_set: ['34', '34'],
      head_profile: ['58', '58'],
    };
    const rng = makeRng(5);
    const moved = applyCareRatchet(pairs, IDEAL, rng);
    expect(moved).toEqual(['neck_length']);
    expect(pairs.neck_length).toEqual(['10', '10']);
  });

  it('does nothing when every trait already sits on target', () => {
    const pairs: TypeGenePairs = {
      neck_length: ['10', '10'],
      shoulder_angle: ['50', '50'],
      back_length: ['74', '74'],
      hock_set: ['34', '34'],
      head_profile: ['58', '58'],
    };
    const rng = makeRng(6);
    expect(applyCareRatchet(pairs, IDEAL, rng)).toEqual([]);
  });
});

describe('TYPE_LOCUS_CODE', () => {
  it('maps every conformation trait to a distinct two-letter locus code', () => {
    const codes = CONFORMATION_TRAITS.map((t) => TYPE_LOCUS_CODE[t]);
    expect(new Set(codes).size).toBe(CONFORMATION_TRAITS.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });
});
