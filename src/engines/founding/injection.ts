// Amendment 0017a §5.4: overwrites one locus's pair on an already-generated candidate genotype with
// a queued allele. Pure, no database access, no randomness (CLAUDE.md §5.1/§5.2) - generateCandidate
// runs unchanged against the breed's real pool first; this runs after it, deterministically, and
// never perturbs any other locus or any RNG stream.

import { LOCI } from '../genetics/loci';
import { sortAllelePair, type Genotype } from '../genetics/genotype';

export interface ConsignmentInjection {
  locusCode: string;
  allele: string;
  zygosity: 'het' | 'hom';
}

/**
 * `hom` writes two copies of the injected allele. `het` writes one copy of it plus the locus's
 * OTHER allele (every locus in LOCI is biallelic) - never a copy drawn from the candidate's own
 * generated pair, so the result is deterministic from the injection alone and does not depend on
 * what generateCandidate happened to roll.
 */
export function applyConsignmentInjection(genotype: Genotype, injection: ConsignmentInjection): Genotype {
  const locus = LOCI.find((l) => l.code === injection.locusCode);
  if (!locus) throw new Error(`applyConsignmentInjection: unknown locus ${injection.locusCode}`);
  if (!locus.alleles.includes(injection.allele)) {
    throw new Error(`applyConsignmentInjection: allele "${injection.allele}" is not defined at locus ${injection.locusCode}`);
  }
  const other = injection.zygosity === 'hom' ? injection.allele : locus.alleles.find((a) => a !== injection.allele)!;
  const pair = sortAllelePair(injection.locusCode, injection.allele, other);
  return { ...genotype, mendelian: { ...genotype.mendelian, [injection.locusCode]: pair } };
}
