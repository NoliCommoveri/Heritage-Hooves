# Amendment 0017a — Colour testing, and the consignment dealer (Part E)

**This is an amendment to `docs/slices/0017-market.md`, not a replacement for any part of it.**
It adds two things that document does not describe. Read 0017 first; this assumes it.

It was written while **another session was building Part B** (0017 §11, NPC stables selling their
own surplus). Nothing here is Part B, nothing here changes Part B, and §2 below is a deliberate list
of the places the two touch. If you are that session, you do not need this document.

---

## 1. What this adds

**Part 1 — colour testing (genetics, not market).** A player can pay to test a horse's colour loci,
the way they already pay to test its disease loci. A horse page and a breeding preview then say
what colours a pairing could produce, computed only from what the player actually knows.

**Part 2 — the consignment dealer (Part E).** Every 90 game days a dealer offers one or two outside
horses on the open market. They are generated the way founding stock is generated, they are removed
if nobody buys them, and — the point of the whole thing — **the operator can queue an allele or two
from `/admin` to be seeded into the next batch**, so a colour that does not exist in the players'
gene pool can be got into it deliberately.

**Part 3 — breeds in play (§6).** An admin screen that turns a breed on or off, and the decision
about what that actually means. `breeds.enabled` has existed since `0010_breeds.sql` and **nothing
has ever read it**; this is where it starts mattering.

**Part 1 must land first.** An injected allele nobody can test for is invisible, and a tested
carrier is the dealer's entire value proposition. Building Part 2 first produces a feature that
looks like it does nothing.

Part 3 is independent of both and can land in any order, though the dealer's breed list (§5.8) reads
it, so a dealer built first should be checked against §6 afterwards.

**Naming.** 0017 already spends A, B, C and D. This is **Part E**. It is not "Part B1" and the
consignment dealer is not a variety of NPC stable selling surplus — see §5.1.

---

## 2. The seam with the in-flight Part B

Both changes touch the same five places. None of them is a conflict if both sessions know:

- **`listings` needs no schema change from either side.** 0017 §5.2 already says an NPC listing is
  this same row with an `is_npc` stable in `seller_stable_id`. The dealer is one more such stable.
- **The buy path (§7) is untouched by both.** There is one sale path. Neither of us adds a second.
- **`appraise()` is untouched by this amendment.** Part B multiplies its result by a personality
  multiplier; Part E multiplies it by a dealer multiplier (§5.6). Neither adds a term *inside* the
  engine, so both can land in either order.
- **The tick.** Part B adds an NPC-listing stage; Part E adds a consignment stage. Both go inside
  the `paused === 0` branch, both before `expireListings`. Adjacent, not overlapping.
- **Writing `horse_knowledge` for an NPC seller.** Part B's recommendation (0017 §11) is that an
  NPC stable pays for a full disease panel when it lists. Part E writes knowledge rows too, on a
  different rule (§5.6). **If Part B builds a shared helper for "test this horse on behalf of this
  stable", Part E should reuse it rather than write a second one.** Check for it before writing.
- **Migration numbers.** Claim them at build time by reading `migrations/` (build log, 3 Aug 2026).
  Expect the Part B session to have taken some. No number in this document is real.

---

## 3. Decided in this session

Settled with the operator in conversation. Treat as standing.

1. **The dealer cycle is 90 game days, and a listing stands for 90 game days.** 0017 §5.4 calls 90
   game days "three real days." The first proposal was 30, which is about **one real day** — one to
   two new horses every real day into a five-account game, with unclaimed ones gone before a child
   who was at school could see them. At 90/90 a batch is claimable for the entire gap and nobody has
   to be lucky.
2. **Colour only. Mid conformation.** Dealer horses are generated at the **`mid` quality band**,
   exactly like founding stock (0005 §4). The slant touches colour and gait loci and never the
   polygenic draw. A dealer horse must never be a shortcut past breeding for conformation — it is a
   source of alleles you do not have, which is the same sentence 0005 §4 uses about token imports.
3. **Rarity is injected, not sampled.** An earlier draft generated several candidates per slot and
   picked the rarest-coloured by weighted draw. The operator replaced it with a queued allele
   injection set from admin. This is strictly better and the resampling machinery is **not built** —
   see §5.4 for why.
4. **When the operator injects an allele, the dealer pre-tests that locus.** Not optional. §5.4.
5. **The dealer stocks Quarter Horses only, for now.** ~~`consignment_breed_codes = ["QH"]`. It is
   the only breed with a seeded `ideal_vector`, and under 0017 §4.4 anything else would be priced off
   age and health alone — systematically wrong, in a direction a child could learn to exploit. This
   is a config key, not a constant: the day the drafted vectors in `docs/breed-ideal-vectors.md` are
   seeded, widening it is one edit at `/admin/config` with no deploy.~~ **Superseded 2026-08-04**:
   all eight breeds now have a seeded `ideal_vector` (migration `0107`), so the pricing objection no
   longer applies to any of them. Rather than editing the allowlist, it was removed — the dealer now
   mints from `getBreedsInPlay` directly, the same `breeds.enabled` switch §6 below wires everywhere
   else, so there is one control instead of two that can drift apart (as this one did).
6. **A breed can be taken in and out of play from admin, and that gates supply only.** §6.
7. **Colour carries value in `appraise()`, game-wide.** Not a dealer-only premium. A cremello is
   worth more whoever is selling it, including a child. §4.7 splits this into what anyone can see
   and what only a test reveals — which makes testing a horse *raise its appraised value*, the same
   loop the tested-clear health premium already runs.
8. **A colour test costs the same as a health test.** Reuse `genotype_test_cost` and
   `genotype_panel_cost`; add no new keys. §4.6.

---

## 4. Part 1 — colour testing

### 4.1 Storage: no new table, and no change to `horse_knowledge`

`migrations/0055_horse_knowledge.sql` already anticipates this. Its own comment on `subject_code`
reads *"the condition code today. A locus code, when colour testing arrives."*

- `kind = 'genotype'`, as for a disease test.
- `subject_code = 'locus:CR'` — **namespaced with a `locus:` prefix.** Condition codes (`HYPP`,
  `PSSM1`) and locus codes (`E`, `A`, `CR`, `G`, `DMRT3`) do not collide today, and a bare `E` would
  work. Namespace them anyway: the two families are read by different code paths and rendered
  differently, and the day somebody adds a condition whose code is a letter is not a day anyone
  wants to debug. Every reader must therefore filter on the prefix rather than assuming every
  `genotype` row is a disease result — **check `src/db/health.ts` for existing readers that assume
  this** (`getKnownCodes` and the map built around line 226 both do).
- `result` = the pair as stored, e.g. `Cr/cr`, in `LOCI` canonical order via `sortAllelePair`.
- `expires_game_day = NULL`. A genotype test is permanent (CLAUDE.md §12).
- `cost_paid` at the price charged, per that table's own comment.

The unique index `(stable_id, horse_id, subject_code)` already makes a result unbuyable twice.
**Sale already copies every knowledge row to the buyer** (`src/db/listings.ts`, the
`INSERT OR IGNORE ... SELECT` in the sale batch) and does not filter by subject, so colour knowledge
travels with the horse for free. Nothing to build.

### 4.2 The engine: what looking at a horse already tells you

New pure function, `src/engines/genetics/inference.ts`:

```ts
/** What the visible horse constrains its genotype to, before anyone has paid for anything.
 *  Takes a Phenotype, returns the set of allele pairs still possible at each locus. */
export function inferFromPhenotype(phenotype: Phenotype): Record<string, AllelePair[]>;
```

This is the part that makes the test worth buying on some horses and worthless on others, and
working out which is which is the genetics lesson. Derived from `expression.ts`'s own rules:

| The horse looks | Free, from looking | What the test actually buys |
|---|---|---|
| Chestnut | `e/e` certain; cream dose 0 so `cr/cr` certain | **Agouti, entirely.** `baseColourOf` returns chestnut without consulting A at all — a chestnut carries any A genotype and looks identical. This is the textbook epistasis case and the single best thing the test sells. |
| Bay | `E/_`, `A/_`, `cr/cr` | Whether E and A are homozygous — that is, whether it can throw a chestnut foal or a black one |
| Black | `a/a` certain, `E/_` | E zygosity, **and cream** — see §4.3 |
| Grey, any stage | `G/_`; the base underneath is masked further with age | G zygosity — a `G/G` greys *every* foal it ever produces — plus whatever the grey is hiding |
| Not gaited | `C/_` | A hidden `A` gait carrier. `expression.ts` reads gaited as `A/A` only, so heterozygotes are invisible |

Knowledge then narrows inference: a tested locus collapses to one pair, an untested one keeps the
set. Everything downstream reads the narrowed set, never `horses.genotype`.

**Note for whoever builds it:** check whether a grey horse's `bornColour` is currently rendered to
its owner. If it is, greys leak their base colour for free and the grey test is worth less than the
table above suggests. That is a display decision, not an engine one, and it should be made
deliberately rather than discovered.

### 4.3 The smoky black rule — one display change

`CREAM_TABLE` in `expression.ts` names black + one cream `'smoky black'`, with a comment saying it
*"looks almost identical to plain black."* The engine is right and the comment is right, but the
string currently reaches the player, which hands them the cream test's answer for nothing.

**Keep `'smoky black'` in the engine as truth. Render it as "black" to the player until that horse's
owner has tested `CR`.** A render-layer mapping, no engine change.

Three reasons, and the third is the one that matters:

1. It is why cream testing exists in real life. Smoky black is the classic indistinguishable-by-eye
   dilute; breeders test for it precisely because they cannot see it.
2. It is exactly the truth-vs-knowledge rule CLAUDE.md §12 calls load-bearing — the horse *is* a
   smoky black, and the player has not paid to know.
3. It creates the best surprise available in five loci: a "black" mare bred to a chestnut stallion
   throws a palomino. A child who then goes and buys a cream test has learned what a hidden dilute
   is by wanting to know, which is worth more than any amount of explanation.

Audit every place `dilutedColour`, `visibleColour` and `bornColour` reach a template before
changing this. The mapping belongs in one helper in `src/render/`, called from all of them.

### 4.4 Foal colour possibilities

New pure function, `src/engines/genetics/foal-colours.ts`:

```ts
/** Every colour a pairing could produce, with probabilities, from what is KNOWN about each parent.
 *  Loci where either parent is untested come back as `uncertain`, never silently resolved. */
export function foalColourPossibilities(input: {
  sire: Record<string, AllelePair[]>;   // narrowed possibilities, not the genotype
  dam: Record<string, AllelePair[]>;
  gameDaysPerYear: number;
}): {
  certain: { colour: string; probability: number }[];
  uncertain: { locusCode: string; unlockedColours: string[]; untestedParents: ('sire'|'dam')[] }[];
};
```

It runs the existing expression rules over every combination of possible parental contributions —
no second colour model, the same reason 0017 §4.1 reuses `scoreEntry`.

**The rule that governs the whole feature: it reads knowledge and inference, never
`horses.genotype`.** Where a locus is untested on either parent, it does not quietly use the truth.
It says so:

> **Foals from this pairing:** about half bay, about half black.
>
> *Neither parent has been tested for cream. If either one carries it, palomino or buckskin foals
> are possible — a cream test on the mare would tell you.*

The second paragraph is the feature. It is honest, it teaches what a hidden recessive is, and it is
the advertisement for the test: the child finds out testing is worth money by wanting the answer to
a question the game has just put in front of them. A version that computed the real answer from the
genotype would be a better oracle and a worse game, and it would break §12.

### 4.5 Screens

1. **The breeding preview**, beside the health line slice 0010 put there. Both parents' known loci,
   the distribution, and the untested sentence.
2. **A horse's own page** — the simplest form: what this horse can pass on, per locus, with
   "untested" shown as loudly as a result (0017 §2.3's rule, and for the same reason).
3. **A listing page** — which arrives free from 0017 §2.3, since a listing renders every knowledge
   row the seller holds. It needs the renderer taught to lay out `locus:` rows next to condition
   rows. **This is what makes a dealer carrier legible**: *"this stallion carries cream — bred to a
   chestnut mare, about half his foals would be palomino."*
4. **The test page** from slice 0010, extended. It already offers only what is missing; colour loci
   join that list. Offer the five individually and as one discounted panel, mirroring the disease
   panel.

### 4.6 What the test costs — no new config keys

`genotype_test_cost` and `genotype_panel_cost` already exist (`src/lib/config-cache.ts`, slice 0010
§5.4) and are already on the admin config form's allow-list. **Reuse them. Add nothing.**

The existing key is named `genotype_test_cost`, not `disease_test_cost`, and
`horse_knowledge.kind = 'genotype'` already covers both subjects. The test page at
`src/routes/horses.ts` prices per-code off that key, so colour loci join the list of testable
subjects and are priced by the code path that already exists. This is most of why Part 1 is smaller
than it looks: the purchase flow is built, and colour is a new kind of *subject* rather than a new
kind of *transaction*.

**Two panels, not one, each at `genotype_panel_cost`** — "the disease panel" and "the colour panel."
Folding colour into the existing panel would silently double what that button buys for the same
money, and `routes/horses.ts` already sets `totalCost = genotype_panel_cost` for the disease path.
Same price for the same amount of work is what "the same as health testing" means.

### 4.7 Colour in `appraise()` — and the one new thing it must never read

Colour carries value game-wide (§3.7), so this is a term inside `src/engines/market/appraise.ts`,
not a dealer multiplier. It multiplies in alongside `healthFactor`:

```
colourFactor = visibleColourFactor × carriedAlleleFactor
```

**The split is the design.** Colour differs from health in one way that matters: some of it is free
to look at.

- **`visibleColourFactor`** — keyed on the horse's expressed colour, from `expression.ts`. Needs no
  test and no knowledge check: a cremello is visibly a cremello, and a stranger at a show can see it
  (slice 0016 §2.2's rule). A config table maps expressed colour to a multiplier.
- **`carriedAlleleFactor`** — `1 + market_carried_allele_premium × n`, capped, where `n` counts
  alleles the horse carries that **a test has revealed and looking could not**. Reuse
  `inferFromPhenotype` (§4.2) for exactly this: an allele inference alone already establishes is not
  paid for twice. A palomino is visibly `Cr/cr` and earns nothing extra for a cream test; a bay that
  tests `Cr/cr` is a genuine discovery and earns the premium.

That second bullet is the good loop: **paying for a test raises what the horse is appraised at**,
so the child who does the genetics work is rewarded by the market for it — the same shape as the
tested-clear health premium in 0017 §4.3, and it is what makes a tested carrier the most interesting
object on the market.

**A new entry for 0017 §4.2's "must never read" list, and it belongs beside the lifespan rule:**

> **`appraise()` must not read `horses.genotype` for the colour term.** It takes expressed phenotype
> and knowledge rows, exactly as it already takes knowledge rows for health. Reading the genotype
> would price in a hidden allele nobody has paid to learn — a seller could read a cream carrier off
> their own guide value without ever buying the test, which breaks CLAUDE.md §12 and empties the
> testing economy in one line of code.

Config, all live:

| Key | Suggested | Notes |
|---|---|---|
| `market_visible_colour_factors` | JSON, expressed colour → multiplier | Keep the whole range modest — see the risk in §8. |
| `market_carried_allele_premium` | `0.10` | Per tested-and-not-visible allele. |
| `market_carried_allele_cap` | `1.5` | Ceiling on `carriedAlleleFactor`. |

The `factors` array in `Appraisal` (0017 §4.5) gains its lines here too — *"Colour: palomino"*,
*"Carries cream (tested)"* — because that array is what makes the guide teach rather than assert.

### 4.8 Tests

- `inferFromPhenotype` — one case per row of §4.2's table, including a chestnut returning all three
  agouti pairs and a grey returning every base colour.
- A tested locus collapses the set; an untested one does not.
- `foalColourPossibilities` — chestnut × chestnut is 100% chestnut; a known `Cr/cr` × `cr/cr` is
  half diluted; probabilities sum to 1.
- **The one that matters:** a pairing where the truth would give a clean answer but neither parent
  is tested must return `uncertain`, not the truth. Assert against a horse whose stored genotype is
  known to the test and must not appear in the output.
- Sale copies `locus:` rows to the buyer (guards against a future `WHERE subject_code IN (...)`).
- **`appraise()` never prices an untested allele.** Two horses with identical genotypes, one tested
  and one not, must appraise differently — and the untested one must appraise as though the allele
  were not there. This is the assertion that catches a future session "improving" the colour term by
  reading `horses.genotype`.
- A palomino does not earn the carried premium for a cream test (no double counting, §4.7).

---

## 5. Part 2 (Part E) — the consignment dealer

### 5.1 Why this is not Part B

Part B recycles horses that already exist and moves money **into** NPC hands, which is what funds
Part C. Part E mints new horses from outside and takes money **out** of the game. Opposite
economic signs, different failure modes, and a different reason to exist: Part B stops the market
being empty; Part E is the only mechanism in the game that can introduce an allele nobody owns.

They are complementary and neither substitutes for the other.

### 5.2 The dealer stable

One new `stables` row, `is_npc = 1`, `account_id NULL`, prefix locked into
`stable_prefix_history` in the same migration — the pattern `0085_npc_stables_and_policies.sql`
already establishes for Cedar Hollow.

- **No `npc_policy` row.** That is what keeps `runNpcBreedingDecisions` and anything Part B adds
  from ever touching it. The dealer does not breed, show, or buy.
- **Upkeep is already free** for NPC stables (`0086_npc_stables_no_upkeep.sql`).
- **Its balance is a fiction and must be documented as one**, in the migration comment. It is not
  an economic actor and topping it up means nothing. This differs from Part B's NPC stables, whose
  balances are real and matter for Part C, and a session that later tries to unify them should read
  this paragraph first.
- **Consigned horses carry an origin prefix from `generateFoundingName`, not the dealer's prefix.**
  They were bred elsewhere; the dealer is a middleman. This also makes them pedigree-identical to
  claimed founding stock, which is what they are.
- Capacity must exceed the largest possible standing consignment. Set it generously; nothing
  charges for it.

### 5.3 Mint on listing, remove on expiry

**Mint the real horse when the listing is created.** The alternative — holding an unminted candidate
row and minting on purchase — needs a second sale path, which 0017 §5.2 and §11 both forbid. A real
`horses` row means `/market/:id` renders a real horse with a real image and real expressed traits,
`appraise()` runs unchanged, and §7's buy batch is untouched.

Reuse `buildFoundingHorseInsertStatements` (`src/db/founding.ts`). It already sets care timers,
lifespan, oestrous cycle and a `careStartAgeGameDays` that stops a 6-year-old arriving fully
overdue — every one of which a hand-rolled insert would get wrong.

**Unclaimed stock is set to `horses.status = 'removed'`, not deleted.** `0012_horses.sql`'s status
enum already has the value. Three reasons: the listing row references the horse by foreign key,
events reference it by name, and nothing in this codebase hard-deletes a horse. Better still,
0017 §8's `expireListings` **already** closes any listing whose horse is `status <> 'alive'`, so
setting the status is the entire operation and the existing sweep finishes it on the same tick.
Idempotency comes from the `status = 'alive'` guard, exactly as `killDueLethalFoals` gets it.

**One guard that must not be forgotten:** only sweep horses whose dealer listing is still `open`. A
sold horse belongs to a child and must never be removed. Write it as a `WHERE` clause, per 0017 §7.3.

Age: reuse `founding_age_min/max_game_days` (4–8 game years). A dealer horse must be breedable on
arrival for the same reason a founding horse must be.

### 5.4 The injection queue — the point of the feature

Not config. A queued instruction that is consumed once and leaves a record:

```sql
-- Amendment 0017a §5.4. An allele the operator wants seeded into the next consignment batch.
-- Consumed by the tick, one row per injection, kept afterwards as the record of what was
-- deliberately introduced to the gene pool and when.
CREATE TABLE consignment_injections (
  id INTEGER PRIMARY KEY,
  locus_code TEXT NOT NULL,          -- must be a code in LOCI
  allele TEXT NOT NULL,              -- must be an allele that locus defines
  zygosity TEXT NOT NULL CHECK (zygosity IN ('het', 'hom')),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('one', 'all')),
  sex_preference TEXT NOT NULL CHECK (sex_preference IN ('any', 'stallion', 'mare')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'applied', 'cancelled')),
  queued_game_day INTEGER NOT NULL,
  applied_game_day INTEGER,
  applied_horse_id INTEGER REFERENCES horses (id),
  note TEXT,
  created_real_ts INTEGER NOT NULL
);
```

**How it applies.** `generateCandidate` runs unchanged against the breed's real pool; a pure
function then overwrites one allele at the named locus and re-sorts with `sortAllelePair`. Keep it
in `src/engines/founding/` beside the generator, not in the tick.

Three defaults, each with a reason:

- **Heterozygous.** One copy is "enough to breed the rarest" — the child still has to find the
  second one themselves, which is the entire play value. `hom` stays available for when an allele
  needs to spread fast.
- **Prefer the stallion.** One stallion covers many mares, so a carrier colt seeds a five-account
  gene pool an order of magnitude faster than a carrier filly.
- **Colour and gait loci only** (`E`, `A`, `CR`, `G`, `DMRT3`). Not the disease loci. Deliberately
  seeding HYPP into a family's gene pool is a conversation to have on purpose, not an option to
  find in a dropdown.

**Injection deliberately breaks breed purity.** A `Cr` in a Friesian contradicts that breed's fixed
`cr/cr` pool (0005 §5.3). That is the mechanism working, not a bug — it is the outcross faucet — but
it should be recorded rather than silent, which is what `note` and the retained history are for.

**When an allele is injected, the dealer always pre-tests that locus** and writes the
`horse_knowledge` row for itself. Non-negotiable. Without it a `Cr`-carrying bay looks like a plain
bay, nobody knows, nobody pays for it, and the operator's deliberate act does nothing visible. 0017
§2.3 then renders it on the listing for free.

**When the queue is empty the dealer generates straight from the breed pool, with no slant at all.**
No fallback rarity weighting, no "make it interesting" nudge. The operator has the control; the
game should not quietly exercise it for them.

### 5.5 `/admin/consignment`

Following CLAUDE.md §13 — a form, not a polished UI.

- The next cycle's game day, and what is currently standing on the market.
- The queue, with a cancel link per row.
- A form: locus dropdown built from `LOCI`, allele dropdown from that locus's own allele list
  (never free text — a typo becomes a horse), zygosity, applies-to, sex preference, note.
- **The injection history.** Every allele ever introduced, with the date and the horse. This is the
  single most useful screen for the risk in §7, because it is the only place the operator can see
  the gene pool they have been building.

### 5.6 Pricing

**The dealer needs no carrier premium of its own.** An earlier draft gave it one; §3.7 made colour a
term inside `appraise()` instead, which prices an injected-and-tested allele correctly for everyone
— the dealer, and the child who later sells the colt on. One multiplier is left:

```
price = appraise(...).value × consignment_price_multiplier
```

This is a better outcome than the draft it replaces. A dealer-only premium would have meant a
carrier was worth more from the dealer than from a player, which is backwards — the whole purpose of
the injection is that the allele becomes valuable *in the players' hands*.

`listings.guide_value` stores the honest appraisal and `listings.price` stores the ask, so a dealer
asking over the odds for a cream carrier is visible as exactly the gap that column pair was built to
show.

**Disease tests: the dealer performs them, and does not pay for them.** Rows are written with a real
`cost_paid` at the going price so the receipt and the tested-clear premium are honest, but no ledger
row and no balance movement, because §5.2 says the balance is a fiction. **This differs from Part
B's recommendation on purpose** — Part B's NPC balances are real. Say so in a comment or a later
session will unify them and break Part C's economy.

**The tests report the truth, whatever it is.** Never pre-test only horses that come back clear. If
"pre-tested" quietly means "clean," the testing economy dies and the most interesting object in the
market — a tested carrier at an honest discount — never appears. `market_carrier_factor` (0.8) and
`market_affected_factor` (0.4) already price it correctly.

How many disease tests: a seeded draw off `consignment_test_count_weights` — most often none,
sometimes two or three, rarely the full panel.

### 5.7 The tick stage

`runConsignments(env, gameDay, ...)`, inside the `paused === 0` branch, immediately **before**
`expireListings`.

**Idempotency with no new column.** Run only when

```
gameDay >= (SELECT MAX(listed_game_day) FROM listings WHERE seller_stable_id = <dealer>) + cadence
```

A re-fired tick finds the condition already false, because the first run moved the maximum. This is
the same shape as the `status = 'open'` guard in 0017 §8 and needs no `last_processed` marker
(CLAUDE.md §5.4).

Two steps per run, in this order: sweep expired dealer listings' horses to `removed`, then mint the
new batch. Batch seed derived deterministically from the world seed and `game_day`; each candidate
takes a sub-seed derived from that (CLAUDE.md §5.2 — no independent generators, no `Math.random()`).

**One `events` row per account when a batch lands.** A 90-game-day window is three real days, which
is long enough for a batch to come and go unnoticed if nothing announces it. Check how slice 0009's
feed scopes events — per account or per stable — before writing it.

### 5.8 Config

| Key | Suggested | Notes |
|---|---|---|
| `consignment_cadence_game_days` | `90` | Live. §3.1. |
| `consignment_listing_game_days` | `90` | **Snapshotted** onto `expires_game_day` (CLAUDE.md §5.5). Retuning it must never move a standing listing's expiry. |
| `consignment_batch_min` / `_max` | `1` / `2` | Live. |
| `consignment_test_count_weights` | `{"0":55,"2":25,"3":13,"5":7}` | Live. Disease panel size, per horse. |
| `consignment_price_multiplier` | `1.15` | Live. The dealer's whole markup — an injected allele is priced by `appraise()` (§4.7), not here. |
| ~~`consignment_breed_codes`~~ | ~~`["QH"]`~~ | **Removed 2026-08-04** (migration `0109`). The dealer reads `getBreedsInPlay` (§6) directly now instead of intersecting with a second allowlist — see point 5 in §3 above. |
| `consignment_age_min/max_game_days` | reuse founding | Live. |

Every number is a guess, for the same reason 0017 §5.4 says so about its own table.

### 5.9 Tests

- The tick stage is idempotent: run it twice at the same `game_day`, get one batch.
- An injected `Cr` appears in the minted horse's genotype, in canonical order, and the injection row
  moves to `applied` with `applied_horse_id` set.
- An injected allele always produces a `locus:` knowledge row for the dealer.
- An unclaimed listing's horse goes to `removed` and the listing to `expired` on the same tick.
- **A sold dealer horse is never removed**, at any age of the listing.
- A world that is paused mints nothing.

---

## 6. Part 3 — breeds in play

### 6.1 The column exists and is dead

`breeds.enabled` was added in `0010_breeds.sql` with `DEFAULT 1`, and `0005` §5.3 instructs the seed
migration to set it on every new breed. **Nothing has ever read it.** `getBreeds` in
`src/db/breeds.ts` is `SELECT * FROM breeds ORDER BY id ASC` with no filter, and none of its
callers — `shows.ts`, `npc.ts`, `npcBreeding.ts`, `routes/shows.ts`, `routes/admin.ts` — filters
either.

So this is not "put a form over an existing switch." The switch is not wired to anything, and the
work is deciding what it should be wired to. **Do that before writing the screen**, because a
half-wired `enabled` is worse than a dead one: an operator who ticks a box and sees some of the game
respond will reasonably assume all of it did.

### 6.2 What `enabled = 0` means, exactly

**It gates the introduction of new horses of that breed, and nothing else. It never touches a horse,
class, pedigree or listing that already exists.**

That sentence is the whole design and it should be a comment on the migration that first reads the
column. A breed code is written permanently into every horse's `composition` blob at birth
(CLAUDE.md §11), so a breed cannot be undone — only closed to new arrivals.

**Gated by `enabled = 0` (no new horses of this breed enter the world):**

- Founding-stock offers — `chooseBreedForOffer` must not offer it, and `mintOffer` must not pick it.
- The consignment dealer (§5) — reads `getBreedsInPlay` directly since 2026-08-04; ~~intersected with `consignment_breed_codes`~~ (that allowlist is gone, see §5.8's table).
- The admin "create a horse" form at `/admin/horses/new`.
- New breed show classes. Existing classes stand — see below.
- New `npc_policy.target_breed_id` assignments.

**Explicitly NOT gated — this is the important half:**

- **Existing horses of that breed live, age, train, show, sell and die exactly as before.** Nothing
  hides them, nothing devalues them.
- **Two existing horses of a disabled breed can still breed, and their foal is still that breed.**
  Disabling a breed must never sterilise a child's herd. "New horses" above means new *introductions
  from outside* — founding offers, consignments, admin creation — never foals from stock somebody
  already owns. Get this wrong and disabling a breed silently ends a family's breeding programme.
- **Standing show classes, entered horses and unresolved entries.** A disabled breed's class runs to
  completion; only the creation of the *next* one is gated.
- **`getBreedById`, and every render path that turns a `breed_id` into a name.** A disabled breed's
  name must still display everywhere, forever.

Read as a whole, `enabled` is an **admission gate on supply**, not a statement about whether the
breed exists. The column name is weaker than the meaning; the meaning is what the comment must say.

### 6.3 The screen — `/admin/breeds`

`src/routes/admin.ts` already imports `updateBreedImageCounts`, so there is an admin breeds surface
to extend rather than a new one to invent. Per CLAUDE.md §13, a form and a table, not a UI.

One row per breed, and **the columns should say why a breed is or is not ready, not just carry a
checkbox** — this screen's real job is answering "which of these can I safely turn on?":

| Column | Why it is there |
|---|---|
| Code, name | — |
| **In play** | The toggle. |
| **Ideal vector?** | No vector means no breed show class, and an appraisal that skips the quality term entirely (0017 §4.4). The single best predictor of whether a breed is ready. |
| **Allele pool?** | Every locus present, per 0005 §3.2. A breed missing a locus **throws** at generation — see the warning below. |
| **Images?** | `image_count` — zero means every horse of this breed has no picture to pick. |
| **Horses alive** | What turning it off would, and would not, affect. Makes §6.2's rule concrete at the moment the operator is deciding. |

Two guards:

- **At least one breed must stay in play.** A game with none has no founding offers and no
  consignments, and the failure is silent. Refuse the last one, with a sentence saying why.
- **Turning a breed on whose pool is missing a locus must be refused, not warned about.** 0005 §3.2
  is explicit that a missing locus is an error rather than a default, and `pool.ts` throws with the
  locus named. That throw would surface as a broken founding offer or a dead tick stage, neither of
  which the operator can debug. Validate the pool against `LOCI` at the moment of enabling and say
  which locus is missing.

The screen should also carry one plain-English paragraph of §6.2 — what turning a breed off does and
does not do — because it is exactly the kind of thing an operator reasonably assumes the wrong way
round, and the consequence lands on a child's horses.

### 6.4 Auditing the change

Taking a breed in or out of play is a human decision that changes what the world produces, and it
should leave a record for the same reason config changes do (CLAUDE.md §7's append-only list).

Check `config_audit`'s columns at build time. If its shape is a generic key/old/new/who/when, reuse
it with a key like `breed:QH:enabled` and note the reuse in the build log. If it is tied to the
`config` row specifically, add a small append-only table rather than bending it. **Do not leave the
change unrecorded** — six months on, "when did the Friesian stop appearing in offers?" is a question
somebody will ask.

### 6.5 Tests

- A disabled breed does not appear in a founding offer's breed choice, and `mintOffer` never picks it.
- A disabled breed is never stocked by the dealer (checked directly against `breeds.enabled` since 2026-08-04, when the separate `consignment_breed_codes` allowlist was removed).
- **A foal bred from two existing horses of a disabled breed is born normally and is that breed.**
- An existing horse of a disabled breed still renders its breed name, still shows, still sells.
- Disabling the last enabled breed is refused.
- Enabling a breed whose pool is missing a locus is refused, naming the locus.

---

## 7. Decide before building

**Nothing is outstanding.** Every question this amendment raised has been answered by the operator
and moved into §3: the dealer's breeds (§3.5), colour in `appraise()` (§3.7), and the test price
(§3.8). A building session should not need to stop.

What it *should* stop for, per CLAUDE.md §2, is anything below that turns out to be wrong in
practice — in particular the numbers in §4.7's colour table, which are the least-informed guesses in
this document and are the direct cause of the risk in §8.

---

## 8. Risks

- **The gene pool is a one-way ratchet.** Every injection is permanent; alleles do not leave a
  closed population of five stables except by chance. Two `Cr` injections a year for three years and
  cream is no longer rare, at which point the premium is a lie and the dealer has nothing left to
  offer. This is the same shape as the NPC quality ceiling in CLAUDE.md — invisible while building,
  fatal later — and §5.5's injection history is the only instrument that shows it. **Look at that
  screen before queueing anything.**
- **Supply faucet.** Unlike Part B, nothing is recycled: every consignment is a new horse from
  nowhere, inflating both the population and the allele pool. `consignment_cadence_game_days` is the
  only brake and should be obvious in `/admin/config`.
- **The children stop breeding.** If dealer stock is reliably better than what they can produce, the
  game becomes shopping. This is exactly what §3.2's mid-band rule is defending, and it is worth
  re-checking after a month of play rather than assuming the rule held.
- **Money leaves the game.** Payments to the dealer vanish, which is a healthy sink, but
  `ledger.counterparty_stable_id` will point at a stable whose balance means nothing. Say so in the
  migration comment.
- **Colour could out-compete conformation, and this is the serious one.** Now that colour is a term
  in `appraise()`, breeding for colour and breeding for quality are two routes to the same money —
  and colour is *far* easier. Five loci with published inheritance rules will be solved by a
  determined ten-year-old in a fortnight; a polygenic conformation score across twenty alleles per
  trait will not. If a cremello is worth double a bay, the rational play is to stop showing and
  start breeding paint-by-numbers, and the shows quietly become decoration.

  The defence is proportion, and it is a number rather than a rule: **keep the whole range of
  `market_visible_colour_factors` small next to `market_quality_weight`.** That weight is `4.0`,
  meaning a conformation score of 100 is worth five times base — so a colour range of roughly
  0.9–1.4 leaves colour as a real bonus that never beats a good horse. Setting a rare colour to 3×
  would invert the game's whole incentive structure in one config edit, from a screen with no
  warning on it. **Put that sentence next to the field on `/admin/config`.**

  This is the same class of failure as the NPC quality ceiling in CLAUDE.md — invisible while
  building, and by the time it is visible the herd has already been bred for the wrong thing.
- **Colour testing and health testing now share a price and a page.** They will be read against each
  other, and the cheaper-feeling one will be bought first. Worth watching which.
- **A half-wired `enabled`.** §6.2 lists five things the flag gates and four it must not. If a
  future session adds a sixth place that creates horses and forgets the check, breeds drift back
  into play silently. The check belongs in as few places as possible — prefer one
  `getBreedsInPlay()` helper in `src/db/breeds.ts` that every creation path calls, over five
  scattered `WHERE enabled = 1` clauses.

---

## 9. Documents to correct when this is built

- **`CLAUDE.md` §10** — a row for colour testing, a row for the consignment dealer, and a row for
  breeds in play. **Edit only your own rows**; the Part B session is rewriting the Market row.
- **`docs/build-log.md`** — the `locus:` namespacing convention on `horse_knowledge.subject_code`;
  the smoky-black display rule and where the mapping helper lives; `consignment_injections` as a
  queued-instruction table rather than config; the dealer stable's fictional balance, which is the
  thing a future session is most likely to unify away; and **what `breeds.enabled` gates and what
  it deliberately does not** (§6.2), which is the entry a future session most needs and cannot
  infer from the column name.
- **`docs/horse-game-schema.md`** — record `horse_knowledge` carrying locus rows, which its own
  comment predicted.
- **`docs/slices/0017-market.md` §4.2** — the "must never read" list gains the genotype rule from
  §4.7, and §4.3's factor list gains `colourFactor`. That document currently describes an
  `appraise()` with no colour term, and will be wrong the moment this lands.
- **`docs/slices/0017-market.md` §19** — the pointer to this document.
- **`docs/slices/0005-founding-stock.md`** — a note that `generateCandidate` now has a second
  caller, so a change to it affects the dealer as well as founding batches; and that the breed
  choice at `chooseBreedForOffer` is now filtered by §6.
- **`docs/horse-game-overview.md` §4a** — record that all eight breeds remain specified but that
  admission to play is now an operator control, and that the dealer stocks Quarter Horses only until
  the remaining ideal vectors are seeded.
