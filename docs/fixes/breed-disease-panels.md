# Fix: breed-specific disease loci

Prompted by an operator screenshot of `/admin/horses/new` plus two sentences: *"only the
original are on the create a horse... testing for every horse breed is the same set...
these were supposed to be breed specific for inheritability."*

Three issues, one root cause. Not a new stage — `docs/breed-disease-panels.md` already
specifies the data (written 2026-08-04, never seeded), and this document is the build
brief for seeding it plus the one behaviour change that document did *not* cover.

---

## The three issues

**1. The six breed panels do not exist.** `docs/breed-disease-panels.md` is a design
record, and its own header says so: "nothing in it is in the database." `LOCI`
(`src/engines/genetics/loci.ts:32`) still ends at the ten colour loci, and `conditions`
still holds exactly the four Quarter Horse rows from `migrations/0053`. Arabian, German
Warmblood and Friesian horses have no signature condition because none was ever seeded.

**2. "Only the original are on the create a horse."** This is issue 1 seen from the admin
form. `renderAdminHorseNewPage` (`src/render/horses.ts:1844`) iterates `LOCI` and draws a
fieldset per locus, so the form is already correct — it shows exactly the nineteen loci
that exist. Seeding the six fixes it with no code change. See §4 for the one thing that
*does* need changing there.

**3. "Testing for every horse breed is the same set."** This is the real defect, and it
predates the missing panels. `migrations/0052_conditions.sql` declares
`breed_associations` **"display only... this is only ever shown, never enforced"**, and
every screen honours that literally: `buildTestPageRows` (`src/routes/horses.ts:1317`),
`healthRowsFor` (`:719`) and `disclosedConditionsFor` (`src/routes/market.ts:187`) all
call `getEnabledConditions` and show the whole list. So a Friesian is offered four
Quarter Horse tests it is genetically incapable of failing — the founding pools already
give every non-QH breed `"N":1.0` at all four loci — and the child pays real money for
four guaranteed "clear" results. Seeding six more conditions makes this **worse**, not
better: ten rows, of which at most three can ever say anything.

---

## The rule

`breed_associations` stops being display-only and becomes **the panel rule**:

> A condition is on a horse's panel when its `breed_associations` intersects the set of
> breed codes appearing anywhere in that horse's pedigree — its own breed, plus the breed
> of every ancestor in `horse_ancestors`.

Ancestry, not just the horse's own breed, because cross-breeding is real and encouraged
(the Nokota outcross is a design pillar, overview §4a). A Quarter Horse × Arabian foal
can carry `Sc`; filtering on `breed_id` alone would leave a genuine lethal risk with no
test to buy and no warning on the breeding preview. `horse_ancestors` is already a
materialised closure table, so this is one query, and `deletableHorseSql`
(`src/db/horseRemoval.ts:60`) refuses to delete any horse that is an ancestor — the
pedigree can never silently lose a breed out from under this rule.

**Accepted limit.** `horse_ancestors` stops at `PEDIGREE_DEPTH` (6). An Arabian crossed
in seven generations back would drop off the panel while its alleles are still in the
line. This is the same horizon COI already uses, and `loci.ts:64` records it as a
settled structural trade-off — accept it, consistently, rather than introduce a second
notion of ancestry. *(Alternative, if this ever bites: a `horses.ancestry_breed_codes`
TEXT column written at birth as the union of both parents' sets plus the foal's own
breed. Exact, no depth limit, still retroactive to conditions added later since it stores
breed codes rather than condition codes — but it costs a column, four write sites and a
backfill. Recorded here so nobody re-derives it.)*

### Where the rule applies, and where it must not

Filter — these are all *offer and disclosure* surfaces, where the question is "what is
worth asking about this horse":

| Call site | Today | After |
|---|---|---|
| `buildTestPageRows`, `src/routes/horses.ts:1317` | every enabled condition | panel only |
| `untestedConditions`, `src/db/health.ts:235` | every enabled condition | panel only (drives the panel-price button and the POST's re-derivation) |
| `healthRowsFor`, `src/routes/horses.ts:719` | every enabled condition | panel only, all three branches (owner, admin, stranger) |
| `disclosedConditionsFor`, `src/routes/market.ts:187` | every enabled condition | panel only — a listing should not show ten "not tested" rows |
| `npcMarket.ts:62` panel purchase | every enabled condition | panel only, or NPC stables burn money on guaranteed-clear tests |
| `consignment.ts:478` dealer pre-test | every enabled condition | panel only |
| breeding preview, `breedingHealthWarningsFor`, `src/db/health.ts:265` | every recessive condition | the **union** of both parents' panels — a cross-breed pairing must warn on both sides' conditions |

Do **not** filter — these read genotype truth, and truth does not care what breed the
registry says a horse is. A horse carrying two `Sc` alleles dies of SCID whatever its
`breed_id`, and filtering here would make the game inconsistent with itself:

- `buildHorseConditionStatements` (`src/db/health.ts:375`) — what is written at birth
- `killDueLethalFoals` (`:456`), `isBarredFromShowing` (`:421`),
  `visibleAffectedConditions` (`:95`), `getLethalTriggers` (`:59`)
- `conditionCensus` (`:538`) — `/admin/health` is the tuning instrument and must see the
  whole population

### Shape of the change

One pure function, per CLAUDE.md §5.1 — no database access, testable without one:

```ts
// src/engines/health/panel.ts
export function panelFor(conditions: ConditionRow[], breedCodes: Set<string>): ConditionRow[]
```
It parses `breed_associations` (JSON array of breed codes) and keeps a row when the
arrays intersect. A row with an empty `breed_associations` is on every panel — there are
none today, and that is the safe default for one added later.

One thin database helper beside it, in `src/db/health.ts`:

```ts
export async function pedigreeBreedCodes(env: Env, horseId: number): Promise<Set<string>>
```
The horse's own `breeds.code`, `UNION` the distinct codes reached through
`horse_ancestors` — one query, no N+1, cached alongside nothing (breeds are already
cached by `db/breeds.ts`).

### What the player sees

The test page's Health section gains one muted line above the rows, and the "nothing left
to test" sentence is already worded for it ("every condition on this panel"):

> These are the conditions that run in this horse's breeds. A test for anything else
> would tell you nothing — the alleles simply are not in the line.

When ancestry adds conditions beyond the horse's own breed, say so plainly, because
otherwise a Quarter Horse showing three Arabian tests reads as a bug:

> This horse has Arabian in its pedigree, so the Arabian conditions are on its panel too.

---

## Seeding the panels

Follow `docs/breed-disease-panels.md` — §4 (six loci), §5 (six `conditions` rows, with
teaching and event text already drafted to the no-semicolon/no-double-hyphen rule), §7
(pool frequencies). Four corrections to that document, all found while writing this one:

1. **`sort_order` is wrong.** §4 says "sort_order 10 through 15" — those were taken by
   slice 0021's colour loci (`migrations/0113`, sort_order 10-19). The six go at **20-25**,
   appended after `PATN1` in `LOCI`, never inserted earlier. `loci.ts`'s own header
   explains why order is load-bearing: the RNG draws one allele per locus in sequence, so
   inserting would change every foal a stored seed produces.

2. **`loci.category` must be `'disease'`.** `buildColourTestPageRows`
   (`src/routes/horses.ts:1347`) selects loci by `category !== 'disease'` — any other
   value and SCID appears on the colour panel, priced as a colour test.

3. **The founding-pool migration must be a full rewrite, not six `json_set` calls.**
   `test/genetics/consistency.test.ts` parses the *most recent* full-literal pool
   migration (`0114_breed_pools_colour_pattern_loci.sql`) as the authoritative state; a
   partial update would leave the test asserting against a pool that no longer exists.
   Write a new full-literal `UPDATE ... WHERE code = ?` per breed and add the new filename
   to that test's `seedMigrations` list. Same for `migrationNames` in the LOCI-vs-seed test
   above it.

4. **§9's open question — keep the single global `lethal_foal_death_game_days`.** That
   document's own lean, and the right one: no condition in this pass needs a different
   window, and a nullable column nothing reads is what slice 0010 §3.2 warned against.
   §5.1's teaching text already discloses the compression honestly.

Migrations, next free number is `0145`, one logical change each, each registered in
`src/db/migrations.ts` per CLAUDE.md §8:

| File | Contents |
|---|---|
| `0145_seed_breed_disease_loci.sql` | the six `loci` rows, category `disease`, sort_order 20-25 |
| `0146_breed_pools_disease_loci.sql` | all eight `founding_allele_pool`s rewritten in full, §7's frequencies |
| `0147_seed_breed_conditions.sql` | the six `conditions` rows, §5's text verbatim |

---

## The admin create form (issue 2)

Seeding fixes the missing fieldsets. Two things are still worth doing while it is open:

- **Group the fieldsets.** Nineteen becomes twenty-five, one stacked fieldset each, on a
  phone. Wrap them in `<details class="section-collapse">` by `loci.category` — Base,
  Dilutions, Patterns, Gait, Disease — closed by default, exactly the treatment slice 0021
  Part F gave the test page when nine rows became nineteen.

- **Leave the loci list itself unfiltered, and say why on the page.** This form is
  deliberately a neutral control (slice 0005 §6.6) and the operator must be able to build
  a horse the generator never would. But that means it can produce a Friesian with `H/N`
  at HYPP — a horse genuinely affected by a condition its panel excludes, which will die
  or be barred with no test available to explain it. One muted line under the Genotype
  heading is enough:

  > Any allele can be set on any breed here. A condition only appears on a horse's testing
  > page if it runs in that horse's breeds, so an allele set outside its breed will be
  > real but untestable.

---

## Tests

1. `panelFor` — a Quarter Horse gets the four QH conditions and none of the six; an
   Arabian gets SCID/CA/LFS only; a horse with both codes in its set gets all seven.
2. The pedigree rule — a QH × Arabian foal's panel includes SCID (guards the whole reason
   this filters on ancestry rather than `breed_id`).
3. Truth is unfiltered — a Friesian genotype hand-built with two `Gb` alleles still reads
   `affected` from `conditionStatus` and still appears in `getLethalTriggers`' clamp.
   This is the assertion that stops a future session "tidying" the filter into the engines.
4. The two existing consistency tests, extended per correction 3 above: `LOCI` matches the
   three-then-four seed migrations in order, and every breed pool covers all 25 loci
   summing to 1.0.
5. Costs nothing and catches the expensive mistake: assert every seeded condition's
   `breed_associations` names a breed code that exists in `breeds`.
