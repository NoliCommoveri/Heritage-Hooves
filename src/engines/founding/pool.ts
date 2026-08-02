// Parses and validates a breeds.founding_allele_pool blob. Slice 0005 §3.2/§5.
//
// A pool must list every locus in LOCI, by design: the missing-locus rule in genotype.ts exists
// for horses that predate a gene, and reusing it here to mean "this breed is fixed for wild type"
// would make two different situations indistinguishable in the stored data. A breed fixed at a
// locus writes that out explicitly, e.g. "CR": {"cr": 1.0}. Whoever adds a sixth locus must update
// all eight breeds' pools in the same migration, or generation starts throwing - that is
// deliberate, not a bug to work around.

import { LOCI } from '../genetics/loci';

/** Locus code -> {allele: frequency}. Frequencies for a locus sum to 1.0. */
export type AllelePool = Record<string, Record<string, number>>;

export function parseAllelePool(json: string): AllelePool {
  const parsed = JSON.parse(json) as AllelePool;
  for (const locus of LOCI) {
    const freqs = parsed[locus.code];
    if (!freqs) throw new Error(`founding allele pool missing locus ${locus.code}`);

    let sum = 0;
    for (const allele of Object.keys(freqs)) {
      if (!locus.alleles.includes(allele)) {
        throw new Error(`founding allele pool: unknown allele "${allele}" at locus ${locus.code}`);
      }
      sum += freqs[allele];
    }
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`founding allele pool: locus ${locus.code} frequencies sum to ${String(sum)}, not 1.0`);
    }
  }
  return parsed;
}
