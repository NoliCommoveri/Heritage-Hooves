/**
 * breeds.discipline_aptitudes (migrations 0143/0144) and its use in scoreAbilityEntry. This is
 * docs/horse-game-schema.md's long-named `discipline_aptitudes`, deliberately left unbuilt by slice
 * 0012 §3.2 ("Discipline classes are open to everyone") until the aptitudes were actually decided.
 *
 * Like test/genetics/breed-ability-bias.test.ts, the seeded numbers are read out of the migration
 * rather than hand-copied, so a retune that quietly advantages one breed across all six disciplines
 * fails here instead of in front of the children.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseDisciplineAptitudes, aptitudeFor, NEUTRAL_APTITUDE } from '../../src/engines/breeds/identity';
import { scoreAbilityEntry, type AbilityWeights } from '../../src/engines/showing/abilityScore';

const SEED_SQL = fs.readFileSync(path.join(process.cwd(), 'migrations', '0144_seed_breed_discipline_aptitudes.sql'), 'utf8');
const DISCIPLINE_SQL = fs.readFileSync(path.join(process.cwd(), 'migrations', '0108_seed_disciplines_remaining.sql'), 'utf8');

const DISCIPLINES = ['barrels', 'racing', 'jumping', 'endurance', 'dressage', 'gaited'];

function seededAptitudes(): { code: string; aptitudes: Record<string, number> }[] {
  const out: { code: string; aptitudes: Record<string, number> }[] = [];
  const re = /SET discipline_aptitudes = '([^']+)'\s*\nWHERE code = '([A-Z]+)';/g;
  let match;
  while ((match = re.exec(SEED_SQL)) !== null) out.push({ code: match[2], aptitudes: parseDisciplineAptitudes(match[1]) });
  return out;
}

/** Barrel Racing's real weights, from migration 0063 - used below so the worked example this whole
 * change was commissioned to fix is asserted against the actual seeded discipline, not a stand-in. */
const BARRELS: AbilityWeights = { speed: 1.4, stamina: 0.2, jump_scope: 0, trainability: 0.8, agility: 1.5 };

describe('the seeded discipline aptitudes', () => {
  it('covers all eight breeds', () => {
    expect(seededAptitudes().map((a) => a.code).sort()).toEqual(['AR', 'FR', 'GW', 'IC', 'NOK', 'PF', 'QH', 'TB']);
  });

  it('names every discipline the game actually runs, so no breed is silently neutral anywhere', () => {
    // Cross-checked against the seeded disciplines rather than only the constant above, so adding a
    // seventh discipline without giving the breeds an opinion about it fails here.
    const seededCodes = Array.from(DISCIPLINE_SQL.matchAll(/^\('([a-z]+)', '/gm)).map((m) => m[1]);
    expect(new Set([...seededCodes, 'barrels'])).toEqual(new Set(DISCIPLINES));
    for (const { code, aptitudes } of seededAptitudes()) {
      for (const discipline of DISCIPLINES) {
        expect(aptitudes[discipline], `${code} has no opinion about ${discipline}`).toBeTypeOf('number');
      }
    }
  });

  it('keeps every aptitude within +/-0.05 of neutral', () => {
    for (const { code, aptitudes } of seededAptitudes()) {
      for (const discipline of DISCIPLINES) {
        const deviation = Math.abs(aptitudes[discipline] - 1.0);
        expect(deviation, `${code}.${discipline} deviates by ${String(deviation)}`).toBeLessThanOrEqual(0.05 + 1e-9);
      }
    }
  });

  it('keeps every breed row close to neutral on average, so nobody is advantaged across the board', () => {
    // Rows are deliberately NOT zero-sum (a breed may be good at two things), so this is the check
    // that replaces the zero-sum rule ability_bias uses.
    for (const { code, aptitudes } of seededAptitudes()) {
      const mean = DISCIPLINES.reduce((acc, d) => acc + aptitudes[d], 0) / DISCIPLINES.length;
      expect(mean, `${code}'s mean aptitude is ${String(mean)}`).toBeGreaterThan(0.98);
      expect(mean, `${code}'s mean aptitude is ${String(mean)}`).toBeLessThan(1.02);
    }
  });

  it('gives every breed at least one discipline it is actually good at', () => {
    for (const { code, aptitudes } of seededAptitudes()) {
      const best = Math.max(...DISCIPLINES.map((d) => aptitudes[d]));
      expect(best, `${code} is not above neutral anywhere`).toBeGreaterThan(1.0);
    }
  });

  it('puts the Quarter Horse above the German Warmblood in barrels - the reported defect', () => {
    const byCode = new Map(seededAptitudes().map((a) => [a.code, a.aptitudes]));
    expect(byCode.get('QH')!.barrels).toBeGreaterThan(byCode.get('GW')!.barrels);
    // ...and the Warmblood ahead where it belongs, so this is a redistribution rather than a nerf.
    expect(byCode.get('GW')!.jumping).toBeGreaterThan(byCode.get('QH')!.jumping);
    expect(byCode.get('GW')!.dressage).toBeGreaterThan(byCode.get('QH')!.dressage);
  });
});

describe('aptitudeFor', () => {
  it('reads a crossbred horse as neutral regardless of the breed it is registered under', () => {
    const qh = { barrels: 1.05 };
    expect(aptitudeFor(qh, 'barrels', false)).toBe(1.05);
    expect(aptitudeFor(qh, 'barrels', true)).toBe(NEUTRAL_APTITUDE);
  });

  it('reads an unknown discipline, an empty table and a null column as neutral, never as zero', () => {
    expect(aptitudeFor({ barrels: 1.05 }, 'jumping', false)).toBe(NEUTRAL_APTITUDE);
    expect(aptitudeFor({}, 'barrels', false)).toBe(NEUTRAL_APTITUDE);
    expect(aptitudeFor(parseDisciplineAptitudes(null), 'barrels', false)).toBe(NEUTRAL_APTITUDE);
    expect(aptitudeFor({ barrels: 1.05 }, null, false)).toBe(NEUTRAL_APTITUDE);
  });
});

describe('scoreAbilityEntry with an aptitude', () => {
  const EXPRESSED = { speed: 50, stamina: 50, jump_scope: 50, trainability: 50, agility: 50 };

  it('is a no-op when omitted - every pre-0143 caller keeps producing exactly its old number', () => {
    const omitted = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
    const explicit = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, aptitudeModifier: 1.0 });
    expect(omitted.finalScore).toBe(explicit.finalScore);
  });

  it('multiplies the final score without touching the raw score', () => {
    const base = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
    const boosted = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, aptitudeModifier: 1.05 });
    expect(boosted.rawScore).toBe(base.rawScore);
    expect(boosted.finalScore).toBeCloseTo(base.finalScore * 1.05, 10);
  });

  it('applies before noise, not after - so a bad draw can still beat a good breed', () => {
    const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 3, aptitudeModifier: 1.05 });
    expect(result.finalScore).toBeCloseTo(50 * 1.05 + 3, 10);
  });

  it('stacks multiplicatively with care and age, in either order', () => {
    const a = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, careModifier: 0.9, ageModifier: 0.8, aptitudeModifier: 1.05 });
    expect(a.finalScore).toBeCloseTo(50 * 0.9 * 0.8 * 1.05, 10);
  });

  it('lets an off-breed horse with a founding specialist still take a barrel class', () => {
    // The tuning decision behind +/-0.05, asserted rather than left in a document. A Warmblood
    // carrying a speed specialist (potential 15 -> geneticValue 75) against an ordinary Quarter
    // Horse with no specialist. Expressed values here are what the 0142 biases produce at the mid
    // band: QH speed/agility 56, stamina 44, trainability 50; GW trainability 55, agility 51,
    // stamina 50, speed overwritten to 75 by the specialist.
    const gwSpecialist = scoreAbilityEntry({
      expressed: { speed: 75, stamina: 50, jump_scope: 44, trainability: 55, agility: 51 },
      weights: BARRELS,
      noise: 0,
      aptitudeModifier: 0.95,
    });
    const qhOrdinary = scoreAbilityEntry({
      expressed: { speed: 56, stamina: 44, jump_scope: 44, trainability: 50, agility: 56 },
      weights: BARRELS,
      noise: 0,
      aptitudeModifier: 1.05,
    });
    expect(gwSpecialist.finalScore).toBeGreaterThan(qhOrdinary.finalScore);

    // ...but an ordinary Warmblood does not, which is the defect this whole change exists to fix.
    const gwOrdinary = scoreAbilityEntry({
      expressed: { speed: 44, stamina: 50, jump_scope: 44, trainability: 55, agility: 51 },
      weights: BARRELS,
      noise: 0,
      aptitudeModifier: 0.95,
    });
    expect(gwOrdinary.finalScore).toBeLessThan(qhOrdinary.finalScore);
  });
});
