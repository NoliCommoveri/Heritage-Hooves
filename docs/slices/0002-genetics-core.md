# Slice 0002 — Genetics core

**Status:** ready to build. Slice 0001 is built and deployed; nothing in this document exists yet.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those. The design documents describe a game far larger than this slice, and reading them will make you build ahead.

**What this slice is.** Horses exist. Two of them can be bred, and the foal's colour, gait and inbreeding coefficient come out of a genetics engine rather than out of a random number. The build order calls this "two horses, one breeding, a foal described in words," and that is exactly the target.

**Why this comes now.** Four things here cannot be retrofitted. `horses.genotype` and `horses.rng_seed` — a horse born without them is unreproducible forever. `horses.composition` — wrong forever for horses already born. `horse_ancestors` — must be written at birth or the pedigree is simply absent. And `horses.breeder_prefix` plus `registered_name` — a prefix scheme applied after horses exist leaves the first generation permanently unmarked, which is precisely the generation whose origin matters most.

---

## 1. What "done" looks like

The person running this project — who does not write code and has no terminal — should be able to do all of the following on the live URL, on a phone:

1. Apply the new migrations from `/admin/migrations`, as before.
2. From an admin page, create a horse into a child's stable: choose its sex, its breed, its name, how old it is, and what it carries at each of five genes.
3. Create a second horse the same way, of the opposite sex.
4. Log in as the child, open their barn, and see both horses listed with their colour written in plain English — "a bay mare, 4 years old".
5. Open a horse's page and see its colour, its sex, its age, who bred it, and its pedigree.
6. Go to a breeding page, choose the mare and the stallion, and press **Check pairing**. The page comes back with the inbreeding coefficient this pairing would produce, *before* anything is committed.
7. Press **Confirm breeding**. A foal is born immediately, with a colour inherited from its parents.
8. The foal appears in the barn as "Unnamed filly", and the child registers a name for it. The name is assembled from the stable's prefix and locks permanently.
9. Breed the foal back to its own sire, check the pairing first, and see a COI of 25% with a warning attached.
10. Try to breed the same mare twice in a row and be refused, in a sentence that says why.
11. Create a grey horse, then press the admin advance button repeatedly and watch its description change from "bay" to "greying" to "light grey" as it ages.

If all eleven work, the slice is done.

---

## 2. Decisions taken for this slice

Settled in conversation on 2 August 2026. Treat them as standing decisions, not recommendations. If one looks wrong, say so — but build this.

**2.1 Five loci: Extension, Agouti, Cream, Grey, DMRT3.** No dun, no tobiano, no roan, no appaloosa, no silver, no pearl, no champagne, no sooty, no flaxen. Those arrive one gene at a time much later in the build order. These five were chosen because between them they cover every inheritance style the engine will ever need — plain dominance (E, A), incomplete dominance with a dose effect (Cream), a dominant that overrides everything and changes with age (Grey), and a recessive that expresses as something other than colour (DMRT3). If the engine handles these five correctly, adding the sixth is data plus a rule.

**2.2 Quarter Horse only.** One breed row with real data. Crossbreeding, breed composition and the "once a cross, always a cross" rule are implemented in code this slice (they are a few lines and they are wrong-forever if applied retroactively), but with one breed nothing can actually cross, and no second breed's data is written.

**2.3 Breeding produces a foal immediately. There is no pregnancy.** Press the button, the foal exists. See §2.4 for the caveat this comes with.

**2.4 The instant-foaling decision is deliberate and temporary, and must be labelled as such in the code.** The design has an eleven-month gestation resolving on a tick, and the `pregnancies` table is listed as a genetics-core table. Building instant foaling means that path gets replaced when the tick slice lands, and the honest reason to do it anyway is that a genetics engine you cannot exercise in under eleven real days is a genetics engine you cannot tune. That is a good reason, and it was the operator's call.

What it asks of you: put the whole thing behind one function — `breedNow(...)` in `src/db/horses.ts` — with a comment at the top saying in as many words that this is a stand-in for conception-plus-gestation, that the real version creates a `pregnancies` row and lets the tick foal it, and that the genotype/pedigree/naming code below it is unaffected by the change. **Everything from the foal's genotype downward must be reusable as-is.** The only thing the tick slice should have to rewrite is when the foal row gets inserted, not how it is built.

**2.5 Founding horses are created by an admin form, not by a generator and not by a seed migration.** `/admin/horses/new` lets the admin build a horse allele by allele. This is the testing instrument the genetics engine needs anyway — it is how you construct a carrier × carrier cross deliberately and watch the ratios — and it stays useful for the whole life of the project. The founding-stock *generator*, which draws from a breed's allele pool at a quality band, is the next slice. Do not write a cut-down version of it here.

**2.6 The pedigree table and the COI both ship now, and COI is previewable before committing.** `horse_ancestors` is written at birth. `horses.coi` is computed at birth and stored. The breeding screen shows the COI of a *hypothetical* pairing before it happens. A number that arrives with the foal is a post-mortem; a number visible while choosing the stallion is a decision, and that is the entire mechanic (overview §2d).

**2.7 Polygenic loci are generated and stored now, and displayed nowhere.** Conformation and ability arrive two slices later, but a foal can only inherit what its parents already have. Every horse created in this slice gets a full set of quantitative-trait loci, inherited properly through the same meiosis as everything else, and rendered nowhere at all — not on the horse page, not for the admin. When the polygenic slice lands, every horse already born has real heritable values and that slice is expression and display only.

**2.8 Players see phenotype. Genotype is admin-only.** A child sees "a bay mare" and nothing about what she carries. The admin sees the full genotype on the horse page, for debugging. `horse_knowledge` and paid genotype tests belong to the health slice; this slice simply never shows a player something they would later have to pay for, so nothing has to be taken away.

**2.9 Foals are born unnamed. The owner registers a name once, and it locks.** A foal is not named at conception — ever. It is born, and it appears everywhere as "Unnamed filly" or "Unnamed colt" until its owner submits a name, at which point the registered name is assembled from the stable's prefix and becomes permanent. There is no deadline, nothing auto-names it, and being unnamed blocks nothing. Admin-created founding horses are named at creation and are never in the unnamed state.

---

## 3. Migrations

Follow `CLAUDE.md` §8, and remember §8's second half: **every new file must also be registered in `src/db/migrations.ts`** with a matching import and list entry, in order, or `/admin/migrations` cannot see it and the operator cannot apply it.

Seven files:

| File | Contents |
|---|---|
| `0010_breeds.sql` | `breeds` table |
| `0011_loci.sql` | `loci` table |
| `0012_horses.sql` | `horses` table |
| `0013_horse_ancestors.sql` | `horse_ancestors` table |
| `0014_seed_breeds.sql` | the Quarter Horse row |
| `0015_seed_loci.sql` | the five locus rows |
| `0016_config_breeding.sql` | adds this slice's config keys |

### 3.1 `breeds`

- `id` — integer primary key
- `code` — TEXT, unique. `QH`.
- `name` — TEXT. `Quarter Horse`.
- `enabled` — INTEGER 0/1, default 1
- `is_recognised_cross` — INTEGER 0/1, default 0. Exists so promoting a Quarab to breed status later is a data change rather than a structural one.
- `founding_allele_pool` — TEXT holding JSON. Per-locus allele frequencies. See §3.5.
- `gaited_typical` — INTEGER 0/1, default 0. Documentation only; actual gait comes from DMRT3.

The other columns the schema document lists on `breeds` — `ideal_vector`, `height_range`, `weight_range`, `eligible_class_types`, `discipline_aptitudes` — are **not** in this slice. They belong to the polygenic and show slices, they are additive columns rather than wrong-forever ones, and writing an ideal vector for traits nothing expresses yet is guessing.

### 3.2 `loci`

Every Mendelian locus — colour, gait, and later single-gene disease. One table.

- `id` — integer primary key
- `code` — TEXT, unique. `E`, `A`, `CR`, `G`, `DMRT3`.
- `name` — TEXT. "Extension", "Agouti", …
- `category` — TEXT. base / dilution / modifier / gait. (pattern / appaloosa / disease arrive later.)
- `inheritance` — TEXT. dominant / recessive / incomplete_dominant / complex.
- `alleles` — TEXT holding JSON: an ordered list of allele symbols, e.g. `["E","e"]`. **The order is canonical** and §4.1 depends on it.
- `teaching_text` — TEXT. The short genetics note shown to players. Editable in the database without a deploy, which is the point of it living here.
- `enabled` — INTEGER 0/1, default 1
- `sort_order` — INTEGER

**What this table is and is not.** It holds what players read and what an operator might want to reword: names, categories, teaching text, and the on/off switch. It does **not** hold the expression rules — epistasis is code, not data, and any attempt to express "`ee` masks agouti entirely" as a JSON rule engine will be worse than the fifteen lines of TypeScript it replaces. The engine keeps its own canonical list of the same five codes (§4.1), and §9 requires a test asserting the two lists agree.

### 3.3 `horses`

The central table. Comment each group in the migration.

**Identity and lineage**
- `id` — integer primary key
- `sex` — TEXT, `CHECK (sex IN ('mare','stallion','gelding'))`. Nothing creates a gelding this slice.
- `registered_name` — TEXT, **nullable**, `UNIQUE COLLATE NOCASE`. Null means the horse has not been named yet. SQLite permits many nulls in a unique index, which is exactly the behaviour wanted here. Once set, never changes.
- `barn_name` — TEXT, nullable. Freely editable by the current owner; cleared on transfer, when transfers exist.
- `breeder_prefix` — TEXT, nullable. A **snapshot** of the breeding stable's prefix at the moment of birth. Null for admin-created founding horses, which nobody bred. Never joined to the breeder's live prefix — if it were, renaming a stable would silently rewrite the registered name of every horse it ever bred.
- `breed_id` — INTEGER references `breeds(id)`, nullable (crosses have no single breed)
- `is_cross` — INTEGER 0/1, default 0
- `composition` — TEXT holding JSON: breed fractions, e.g. `{"QH":1}`. See §4.6.
- `sire_id`, `dam_id` — INTEGER references `horses(id)`, both nullable (founding stock has neither)
- `generation` — INTEGER, default 0
- `coi` — REAL, default 0. Inbreeding coefficient at birth, 0–1. A coefficient is not currency, so the no-floats rule (`CLAUDE.md` §7) does not apply; it exists to be compared against thresholds and rendered as a percentage.
- `owner_stable_id` — INTEGER NOT NULL references `stables(id)`
- `breeder_stable_id` — INTEGER references `stables(id)`, nullable

**Dates and state**
- `born_game_day` — INTEGER NOT NULL
- `ended_game_day` — INTEGER, nullable
- `status` — TEXT NOT NULL default `'alive'`, `CHECK (status IN ('alive','dead','removed'))`
- `end_reason` — TEXT, nullable
- `last_foaled_game_day` — INTEGER, nullable. Mares only. The mare-recovery check in §6.3 reads this.
- `created_real_ts` — INTEGER NOT NULL, UTC epoch seconds. Audit only; never an input to a decision.

**Genetics**
- `genotype` — TEXT holding JSON. **Document the full shape in a comment in the migration**, copied from §4.2 — nothing else enforces it.
- `rng_seed` — INTEGER NOT NULL. Minted once with `randomSeed()` and stored. Every draw this horse ever makes derives from it.

Nothing sets `status`, `ended_game_day` or `end_reason` in this slice; they exist because ageing and death are a later slice that adds no tables, and because every query that lists horses should be filtering `status = 'alive'` from the first one written rather than being retrofitted.

**Indexes:** one — `idx_horses_owner_stable_id ON horses (owner_stable_id)`, because the barn list is the query every screen in this slice makes. Do not add sire/dam indexes yet; nothing displays a horse's offspring. Say why in the migration comment (`CLAUDE.md` §7).

`phenotype_cache` and `image_url`, which the schema document mentions, are **not** in this slice. `image_url` is the image slot slice. `phenotype_cache` is deliberately skipped: grey changes with age, so a cache of a horse's appearance goes stale on its own without anything writing to the row, and computing the phenotype is a pure function over a few hundred bytes. If a later slice measures a real cost, add it then with an invalidation rule keyed on the age band.

### 3.4 `horse_ancestors`

Written once at birth, never updated.

- `descendant_id` — INTEGER NOT NULL references `horses(id)`
- `ancestor_id` — INTEGER NOT NULL references `horses(id)`
- `depth` — INTEGER NOT NULL, 1–6
- `path_count` — INTEGER NOT NULL, default 1
- `PRIMARY KEY (descendant_id, ancestor_id, depth)`

**The primary key includes `depth` on purpose.** The same ancestor can reach a horse by paths of different lengths — a grandsire who is also a great-great-grandsire — and collapsing those into one row loses the information the pedigree display wants. `path_count` is the number of distinct paths of *exactly* that depth.

Six generations is at most 126 rows per horse, so this stays small.

### 3.5 `0014_seed_breeds.sql` — the Quarter Horse

One row. `code = 'QH'`, `name = 'Quarter Horse'`, `gaited_typical = 0`.

`founding_allele_pool` holds per-locus allele frequencies for the five loci this slice implements:

```json
{
  "E": {"E": 0.55, "e": 0.45},
  "A": {"A": 0.45, "a": 0.55},
  "CR": {"Cr": 0.10, "cr": 0.90},
  "G": {"G": 0.03, "g": 0.97},
  "DMRT3": {"C": 0.98, "A": 0.02}
}
```

**Nothing in this slice reads this column.** It is seeded now because the frequencies are genetics work and you have the genetics in front of you, because the next slice's entire job is consuming it, and because one JSON literal in a migration is cheaper than a session re-deriving it. Do not write code that reads it — that is building ahead.

The numbers reflect the breed: chestnut is very common in Quarter Horses, cream dilutions (palomino, buckskin) are present but not dominant, grey is uncommon, and the gait allele is close to absent. They are a starting point to be tuned by observation, not a research result.

### 3.6 `0016_config_breeding.sql`

`config` is a single row holding a JSON blob, so this migration is an `UPDATE` using SQLite's `json_set`, and it must bump `version` so the config cache reloads.

Keys to add:

- `min_breeding_age_game_days`: `1080` — three game years at 360 days to the year.
- `mare_recovery_game_days`: `30` — one real day, at thirty game days per real day. With instant foaling this is the only thing standing between a child and fifty foals in a minute, so it is not decoration.
- `coi_warn_threshold`: `0.125` — the level at which the breeding preview starts warning.

Do not put the pedigree depth cap in config. It is a structural setting: changing it does not change future computation, it makes every pedigree already written inconsistent with every pedigree written afterwards. It lives as a constant in the engine (§5.1) with a comment saying this.

---

## 4. The genotype

This is the load-bearing part of the slice. Get the shape right and everything downstream is ordinary code; get it wrong and every horse ever born is wrong.

### 4.1 Allele symbols and canonical order

| Locus | Alleles, in canonical order | Meaning |
|---|---|---|
| `E` | `["E","e"]` | `E` = black pigment can be made. `ee` = red. |
| `A` | `["A","a"]` | `A` = black pigment restricted to the points. `aa` = black spreads over the body. |
| `CR` | `["Cr","cr"]` | `Cr` = cream dilution, incomplete dominant, dose-dependent. |
| `G` | `["G","g"]` | `G` = greying, dominant, progressive with age. |
| `DMRT3` | `["C","A"]` | `C` = wild type. `A` = the "gait keeper" mutation. |

**A stored allele pair is always written in canonical order** — the order the table above gives, which is also the order in the `loci.alleles` JSON. `["E","e"]`, never `["e","E"]`. This is what makes genotype comparison, equality and test assertions stable, and it costs one sort at write time.

`DMRT3`'s alleles are conventionally written `C` and `A`, and the `A` here is unrelated to the Agouti `A` — they are in different loci and never in the same list. Put that sentence in the code as a comment; it will otherwise be misread.

### 4.2 The stored shape

```json
{
  "v": 1,
  "mendelian": {
    "E": ["E", "e"],
    "A": ["A", "a"],
    "CR": ["cr", "cr"],
    "G": ["g", "g"],
    "DMRT3": ["C", "C"]
  },
  "polygenic": {
    "neck_length":    "10011010 01",
    "shoulder_angle": "...",
    "back_length":    "...",
    "hock_set":       "...",
    "stamina":        "...",
    "jump_scope":     "...",
    "speed":          "...",
    "trainability":   "..."
  }
}
```

(The space in the example above is illustrative only — store no whitespace.)

- `v` is a schema version for the blob itself. It is `1`. A later session that changes the shape increments it and handles both, rather than migrating every horse's JSON.
- `mendelian` maps locus code to an ordered pair of allele symbols.
- `polygenic` maps trait code to a string of `'0'` and `'1'` characters of length `2 × 10`. The alleles at locus *i* are characters `2i` and `2i+1`. A string rather than nested arrays because it is a third of the size and reads fine in the database console.

**Missing keys are legal and must be handled.** A horse created before a locus existed simply has no entry for it. When a later slice adds Dun, every horse alive predates it. The rule: **when a parent lacks a locus or a trait, treat it as homozygous for the last allele in the canonical order** (the recessive / wild-type / absent one) — so a horse from before Dun existed reads as `["nd","nd"]`, which is both correct and invisible. Write this rule down in `genotype.ts` as a comment, because it is the thing that makes adding gene number six a data change.

### 4.3 The quantitative traits

Eight traits, ten loci each, fixed for this slice:

**Conformation:** `neck_length`, `shoulder_angle`, `back_length`, `hock_set`
**Ability:** `stamina`, `jump_scope`, `speed`, `trainability`

Straight from overview §2b. Ten loci sits inside the 8–20 the design recommends and gives a genetic potential of 0–20 with a strong central tendency, which is the bell curve the whole polygenic idea depends on.

The list lives as a frozen constant in `src/engines/genetics/polygenic.ts`. **No `quantitative_traits` table this slice** — nothing reads the trait's display unit or category yet, and the table belongs to the slice that displays them.

Founding horses get each allele drawn independently at 50/50 from their own seed. Not quality bands, not breed-weighted — that is the founding-stock generator's job, and this slice must not pre-empt it.

**Environmental noise is not stored.** The design applies noise at birth, but noise only matters at expression, and expression is two slices away. Because the horse's `rng_seed` is stored, the noise can be derived deterministically whenever it is first needed — `deriveSeed(horse.rng_seed, "birth_noise")` — and will be the same value every time it is asked for. Storing it now would be storing a number nothing can interpret yet. Note this in `polygenic.ts` so the later session knows the label to use.

---

## 5. The engines

`CLAUDE.md` §5.1 is the rule here: **these are pure functions that take data and return data. No `env`, no `DB`, no fetch, nothing async.** The caller reads from D1, calls the engine, writes the result. This is what lets a later session hold the whole genetics model in view at once, and it is what makes §9's tests possible without a database.

```
src/engines/genetics/
  loci.ts          the canonical locus list and allele order
  genotype.ts      parse, serialise, validate, and the missing-locus rule
  inheritance.ts   meiosis: two parent genotypes + a seed -> one foal genotype
  polygenic.ts     the trait list, founder generation, quantitative inheritance
  expression.ts    genotype + age -> structured phenotype
  describe.ts      structured phenotype -> an English sentence
  pedigree.ts      kinship and COI, and the ancestor rows for a new foal
```

### 5.1 `loci.ts`

Exports `LOCI`, a frozen array of `{ code, alleles }` in a fixed order — `E`, `A`, `CR`, `G`, `DMRT3` — and `PEDIGREE_DEPTH = 6` with the comment from §3.6 attached.

**Every iteration over loci in this codebase goes through `LOCI`, in array order.** Never `Object.keys(genotype.mendelian)`. The reason is reproducibility: the RNG draws one allele per locus in sequence, so if the iteration order can vary, the same seed produces a different foal, and `CLAUDE.md` §5.2's promise that outcomes are reproducible quietly stops being true. Put that sentence in the file.

### 5.2 `inheritance.ts`

```ts
meiosis(parentGenotype: Genotype, rng: Rng): Haplotype
combine(sire: Genotype, dam: Genotype, foalSeed: number): Genotype
```

`combine` derives its own sub-seeds and does not accept an `Rng`:

- `deriveSeed(foalSeed, "mendelian_sire")` and `deriveSeed(foalSeed, "mendelian_dam")`
- `deriveSeed(foalSeed, "polygenic_sire")` and `deriveSeed(foalSeed, "polygenic_dam")`

Separate streams per parent per system, so that adding a locus later does not shift the draws of an unrelated system. For each locus in `LOCI` order, each parent contributes one of its two alleles at 50/50. The resulting pair is sorted into canonical order before storing.

Sex is drawn separately by the caller — `deriveSeed(foalSeed, "sex")`, 50/50 mare or stallion — because it is not part of the genotype blob.

`CLAUDE.md` §5.2 forbids creating a second independent generator from a stored seed. Derive; never `makeRng(horse.rng_seed)` twice for different purposes.

### 5.3 `expression.ts`

```ts
expressPhenotype(genotype: Genotype, ageGameDays: number): Phenotype
```

Returns a structured object, not a string:

```ts
{
  baseColour: 'bay' | 'black' | 'chestnut',
  dilution: 'none' | 'cream_single' | 'cream_double',
  dilutedColour: string,      // 'buckskin', 'palomino', 'perlino', ...
  greyStage: 'none' | 'foal_grey' | 'greying' | 'light_grey' | 'white_grey',
  visibleColour: string,      // what you would see, today
  bornColour: string,         // what it was born, for greys
  gaited: boolean
}
```

**The rules, in order. This is the biology and it is the thing to get exactly right.**

1. **Extension.** `ee` → red base, and **Agouti is not consulted at all.** This is the epistasis case and it is the one a test must cover: a chestnut horse can carry any agouti genotype and look identical.
2. **Agouti**, only when `E` is present. `A/A` or `A/a` → bay. `a/a` → black.
3. **Cream**, dose-dependent:

   | Base | One `Cr` | Two `Cr` |
   |---|---|---|
   | chestnut | palomino | cremello |
   | bay | buckskin | perlino |
   | black | smoky black | smoky cream |

   Note that smoky black is the case that looks almost like plain black — worth a comment, because it will otherwise be reported as a bug.
4. **Grey**, if `G` is present in either copy. A grey horse is **born its base colour** and loses it progressively. `bornColour` is the colour rules 1–3 produce; `visibleColour` is driven by the stage:

   | Age | Stage | Reads as |
   |---|---|---|
   | under 1 year | `foal_grey` | the base colour, "with grey hairs coming through around the eyes" |
   | 1 to under 4 | `greying` | "greying", dappled |
   | 4 to under 8 | `light_grey` | "light grey" |
   | 8 and over | `white_grey` | "white grey" |

   Thresholds are exported named constants in this file, in game years, converted with `game_days_per_year` passed in by the caller. They are not config: they only affect display, they are read fresh every time, and a session that wants them tunable can move them in ten minutes.
5. **DMRT3.** `A/A` → `gaited: true`. Anything else → false. Heterozygotes are treated as not gaited. That is a simplification of a real trait whose heterozygous effect is partial and breed-dependent — flag it in a comment; a later slice may want a third state.

Age is passed in rather than read, and the function has no idea what today is. `CLAUDE.md` §5.3: game logic reads `world.game_day`, and the caller does that reading.

### 5.4 `describe.ts`

```ts
describeHorse(phenotype: Phenotype, sex: string, ageYears: number): string
```

"A bay mare, 4 years old." "A greying stallion, born chestnut, 2 years old." "A palomino filly, under a year old." Young horses read as filly/colt under three; mare/stallion after. Gaited horses get a clause: "…, and she is gaited."

Keep the vocabulary in one table at the top of the file. This text is the entire presentation layer for a horse until the image slot lands, so it is worth ten minutes more than it looks like it deserves.

### 5.5 `pedigree.ts`

Two things live here, both pure.

**Ancestor rows for a new foal:**

```ts
buildAncestorRows(sireId, damId, sireRows, damRows): AncestorRow[]
```

Take each parent's existing `horse_ancestors` rows, add the parents themselves at depth 1, shift every inherited row down by one, drop anything past `PEDIGREE_DEPTH`, and merge duplicates by **summing `path_count` within the same `(ancestor_id, depth)`**.

**Kinship and COI — the tabular method.** This settles the open question the schema document leaves to "the genetics specification session": *the exact COI formula, and how `path_count` feeds it.*

```ts
kinship(aId, bId, horses: Map<id, {sireId, damId, coi}>): number
coefficientOfInbreeding(sireId, damId, horses): number   // = kinship(sireId, damId)
```

The recursion, memoised on the unordered pair:

- `f(X, X) = 0.5 × (1 + F_X)`, where `F_X` is that horse's stored `coi`
- `f(X, Y)`, X and Y distinct: take the younger of the two — the one with the higher id works, since ids are monotonic and a horse's parents always predate it — and expand it: `f(X, Y) = 0.5 × [ f(X, sire_Y) + f(X, dam_Y) ]`
- a null parent, or a horse not present in the loaded map, contributes `0`

Then `F_foal = f(sire, dam)`.

**Why the tabular method rather than Wright's path method.** Wright's formula requires enumerating paths in which no individual appears twice, and that constraint cannot be checked against aggregated `path_count` values — the counts have already thrown away which individuals were on which path. The tabular recursion needs only parent pointers and each ancestor's own stored COI, is exact, and is short enough to read in one sitting. **So `path_count` does not feed the COI at all.** It is kept because "this horse appears four times in the pedigree" is worth displaying, and because a later session asking why the column exists deserves to find this paragraph rather than guess. Write it in the file.

**Why this works within the depth cap.** Ancestors beyond six generations are treated as unrelated founders. That understates COI slightly for very deep pedigrees and is the deliberate trade the design makes (overview §2d): deeper walks get slow and stop being meaningful.

**Why the pedigree table exists at all**, given that the recursion only needs parent pointers: it lets the caller fetch the entire relevant subgraph in **two queries** — the ancestor ids of both parents, then those horses' `(id, sire_id, dam_id, coi)` rows — and then run the recursion entirely in memory. Without it, a COI preview would be a chain of recursive queries at request time, and the preview is the whole point (§2.6).

---

## 6. Behaviour

### 6.1 Creating a founding horse (admin)

`/admin/horses/new`, admin only, same guard as every other `/admin` route.

The form: owning stable (a select of all stables), sex, breed, registered name, **age in years**, and one control per locus — two selects, one per allele, defaulting to the recessive/wild-type option.

**The age field matters more than it looks.** Breeding requires a horse of three, and three game years is 1080 game days, which is thirty-six real days of waiting. The form converts: `born_game_day = world.game_day − (ageYears × game_days_per_year)`, which may well be negative, and that is fine — `game_day` is an integer counter and negative birth days simply mean "before the world started", which is exactly what a founding horse is.

On submit: mint `rng_seed` with `randomSeed()`, generate the polygenic loci from `deriveSeed(seed, "founder_polygenic")`, assemble the genotype, set `generation = 0`, `coi = 0`, `breeder_stable_id` and `breeder_prefix` null, `composition = {"QH": 1}`, `is_cross = 0`. Write no `horse_ancestors` rows.

Founding horses are named on this form and are never unnamed. Because they have no breeder prefix, their `registered_name` is the typed name alone.

### 6.2 The barn list

`/stables/:id/horses` — every alive horse the stable owns, in birth order, each showing its name (or "Unnamed filly"), the description sentence from §5.4, and a link to its page. Reuse the ownership pattern already in `src/routes/stables.ts`: re-read the stable from its `account_id` and 404 if the logged-in account does not own it. Never trust the `hh_stable` cookie for authorisation.

### 6.3 Breeding

`/stables/:id/breed`, owner only. **Two steps, no JavaScript** (`CLAUDE.md` §11, 2026-08-02): a form with two selects — mares owned by this stable, stallions owned by this stable — and a **Check pairing** button. That submits, and the page re-renders with the same selections plus:

- both horses' descriptions and ages
- **the COI this pairing would produce**, as a percentage
- a plain-English note: at or above `coi_warn_threshold`, say what it means — "these two are closely related; a foal from this pairing would be noticeably inbred" — and at 25% or more say so more firmly. Do not block it. Inbreeding is a decision with consequences, not a forbidden move, and the consequences arrive when health lands.
- a **Confirm breeding** button

Confirm re-validates everything server-side. The refusals, each with a sentence saying why:

- both horses must be alive, owned by this stable, one mare and one stallion (a gelding is refused explicitly)
- both must be at least `min_breeding_age_game_days` old
- the mare's `last_foaled_game_day`, if set, must be at least `mare_recovery_game_days` ago
- the stable must have room: alive horses owned by it must be below `stables.capacity`

**Parent–offspring and full-sibling matings are allowed.** The COI is the mechanic; a ban would remove the lesson.

### 6.4 What happens when a foal is born

All of it in **one `env.DB.batch([...])`** — D1 batches are one implicit transaction, the pattern `createStableWithPrefix` already uses. A foal that exists without its pedigree rows is a horse whose COI is silently wrong forever.

1. Mint the foal's `rng_seed` with `randomSeed()`.
2. `combine(sireGenotype, damGenotype, foalSeed)` for the genotype; `deriveSeed(foalSeed, "sex")` for the sex.
3. `generation = max(sire.generation, dam.generation) + 1`.
4. `coi = coefficientOfInbreeding(sireId, damId, loadedHorses)` — computed *before* the insert, from the same two queries the preview used.
5. `composition` and `is_cross` per §6.5.
6. `breeder_stable_id` = the breeding stable; `breeder_prefix` = **a snapshot of that stable's prefix right now**.
7. `owner_stable_id` = the same stable.
8. `born_game_day = world.game_day`. `registered_name = NULL`.
9. Insert the `horse_ancestors` rows from `buildAncestorRows`.
10. Set the dam's `last_foaled_game_day = world.game_day`.
11. **Set the breeding stable's `prefix_locked = 1`.** Slice 0001 built that column and said explicitly that the breeding slice is what sets it: a prefix is free to change until the stable breeds its first horse, and permanent afterwards. This is that moment. Set it unconditionally — it is already 1 or it is about to be.

### 6.5 Breed composition and the cross rule

```ts
foalComposition(sire, dam): { composition, isCross, breedId }
```

Average the parents' fraction maps. `is_cross` is 1 if either parent is a cross **or** the parents' `breed_id`s differ. `breed_id` is the single breed when the composition is a clean 1.0 of one breed and neither parent is a cross; otherwise null.

**Once a cross, always a cross**, regardless of how many purebred generations follow (overview §4c). Without a rule of this shape, breed allele restrictions dissolve within a few generations — cross once for a gene your breed does not have, breed back twice, and the "Arabian" line now carries it. Those restrictions are most of what makes breeds feel like breeds.

With one breed nothing crosses, so this code is unexercised except by its unit test. Write it anyway: it is fifteen lines, and applying it retroactively to horses already born is impossible.

### 6.6 The horse page

`/horses/:id`. Owner or admin only — no market and no public profiles yet, so anyone else gets a 404.

Shows: registered name or "Unnamed filly"; barn name; the description sentence; sex, age in years, breed, and whether it is gaited; who bred it (the snapshotted prefix, and the breeder stable's current name if it still exists); COI as a percentage; and a **three-generation pedigree table** built from `sire_id`/`dam_id`, with links, showing "unknown" where a founder's parents would be.

Forms on the page: set/change the barn name, always. **Register a name**, only when `registered_name` is null and only for the owner — it assembles `"{prefix} {name}"` from the *owner's* prefix (which for a foal is the breeder's, since nothing transfers yet), validates it the way prefixes are validated in slice 0001 (length, allowed characters, and a clear message if the assembled name is already taken), writes it, and the form disappears forever.

**For admins only, a genotype block**: each locus with its allele pair and the locus's `teaching_text`. Nothing polygenic is displayed to anyone (§2.7). No player sees any of this (§2.8).

---

## 7. Routes to add

In `src/router.ts`, following the existing patterns:

- `GET /stables/:id/horses` — barn list
- `GET|POST /stables/:id/breed` — the two-step breeding screen
- `GET /horses/:id` — horse page
- `POST /horses/:id/name` — register the permanent name
- `POST /horses/:id/barn-name` — set the barn name
- `GET|POST /admin/horses/new` — founder creation

The existing `STABLE_ROUTE` regex handles `/stables/(\d+)(\/select|\/prefix)?` — extend it rather than adding a second matcher. Add a link to the barn from the stable home page, and a link to `/admin/horses/new` from the admin home page; a screen with no route into it does not exist as far as the operator is concerned.

---

## 8. Database layer

`src/db/horses.ts` and `src/db/breeds.ts` (which also serves `loci`). All SQL lives here (`CLAUDE.md` §4) and the engines never see it.

Functions worth naming explicitly:

- `listStableHorses(env, stableId)` — alive only
- `getHorse(env, id)`
- `loadPedigreeContext(env, sireId, damId)` — **the two-query load**: ancestor ids of both parents from `horse_ancestors`, then those horses' `(id, sire_id, dam_id, coi)` rows. Returns the `Map` the pedigree engine takes. Used identically by the preview and the birth, which is what guarantees the previewed number is the number the foal gets.
- `createFoundingHorse(env, input)`
- `breedNow(env, input)` — the batch in §6.4, carrying the §2.4 comment

Cache `breeds` and `loci` against their own reads the way `config-cache.ts` does — they are tiny, read constantly, and edited approximately never.

---

## 9. Testing

In `test/`, no database, engines only.

**Inheritance and reproducibility**
- Same parents, same foal seed → byte-identical genotype. This one guards the whole reproducibility promise; comment it.
- `E/e × E/e` over 10,000 foals → close to 25% `ee`. The carrier × carrier assertion `CLAUDE.md` §5.2 exists for.
- `E/E × e/e` → 100% `E/e`.
- Every allele in a foal came from a parent, over a large sample.
- A parent missing a locus entirely is read as homozygous-last-allele (§4.2) and the foal is well-formed.

**Expression** — a table-driven test, one row per combination, asserting exact colour names:
- `ee` with `A/A`, `A/a` and `a/a` all give chestnut — the epistasis case
- `E_ A_` bay; `E_ aa` black
- every cell of the cream table in §5.3, single and double dose
- grey: the same genotype at 0, 2, 6 and 10 years gives four different `visibleColour`s and one unchanging `bornColour`
- `DMRT3` `A/A` gaited; `C/A` and `C/C` not

**Pedigree and COI** — the known values, which is what makes this testable at all:
- unrelated parents → 0
- half-siblings → 0.125
- full siblings → 0.25
- parent × offspring → 0.25
- a mating whose common ancestor is itself inbred → strictly greater than the same pedigree with that ancestor's COI at 0
- `buildAncestorRows` sums `path_count` when an ancestor appears twice at the same depth, and drops everything past depth 6

**Polygenic**
- a foal's potential (sum of alleles) over many draws has a mean close to the midpoint of its parents'
- founder generation produces a spread rather than everything at 10

**Consistency**
- the locus codes in `0015_seed_loci.sql` are exactly the codes in `LOCI`, in the same order. Parse the migration text — it is already imported as a string in `src/db/migrations.ts`. This is the test that stops the table and the engine drifting apart.

---

## 10. What this slice does not include

Named so a future session knows these were left out on purpose:

- **No `pregnancies` table and no gestation.** §2.4. This is the one item here that is a deliberate temporary rather than a deferral.
- No stud services, no breeding to another stable's stallion, no market, no money moving. Breeding is free.
- No action budget. Breeding costs nothing but the mare's recovery time and the stable's capacity.
- No images. `image_url` is the next-but-one slice.
- No `quantitative_traits` table, no trait display, no expression of potential. The data is generated and stored and shown to nobody.
- No conditions, no `horse_knowledge`, no genotype testing, no vet.
- No death, no ageing effects beyond grey progressing. The tick does no horse work at all this slice — it still only moves the clock.
- No NPC stables, no second breed, no geldings, no transfers.
- No indexes beyond the one named in §3.3.

---

## 11. Acceptance checklist for the operator

Write this into the README as a numbered list, each step saying what to click and what should happen.

1. Deploy. Open `/admin/migrations` and apply the seven new migrations. They all report applied.
2. From the admin page, create a horse: a mare, Quarter Horse, into a child's stable, aged 4, with Extension `E/e`, Agouti `A/a`, Cream `cr/cr`, Grey `g/g`, DMRT3 `C/C`. Name her.
3. Create a stallion the same way, also `E/e` and `A/a`. Name him.
4. Log in as the child. Open the barn. Both horses are listed, each described in a sentence — both should read as bay.
5. Go to the breeding page. Choose the mare and the stallion. Press **Check pairing**. It reports a COI of 0% — they are unrelated.
6. Press **Confirm breeding**. A foal appears in the barn as "Unnamed filly" or "Unnamed colt".
7. Repeat steps 5–6 several times, using a different mare each time or waiting for recovery. Because both parents carry `E/e`, roughly one foal in four should be chestnut and the rest bay. Small numbers are noisy; over a dozen foals the pattern should be visible.
8. Open a foal's page. It shows its colour, its sire and dam with links, and a pedigree.
9. Register a name for it. The name appears with the stable's prefix in front of it, and the naming form is gone.
10. Try to change that stable's prefix now. It is refused — the stable has bred a horse, so the prefix is permanent.
11. Breed a filly foal back to her own sire. **Check pairing first**: it reports 25% and warns you. Confirm anyway; the foal's page shows a COI of 25%.
12. Try to breed the same mare again straight away. Refused, with a sentence explaining she has just foaled.
13. Create a horse with Grey `G/g`, aged 0. It is described by its base colour. Press the admin advance button repeatedly — each press is ten game days — and watch the description move through greying, light grey and eventually white grey. Thirty-six presses is a game year.

Step 11 is the one worth doing carefully. Everything else confirms the plumbing; that one confirms the pedigree, the COI and the preview all agree with each other.

---

## 12. Questions this slice does not answer

Do not guess at these. They belong to later slices or later conversations.

- **What gestation length actually is**, and whether foaling announces itself. The pregnancy slice.
- **Whether breeding costs money or an action.** Nothing is charged here.
- **How the heterozygous DMRT3 horse should behave.** Treated as not gaited; a partial third state is defensible and was not decided.
- **Whether the grey progression thresholds should be tunable from the config screen.** Constants for now.
- **Test pricing and what a player pays to learn a genotype.** The health slice, and an open question in the design.
- **Disclosure on listings** — whether a seller's knowledge is shown. No market yet.
- **Quality bands for founding stock**, and whether players are given horses or buy them. The founding-stock slice, and an open question in the design.
- **What the founding allele pool numbers should actually be.** §3.5 seeds a plausible set; only play will tell.

---

## 13. When you are finished

Per `CLAUDE.md` §9:

- Summarise what you built in plain English, for someone who does not code. Assume they will read your summary and then try to follow §11 with no other help.
- State anything you decided that this document did not specify.
- State anything here you disagreed with, and what you did about it.
- **Update `CLAUDE.md` §10**, marking Genetics core as built with a one-line note.
- **Update `CLAUDE.md` §11** with the conventions the next session needs, dated: the genotype blob shape and its version field, the missing-locus rule, the `LOCI`-order rule and why it is load-bearing for reproducibility, the sub-seed labels in use (`mendelian_sire`, `mendelian_dam`, `polygenic_sire`, `polygenic_dam`, `sex`, `founder_polygenic`, and the reserved `birth_noise`), the tabular COI decision and the fact that `path_count` does not feed it, and the two-query `loadPedigreeContext` pattern.

Keep those entries short. That section is a reference for a stranger, not a changelog.
