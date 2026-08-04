import { describe, expect, it } from 'vitest';
import { bandForTraitScore, conformationLabelFor, conformationLabelsFor, CONFORMATION_LABEL_TEXT, type ConformationLabelBands } from '../../src/engines/conformation/labels';
import type { IdealVector } from '../../src/engines/showing/score';

const BANDS: ConformationLabelBands = { outstandingMin: 90, goodMin: 75, acceptableMin: 55, weakMin: 30 };

describe('bandForTraitScore', () => {
  it('picks each band at its own edge, inclusive of the minimum', () => {
    expect(bandForTraitScore(100, BANDS)).toBe('outstanding');
    expect(bandForTraitScore(90, BANDS)).toBe('outstanding');
    expect(bandForTraitScore(89.9, BANDS)).toBe('good');
    expect(bandForTraitScore(75, BANDS)).toBe('good');
    expect(bandForTraitScore(74.9, BANDS)).toBe('acceptable');
    expect(bandForTraitScore(55, BANDS)).toBe('acceptable');
    expect(bandForTraitScore(54.9, BANDS)).toBe('weak');
    expect(bandForTraitScore(30, BANDS)).toBe('weak');
    expect(bandForTraitScore(29.9, BANDS)).toBe('poor');
    expect(bandForTraitScore(0, BANDS)).toBe('poor');
  });
});

describe('conformationLabelFor', () => {
  it('reads unknown when not eligible, regardless of how good the trait is', () => {
    expect(conformationLabelFor(55, 55, 2.0, BANDS, false)).toBe('unknown');
  });

  it('a trait exactly on target scores outstanding when eligible', () => {
    expect(conformationLabelFor(55, 55, 2.0, BANDS, true)).toBe('outstanding');
  });

  it('reuses the judge\'s own falloff maths, not a second formula - matches traitScoreFor directly', () => {
    // 20 points off target at falloff 2.0 -> traitScore 60 -> acceptable.
    expect(conformationLabelFor(75, 55, 2.0, BANDS, true)).toBe('acceptable');
  });
});

describe('conformationLabelsFor', () => {
  const IDEAL: IdealVector = { neck_length: { target: 55, weight: 1.0 }, shoulder_angle: { target: 70, weight: 1.0 } };

  it('a trait missing from the ideal vector reads unknown even when the horse is otherwise eligible', () => {
    const map = conformationLabelsFor([{ code: 'neck_length', expressed: 55 }, { code: 'back_length', expressed: 35 }], IDEAL, 2.0, BANDS, true);
    expect(map.get('neck_length')).toBe('outstanding');
    expect(map.get('back_length')).toBe('unknown');
  });

  it('a null ideal vector (breed has none) reads every trait as unknown', () => {
    const map = conformationLabelsFor([{ code: 'neck_length', expressed: 55 }], null, 2.0, BANDS, true);
    expect(map.get('neck_length')).toBe('unknown');
  });

  it('CONFORMATION_LABEL_TEXT has display text for every label value bandForTraitScore/conformationLabelFor can produce', () => {
    for (const label of ['unknown', 'poor', 'weak', 'acceptable', 'good', 'outstanding'] as const) {
      expect(typeof CONFORMATION_LABEL_TEXT[label]).toBe('string');
      expect(CONFORMATION_LABEL_TEXT[label].length).toBeGreaterThan(0);
    }
  });
});
