// Seeded randomness. CLAUDE.md §5.2 is absolute: no Math.random() anywhere in this codebase, ever.
// Every random draw in the game runs through an Rng created here, seeded from a value stored on
// the entity the draw belongs to (horses.rng_seed, pregnancies.rng_seed, and so on).
//
// Algorithm: xoshiro128** (https://prng.di.unimi.it/xoshiro128starstar.c), seeded through splitmix32.
// Small, well-characterised, four 32-bit words of state, no dependencies.

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** A uniformly chosen element of a non-empty array. */
  pick<T>(items: T[]): T;
  /** A new array holding a Fisher-Yates shuffle of items. Does not mutate the input. */
  shuffle<T>(items: T[]): T[];
  /** A normally distributed value via Box-Muller. */
  normal(mean: number, sd: number): number;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

// splitmix32: a fast, well-mixed generator used only to expand a single seed number into the
// four words of xoshiro128** state (and, in deriveSeed, to mix a label into a new seed).
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function makeXoshiro128ss(s0: number, s1: number, s2: number, s3: number): () => number {
  let a = s0 >>> 0;
  let b = s1 >>> 0;
  let c = s2 >>> 0;
  let d = s3 >>> 0;
  return function (): number {
    const result = rotl(Math.imul(b, 5) >>> 0, 7);
    const output = Math.imul(result, 9) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = rotl(d, 11);
    return output;
  };
}

export function makeRng(seed: number): Rng {
  const seedGen = splitmix32(seed >>> 0);
  const raw = makeXoshiro128ss(seedGen(), seedGen(), seedGen(), seedGen());

  function next(): number {
    return raw() / 4294967296;
  }

  function int(maxExclusive: number): number {
    return Math.floor(next() * maxExclusive);
  }

  function pick<T>(items: T[]): T {
    return items[int(items.length)];
  }

  function shuffle<T>(items: T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  let spare: number | null = null;
  function normal(mean: number, sd: number): number {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return mean + sd * v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mean + sd * mag * Math.cos(2.0 * Math.PI * v);
  }

  return { next, int, pick, shuffle, normal };
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic sub-seeding: one stored seed produces many independent streams (a pregnancy's
 * seed derives "genotype", "polygenic", "noise", and so on). Derive sub-seeds; never create a
 * second independent generator.
 */
export function deriveSeed(parentSeed: number, label: string): number {
  const mixed = (parentSeed >>> 0) ^ fnv1a(label);
  const gen = splitmix32(mixed >>> 0);
  return gen();
}

/**
 * Mints a brand new seed using crypto.getRandomValues. This looks like a violation of "no
 * unseeded randomness" and is not: seeds have to come from somewhere. When a new horse or
 * pregnancy is created, its seed is drawn unpredictably exactly once and stored on the row, and
 * every draw that entity ever makes derives from that stored seed via deriveSeed. The ban in
 * CLAUDE.md §5.2 is on unrecorded randomness in game logic, not on minting a seed.
 * crypto.getRandomValues is the only acceptable source, it is called only by this function, and
 * every call site must store the result immediately.
 */
export function randomSeed(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0];
}
