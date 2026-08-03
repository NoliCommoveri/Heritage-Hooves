import { describe, expect, it } from 'vitest';
import { scoreEntry, type IdealVector, type JudgeWeights } from '../../src/engines/showing/score';

// The Quarter Horse standard from slice 0008 §4.2/§4.6.
const QH_IDEAL: IdealVector = {
  neck_length: { target: 55, weight: 1.0 },
  shoulder_angle: { target: 70, weight: 1.2 },
  back_length: { target: 35, weight: 1.1 },
  hock_set: { target: 50, weight: 0.9 },
};

const ASH = { neck_length: 58, shoulder_angle: 66, back_length: 40, hock_set: 52 };
const BIRCH = { neck_length: 55, shoulder_angle: 71, back_length: 48, hock_set: 50 };

const BALANCED: JudgeWeights = { neck_length: 1.0, shoulder_angle: 1.0, back_length: 1.0, hock_set: 1.0 };
const MOVEMENT: JudgeWeights = { neck_length: 1.1, shoulder_angle: 1.6, back_length: 0.8, hock_set: 0.7 };
const SUBSTANCE: JudgeWeights = { neck_length: 0.8, shoulder_angle: 0.8, back_length: 1.5, hock_set: 1.3 };

function rawScoreOf(expressed: typeof ASH, judge: JudgeWeights): number {
  return scoreEntry({ expressed, ideal: QH_IDEAL, judgeWeights: judge, falloff: 2.0, noise: 0 }).rawScore;
}

describe('scoreEntry', () => {
  it('a horse matching the standard exactly scores 100 under every judge', () => {
    const perfect = { neck_length: 55, shoulder_angle: 70, back_length: 35, hock_set: 50 };
    for (const judge of [BALANCED, MOVEMENT, SUBSTANCE]) {
      expect(rawScoreOf(perfect, judge)).toBeCloseTo(100, 6);
    }
  });

  it('trait score falls off linearly and clamps at 0 rather than going negative', () => {
    const result = scoreEntry({
      expressed: { neck_length: 115 }, // 60 points off a target of 55
      ideal: { neck_length: { target: 55, weight: 1.0 } },
      judgeWeights: {},
      falloff: 2.0,
      noise: 0,
    });
    expect(result.traits[0].traitScore).toBe(0);

    const closer = scoreEntry({
      expressed: { neck_length: 65 }, // 10 points off
      ideal: { neck_length: { target: 55, weight: 1.0 } },
      judgeWeights: {},
      falloff: 2.0,
      noise: 0,
    });
    expect(closer.traits[0].traitScore).toBe(80);
  });

  it('a missing trait key in a judge weights reads as 1.0', () => {
    const explicit = rawScoreOf(ASH, { neck_length: 1.0, shoulder_angle: 1.0, back_length: 1.0, hock_set: 1.0 });
    const missing = rawScoreOf(ASH, {});
    expect(missing).toBeCloseTo(explicit, 6);
  });

  it('noise adds directly onto the final score, after the care/tack modifiers (pinned at 1.0)', () => {
    const result = scoreEntry({ expressed: ASH, ideal: QH_IDEAL, judgeWeights: BALANCED, falloff: 2.0, noise: 3.5 });
    expect(result.finalScore).toBeCloseTo(result.rawScore + 3.5, 6);
  });

  // Slice 0013 §10 test 10: a regression test that nobody has "helpfully" moved the care modifier
  // to the wrong side of the noise addition - this function itself does not change with care.
  it('careModifier: 0.95 produces exactly rawScore * 0.95 + noise', () => {
    const withoutCare = scoreEntry({ expressed: ASH, ideal: QH_IDEAL, judgeWeights: BALANCED, falloff: 2.0, noise: 2.0 });
    const withCare = scoreEntry({ expressed: ASH, ideal: QH_IDEAL, judgeWeights: BALANCED, falloff: 2.0, noise: 2.0, careModifier: 0.95 });
    expect(withCare.rawScore).toBeCloseTo(withoutCare.rawScore, 10);
    expect(withCare.finalScore).toBeCloseTo(withCare.rawScore * 0.95 + 2.0, 10);
  });

  // §4.6's worked example, checked against the formula in §4.4 rather than trusted from the design
  // document's prose - slice 0006 §4.4 shipped a worked example whose prose disagreed with its own
  // formula, and the fix there was to implement the formula and flag it. Same discipline here: if
  // these numbers ever stop reproducing, the formula above is the specification.
  describe('§4.6 worked example: Ash vs Birch under three judges', () => {
    it('Marchbank (balanced): Ash wins, by two tenths of a point', () => {
      expect(rawScoreOf(ASH, BALANCED)).toBeCloseTo(92.81, 2);
      expect(rawScoreOf(BIRCH, BALANCED)).toBeCloseTo(92.62, 2);
    });
    it('Ellery (movement): Birch wins, and not narrowly', () => {
      expect(rawScoreOf(ASH, MOVEMENT)).toBeCloseTo(92.65, 2);
      expect(rawScoreOf(BIRCH, MOVEMENT)).toBeCloseTo(94.1, 2);
    });
    it('Halloway (substance): Ash wins clearly', () => {
      expect(rawScoreOf(ASH, SUBSTANCE)).toBeCloseTo(92.65, 2);
      expect(rawScoreOf(BIRCH, SUBSTANCE)).toBeCloseTo(90.21, 2);
    });
  });

  it('judge weights change the winner - the same two horses, three judges, two different winners', () => {
    expect(rawScoreOf(ASH, BALANCED)).toBeGreaterThan(rawScoreOf(BIRCH, BALANCED));
    expect(rawScoreOf(BIRCH, MOVEMENT)).toBeGreaterThan(rawScoreOf(ASH, MOVEMENT));
    expect(rawScoreOf(ASH, SUBSTANCE)).toBeGreaterThan(rawScoreOf(BIRCH, SUBSTANCE));
  });
});
