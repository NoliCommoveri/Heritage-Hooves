import { describe, expect, it } from 'vitest';
import { expressPhenotype } from '../../src/engines/genetics/expression';
import type { Genotype } from '../../src/engines/genetics/genotype';

const GAME_DAYS_PER_YEAR = 360;
// Inert for every test in this file except the penetrance-determinism one below: no pattern
// locus is set on these genotypes, so patternsOf's rolls never gate anything (slice 0021 §5.5).
const PATTERN_SEED = 1;

function genotypeWith(mendelian: Genotype['mendelian']): Genotype {
  return { v: 1, mendelian, polygenic: {} };
}

describe('expressPhenotype: base colour and epistasis', () => {
  const cases: [string, [string, string], [string, string], string][] = [
    ['ee AA -> chestnut (epistasis: agouti ignored)', ['e', 'e'], ['A', 'A'], 'chestnut'],
    ['ee Aa -> chestnut (epistasis: agouti ignored)', ['e', 'e'], ['A', 'a'], 'chestnut'],
    ['ee aa -> chestnut (epistasis: agouti ignored)', ['e', 'e'], ['a', 'a'], 'chestnut'],
    ['E_ A_ -> bay', ['E', 'e'], ['A', 'a'], 'bay'],
    ['E_ aa -> black', ['E', 'e'], ['a', 'a'], 'black'],
  ];

  it.each(cases)('%s', (_label, ePair, aPair, expected) => {
    const genotype = genotypeWith({ E: ePair, A: aPair, CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] });
    const phenotype = expressPhenotype(genotype, 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.baseColour).toBe(expected);
    expect(phenotype.visibleColour).toBe(expected);
  });
});

describe('expressPhenotype: cream dose', () => {
  const cases: [string, string, string, string][] = [
    ['chestnut, single cream -> palomino', 'e', 'A', 'palomino'],
    ['chestnut, double cream -> cremello', 'e', 'A', 'cremello'],
    ['bay, single cream -> buckskin', 'E', 'A', 'buckskin'],
    ['bay, double cream -> perlino', 'E', 'A', 'perlino'],
    ['black, single cream -> smoky black', 'E', 'a', 'smoky black'],
    ['black, double cream -> smoky cream', 'E', 'a', 'smoky cream'],
  ];

  it('every cell of the cream table, single and double dose', () => {
    for (const [label, eAllele, aAllele, expected] of cases) {
      const dose: 1 | 2 = label.includes('double') ? 2 : 1;
      const crPair: [string, string] = dose === 1 ? ['Cr', 'cr'] : ['Cr', 'Cr'];
      const genotype = genotypeWith({
        E: [eAllele, 'e'],
        A: [aAllele, 'a'],
        CR: crPair,
        G: ['g', 'g'],
        DMRT3: ['C', 'C'],
      });
      const phenotype = expressPhenotype(genotype, 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED);
      expect(phenotype.dilutedColour, label).toBe(expected);
      expect(phenotype.dilution, label).toBe(dose === 1 ? 'cream_single' : 'cream_double');
    }
  });
});

describe('expressPhenotype: grey progression', () => {
  it('the same genotype at 0, 2, 6 and 10 years gives four different visibleColours and one unchanging bornColour', () => {
    const genotype = genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'C'] });

    const ages = [0, 2, 6, 10].map((years) => expressPhenotype(genotype, years * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED));

    expect(ages[0].greyStage).toBe('foal_grey');
    expect(ages[1].greyStage).toBe('greying');
    expect(ages[2].greyStage).toBe('light_grey');
    expect(ages[3].greyStage).toBe('white_grey');

    const visibleColours = new Set(ages.map((p) => p.visibleColour));
    expect(visibleColours.size).toBe(4);

    const bornColours = new Set(ages.map((p) => p.bornColour));
    expect(bornColours.size).toBe(1);
    expect([...bornColours][0]).toBe('bay');
  });

  it('a non-grey horse is never assigned a grey stage', () => {
    const genotype = genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] });
    const phenotype = expressPhenotype(genotype, 10 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.greyStage).toBe('none');
    expect(phenotype.visibleColour).toBe('bay');
  });
});

describe('expressPhenotype: DMRT3 gait', () => {
  it('A/A is gaited; C/A and C/C are not', () => {
    const base = { E: ['E', 'e'] as [string, string], A: ['A', 'a'] as [string, string], CR: ['cr', 'cr'] as [string, string], G: ['g', 'g'] as [string, string] };
    expect(expressPhenotype(genotypeWith({ ...base, DMRT3: ['A', 'A'] }), 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED).gaited).toBe(true);
    expect(expressPhenotype(genotypeWith({ ...base, DMRT3: ['C', 'A'] }), 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED).gaited).toBe(false);
    expect(expressPhenotype(genotypeWith({ ...base, DMRT3: ['C', 'C'] }), 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED).gaited).toBe(false);
  });
});

// Slice 0021 §10: one case per new locus, plus the four called out as mattering most.
describe('expressPhenotype: dun, champagne, silver and roan', () => {
  const ADULT = 4 * GAME_DAYS_PER_YEAR;
  const solidBay = { E: ['E', 'e'] as [string, string], A: ['A', 'a'] as [string, string], CR: ['cr', 'cr'] as [string, string], G: ['g', 'g'] as [string, string], DMRT3: ['C', 'C'] as [string, string] };
  const solidBlack = { ...solidBay, A: ['a', 'a'] as [string, string] };
  const solidChestnut = { ...solidBay, E: ['e', 'e'] as [string, string] };

  it('bay + dun -> bay dun', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBay, D: ['D', 'nd'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.dilutedColour).toBe('bay dun');
  });

  it('black + dun -> grullo', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBlack, D: ['D', 'nd'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.dilutedColour).toBe('grullo');
  });

  it('chestnut + cream + dun -> dunalino (a named double-modifier combination)', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidChestnut, CR: ['Cr', 'cr'], D: ['D', 'nd'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.dilutedColour).toBe('dunalino');
  });

  it('bay + champagne -> amber champagne', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBay, CH: ['Ch', 'ch'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.dilutedColour).toBe('amber champagne');
  });

  it('silver on a black-pigmented horse is visible', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBlack, Z: ['Z', 'z'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.dilutedColour).toBe('silver black');
  });

  it('epistasis: silver on a chestnut (even Z/Z) is invisible - it expresses as an ordinary chestnut', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidChestnut, Z: ['Z', 'Z'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.dilutedColour).toBe('chestnut');
    expect(phenotype.visibleColour).toBe('chestnut');
  });

  it('roan prefixes the traditional name for a plain base colour', () => {
    expect(expressPhenotype(genotypeWith({ ...solidBlack, RN: ['Rn', 'rn'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).visibleColour).toBe('blue roan');
    expect(expressPhenotype(genotypeWith({ ...solidChestnut, RN: ['Rn', 'rn'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).visibleColour).toBe('red roan');
    expect(expressPhenotype(genotypeWith({ ...solidBay, RN: ['Rn', 'rn'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).visibleColour).toBe('bay roan');
  });

  it('roan on anything else composes "<colour> roan"', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBay, CR: ['Cr', 'cr'], RN: ['Rn', 'rn'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.visibleColour).toBe('buckskin roan');
  });

  it('grey masks a roan horse exactly as it masks a plain one', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBlack, RN: ['Rn', 'rn'], G: ['G', 'g'] }), 6 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.visibleColour).toBe('light grey');
  });
});

describe('expressPhenotype: patterns', () => {
  const solidBay = { E: ['E', 'e'] as [string, string], A: ['A', 'a'] as [string, string], CR: ['cr', 'cr'] as [string, string], G: ['g', 'g'] as [string, string], DMRT3: ['C', 'C'] as [string, string] };
  const ADULT = 4 * GAME_DAYS_PER_YEAR;

  it('tobiano is fully penetrant and never touches visibleColour', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBay, TO: ['TO', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.patterns).toEqual(['tobiano']);
    expect(phenotype.visibleColour).toBe('bay');
  });

  it('Sabino1 has three visibly distinct states', () => {
    expect(expressPhenotype(genotypeWith({ ...solidBay, SB1: ['n', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual([]);
    expect(expressPhenotype(genotypeWith({ ...solidBay, SB1: ['SB1', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual(['sabino']);
    expect(expressPhenotype(genotypeWith({ ...solidBay, SB1: ['SB1', 'SB1'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual(['sabino_max']);
  });

  it('leopard complex: Lp/Lp + PATN1 -> appaloosa_leopard; Lp/Lp alone -> appaloosa_fewspot; Lp/lp + PATN1 -> appaloosa_blanket; Lp/lp alone -> appaloosa', () => {
    expect(expressPhenotype(genotypeWith({ ...solidBay, LP: ['Lp', 'Lp'], PATN1: ['PATN1', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual(['appaloosa_leopard']);
    expect(expressPhenotype(genotypeWith({ ...solidBay, LP: ['Lp', 'Lp'], PATN1: ['n', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual(['appaloosa_fewspot']);
    expect(expressPhenotype(genotypeWith({ ...solidBay, LP: ['Lp', 'lp'], PATN1: ['PATN1', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual(['appaloosa_blanket']);
    expect(expressPhenotype(genotypeWith({ ...solidBay, LP: ['Lp', 'lp'], PATN1: ['n', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED).patterns).toEqual(['appaloosa']);
  });

  it('a horse with no pattern allele at all gets an empty patterns array', () => {
    const phenotype = expressPhenotype(genotypeWith(solidBay), ADULT, GAME_DAYS_PER_YEAR, PATTERN_SEED);
    expect(phenotype.patterns).toEqual([]);
  });
});

describe('expressPhenotype: pattern penetrance and determinism', () => {
  const solidBay = { E: ['E', 'e'] as [string, string], A: ['A', 'a'] as [string, string], CR: ['cr', 'cr'] as [string, string], G: ['g', 'g'] as [string, string], DMRT3: ['C', 'C'] as [string, string] };
  const ADULT = 4 * GAME_DAYS_PER_YEAR;

  it('the same rng_seed produces the same pattern expression twice', () => {
    const genotype = genotypeWith({ ...solidBay, O: ['O', 'n'], SW1: ['SW1', 'n'] });
    const first = expressPhenotype(genotype, ADULT, GAME_DAYS_PER_YEAR, 424242);
    const second = expressPhenotype(genotype, ADULT, GAME_DAYS_PER_YEAR, 424242);
    expect(second.patterns).toEqual(first.patterns);
  });

  it('penetrance of 0 never shows a carried pattern; penetrance of 1 always does', () => {
    const genotype = genotypeWith({ ...solidBay, O: ['O', 'n'], SW1: ['SW1', 'n'] });
    const hidden = expressPhenotype(genotype, ADULT, GAME_DAYS_PER_YEAR, 1, { O: 0, SW1: 0 });
    expect(hidden.patterns).toEqual([]);
    const shown = expressPhenotype(genotype, ADULT, GAME_DAYS_PER_YEAR, 1, { O: 1, SW1: 1 });
    expect(shown.patterns).toEqual(['frame', 'splash']);
  });

  it('an n/n horse never shows frame or splash regardless of penetrance', () => {
    const genotype = genotypeWith({ ...solidBay, O: ['n', 'n'], SW1: ['n', 'n'] });
    const phenotype = expressPhenotype(genotype, ADULT, GAME_DAYS_PER_YEAR, 1, { O: 1, SW1: 1 });
    expect(phenotype.patterns).toEqual([]);
  });
});
