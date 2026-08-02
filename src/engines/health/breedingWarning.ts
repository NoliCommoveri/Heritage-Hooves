// The breeding preview's health line - slice 0010 §7.3, the single highest-value screen in this
// slice. Pure, no database access, and deliberately confined to what a stable has PAID TO LEARN:
// it is passed only knowledge (a code -> known status map per horse), never a genotype. Both
// genotypes are already loaded on the breeding preview page for the COI calculation, and reading
// them here would be the one line in this slice that is wrong in a way nobody notices for months
// (§14) - confining this function to knowledge-shaped input is what makes that mistake impossible
// to make by accident, the same discipline fertilityPotential uses (per §7.3's own comment).

export type KnownResult = 'clear' | 'carrier' | 'affected';

/** condition code -> what this stable has learned about one horse, for one recessive condition. */
export type KnownStatusMap = Map<string, KnownResult>;

export interface RecessiveCondition {
  code: string;
  name: string;
}

export interface BreedingHealthWarning {
  conditionCode: string;
  conditionName: string;
  sentence: string;
}

const COPIES: Record<KnownResult, 0 | 1 | 2> = { clear: 0, carrier: 1, affected: 2 };

function fractionWords(p: number): string {
  if (Math.abs(p - 0.25) < 1e-9) return 'about one in four';
  if (Math.abs(p - 0.5) < 1e-9) return 'about one in two';
  if (Math.abs(p - 1) < 1e-9) return 'every';
  return `about ${String(Math.round(p * 100))}% of`;
}

/**
 * One warning per recessive condition where this stable's own knowledge of both parents implies a
 * real chance of an affected foal, or where it knows enough about one parent to be worth saying so
 * even though the other is untested. Nothing is said about a condition neither horse has been
 * tested for (§7.3's "if it has tested neither, it says nothing at all"), and nothing is said when
 * a known parent is clear - clear x anything cannot produce an affected foal for a recessive, so
 * there is nothing to warn about.
 */
export function breedingHealthWarnings(
  mareKnown: KnownStatusMap,
  stallionKnown: KnownStatusMap,
  recessiveConditions: RecessiveCondition[]
): BreedingHealthWarning[] {
  const warnings: BreedingHealthWarning[] = [];

  for (const condition of recessiveConditions) {
    const mareResult = mareKnown.get(condition.code);
    const stallionResult = stallionKnown.get(condition.code);

    if (mareResult !== undefined && stallionResult !== undefined) {
      const pMare = COPIES[mareResult] / 2;
      const pStallion = COPIES[stallionResult] / 2;
      const pAffected = pMare * pStallion;
      if (pAffected <= 0) continue;
      const pCarrier = pMare * (1 - pStallion) + (1 - pMare) * pStallion;
      const sentence =
        pCarrier > 0
          ? `Both parents have been tested for ${condition.name}. ${fractionWords(pAffected)} foals from this pairing would be expected to be affected, and ${fractionWords(pCarrier)} carriers.`
          : `Both parents have been tested for ${condition.name}. ${fractionWords(pAffected)} foals from this pairing would be expected to be affected.`;
      warnings.push({ conditionCode: condition.code, conditionName: condition.name, sentence });
      continue;
    }

    // Exactly one side known - only worth saying when that known side carries the allele at all.
    const knownResult = mareResult ?? stallionResult;
    if (knownResult === undefined || knownResult === 'clear') continue;
    const knownIsMare = mareResult !== undefined;
    const label = knownResult === 'carrier' ? 'a known carrier of' : 'known to be affected by';
    const sentence = `${knownIsMare ? 'The mare' : 'The stallion'} is ${label} ${condition.name}. ${knownIsMare ? 'The stallion' : 'The mare'} has not been tested for it in this stable.`;
    warnings.push({ conditionCode: condition.code, conditionName: condition.name, sentence });
  }

  return warnings;
}
