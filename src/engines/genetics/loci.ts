// The canonical locus list and allele order. Slice 0002 §5.1.
//
// Every iteration over loci in this codebase goes through LOCI, in this array's order - never
// Object.keys(genotype.mendelian). The RNG draws one allele per locus in sequence (inheritance.ts),
// so if the iteration order could vary, the same stored seed would produce a different foal, and
// CLAUDE.md §5.2's reproducibility promise would quietly stop being true.
//
// The alleles array for each locus is also its canonical order: a stored pair is always written
// with alleles[0] before alleles[1], e.g. ["E","e"], never ["e","E"]. This is what keeps genotype
// comparison, equality and test assertions stable.
//
// test/genetics/consistency.test.ts asserts this list matches migrations/0015_seed_loci.sql
// exactly (codes, alleles, order) - the migration is what a player-facing admin might edit
// (teaching_text), this file is what the engine actually computes with, and they must agree.

export interface Locus {
  code: string;
  alleles: readonly [string, string];
  /**
   * The allele a horse reads as, at both copies, when it predates this locus entirely (the
   * missing-locus rule, genotype.ts's getMendelianPair - slice 0002 §4.2). For four of these five
   * loci this is simply alleles[1], the last allele in canonical order, which is why §4.2 describes
   * the rule that way. It is NOT alleles[1] for DMRT3: §4.1 fixes DMRT3's canonical order as
   * ["C","A"] by real-world convention, but A is the rare gait mutation (2% frequency in the
   * founding pool, migrations/0014_seed_breeds.sql) and C is the common wild type - defaulting a
   * legacy horse to A/A would silently make it gaited. wildType is spelled out per-locus instead
   * of assumed from position so that case is handled correctly rather than by accident.
   */
  wildType: string;
}

export const LOCI: readonly Locus[] = [
  { code: 'E', alleles: ['E', 'e'], wildType: 'e' },
  { code: 'A', alleles: ['A', 'a'], wildType: 'a' },
  { code: 'CR', alleles: ['Cr', 'cr'], wildType: 'cr' },
  { code: 'G', alleles: ['G', 'g'], wildType: 'g' },
  // DMRT3's alleles are conventionally written C and A. That A is unrelated to the Agouti locus's
  // A above - they are different loci and never appear in the same allele list.
  { code: 'DMRT3', alleles: ['C', 'A'], wildType: 'C' },
  // Four disease loci, slice 0010 §4.1. Appended after DMRT3, never inserted earlier - see this
  // file's own comment above about why order is load-bearing. Unlike the five loci above, the
  // wild type here IS alleles[0] for all four - written out per-locus regardless, per this file's
  // wildType comment, so nothing downstream needs to know that pattern holds.
  { code: 'HYPP', alleles: ['N', 'H'], wildType: 'N' },
  { code: 'PSSM1', alleles: ['N', 'P1'], wildType: 'N' },
  { code: 'HERDA', alleles: ['N', 'Hrd'], wildType: 'N' },
  { code: 'GBED', alleles: ['N', 'Gb'], wildType: 'N' },
  // Ten colour/pattern loci, slice 0021 §4.1. Appended after GBED, never inserted earlier, for the
  // same RNG-order reason as the disease loci above. Dominant white ("W") was in the operator's
  // original draft and is deliberately dropped (slice 0021 §1) - eleven became ten.
  { code: 'D', alleles: ['D', 'nd'], wildType: 'nd' },
  { code: 'Z', alleles: ['Z', 'z'], wildType: 'z' },
  { code: 'CH', alleles: ['Ch', 'ch'], wildType: 'ch' },
  { code: 'RN', alleles: ['Rn', 'rn'], wildType: 'rn' },
  { code: 'TO', alleles: ['TO', 'n'], wildType: 'n' },
  { code: 'O', alleles: ['O', 'n'], wildType: 'n' },
  { code: 'SW1', alleles: ['SW1', 'n'], wildType: 'n' },
  { code: 'SB1', alleles: ['SB1', 'n'], wildType: 'n' },
  { code: 'LP', alleles: ['Lp', 'lp'], wildType: 'lp' },
  { code: 'PATN1', alleles: ['PATN1', 'n'], wildType: 'n' },
  // Seven more disease loci, docs/fixes/breed-disease-panels.md. Appended after PATN1, never
  // inserted earlier, for the same RNG-order reason as every group above. Wild type is N and is
  // alleles[0] for all seven, the same convention the first four disease loci (HYPP..GBED) use.
  // MCOA (Icelandic) needs no locus of its own - it reads Z above a second way, homozygous.
  { code: 'SCID', alleles: ['N', 'Sc'], wildType: 'N' },
  { code: 'CA', alleles: ['N', 'Ca'], wildType: 'N' },
  { code: 'LFS', alleles: ['N', 'Lv'], wildType: 'N' },
  { code: 'WFFS', alleles: ['N', 'Wf'], wildType: 'N' },
  { code: 'DWARF', alleles: ['N', 'Dw'], wildType: 'N' },
  { code: 'HYDRO', alleles: ['N', 'Hy'], wildType: 'N' },
  { code: 'DSLD', alleles: ['N', 'Dsld'], wildType: 'N' },
] as const;

// Ancestors beyond this many generations are treated as unrelated founders (pedigree.ts). This is
// a structural setting, not a config value: changing it would make every pedigree already written
// inconsistent with every pedigree written afterwards (CLAUDE.md §5.5, slice 0002 §3.6).
export const PEDIGREE_DEPTH = 6;
