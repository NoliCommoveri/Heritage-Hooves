// Parse, serialise, and validate the genotype blob stored in horses.genotype, and the
// missing-locus/missing-trait rule that makes adding a sixth gene (or a ninth trait) a data
// change rather than a migration of every horse ever born. Slice 0002 §4.2.

import { LOCI } from './loci';

export const GENOTYPE_VERSION = 1;

export type AllelePair = [string, string];

export interface Genotype {
  v: number;
  mendelian: Record<string, AllelePair>;
  polygenic: Record<string, string>;
}

export function makeEmptyGenotype(): Genotype {
  return { v: GENOTYPE_VERSION, mendelian: {}, polygenic: {} };
}

export function parseGenotype(json: string): Genotype {
  const parsed = JSON.parse(json) as Genotype;
  return { v: parsed.v, mendelian: parsed.mendelian ?? {}, polygenic: parsed.polygenic ?? {} };
}

/** No whitespace is stored - see slice 0002 §4.2. */
export function serializeGenotype(genotype: Genotype): string {
  return JSON.stringify(genotype);
}

/** Sorts two alleles at a locus into that locus's canonical order (LOCI's alleles order). */
export function sortAllelePair(locusCode: string, a: string, b: string): AllelePair {
  const locus = LOCI.find((l) => l.code === locusCode);
  if (!locus) throw new Error(`unknown locus: ${locusCode}`);
  const index = (allele: string): number => {
    const i = locus.alleles.indexOf(allele);
    if (i === -1) throw new Error(`unknown allele "${allele}" at locus ${locusCode}`);
    return i;
  };
  return index(a) <= index(b) ? [a, b] : [b, a];
}

/**
 * The missing-locus rule (slice 0002 §4.2): a horse created before a locus existed has no entry
 * for it in `mendelian`. Read that as homozygous for the last allele in the locus's canonical
 * order - the recessive/wild-type one - which is both correct and invisible. This is what lets a
 * later slice add a sixth locus as a data change: every horse alive already reads as though it
 * always had two copies of that locus's wild-type allele.
 */
export function getMendelianPair(genotype: Genotype, locusCode: string): AllelePair {
  const stored = genotype.mendelian[locusCode];
  if (stored) return stored;
  const locus = LOCI.find((l) => l.code === locusCode);
  if (!locus) throw new Error(`unknown locus: ${locusCode}`);
  return [locus.wildType, locus.wildType];
}

/**
 * The polygenic equivalent of the missing-locus rule: a horse born before a trait existed has no
 * entry for it. Read as `length` characters of '0' - every quantitative-trait locus absent - which
 * is the bottom of that trait's potential range rather than a guess.
 */
export function getPolygenicString(genotype: Genotype, traitCode: string, length: number): string {
  return genotype.polygenic[traitCode] ?? '0'.repeat(length);
}
