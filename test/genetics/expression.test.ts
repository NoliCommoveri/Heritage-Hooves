import { describe, expect, it } from 'vitest';
import { expressPhenotype } from '../../src/engines/genetics/expression';
import type { Genotype } from '../../src/engines/genetics/genotype';

const GAME_DAYS_PER_YEAR = 360;

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
    const phenotype = expressPhenotype(genotype, 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR);
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
      const phenotype = expressPhenotype(genotype, 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR);
      expect(phenotype.dilutedColour, label).toBe(expected);
      expect(phenotype.dilution, label).toBe(dose === 1 ? 'cream_single' : 'cream_double');
    }
  });
});

describe('expressPhenotype: grey progression', () => {
  it('the same genotype at 0, 2, 6 and 10 years gives four different visibleColours and one unchanging bornColour', () => {
    const genotype = genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'C'] });

    const ages = [0, 2, 6, 10].map((years) => expressPhenotype(genotype, years * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR));

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
    const phenotype = expressPhenotype(genotype, 10 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR);
    expect(phenotype.greyStage).toBe('none');
    expect(phenotype.visibleColour).toBe('bay');
  });
});

describe('expressPhenotype: DMRT3 gait', () => {
  it('A/A is gaited; C/A and C/C are not', () => {
    const base = { E: ['E', 'e'] as [string, string], A: ['A', 'a'] as [string, string], CR: ['cr', 'cr'] as [string, string], G: ['g', 'g'] as [string, string] };
    expect(expressPhenotype(genotypeWith({ ...base, DMRT3: ['A', 'A'] }), 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR).gaited).toBe(true);
    expect(expressPhenotype(genotypeWith({ ...base, DMRT3: ['C', 'A'] }), 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR).gaited).toBe(false);
    expect(expressPhenotype(genotypeWith({ ...base, DMRT3: ['C', 'C'] }), 4 * GAME_DAYS_PER_YEAR, GAME_DAYS_PER_YEAR).gaited).toBe(false);
  });
});
