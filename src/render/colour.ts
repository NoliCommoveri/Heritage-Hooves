// Amendment 0017a §4.3: smoky black is truth expression.ts computes correctly, but it is the
// classic indistinguishable-by-eye dilute - real breeders test for it because they cannot see it.
// The engine keeps it as truth; this is the one place the string is remapped before it reaches a
// player who has not paid to know. CLAUDE.md §12's truth-vs-knowledge rule, applied to a display
// string rather than a database column.

/** Every colour but smoky black is already visually distinct (§4.3) - this is the only mapping. */
export function displayColourName(name: string, creamTested: boolean): string {
  return !creamTested && name === 'smoky black' ? 'black' : name;
}
