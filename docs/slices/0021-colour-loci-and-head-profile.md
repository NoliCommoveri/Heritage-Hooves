# Slice 0021 — The full colour palette, a fifth conformation trait, and a testing page that doesn't sprawl

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts this slice
depends on are quoted or summarised below.**

This is a spec. **Nothing in this document has landed.**

Where it comes from: the operator drafted two SQL files on 2026-08-04 — one adding eleven
colour/pattern loci, one adding a fifth conformation trait (`head_profile`) to every breed's
`ideal_vector`. The *content* of both drafts was right and is carried into this slice largely
unchanged. What was wrong was mechanical: both were written in PostgreSQL against a SQLite
database, both would have failed at `/admin/migrations`, and both were data-only files for things
that need engine code before the data means anything. This slice is those two drafts, corrected,
with the code they imply.

It also takes in a UI ask made in the same conversation: the testing page is about to grow from
nine rows to nineteen, and needs to stop being a wall of text before that happens.

---

## 1. Decisions already taken

These were settled by the operator before this document was written. They are not open.

| Question | Decision |
|---|---|
| Existing horses have no `head_profile` genotype and would all read as an extreme dish | **Full world reset.** No `*Potential()` stand-in is written. See §8. |
| Frame overo (`O/O`) is lethal in reality | **Build it.** A foal born `O/O` does not survive, through the *existing* GBED path — no new death mechanism. |
| Dominant white (`W`) was in the operator's draft | **Dropped from this slice.** It is a family of variants standing in as one locus, adds little the other patterns don't, and its lethality is embryonic — a pregnancy that quietly produces nothing, which reads to a child as a bug rather than a lesson. Eleven loci become ten. |
| Pricing for eleven more testable loci | **Flat per-locus, at the existing `genotype_test_cost`.** No new purchase path, no panels beyond the "test everything unknown" button that already exists. |
| The testing page after this lands | **Collapsed by default**, see §7. |

---

## 2. What this slice adds, in one paragraph for a non-programmer

Right now a horse in this game can be one of about ten colours, and a show judge looks at four
things: neck, shoulder, back and hock. After this slice a horse can be dun, silver, champagne,
roan, tobiano, splash, sabino, frame overo or appaloosa-spotted — the colours the eight breeds
actually come in, and the reason a Nokota looks like a Nokota — and the judge also has an opinion
about the horse's head. Two of those genes are worth real money to test for before breeding: frame
overo, because two copies kill the foal, and silver, because it hides completely on a chestnut.

---

## 3. Part A — `head_profile`, the fifth conformation trait

### 3.1 The trait

Append `head_profile` to `TRAITS` in `src/engines/genetics/polygenic.ts`. **Append — never insert.**
That file's own comment explains why at length; the reset does not make it safe to reorder, because
the RNG draws one allele per trait in list order and every test fixture in `test/` depends on that
order.

`TRAIT_CATEGORY['head_profile'] = 'conformation'`, `TRAIT_DIRECTION['head_profile'] =
'bidirectional'` in `src/engines/conformation/traits.ts`. `CONFORMATION_TRAITS` is derived by
filter, so it picks the trait up with no further change — and so does `scoreEntry`, which iterates
`CONFORMATION_TRAITS` rather than the ideal vector's own keys (`src/engines/showing/score.ts:88`).

Scale, as the operator specified it: **1 = extreme dish (concave), 50 = straight, 100 = extreme
Roman nose (convex)**. Low/high labels for `quantitative_traits`: `dished` / `Roman`.

### 3.2 Migration `0110_quantitative_traits_head_profile.sql`

One `INSERT` into `quantitative_traits`, following `0061` (agility) and `0081` (robustness) exactly:

```sql
-- head_profile, the fifth conformation trait (slice 0021 §3). Appended to TRAITS, never inserted -
-- see src/engines/genetics/polygenic.ts. Scale: 1 = extreme dish, 50 = straight, 100 = Roman nose.
INSERT INTO quantitative_traits (code, name, category, direction, low_label, high_label, locus_count, teaching_text, enabled, sort_order) VALUES
('head_profile', 'Head profile', 'conformation', 'bidirectional', 'dished', 'Roman', 10,
 'The line of the face seen from the side. A dished head curves inward, a Roman nose curves outward, and most horses sit somewhere near straight between them. Which one is right depends entirely on the breed - the dish that wins an Arabian class would be a fault on a Friesian.',
 1, 14);
```

`sort_order 14` — 1-9 are the original nine, `agility` took 10 in `0061`, and the three robustness
traits took 11, 12 and 13 in `0081`. Verified against those files, not assumed.

Then add `'0110_quantitative_traits_head_profile.sql'` to the `migrationNames` array in
`test/genetics/consistency.test.ts:88`. That test parses the seed migrations in sequence and
asserts they match `TRAITS` exactly — it will fail loudly if you forget, which is the point.

### 3.3 Migration `0111_breeds_head_profile_ideal.sql`

The operator's eight targets and weights, unchanged. Only the dialect changes: SQLite has
`json_set`, not `jsonb_set`, and no `::jsonb` cast. The operator's instinct to patch the one key
rather than retype each breed's whole vector was right and is kept — `0035`'s and `0107`'s seeded
targets are never restated here, so they cannot be mistyped.

```sql
-- head_profile's per-breed target and weight (slice 0021 §3.3). json_set patches the single key so
-- the four targets seeded in 0035 (QH) and 0107 (the other seven) are preserved exactly as written
-- rather than retyped. The json() wrapper is what makes SQLite store an object rather than a string.

-- Arabian: the dish is the breed's single most recognisable trait, weighted just behind
-- neck_length (1.4), which stays the calling card.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":8,"weight":1.3}'))
  WHERE code = 'AR';

-- Thoroughbred: near-straight and unremarkable. The lightest weight in the file bar the Icelandic;
-- shoulder_angle (1.5) stays the defining trait.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":48,"weight":0.7}'))
  WHERE code = 'TB';

-- German Warmblood: straight and proportionate, expected but not decisive - under 1.0 so
-- shoulder_angle and hock_set remain the row's demanding targets.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":50,"weight":0.8}'))
  WHERE code = 'GW';

-- Friesian: the convex "ramskop" is named in the breed standard, so it carries real weight - but
-- stays below neck_length's 1.5, which is deliberately the hardest single target in the game.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":70,"weight":1.2}'))
  WHERE code = 'FR';

-- Paso Fino: a refined, lightly convex Iberian head matters for elegance, but back_length stays
-- the heaviest trait on the row - the gait is carried on the back, not the head.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":62,"weight":0.9}'))
  WHERE code = 'PF';

-- Icelandic: judged overwhelmingly on gait and movement. The lightest head weight in the set.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":57,"weight":0.6}'))
  WHERE code = 'IC';

-- Nokota: the landrace - close to flat, in keeping with a row that has no single defining feature.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":66,"weight":0.8}'))
  WHERE code = 'NOK';

-- Quarter Horse: the clean, refined "box head" - part of overall balance rather than a standout.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":35,"weight":0.8}'))
  WHERE code = 'QH';
```

Two notes on the operator's own flagged uncertainties, both resolved:

- **The American Paint question is moot.** There is no Paint breed. Eight breeds exist — QH, AR,
  TB, GW, FR, PF, IC, NOK — and all eight are covered above. The eight show classes are those eight
  breeds.
- **`"v"` stays at 1.** Nothing reads it. Both `parseIdealVector` and `parseJudgeWeights`
  (`src/engines/showing/score.ts:33,37`) take `.traits` and ignore the version. Bumping it would be
  a promise nothing keeps.

### 3.4 Migration `0112_judges_head_profile_weights.sql`

`scoreEntry` defaults a missing judge weight to 1.0, so the three judges seeded in `0033` would
degrade gracefully — but silently. A judge whose whole character is "cares about the shoulder"
(1.6) would quietly start caring about the head at 1.0, and the weight sum every judge divides by
would shift underneath them. Set all three explicitly, same `json_set` pattern:

- **The generalist** (all 1.0): `head_profile` **1.0**.
- **The shoulder judge** (shoulder 1.6, back 0.8, hock 0.7): `head_profile` **0.8** — a movement
  judge, not a beauty judge.
- **The back-and-hock judge** (back 1.5, hock 1.3): `head_profile` **1.2** — the one who reads the
  horse as a whole picture, and the reason two judges can disagree about the same Arabian.

That last number is the point of the migration: after this slice there is a judge who rewards a
correct head and a judge who barely looks, and a child who enters the same horse twice sees it.

### 3.5 What comes along free

- **Conformation display** (`src/render/horses.ts:669`) iterates the trait list — the fifth row
  appears with no change.
- **Slice 0019's founding specialists** pick a conformation trait to make a horse good at. If that
  code reads `CONFORMATION_TRAITS`, head profile joins the pool automatically. **Verify this**; if
  it holds a hardcoded four, extend it, and say so in the summary.
- **`show_entries`' trait snapshot** (`0065`) stores whatever the scorer breaks down. New entries
  carry five traits, old ones carry four — and after the reset there are no old ones.

---

## 4. Part B — ten colour and pattern loci

### 4.1 The loci

Ten, not the operator's eleven: `W` (dominant white) is dropped per §1. Alleles, categories,
inheritance labels and teaching text are the operator's, with one correction noted below.

Append to `LOCI` in `src/engines/genetics/loci.ts` **after `GBED`**, in this order, each with an
explicit `wildType`:

| # | code | alleles | wildType | category | inheritance |
|---|---|---|---|---|---|
| 10 | `D` | `["D","nd"]` | `nd` | dilution | dominant |
| 11 | `Z` | `["Z","z"]` | `z` | dilution | dominant |
| 12 | `CH` | `["Ch","ch"]` | `ch` | dilution | dominant |
| 13 | `RN` | `["Rn","rn"]` | `rn` | pattern | dominant |
| 14 | `TO` | `["TO","n"]` | `n` | pattern | dominant |
| 15 | `O` | `["O","n"]` | `n` | pattern | dominant |
| 16 | `SW1` | `["SW1","n"]` | `n` | pattern | dominant |
| 17 | `SB1` | `["SB1","n"]` | `n` | pattern | incomplete_dominant |
| 18 | `W` | — | — | — | **dropped** |
| 19 | `LP` | `["Lp","lp"]` | `lp` | pattern | incomplete_dominant |
| 20 | `PATN1` | `["PATN1","n"]` | `n` | modifier | dominant |

**Correction to the operator's draft:** frame overo's `inheritance` was written `recessive`. The
*pattern* is dominant — one copy shows it. Only the *lethal* is recessive. That column is
documentation, but it is player-facing documentation, and a child reading "recessive" next to a
gene that visibly shows on one copy learns the wrong thing. Use `dominant`; the teaching text the
operator wrote already says exactly the right thing about the two-copy case and needs no edit.

`category = 'pattern'` is new but anticipated — `0011_loci.sql`'s own column comment says
"(pattern / appaloosa / disease arrive later)".

### 4.2 Migration `0113_seed_colour_pattern_loci.sql`

The operator's `INSERT` verbatim, minus the `W` row, with **`sort_order` renumbered 10-19**. The
draft used 6-16, which collides head-on with the four disease loci — `0050` already occupies 6, 7,
8 and 9. Nothing enforces uniqueness, so this would not have errored; the testing page would just
have interleaved Sabino1 with HERDA and nobody would have known why.

Then add `'0113_seed_colour_pattern_loci.sql'` to the `migrationNames` array in
`test/genetics/consistency.test.ts:17`. That test currently parses `['0015_seed_loci.sql',
'0050_seed_disease_loci.sql']` and asserts exact agreement with `LOCI` — **the SQL alone fails it,
and the TypeScript alone fails it.** They land in one commit or the suite is red.

### 4.3 Migration `0114_breed_pools_colour_pattern_loci.sql` — mandatory, not optional

`parseAllelePool` (`src/engines/founding/pool.ts:17`) loops **every locus in `LOCI`** and throws if
a breed's `founding_allele_pool` has no entry for it. The moment `LOCI` grows, founding stock
generation, the consignment dealer, admin horse creation and `/admin/breeds` enabling all throw for
all eight breeds. This migration ships in the same push as the code — there is no intermediate
state that works.

The operator's own breed-relevance notes said exactly the right thing about how to do this: *"a
breed that doesn't carry a given allele in reality should just be seeded at ~0% for it, not
excluded from the schema"*. The code agrees and in fact requires it — the locus key must be present
and its frequencies must sum to 1.0, so a breed with none of an allele gets `{"nd":1.0}`, not a
missing key.

Frequencies below. Every unlisted allele at a locus is absent; each object sums to 1.0. `use
json_set` per locus, or rewrite the whole pool string per breed — the pools are seeded data with no
player edits, so either is safe. Rewriting whole is easier to read and easier to check.

**Quarter Horse** — roan and sabino are the real ones; tobiano, frame and splash sit at low
frequency because of the shared Paint gene pool the operator noted.
```
"D":{"D":0.03,"nd":0.97}, "Z":{"z":1.0}, "CH":{"Ch":0.01,"ch":0.99},
"RN":{"Rn":0.06,"rn":0.94}, "TO":{"TO":0.02,"n":0.98}, "O":{"O":0.03,"n":0.97},
"SW1":{"SW1":0.02,"n":0.98}, "SB1":{"SB1":0.05,"n":0.95}, "LP":{"lp":1.0}, "PATN1":{"n":1.0}
```

**Arabian** — none. E/A/G already describe the breed completely, as the operator said.
```
"D":{"nd":1.0}, "Z":{"z":1.0}, "CH":{"ch":1.0}, "RN":{"rn":1.0}, "TO":{"n":1.0},
"O":{"n":1.0}, "SW1":{"n":1.0}, "SB1":{"n":1.0}, "LP":{"lp":1.0}, "PATN1":{"n":1.0}
```

**Thoroughbred** — the operator's note said "W only", and W is dropped, so the Thoroughbred gets
nothing. That is correct and worth a comment in the migration so a future session doesn't read it
as an oversight: Thoroughbreds are a solid-coloured breed and this is what that looks like in data.
Same block as the Arabian.

**Friesian** — none. Fixed black, famously. Same block as the Arabian.

**Icelandic** — the widest palette in the game, deliberately. Dun, silver, tobiano pinto
(*skjóttur*) and splash are all ordinary in the breed.
```
"D":{"D":0.20,"nd":0.80}, "Z":{"Z":0.12,"z":0.88}, "CH":{"ch":1.0},
"RN":{"Rn":0.04,"rn":0.96}, "TO":{"TO":0.08,"n":0.92}, "O":{"n":1.0},
"SW1":{"SW1":0.06,"n":0.94}, "SB1":{"n":1.0}, "LP":{"lp":1.0}, "PATN1":{"n":1.0}
```

**Nokota** — blue roan and appaloosa spotting are the breed's identity, per the operator's note.
The highest `Rn` and the only meaningful `LP` in the game.
```
"D":{"D":0.12,"nd":0.88}, "Z":{"z":1.0}, "CH":{"ch":1.0},
"RN":{"Rn":0.25,"rn":0.75}, "TO":{"n":1.0}, "O":{"n":1.0}, "SW1":{"n":1.0},
"SB1":{"n":1.0}, "LP":{"Lp":0.10,"lp":0.90}, "PATN1":{"PATN1":0.08,"n":0.92}
```

**German Warmblood** — the growing pinto warmblood lines, nothing else.
```
"D":{"nd":1.0}, "Z":{"z":1.0}, "CH":{"ch":1.0}, "RN":{"rn":1.0},
"TO":{"TO":0.04,"n":0.96}, "O":{"n":1.0}, "SW1":{"n":1.0}, "SB1":{"n":1.0},
"LP":{"lp":1.0}, "PATN1":{"n":1.0}
```

**Paso Fino** — the broad pinto palette `0024`'s own comment promised and could not deliver.
```
"D":{"D":0.05,"nd":0.95}, "Z":{"z":1.0}, "CH":{"ch":1.0},
"RN":{"Rn":0.05,"rn":0.95}, "TO":{"TO":0.10,"n":0.90}, "O":{"n":1.0},
"SW1":{"n":1.0}, "SB1":{"SB1":0.06,"n":0.94}, "LP":{"lp":1.0}, "PATN1":{"n":1.0}
```

Update `0024_seed_breed_pools.sql`'s promise in the build log, not in the file — `0024` is applied
and forward-only. Its header comment says these pools are "a first pass to be revisited as each
locus lands". This is that revision.

---

## 5. Part C — expression

This is the real work of the slice. None of Part B is visible until this exists.

### 5.1 The shape change to `Phenotype`

Patterns do **not** get folded into `visibleColour`. Adding tobiano, splash, sabino, frame and
appaloosa to a string that already carries base × cream × dun × champagne × silver × roan produces
a combinatorial explosion that lands directly in `market_visible_colour_factors` (`0095`), which is
a flat colour→number map. Instead:

```ts
export interface Phenotype {
  baseColour: BaseColour;           // unchanged
  dilution: Dilution;               // unchanged - cream dose only
  dilutedColour: string;            // now includes dun/champagne/silver
  greyStage: GreyStage;             // unchanged
  visibleColour: string;            // now includes roan
  bornColour: string;               // unchanged meaning
  gaited: boolean;                  // unchanged
  patterns: PatternCode[];          // NEW - ordered, e.g. ['tobiano','sabino']
}
```

`PatternCode` is `'tobiano' | 'frame' | 'splash' | 'sabino' | 'sabino_max' | 'appaloosa' |
'appaloosa_blanket' | 'appaloosa_leopard' | 'appaloosa_fewspot'`.

### 5.2 Order of operations in `expressPhenotype`

The existing comment at the top of `expression.ts` — *"get it exactly right, in the order below,
because later rules depend on earlier ones running first"* — is now load-bearing for nine more
genes. The order:

1. **Base** (E, then A). Unchanged. Epistasis: `ee` ignores Agouti entirely.
2. **Cream dose** (0/1/2). Unchanged.
3. **Dun** (`D` present → dun). Acts on base+cream.
4. **Champagne** (`Ch` present). Acts on base+cream+dun.
5. **Silver** (`Z` present) — **only if the horse can make black pigment at all**, i.e. not `ee`.
   This is the same epistasis rule as Agouti and the same lesson as smoky black: a chestnut can
   carry two copies of silver and look like any other chestnut. Do not skip this check.
6. **Roan** (`Rn` present) — a prefix word on whatever came out of 1-5.
7. **Grey** — unchanged, applied last, masks everything with age.
8. **Patterns** (TO, O, SW1, SB1, LP+PATN1) — computed independently into `patterns[]`, never
   into the colour string.

### 5.3 Naming, without a table of every combination

Five modifiers stack. A lookup table of every combination is roughly 3 × 3 × 2 × 2 × 2 = 72 rows,
most of which are names nobody uses. Instead:

- A `NAMED_COLOURS` map keyed on `base|creamDose|dun|champagne|silver` covering the combinations
  that have a real name — `chestnut|1|0|0|0` → `palomino`, `bay|0|1|0|0` → `bay dun` (or `zebra
  dun`), `black|0|1|0|0` → `grullo`, `chestnut|0|1|0|0` → `red dun`, `bay|0|0|1|0` → `amber
  champagne`, `black|0|0|1|0` → `classic champagne`, `chestnut|0|0|1|0` → `gold champagne`,
  `black|0|0|0|1` → `silver black`, `bay|0|0|0|1` → `silver bay`, plus the existing cream table,
  plus `chestnut|1|1|0|0` → `dunalino` and `bay|1|1|0|0` → `dunskin` because those two do come up.
- **Everything else composes adjectives in fixed order**: `silver`, `champagne`, `dun`, then the
  cream/base name. `silver dun bay`, `champagne buckskin`. Not elegant English; unambiguous, which
  matters more.
- Roan prefixes the result, with the three traditional names as overrides: `black` + roan → `blue
  roan`, `chestnut` + roan → `red roan`, `bay` + roan → `bay roan`; anything else → `<colour>
  roan`.

Write the composition as a pure function with the named table as an override on top, not the other
way round. A future session adding an eleventh locus then adds one modifier to the ordered list
rather than 72 rows.

### 5.4 Appaloosa: LP and PATN1 together

The one two-locus interaction in the slice, and the reason `PATN1` exists.

| LP | PATN1 | result |
|---|---|---|
| `lp/lp` | any | no pattern |
| `Lp/lp` | absent | `appaloosa` — varnish roaning, mottled skin, striped hooves |
| `Lp/lp` | present | `appaloosa_blanket` |
| `Lp/Lp` | absent | `appaloosa` — few-spot/varnish end, expressed as `appaloosa_fewspot` |
| `Lp/Lp` | present | `appaloosa_leopard` |

`Lp/Lp` is also linked to congenital stationary night blindness in reality. **This slice does not
model that** — it would be a fifth health condition and a fifth thing to explain, and the Nokota is
the only breed carrying `Lp` at any frequency. Noted here so the next session knows it was
considered, not missed. If it is ever built, it belongs in `conditions` as a non-lethal row keyed
on `{"locus":"LP","mutant":"Lp","mode":"recessive"}`, and it costs nothing else.

### 5.5 Variable expression — why frame overo isn't always visible

A problem the draft doesn't address: if pattern expression is purely deterministic, then a horse
with no visible frame is `n/n` with *certainty*, the frame test never tells anyone anything they
couldn't see, and the lethal pairing can never be walked into by surprise. That is both wrong about
real horses — minimally-marked and solid "cryptic" frame carriers are exactly why the real test
exists — and it throws away the best reason to buy a test in the game.

So: **frame overo and splashed white each have a penetrance**, drawn per horse, deterministically,
from the horse's own seed.

```ts
deriveSeed(horse.rng_seed, 'pattern_expression')
```

Reserve that label now, the way `polygenic.ts` reserved `'birth_noise'`. One draw per horse, per
locus, consumed in `LOCI` order. Config, live-tunable (`0115`):

```
pattern_penetrance: { "O": 0.85, "SW1": 0.90 }
```

An `O/n` horse shows frame 85% of the time; 15% of carriers look solid. Tobiano, roan, dun,
champagne and silver stay fully penetrant — they are, near enough, in reality.

This is a genuine addition to the operator's draft rather than a correction of it, and it is the
one place this slice adds a mechanism nobody asked for. The justification is that without it the
lethal is unreachable by accident, and a lethal you can only hit deliberately teaches nothing. If
the operator disagrees, set both values to `1.0` and everything else in the slice still works.

**`expressPhenotype` is pure and takes no seed today.** It gains a `patternSeed: number` parameter
supplied by the caller — the same shape as the existing `ageGameDays`/`gameDaysPerYear` arguments.
Do not reach for the horse row inside the engine (CLAUDE.md §5.1).

### 5.6 `describeHorse`

The sentence gains a pattern clause: `A bay tobiano mare, 4 years old.` Multiple patterns read in
`patterns[]` order: `a chestnut sabino splash filly`. Keep the existing born-colour and gaited
clauses exactly as they are.

---

## 6. Part D — knowledge, prediction, and the market

### 6.1 `inferFromPhenotype` — what looking alone tells you

The teaching core of the slice. Extend `src/engines/genetics/inference.ts` with each new locus.
Cases worth getting exactly right:

- **Silver on a chestnut**: fully open, both alleles unknown. The single best new test in the game
  and the direct parallel to smoky black. A chestnut mare can carry silver invisibly and throw a
  silver black foal to a black stallion, and *nobody can see it coming without paying.*
- **Silver on a black-pigmented horse**: visible → `Z` present, zygosity unknown. Not visible →
  `z/z`.
- **Dun, champagne, roan, tobiano**: visible → dominant allele present, **zygosity unknown**;
  not visible → homozygous wild type. Zygosity matters to a breeder and is never readable by eye —
  that is the entire pitch for the test.
- **Sabino1**: three visibly distinct states (`n/n`, `SB1/n`, `SB1/SB1`), so looking resolves it
  completely and the test is worthless. Return a single pair and let the UI say so — `inference.ts`
  already documents that a one-element array means "a genotype test on this locus is worthless".
- **Frame overo**: visible → `O/n` **with certainty**, because `O/O` never draws breath. Not
  visible → `O/n` or `n/n`, still open, because of §5.5's cryptic carriers. This asymmetry is the
  lesson: the flashy framed horse needs no test, the plain one does.
- **Leopard complex**: `Lp/lp` and `Lp/Lp` are distinguishable in principle but not reliably, and
  `PATN1` confounds it. Treat visible spotting as `Lp` present, zygosity open.
- **Any grey horse past the foal-grey stage**: everything masked, everything open. The existing
  function already does this for E/A/CR; extend the same branch to the new loci rather than writing
  a second grey check.

### 6.2 `foalColourPossibilities` — and the CPU ceiling

`ColourLocus` today is `'E' | 'A' | 'CR'` — three loci, 27 genotype combinations, trivial. After
this slice it is **twelve loci**. A naive product is 3¹² ≈ 531,000 combinations per preview, on a
10ms free-tier CPU budget (CLAUDE.md §3). This will not work and must not be attempted.

**Fold progressively over phenotypes, not genotypes.** Carry a `Map<string, number>` keyed on the
*phenotype-relevant state so far* — base, cream dose, dun, champagne, silver, roan, pattern set —
and merge after each locus. The distinct-phenotype space is a few hundred, not half a million, and
the map collapses duplicates at every step. Add:

- A probability floor: outcomes below **0.5%** merge into a single `other` bucket rather than
  padding the list with fractions a child can't act on.
- A hard cap of the **8 most likely** named outcomes shown, remainder in `other`.
- The existing `uncertain` mechanism is unchanged and does the heavy lifting — an untested locus on
  either parent is reported as a named uncertainty, not folded into a number, and that already
  keeps most previews small in practice.

Write a test that asserts the preview for two fully-tested parents at all twelve loci completes and
that its probabilities sum to 1.0 within tolerance. That test is the CPU guard.

### 6.3 Testing

No new mechanism. `buildKnowledgePurchaseStatements` already writes `locus:<code>` rows keyed by
bare code with a per-code cost (`src/db/health.ts:325`), and the routes already price every locus
at `genotype_test_cost`. Ten more loci flow through unchanged — this is what §1's flat-pricing
decision buys.

The one thing to check: the **colour panel** button ("test every colour/gait locus still unknown")
now charges for up to fifteen loci at once. On a stable's opening balance that may exceed what a
child has. Confirm the existing insufficient-funds path covers it and shows a price before the
click, which it does today via `colourPanelPrice`.

### 6.4 The market

`market_visible_colour_factors` (`0095`) is a flat map from `visibleColour` to a multiplier, with
existing entries for the ten colours that exist today. After this slice `visibleColour` can be
about forty strings.

- **Extend the map** in `0115` with the new named colours. Keep the operator's existing restraint:
  `0095`'s own comment says colour is deliberately kept small next to `market_quality_weight` (4.0)
  so colour never out-competes conformation. Rare dilutions (champagne, silver, dun-on-cream) sit
  at **1.2-1.35**, in line with the existing cremello/perlino.
- **Confirm the lookup's fallback.** An unmapped colour must resolve to 1.0, not `undefined` or
  `NaN`. Check this before extending the map — it is the failure that would silently zero out an
  appraisal.
- **Patterns get one flat factor, not a map**: `market_pattern_factor` at **1.15**, applied once if
  `patterns[]` is non-empty regardless of how many. A loud tobiano appaloosa should be worth a bit
  more than a plain bay because the children will believe it is, but stacking multipliers per
  pattern would let a maximally-marked horse out-earn a well-bred one, which is the exact failure
  `0095` was written to avoid.

---

## 7. Part E — the lethal, and Part F — the testing page

### 7.1 Lethal white overo: migration `0116_condition_lethal_white.sql`

This needs **no new code at all**, which is the reason the operator's choice here was the cheap
one. `conditions` already carries single-gene rows with a `trigger` JSON of
`{"v":1,"locus":...,"mutant":...,"mode":"recessive"}`, a `severity_class` of `lethal`, and a death
window driven by `lethal_foal_death_game_days` (`src/db/pregnancies.ts:188`,
`src/engines/health/status.ts:61`). GBED is exactly this shape and has worked since slice 0010.

One `INSERT`, modelled line-for-line on `0053`'s GBED row:

```
code:            'LWO'
name:            'Lethal white overo syndrome'
category:        'single_gene'
locus_code:      'O'
trigger:         '{"v":1,"locus":"O","mutant":"O","mode":"recessive"}'
severity_class:  'lethal'
signs_visible:   0
bars_showing:    0
breed_associations: '["QH"]'
test_cost_key:   'genotype_test_cost'
```

The teaching text and event text matter more than the row. Follow `0053`'s GBED wording closely —
it is the best writing in the codebase and it was written for a child reading it on the worst day
of their week. The specific thing to say that GBED's text does not: **this one was preventable, and
here is how.** Both parents carry frame; either parent tested would have shown it; a carrier bred
to a non-carrier is completely safe. That is the whole lesson and it should be in the event.

`0053`'s header comment warns that event text is copied from the event payload at write time, not
read from this table — so a later reword never rewrites history. Respect that.

**The breeding preview** already carries a health line (slice 0010). Frame appears there for free
via the existing recessive-risk path, provided both parents' `O` status is known. Verify it, since
this is the screen where the death gets prevented.

### 7.2 The testing page

`/horses/:id/test` is already its own subpage (`src/render/horses.ts:1203`), so the "own subpage"
half of the ask is done. What breaks is the length: five disease rows and fifteen colour/gait rows,
each with a name, a price, a paragraph of teaching text and a button, is a page a child scrolls
past rather than reads.

Use the house pattern — `<details class="section-collapse">`, already used in `src/render/admin.ts`
at three call sites:

- **Health** stays as it is, open. Five rows, and it is the section that matters most.
- **Colour and gait** becomes four `<details>` groups, **all closed by default**, one per category
  as stored on the `loci` row: **Base colour** (E, A), **Dilutions** (CR, D, Z, CH), **Patterns**
  (RN, TO, O, SW1, SB1, LP), **Gait** (DMRT3). `PATN1` sits in Patterns despite its `modifier`
  category — a player looking for the appaloosa genes should find it next to `LP`, and the
  grouping is presentational, not the source of truth.
- Each `<summary>` shows the group name and a count of what is still unknown: `Patterns — 4 of 6
  still unknown`. That is what makes a closed section still informative.
- **Both panel buttons stay outside and above the collapsed groups**, always visible. The whole
  point of the panel is that it is the one click a child who doesn't want to read makes.
- A group with nothing left to test renders closed with `— all known`, and no button.

Apply the same treatment to the **horse page's own "Colour and gait" section**
(`src/render/horses.ts:747`), which lists what is known per locus and grows from five rows to
fifteen on the page a child looks at most. Collapsed by default, summary line showing the horse's
visible colour and pattern list — which is the part they actually came for — with the per-locus
detail behind the disclosure.

No CSS beyond what `.section-collapse` already provides. No JavaScript: `<details>` is native HTML
and works with the keyboard for free.

---

## 8. Part G — the reset

Run after all migrations apply, from `/admin`, scope **`world`** (`src/db/reset.ts`'s
`ResetScope`). A horse-only reset is not enough: `head_profile` and ten loci change what a genotype
*is*, and pedigrees, show records, listings, stud bookings and pregnancies all reference horses
that will not exist.

Note for the operator, in the summary, in plain English: **every horse, pedigree, show result and
balance is deleted, and founding stock is claimed again from scratch.** This is the one step in the
slice that cannot be undone, and it is worth them confirming they still want it on the day rather
than assuming the decision recorded here still holds.

After the reset: check `/admin/breeds` can still enable and disable a breed (the `parseAllelePool`
path from §4.3), then claim a founding batch and look at it. A batch of eight should show at least
one horse with a new colour if the pools in §4.3 are right — Icelandic and Nokota are where to
look.

---

## 9. Migration list

| file | what |
|---|---|
| `0110_quantitative_traits_head_profile.sql` | seed the fifth conformation trait |
| `0111_breeds_head_profile_ideal.sql` | eight breeds' head target + weight, via `json_set` |
| `0112_judges_head_profile_weights.sql` | three judges' opinion of the head |
| `0113_seed_colour_pattern_loci.sql` | ten loci, `sort_order` 10-19 |
| `0114_breed_pools_colour_pattern_loci.sql` | eight breeds' founding frequencies for those ten |
| `0115_config_colour_patterns.sql` | `pattern_penetrance`, `market_pattern_factor`, new colour factors |
| `0116_condition_lethal_white.sql` | LWO as a `conditions` row |

Each one also gets an `import` and a list entry in `src/db/migrations.ts` (CLAUDE.md §8) or
`/admin/migrations` cannot see it — which is the operator's only way to apply them.

Sequencing note: `0113` and `0114` must apply together, and the code change to `LOCI` must deploy
with them. Between `0113` alone and `0114`, founding stock generation throws.

---

## 10. Tests

- **Consistency** (`test/genetics/consistency.test.ts`): both `migrationNames` arrays extended;
  this is the test that catches a mismatch between SQL and `LOCI`/`TRAITS`.
- **Expression**: one case per new locus, plus the four that matter most — silver on chestnut
  (invisible), silver on black (visible), `Lp/Lp` + `PATN1` (leopard), dun + cream (dunskin).
- **Epistasis**: a chestnut carrying `Z/Z` expresses as an ordinary chestnut. Assert it directly;
  it is the rule most likely to be broken by a later refactor.
- **Inference**: a visibly framed horse resolves to `O/n` and only `O/n`. A solid horse does not
  resolve at `O`.
- **Foal colours**: twelve fully-tested loci, probabilities sum to 1.0, completes fast (§6.2).
- **Pools**: `parseAllelePool` accepts all eight breeds' seeded pools. Cheap, and it is the test
  that would have caught the whole `0114` problem.
- **Penetrance determinism**: the same `rng_seed` produces the same pattern expression twice.

---

## 11. What this slice deliberately does not do

- **No dominant white.** §1.
- **No night blindness on `Lp/Lp`.** §5.4.
- **No `Rn/Rn` homozygous lethality.** Long believed lethal, now known not to be; modelling a
  second lethal on a gene the Nokota carries at 25% would make that breed miserable to play.
- **No pattern effect on show scoring.** A judge scores conformation. A flashy horse does not win
  because it is flashy, and the children should learn that in this game as in the real one.
- **No white markings independent of these genes** — no stars, stripes, socks. Those are largely
  polygenic in reality and would be a separate trait family.
- **No new health condition beyond LWO.**

---

## 12. Open questions for the operator

1. **§5.5's penetrance is an addition, not a correction.** It exists so the frame lethal can be
   walked into by accident. Setting both values to 1.0 disables it and nothing else breaks.
2. **`market_pattern_factor` at 1.15** (§6.4) is a guess. It is a live tunable and wants real play
   to settle it.
3. **The Thoroughbred and Friesian get nothing from this slice** (§4.3), and the Arabian nearly
   nothing. That is honest to the breeds, but a child who picked Thoroughbreds watches a Nokota
   player get blue roans and appaloosas while their own horses stay bay. Worth knowing before the
   reset, since breed choice happens right after it.
