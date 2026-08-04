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
holds five rows: the four from `migrations/0053` plus LWO (`0117`, slice 0021 Part E).
Arabian, German Warmblood and Friesian horses have no signature condition because none
was ever seeded.

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
call `getEnabledConditions` and show the whole list. So a Friesian is offered five
Quarter Horse tests it is genetically incapable of failing — the founding pools already
give every non-QH breed `"N":1.0` at all four disease loci and `{"n":1.0}` at frame overo
— and the child pays real money for five guaranteed "clear" results. Seeding six more
makes this **worse**, not better: eleven rows, of which at most four can ever say
anything.

---

## "Are those not diseases?" — where genetic conditions live

Yes, and they are already all in one place. Reviewed and confirmed rather than moved:

- **`conditions` is the one home for genetic inheritable conditions.** All five current
  rows are single-gene and genotype-triggered, LWO included. Slice 0022 Part A already did
  the separation work — the twelve acquired conditions (colic, laminitis, and the rest)
  left for `incident_types`/`horse_incidents`, `0133` deleted their old rows, and `0052`'s
  table is genetics-only from that point. Nothing needs to move.

- **LWO is a disease that happens to ride a colour locus, and it is filed correctly.** Its
  `locus_code` is `O` (frame overo) but its row is a `conditions` row, it shows in the test
  page's *Health* section, and the colour panel never sees it — `buildColourTestPageRows`
  selects `category !== 'disease'` off the **locus**, not the condition. Health and colour
  stay separate on screen, which is the split you said you like. Keep it.

  One known wart, already a recorded decision (CLAUDE.md §10, slice 0021 Part E): the LWO
  health test and the `locus:O` colour test are two separate purchases of the same allele.
  Left alone — it is deliberate, and GBED sets the precedent.

- **The two leftovers found while reviewing.** Neither blocks this fix; both are cheap and
  worth doing in the same pass since the world is being reset anyway:
  1. `horse_conditions` still carries `resolve_game_day`, `treated_game_day` and `outcome`
     (`0122`), added for the acquired conditions. `0131` recreated all three on
     `horse_incidents` and `0133` deleted every acquired row, so on `horse_conditions` they
     are now written by nothing and read by nothing — exactly the "nullable column nothing
     touches is a promise nobody keeps" this project refuses elsewhere (slice 0010 §3.2).
     Drop them. `state` likewise narrows back to `onset`/`terminal`.
  2. `src/engines/showing/eligibility.ts:42-48` still documents `hasOpenAcuteIncident` and
     `hasDegenerativeIncident` as reading `horse_conditions` and
     `horse_conditions.outcome`. Both read `horse_incidents` now. Comment-only, but in this
     codebase the comments are the handoff.

---

## The rule

> A condition is on a horse's panel when **any breed in that horse's pedigree carries the
> condition's mutant allele at nonzero frequency in its `founding_allele_pool`** — the
> horse's own breed, plus the breed of every ancestor in `horse_ancestors`.

**Derived from the pools, not from `breed_associations`.** The obvious move is to promote
`breed_associations` from display-only to the panel rule, and it is the wrong one — LWO is
why. `0117` gives it `'["QH"]'`, which is correct today only because `0114` happens to give
frame overo `{"O":0.03,"n":0.97}` to the Quarter Horse and `{"n":1.0}` to the other seven.
The *locus* is already in all eight pools at zero. The day someone gives the Paso Fino
frame overo — a one-number edit to a pool, exactly the kind of tuning this game expects —
LWO silently drops off that breed's panel and the failure mode is a dead white foal with
no test the child could have bought. A hand-maintained breed list drifts from the pools
that actually decide what a horse can carry; the pools cannot drift from themselves.

So `breed_associations` keeps the contract `0052` gave it, which turns out to have been
right all along: it answers "why is this listed as an Arabian condition", and is never
enforced. §Tests item 5 is what keeps the two honest with each other.

`founding_allele_pool` is already loaded and cached by `getBreeds`, and the mutant allele
is already parsed out of `conditions.trigger` by `parseConditionTrigger` — no new data.

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
export function panelFor(
  conditions: ConditionRow[],
  pools: Map<string, AllelePool>, // breed code -> that breed's founding_allele_pool
  breedCodes: Set<string>         // the breeds in this horse's pedigree
): ConditionRow[]
```
For each condition it reads `trigger.locus`/`trigger.mutant` and keeps the row when any
named breed's pool has that mutant at a frequency above zero. A condition whose locus is
missing from a pool keeps `pool.ts`'s existing rule — that is an error, not a default —
so it throws rather than quietly dropping off a panel.

The one thing that would defeat this: an allele reaching a horse without passing through
a founding pool. `CONSIGNMENT_INJECTABLE_LOCI` (`src/render/admin.ts:1731`) is
`E/A/CR/G/DMRT3` only, so the dealer cannot inject a disease allele today. If that list
ever grows to a disease locus, this rule needs the injected allele folded in.

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

### Coverage: at least a couple each for Quarter Horse, German Warmblood and Paso Fino

`docs/breed-disease-panels.md` gives the German Warmblood one condition and the Paso Fino
none at all — §6.2 refuses DSLD because it has no confirmed causal gene even in reality,
and refuses on principle to invent a locus. That refusal is right, but it leaves two of
the three breeds you named with nothing. The way out is not a new locus, it is **a wider
pool**:

**PSSM1 genuinely occurs in Quarter Horses, warmbloods and gaited breeds alike** — it is
one of the least breed-exclusive equine myopathies there is. Making it Quarter-Horse-only
was a slice 0010 simplification, not biology. Widen its `founding_allele_pool` entry to
QH, GW and PF, and both gaps close with no invention at all. It also makes the panel rule
visibly do its job: PSSM1 appears on three breeds' panels because three breeds' pools
carry it, and nobody maintains a list.

That leaves one knowing simplification, and only one:

**DSLD (degenerative suspensory ligament desmitis), Paso Fino.** Real, breed-signature,
clearly heritable, and — unlike every other condition here — with no confirmed single
locus. Modelling it as one is a departure from §6.2 and from the "take the real list
rather than invent one" rule slice 0010 §2.1 set. Recommended anyway, because it is the
Paso Fino's actual signature problem and the alternative is a breed with no identity, but
**say so in the teaching text** rather than let it pass as settled science: *"Unlike the
other conditions here, nobody has yet found the single gene behind DSLD. Real breeders
watch the bloodlines instead of testing. This game gives it one gene so it can be tested,
which is a simplification."* That is a better lesson than silence, and it is honest.

Bonus, free, and closes a deferral: **MCOA (multiple congenital ocular anomalies),
Icelandic.** §6.3 deferred it solely because the Silver locus did not exist — slice 0021
added `Z` (`0113`), and `0114` already gives the Icelandic `{"Z":0.12,"z":0.88}`. It is
homozygous silver, so it needs **no new locus and no new engine**, exactly like LWO.

Resulting panels:

| Breed | Panel | New this pass |
|---|---|---|
| Quarter Horse | HYPP, PSSM1, HERDA, GBED, LWO | — |
| Arabian | SCID, CA, LFS | 3 |
| German Warmblood | WFFS, **PSSM1** | 1 + pool widening |
| Paso Fino | **DSLD**, **PSSM1** | 1 + pool widening |
| Friesian | DWARF, HYDRO | 2 |
| Icelandic | **MCOA** | 1 (existing locus) |
| Thoroughbred | — | deliberately none, §6.5 |
| Nokota | — | deliberately none, §6.6 |

### Hydrocephalus is `degenerative`, not lethal — operator decision, 2026-08-04

Seeding `docs/breed-disease-panels.md` §5.6 as written would put the lethal count at six:
GBED, LWO, SCID, LFS, WFFS and hydrocephalus. That document's §3 predicted five and called
it "exactly on overview §3b's ceiling", but it was written without LWO in view — that
landed from slice 0021. Overview §3b's own words are that four or five "is enough to make
testing matter" and a dozen "makes foaling an anxious event rather than a hopeful one".
Six is over the line, and foaling is the moment this game is actually about.

**Decision: hydrocephalus is seeded `severity_class = 'degenerative'`.** Five lethals,
back inside the ceiling, and the Friesian gets two visible conditions instead of one. Real
hydrocephalus foals that survive the birth are profoundly affected, so this is a
defensible reading rather than a fudge. **This overrides §5.6 of the design document,
which specifies lethal** — do not seed that row verbatim.

Four consequences, all of which need handling and one of which is easy to miss:

1. **Rewrite the teaching and event text.** §5.6's drafts both end on "the foal does not
   survive", which is now false. Follow HERDA and dwarfism instead — visible, permanent,
   career-ending, not fatal. `event_text` fires at signs, not at death.
2. **`bars_showing = 1`**, matching HERDA, CA and dwarfism. Nothing else in the
   degenerative class shows.
3. **It leaves the lethal clamp** (`getLethalTriggers`, `src/db/health.ts:59`). The
   founding and consignment generators will no longer refuse to mint a homozygous
   affected Friesian, so at `0.04` roughly one founding Friesian in 600 arrives already
   affected and barred from showing. That is exactly HERDA's situation at `0.06` and needs
   no new code — but it is a real behaviour change and worth watching at `/admin/health`
   after the reset.
4. **`terminal_game_day` stays NULL** and `state` is `onset`, not `terminal` —
   `buildHorseConditionStatements` already branches on `severity_class`, so this falls out
   of the column rather than needing a special case.

Signs delay stays `0`: a domed skull is visible at birth whether or not the foal survives.

### Corrections to `docs/breed-disease-panels.md`

Follow it for §4 (loci), §5 (condition rows, teaching and event text already drafted to
the no-semicolon/no-double-hyphen rule) and §7 (pool frequencies). Four corrections, all
found while writing this one:

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
| `0145_seed_breed_disease_loci.sql` | the seven `loci` rows (§4's six, plus `DSLD`), category `disease`, sort_order 20-26 |
| `0146_breed_pools_disease_loci.sql` | all eight `founding_allele_pool`s rewritten in full: §7's frequencies, plus PSSM1 widened to GW and PF, plus DSLD for PF |
| `0147_seed_breed_conditions.sql` | the new `conditions` rows — §5's six verbatim, plus DSLD and MCOA |
| `0148_conditions_signs_delay.sql` | `signs_delay_min/max_game_days` on `conditions`, defaulted 0 |
| `0149_seed_signs_delays.sql` | the per-condition delays in the table above |
| `0150_horse_conditions_signs.sql` | `signs_game_day` + `signs_noticed_game_day` on `horse_conditions` |
| `0151_horse_conditions_drop_incident_columns.sql` | drops the three dead columns `0122` left behind |

MCOA needs no locus row — it reads the existing `Z`, the same way LWO reads `O`.

---

## Signs take time to show

Today `signs_visible = 1` means *visible the instant the horse exists*:
`buildHorseConditionStatements` (`src/db/health.ts:398`) writes the `condition_signs` event
in the same batch as the horse insert, and `visibleAffectedConditions` (`:95`) reads
nothing but the genotype. So a newborn foal is flagged with HERDA on the day it is born,
and a Quarter Horse bought at four is flagged with HYPP before anyone has worked it. That
is wrong in the same way for both: in reality almost none of these announce themselves
straight away.

**Per-condition, not one global delay.** A blanket "20-25 ticks" would be wrong in the
other direction — dwarfism, hydrocephalus, lavender foal syndrome and WFFS genuinely *are*
obvious at birth, and `docs/breed-disease-panels.md` §5.3 deliberately made LFS visible
from day one as a teaching contrast against GBED's "looked fine, then wasn't." Two new
`NOT NULL` columns on `conditions` keep both truths:

```
signs_delay_min_game_days INTEGER NOT NULL DEFAULT 0
signs_delay_max_game_days INTEGER NOT NULL DEFAULT 0
```

| Condition | Delay (game days) | Why |
|---|---|---|
| HYPP, PSSM1, HERDA | 100-250 | the default band — episodes under work and stress |
| CA (Arabian) | 20-60 | real onset is weeks after birth, not months |
| DSLD (Paso Fino) | 250-400 | adult-onset by nature |
| DWARF, HYDRO, LFS, WFFS, MCOA | 0 | genuinely visible at birth |
| GBED, LWO | n/a | `signs_visible = 0`, unchanged |

**Your 10-25 ticks is 100-250 game days** — `game_days_per_tick` is 10
(`migrations/0009`), and CLAUDE.md §5.3 requires game logic to read `game_day`, never a
tick count. That band is the default, applied to the three conditions that have no
stronger biological claim. The two rows that deviate deviate on purpose and are the ones
to argue with if you disagree: cerebellar abiotrophy really does show within weeks, and
DSLD really is a middle-aged horse's problem. Everything here is data in a seed migration,
so retuning costs a migration and no code.

**Mechanically:**

- New column `horse_conditions.signs_game_day`, **snapshotted at write time** per CLAUDE.md
  §5.5, drawn once from a sub-seed off the horse's own `rng_seed` per §5.2 — never
  `Math.random()`, and reproducible.
- Measured from **when the `horse_conditions` row is written**, not from `born_game_day`.
  That is birth for a foal and arrival for founding, consignment and NPC-minted stock —
  literally "after the horse is created", your words, and one rule instead of two. Founding
  stock is backdated to age 4, so measuring from birth would put every delay in the past
  and change nothing.
- New tick stage, `noticeDueConditionSigns`, sitting beside `killDueLethalFoals`
  (`src/db/tick.ts:106`). It writes the `condition_signs` event for rows whose
  `signs_game_day <= game_day`. Idempotency marker is a `signs_noticed_game_day` column,
  NULL until written — the same shape `last_evaluated_game_day` already uses, so a missed
  or double-fired tick is safe (§5.4).
- `visibleAffectedConditions` gains the horse's `horse_conditions` rows and the current
  `game_day`, and returns nothing whose signs are not yet due. This is what the barn badge
  and the owner's "observed, no test needed" health status both read.
- **`isBarredFromShowing` follows the signs, not the genotype.** A HERDA horse is barred
  from the day its signs appear. Anything else means a horse is barred for a reason its
  owner cannot see, which is the one outcome the truth-vs-knowledge split exists to
  prevent. Minimum breeding age is 1080 game days, so no delay in the table above lets an
  affected horse reach a show before its signs land.
- **The genotype test still returns the truth immediately.** Paying for a test is exactly
  the action allowed to look ahead (slice 0010 §2.4), and that is now worth real money
  rather than confirming what the page already said. This change makes testing *more*
  valuable, which is the point of the whole panel.

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
5. Costs nothing and catches the expensive mistake: **`breed_associations` must name
   exactly the breeds whose pool carries the mutant at nonzero frequency.** The column
   stays display-only, but this is what stops the words under a condition and the panel it
   actually appears on from ever disagreeing — the LWO trap, made unrepeatable.
6. Signs delay — a condition with `signs_visible = 1` and a nonzero delay is invisible to
   `visibleAffectedConditions` on the day the horse is created and visible after the delay;
   a zero-delay one is visible immediately. Same test covers both rows of the table.
7. The delay is reproducible: the same `rng_seed` and the same condition produce the same
   `signs_game_day` twice (CLAUDE.md §5.2's actual promise, not just an absence of
   `Math.random()`).
