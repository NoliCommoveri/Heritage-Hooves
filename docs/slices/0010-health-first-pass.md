# Slice 0010 — Health, first pass: the Quarter Horse's panel, and paying to find out

**Read `CLAUDE.md` completely first. Then read this document. Do not read the full design documents unless a section below tells you to.**

The sections you *are* asked to read, because this slice depends on them and paraphrasing them here would lose the reasoning:

- `docs/horse-game-overview.md` **§2c** (genotype vs phenotype as a mechanic), **§3** through **§3f** (the whole health section). §3b in particular — it carries two decisions taken in conversation about the lethals, and this slice takes the two it left open.
- `docs/horse-game-schema.md` **§3.3** (`conditions`), **§4.4** (`horse_knowledge`), **§4.5** (`horse_conditions`).

Everything else you need is below.

This is the slice that gives slice 0002's hidden genotype a reason to be hidden. Until now a horse's genotype has been fully visible on its own page, because nothing it contained was worth concealing — a coat colour announces itself. Four disease loci change that: what a horse carries becomes worth money to find out, and worth not telling a buyer.

---

## 1. What "done" looks like

Eleven things a person can do in a browser, in order. If all eleven work, the slice is built.

1. Open a Quarter Horse's page and see a **Health** card listing four conditions — HYPP, PSSM1, HERDA, GBED — each reading **Not tested**.
2. Press **Test** and see a page offering one condition at a time for 250, or all four as a panel for 700, with the stable's balance shown and the cost of each spelled out.
3. Buy the panel. Come straight back to a Health card reading four real results — some mixture of **Clear** and **Carrier** — and a Money page with a `-700` row reading "Five-panel genotype test, Bramblewood Juniper." One turn is gone.
4. Press **Test** again on the same horse and be told there is nothing left to test, with no charge and no turn spent.
5. Open a horse belonging to somebody else's stable. The Health card shows nothing but the condition names — no results, no Test button — even when logged in as an admin.
6. Take a stable's balance negative from `/admin/money`, then try to test. It refuses by name and by amount, the same way booking a covering already does.
7. Breed two horses the booking stable has tested as **carriers of the same recessive**. The breeding preview warns, before the covering is booked, that about one foal in four will be affected — and names the condition. Do the same pairing from a stable that has *not* tested them, and no warning appears, because that stable does not know.
8. Book it anyway, tick until the foal is born, and find a healthy-looking foal in the barn with nothing marked on it.
9. Tick three more times. The foal is dead. `/stables` shows a new "While you were away" entry that explains, in plain English, what GBED is and why a foal from two carriers had a one-in-four chance of it. The foal is still in the barn list as **Died**, still in its dam's produce record, still in pedigrees, with its genotype intact.
10. Find a horse that is **affected** by HERDA without anyone having tested it — its page says so on its own, because a horse whose skin splits does not need a laboratory. Try to enter it in a show: refused, by name and by reason. Try to breed it: allowed, because that is the player's decision to make and not the game's.
11. Open `/admin/health` and see, per condition, how many horses in the game are clear, carriers and affected — the numbers §3f says to tune the founding pools against.

---

## 2. Decisions taken for this slice

Four were taken in conversation while writing this document, on 2 Aug 2026. Two of them close questions `docs/horse-game-overview.md` §3b explicitly left open and asks the implementing session not to assume.

### 2.1 The panel is the real Quarter Horse panel, minus one

**HYPP, PSSM1, HERDA and GBED.** These are four of the five conditions the actual Quarter Horse five-panel test covers, and taking the real list rather than inventing one is the whole point of §3's "genetic realism is the goal rather than the flavour."

**Malignant hyperthermia is the one left out.** It only manifests under general anaesthesia, and there is no surgery in this game — a condition that can never do anything is a row that teaches nothing. It joins the panel if a vet profession ever gives it a surface.

The four cover three of §3d's four severity classes, which is why this set and not a smaller one:

| Condition | Inheritance | Severity | What it does here |
|---|---|---|---|
| HYPP | Dominant | manageable | Visible signs, still competes, no management system yet |
| PSSM1 | Dominant | manageable | Visible signs, still competes, no management system yet |
| HERDA | Recessive | degenerative | Visible signs, **barred from showing** |
| GBED | Recessive | lethal | Foal is born, and dies |

**HYPP is the teaching case and is worth understanding before building it.** It traces to one enormously successful Quarter Horse sire, and it spread because the genetics that caused it also produced the muscling that won halter classes. That is the entire argument about selection pressure in one true example. Note that *this build does not model that link* — HYPP is not tied to any conformation trait here, so it is a straight negative with nothing on the other side of the ledger. Its `teaching_text` should say so honestly rather than imply a trade-off the code does not contain.

### 2.2 GBED is modelled fully, and the foal lives about 30 game days

**Decided in conversation, 2 Aug 2026.** §3b already settled that the lethals are modelled fully and that the presentation is *the foal is born, and then dies* — not an early-term loss. It then flagged two things the implementing session must decide rather than assume. Both are now decided.

**The death window is 30 game days** — three ticks, about a full real day at the current schedule. §3b's warning is the reason: at 10 game days per tick a two-day window is roughly two real hours, so the child finds birth and death both already over in a log, and "born, then died" silently collapses back into the early-term loss that was deliberately declined. Thirty game days means the foal is reliably there, alive and unremarkable, across at least one login before it is not.

It is a config value, `lethal_foal_death_game_days`, and it is **snapshotted onto the row at birth** rather than read live at the tick — CLAUDE.md §5.5. Retuning it must never move the death date of a foal already born.

**Birth and death are two separate events**, never one combined message. §3b asks for this in those words. Nothing at birth hints at what is coming, which is both accurate and the reason the allele persists in real populations — nothing about the pregnancy warns you.

### 2.3 A lethal foal can be named, and nothing special-cases it

**Decided in conversation, 2 Aug 2026** — the other question §3b left open. Registered names are unique and permanent, so naming a foal that dies spends that name from the game forever. That cost stands. In practice foals are born unnamed and most affected ones will die unnamed, but a child who names one inside the window keeps the record, and the game does not intervene.

The alternative — blocking the naming flow for an affected foal — was declined because the block itself would announce the diagnosis before the death, which is exactly what §2.2 is arranging not to do.

### 2.4 Affected is visible without a test. Carrier never is.

This is the sharp version of §2c, and it is biologically true rather than a concession. A horse whose skin splits open along its back has HERDA whether or not anyone paid a laboratory. A horse that ties up has PSSM1. **The carriers are the invisible ones, and the carriers are the whole problem** — which is precisely the lesson worth a child absorbing.

So: **affected status shows on the owner's horse page with no test and no charge**, worded as observation ("Shows signs of HERDA") rather than as a result. **Carrier and clear status never appear without a knowledge row.** Testing an already-visibly-affected horse is still possible and still writes a permanent record — that is the difference between what you can see and what you can prove to a buyer.

**This is a column, not a branch.** `conditions.signs_visible` is 0/1. HYPP, PSSM1 and HERDA are 1. **GBED is 0** — a neonatal lethal has no window of visible signs before the death, and setting it to 1 would give the foal 30 game days of announced dread instead of 30 game days of being a foal, undoing §2.2. Do not write `if (condition.code === 'GBED')` anywhere; the design record's rule 6 (breeds, loci and conditions are rows) applies here exactly.

### 2.5 An affected horse can always be bred

Never blocked, never warned about at the point of booking beyond what the player has learned for themselves. §3e names this as the central dilemma the whole health system exists to produce — the best stallion available is a carrier, and what you do about that is the game. A rule that answers it for the player deletes the slice's reason to exist.

Showing is different, and only for the degenerative class: `conditions.bars_showing` is 1 for HERDA and 0 for the rest. HYPP and PSSM1 affected horses compete, per §3d's "horse still competes."

---

## 3. Not built here

Say so plainly in the summary if you build any of these anyway.

### 3.1 No screening, only genotype tests
§3c's second kind of knowledge — an observation at a point in time that goes stale and needs redoing — arrives with the polygenic predispositions. `horse_knowledge.kind` is written as `'genotype'` in this slice and nothing writes `'screening'`. Keep the column and the distinction; it is the educational content, and building the column now costs nothing.

### 3.2 No management, so "manageable" means "diagnosed"
HYPP and PSSM1 are manageable through diet and workload, and neither diet nor workload exists. In this slice an affected horse is identified and displayed and nothing can be done about it. This is the honest first pass, and it is why `conditions.onset_model` and `conditions.management_options` from the schema document's §3.3 sketch are **not built as columns** — a nullable column nothing writes and nothing reads is a promise to a future session that nobody has kept. The care and tack stage adds them.

### 3.3 No vet, no service calls, no turnaround time
There is no professions system, so testing is a direct purchase from the horse page and results are instant. `horse_knowledge.service_call_id` from the schema sketch is **not built** for the same reason as §3.2. When the vet profession lands, testing becomes a service call and that column arrives with it.

### 3.4 No polygenic predispositions
The third of §3a's three categories. Same additive machinery as conformation, a risk score rather than a genotype, `state = 'at_risk'` rows at birth. None of it here. `horse_conditions` gets rows only for single-gene conditions the genotype actually triggers.

### 3.5 No colour-linked conditions
Frame Overo and lethal white, homozygous Silver and ocular anomalies, Grey and melanoma, white patterning and deafness. §3a calls these the highest value per unit of work anywhere in the design and it is right — but every one of them needs a locus that does not exist yet. They land with the remaining colour loci, one at a time, as the overview's build order already specifies. **The machinery this slice builds is what they attach to**: a `conditions` row with a `trigger`, and no new engine.

### 3.6 Knowledge does not transfer, because nothing transfers
Schema §4.4 says knowledge is copied to the buyer on sale and the seller keeps their own row. There is no market and no transfer path, so nothing here implements it. The table is per-stable from the first row, which is the part that matters — retrofitting that later would be a rewrite.

### 3.7 No disclosure flag on anything
The child who sells a carrier without saying so is a real consequence of §2c, and the overview says to be ready for it rather than surprised. There is nothing to sell on yet. Do not pre-build the mitigation.

### 3.8 No death from anything else
Ageing, injury and ordinary mortality are their own stage. The only thing that kills a horse in this slice is GBED, and `horses.end_reason` carries the condition code so the later stage joins it rather than replacing it.

---

## 4. The genetics

### 4.1 Four new loci, appended

Four rows in `loci`, `category = 'disease'`, and four entries appended to `LOCI` in `src/engines/genetics/loci.ts`.

| Code | Name | Alleles (canonical order) | `wildType` | Inheritance |
|---|---|---|---|---|
| `HYPP` | Hyperkalemic periodic paralysis | `["N","H"]` | `N` | dominant |
| `PSSM1` | Type 1 polysaccharide storage myopathy | `["N","P1"]` | `N` | dominant |
| `HERDA` | Hereditary equine regional dermal asthenia | `["N","Hrd"]` | `N` | recessive |
| `GBED` | Glycogen branching enzyme deficiency | `["N","Gb"]` | `N` | recessive |

**Three things about this table are load-bearing.**

**Append, never insert.** `inheritance.ts` draws one allele per locus in `LOCI` order from a single RNG stream, so inserting a locus anywhere but the end shifts every draw after it and the same stored seed stops producing the same horse. These four go after `DMRT3`, at `sort_order` 6 through 9. Existing horses are unaffected either way — their genotypes are already stored — but a pregnancy conceived before this migration and foaled after it reads its genetics from `pregnancies.rolled_genotype`, which was written at conception, so it is safe in both directions.

**The wild type is `N`, and it is `alleles[0]`, not `alleles[1]`.** Slice 0002 §4.2 describes the missing-locus default as "the last allele in canonical order," which is already false for DMRT3 and is now false for four more. `wildType` is spelled out per-locus precisely so this works; read it, never `alleles[1]`.

**This is why no backfill migration exists.** Every horse alive before this slice has no key for these loci in its genotype blob, `getMendelianPair` reads a missing locus as two copies of `wildType`, and two copies of `N` is clear. The entire existing population reads as clear for all four conditions with nothing written to any row. That is slice 0002's missing-locus rule paying for itself, and it is worth noticing rather than assuming.

**Do not touch `src/engines/genetics/expression.ts`.** It reads named colour loci by code and computes a coat. Four disease loci must change nothing about any horse's appearance, and the test suite should say so.

### 4.2 The status engine

`src/engines/health/status.ts` — new directory, pure functions, no database access, the same pattern as `engines/genetics/`, `engines/breeding/`, `engines/conformation/` and `engines/showing/`.

The one function that matters:

```
conditionStatus(genotype, condition) -> { status: 'clear' | 'carrier' | 'affected', copies: 0 | 1 | 2 }
```

It reads the condition's `trigger` blob, counts copies of the mutant allele at the named locus via `getMendelianPair`, and maps:

- **recessive** — 0 copies clear, 1 carrier, 2 affected
- **dominant** — 0 copies clear, 1 affected, 2 affected. **There is no such thing as a carrier of a dominant**, and the display must never offer the word. This is the thing HYPP teaches that the recessives cannot.

`copies` is returned alongside the status because a homozygote is worse than a heterozygote for the dominants in reality, and because the horse page saying "two copies" is more informative than "affected" alone. Nothing branches on it yet.

**The `trigger` blob's shape**, stored as TEXT on `conditions` and documented in the migration:

```json
{ "v": 1, "locus": "GBED", "mutant": "Gb", "mode": "recessive" }
```

`v` is the blob's own version, the same convention `horses.genotype` uses. This shape is deliberately the one the colour-linked conditions will also need — Frame is `{"v":1,"locus":"TO","mutant":"Fr","mode":"recessive"}` and needs no new engine, which is §3a's claim made good.

### 4.3 The founding pools, and one clamp

The schema document §3.1 is explicit: **a pool missing a locus is an error rather than a default**, so the migration adding these loci updates all eight breeds' `founding_allele_pool` in the same change. Seven of the eight get `{"N":1.0}` for all four — these are Quarter Horse conditions, HERDA and GBED essentially exclusively so, and confining them to one breed in the first pass keeps the tuning legible. PSSM1 genuinely occurs beyond the Quarter Horse and can spread to other pools later; say so in the migration comment rather than leaving a future session to wonder.

**Quarter Horse starting frequencies** — these are allele frequencies, drawn Hardy-Weinberg by the existing generator:

| Condition | Mutant allele frequency | Founding horses affected | Founding horses carrying |
|---|---|---|---|
| HYPP | 0.02 | ~4% (dominant) | — |
| PSSM1 | 0.03 | ~6% (dominant) | — |
| HERDA | 0.06 | ~0.4% | ~11% |
| GBED | 0.05 | never, see below | ~9.5% |

These are lower than the real population, deliberately. §3f says to tune so most foals are healthy, and names the founding frequencies as the lever. They are the number to revisit first if `/admin/health` shows the panel is doing too much or too little — which is exactly why that page exists.

**The clamp.** A founding or import candidate must never be generated homozygous-affected for a **lethal** condition, because such a horse would have died as a foal and cannot exist as an adult in a batch. The generator, after drawing, replaces one mutant allele with the wild type where a lethal condition would read affected, turning it into a carrier. Deterministic, draws no extra RNG, and does not perturb any downstream stream — a re-draw would have been the alternative and would make the number of draws depend on their outcome for no gain. It biases carrier frequency upward by about a quarter of a percentage point, which is worth one sentence in a comment and nothing more.

The generator is pure, so pass it the lethal `(locus, mutant)` pairs as data, derived from the `conditions` rows by the caller. It must not know what GBED is.

---

## 5. Data

**Migration numbers: read `migrations/` and take the next free number.** The last applied is `0049`, so these are expected to be `0050` onward, but that has been wrong twice already in this project — CLAUDE.md §11's numbering entry explains why. Roughly eight files, one logical change each:

1. Seed the four `loci` rows.
2. Update all eight `founding_allele_pool`s.
3. `CREATE TABLE conditions`.
4. Seed the four `conditions` rows.
5. `CREATE TABLE horse_conditions`.
6. `CREATE TABLE horse_knowledge`.
7. Config keys.
8. Rebuild `ledger` to widen its `kind` constraint — see §5.5, and read that section before writing it.

**Two warnings about the seed migrations, both from real failures.**

`src/lib/sql.ts`'s `splitSqlStatements` splits on every `;` with no awareness of string literals, and strips every `--` line comment. Slice 0008 lost an afternoon to a semicolon inside a judge's blurb. The `teaching_text` and `event_text` values in this slice are the longest prose ever inserted into this database. **No semicolons, no double hyphens, anywhere inside a string literal**, or `/admin/migrations` fails with `unrecognized token` and the operator cannot fix it. Use em dashes and full stops. Double every apostrophe for SQL escaping — "does not" is safer than "doesn't" throughout, and reads better to a nine-year-old anyway.

### 5.1 New table: `conditions`

Reference data, per schema §3.3, trimmed to what this slice reads (§3.2 and §3.3 above explain the two omissions).

- `id`, `code` (unique), `name`
- `category` — `single_gene` / `colour_linked` / `polygenic`. All four rows are `single_gene`.
- `locus_code` — nullable, points at `loci.code`. Set for all four.
- `trigger` — TEXT, the JSON in §4.2. Document the shape in the migration.
- `severity_class` — `lethal` / `manageable` / `degenerative` / `latent`
- `signs_visible` — INTEGER 0/1, §2.4
- `bars_showing` — INTEGER 0/1, §2.5
- `breed_associations` — TEXT, JSON array of breed codes. Display only, and the honest answer to "why does my Arabian have this listed" — it does not.
- `test_cost_key` — nullable TEXT, the config key naming this condition's individual test price. All four point at `genotype_test_cost` today. It exists so a condition can be made expensive to test individually without a code change, which §3c names as the tuning point that decides whether hidden information stays hidden.
- `enabled` — INTEGER 0/1, the per-condition toggle §12.2 asks for. **Disabling suppresses display and consequence and leaves the alleles in the genotype blob untouched**, matching the `loci.enabled` rule exactly, so re-enabling is lossless. A disabled condition is not testable, not displayed, does not bar showing, and does not kill foals — but rows already written to `horse_conditions` stay.
- `teaching_text` — the genetics note, shown next to the result
- `event_text` — the drafted wording, §5.6
- `sort_order`

### 5.2 New table: `horse_conditions`

What is actually true, per schema §4.5. **A row is written only when the genotype makes a horse affected** — never for carriers, never for clear horses. Carriers are a fact about a genotype, not a condition a horse has, and writing rows for them would triple the table for nothing.

- `id`, `horse_id` (references `horses`), `condition_code`
- `state` — `onset` for manageable and degenerative, `terminal` for lethal. The schema's `at_risk` / `managed` / `resolved` values arrive with the polygenic and care stages.
- `onset_game_day` — the horse's `born_game_day` for everything in this slice
- `terminal_game_day` — nullable, set only on lethal rows, to `born_game_day + lethal_foal_death_game_days` **snapshotted at write time** (§2.2, CLAUDE.md §5.5)
- `last_evaluated_game_day`

Index on `(condition_code, state)` and on `horse_id`.

**Why this table exists at all, given that everything in it is derivable from the genotype.** Two reasons, and if a future session finds a third way to do it, both need answering. First, the tick's death stage needs an indexed set of affected foals rather than a scan that parses every living horse's genotype JSON. Second, the care stage needs somewhere to put `management_state`, and it needs it hanging off a row that already exists.

**What a player sees is always derived from the genotype, never read from this table.** That is what stops the two disagreeing on screen. This table is for the tick and for later stages.

### 5.3 New table: `horse_knowledge`

Per schema §4.4, trimmed per §3.1 and §3.3 above.

- `id`, `stable_id` (references `stables`), `horse_id` (references `horses`)
- `kind` — `genotype` / `screening`. Only `genotype` is written here.
- `subject_code` — the condition code. (A locus code, when colour testing arrives.)
- `result` — `clear` / `carrier` / `affected`
- `tested_game_day`, `expires_game_day` (nullable, always null for genotype rows — §3c's permanence is the point)
- `cost_paid` — what was actually charged, since prices are live tunables and a receipt should say what it said at the time

**Unique index on `(stable_id, horse_id, subject_code)`.** A permanent result cannot be bought twice, and the index is what makes that true rather than a check somebody forgets. The test page reads existing rows and offers only what is missing.

**Knowledge is per stable, not per account.** A child running two barns who tests a horse in one has not tested it in the other. This follows CLAUDE.md §12's account-versus-stable rule — knowledge belongs to the business that paid for it, and it is what travels with the horse on sale.

### 5.4 Config

Live tunables, all of them, added to `/admin/config`:

- `genotype_test_cost` — **250**, one condition
- `genotype_panel_cost` — **700**, all four at once
- `lethal_foal_death_game_days` — **30**, §2.2

**The arithmetic behind those two prices**, since §3c calls test pricing a genuine tuning point and §14 leaves it open. A founding stable starts with 10,000 and three horses, paying 60 a tick in upkeep. A show win pays 600. So a full panel is roughly one win, and panelling all three founding horses is 2,100 — a real decision that does not end the stable. Single tests at 250 mean the panel saves 300, which is enough to make the panel the obvious choice for a breeding prospect and the single test the right one for a specific worry.

**These are a starting point to be tuned by observation, and the open question stays open.** Too cheap and everyone tests everything, which kills the mechanic. Too expensive and the children breed blind, which is frustrating rather than strategic. `/admin/health`'s counts and the ledger are how you find out which is happening.

`lethal_foal_death_game_days` is the one that is read once and snapshotted (§2.2). The other two are read live at purchase, per CLAUDE.md §5.5 — a price change should affect the next test, not retroactively re-price a receipt.

### 5.5 One migration to read twice: the `ledger` rebuild

`ledger.kind` carries `CHECK (kind IN ('opening', 'upkeep', 'prize', 'adjustment'))` and needs `'vet'`. **SQLite cannot alter a CHECK constraint**, so this is a table rebuild: create the new table, copy every row, drop the old, rename, recreate the index. It is the money truth table, so:

- It must be one `env.DB.batch()`, which the migration runner already guarantees — a migration lands completely or not at all.
- Nothing has a foreign key pointing *into* `ledger`, which is what makes the rebuild safe. Verify that is still true before writing it rather than trusting this sentence.
- **Keep the CHECK.** `events.kind` is deliberately free text so a future kind attaches with no migration, and the same argument could be made here — but money is the one place a typo'd value should fail loudly at the database rather than quietly become a row nobody queries. The market stage will need another rebuild for `sale` and `stud_fee`. That is a cheap price for the constraint.
- Re-read `src/db/ledger.ts`'s comment about `buildLedgerStatements` being the only function allowed to write `stables.balance` before touching anything in that file.

---

### 5.6 The wording, drafted now rather than at the point of failure

§3b asks for this in as many words, and `conditions.event_text` exists so it is written calmly and edited later without a deploy. Draft all four. The GBED one is the one that matters, and it is reproduced here in full so that it is argued about in review rather than written in a hurry:

> **Juniper's foal has died.**
>
> The foal was born with GBED — glycogen branching enzyme deficiency. A foal with this condition cannot store sugar in the way a body needs to, and there is nothing that can be done about it. It is why the foal seemed well at first and then was not.
>
> GBED is recessive. That means a horse needs two copies to be affected, one from each parent, and a horse with only one copy is perfectly healthy its whole life — a carrier. Two carriers bred together have about a one in four chance of an affected foal each time. Neither parent shows anything at all.
>
> A genotype test tells you whether a horse is a carrier. It is the only way to know.

Three things about that draft, for whoever edits it. It leads with the genetics rather than the outcome, which is the softening §3b keeps available without abandoning the biology. It never blames the player for the pairing. And it contains no semicolons and no double hyphens, per §5's warning — keep it that way.

The other three conditions' `event_text` fires when signs first appear (§6.3) and can be shorter. All four `teaching_text` values are the short note shown beside a result on the horse page, and should be readable by a nine-year-old.

---

## 6. The tick

One new stage, in a new file `src/db/health.ts`, matching the existing pattern where `coverings.ts`, `pregnancies.ts`, `shows.ts` and `upkeep.ts` each own their stage and `tick.ts` only orchestrates.

### 6.1 Where it goes in the order

Inside the existing `paused === 0` branch of `executeTick`, **after `foalDuePregnancies` and before `chargeUpkeep`**.

After foaling, because a foal born this tick needs its `horse_conditions` row written before anything looks for it — though at 30 game days it cannot die on the tick it is born.

Before upkeep, because a horse that dies this tick should not be billed for board over the period it partly lived. It is a rounding decision worth one comment and no more.

### 6.2 What it does

```sql
SELECT hc.*, h.owner_stable_id, h.registered_name, h.barn_name, h.sex
FROM horse_conditions hc
JOIN horses h ON h.id = hc.horse_id
WHERE hc.state = 'terminal'
  AND hc.terminal_game_day <= ?          -- the tick's new game_day
  AND h.status = 'alive'
```

For each, in one batch per horse: set `horses.status = 'dead'`, `ended_game_day` to the tick's game day, `end_reason` to the condition code; set the `horse_conditions` row's `last_evaluated_game_day`; write the event.

**Idempotency comes free from `h.status = 'alive'`** (CLAUDE.md §5.4). A re-fired tick finds nothing, because the horse it would have killed is already dead. A missed tick catches up, because the comparison is `<=` against a snapshotted day rather than an increment. Do not add a processed-marker column; the status *is* the marker.

**The horse row is never deleted and never anonymised.** §11 of the schema document keeps identity, parents and genotype for dead horses, and §3b is explicit that the record of a pairing having produced a lethal is the teaching artifact. It stays in the barn list marked **Died**, in both parents' produce records, and in every descendant's pedigree — of which there will be none, which is itself the point.

Check what already filters on `status` before you finish: `countAliveHorses` governs stable capacity, `chargeUpkeep` governs board, and show eligibility governs entry. A dead horse should stop counting against capacity and stop costing money. Grep for `status` rather than trusting this list.

### 6.3 Writing the condition rows at creation

Not a tick stage — this happens at the two existing points where a horse comes into being, both of which already take a config value threaded from the caller:

- `buildFoalInsertStatements` in `src/db/horses.ts` (foaling, and any later path that reuses it)
- `buildFoundingHorseInsertStatement` in `src/db/horses.ts` (founding claims and the admin founder form)

Both gain the enabled `conditions` rows as a parameter and append `horse_conditions` inserts for every condition the new horse's genotype reads as affected. Both already solve the same-batch-unknown-id problem — the foal path uses `(SELECT id FROM horses ORDER BY id DESC LIMIT 1)` and must keep working alongside `buildFoaledEventStatement`, which relies on being the last statement in its batch. **Read that constraint before adding statements after it.**

A `condition_signs` event is written in the same batch for any affected condition with `signs_visible = 1`, so an HYPP foal is noticed rather than sitting unread on a page nobody opened. Nothing is written for `signs_visible = 0`, which is the whole of §2.2's silence.

### 6.4 Two new event kinds

Added to `src/db/events.ts`, following the existing `buildEventStatement` shape. `events.kind` has no CHECK constraint, so no migration is needed for either.

```
condition_signs -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"HERDA"}
horse_died      -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"GBED",
                    "age_game_days":30,"dam_name":"...","sire_name":"..."}
```

`eventSentence` in `src/render/stables.ts` renders both, reading a missing payload key defensively rather than throwing, per the existing convention. The `horse_died` sentence is the one place `conditions.event_text` is shown in full rather than summarised — it is four paragraphs, and the feed should give it room.

The show barn has no account, so the existing `accountId === null` guard means nothing is ever written for its horses. Its horses are Quarter Horses drawn from the same pool and will occasionally be affected, which is correct and needs no special handling.

---

## 7. Testing, as a purchase

### 7.1 The screen

`/horses/:id/test`, owner-only on GET and POST, the same `notFound()`-for-a-non-owner shape every stable-scoped route already uses — an admin viewing another account's horse gets no exception, exactly as `/horses/:id/image` established.

GET lists every enabled condition applicable to the horse, each showing what is already known (with its `tested_game_day`) or a price. Below that, the panel price for everything still untested, the stable's current balance, and the turn cost. If nothing is left to test, the page says so and offers nothing to press.

POST takes either a single `condition_code` or `action=panel`, and:

1. **Re-derives what is untested** from the knowledge rows rather than trusting the form. A submitted condition code that is already known, disabled, or not applicable is rejected and nothing is charged — the same "re-derive and check membership" rule `isAllowedImagePath` established in slice 0007.
2. Re-reads the price from config and computes the real cost.
3. Checks turns, and refuses with `turnsRefusalMessage` before anything else happens.
4. Checks `canTakeOnCost` from `src/lib/money.ts` and refuses by stable name and deficit if the stable is in the red.
5. In **one `env.DB.batch()`**: the `horse_knowledge` inserts, and the ledger statements from `buildLedgerStatements` — kind `'vet'`, `reference_type` `'horse'`, `reference_id` the horse id, description naming the horse and what was bought.
6. Spends the turn **after** the batch succeeds, per slice 0009's check-act-spend rule. If `spendAction` loses a race and returns false, the test stands and nothing is charged. A child charged for something that did not happen has no way to find out why.

`ACTION_COSTS` gains `genotype_test: 1`. A panel is **one** action, not four — which is a second, quieter reason to buy the panel.

### 7.2 The debt rule applies here

Unlike showing, and like breeding. Slice 0009 §4.6 blocks a stable in the red from taking on new costs, with shows deliberately exempted because they are the only income that exists. A genotype test is a discretionary purchase, not a way out of debt, so it is blocked. `canTakeOnCost` is currently called from exactly one place; this makes two. Leave the comment at `enterHorseInClass` alone — it explains why a third call site does not exist.

### 7.3 The breeding preview is where this pays off

`/stables/:id/breed` already previews COI before a covering is booked. It gains a health line, and this is the single highest-value screen in the slice.

**Computed from the booking stable's `horse_knowledge` rows only. Never from either horse's genotype.** If a stable has tested both parents as carriers of the same recessive, the preview says so and states the odds — about one foal in four affected, one in two a carrier. If it has tested one and not the other, it says what it knows and what it does not. If it has tested neither, it says nothing at all.

This is the truth-versus-knowledge line from CLAUDE.md §12, and it is the exact place a future session is most likely to cross it by accident, because both genotypes are already loaded on that page for the COI calculation. The temptation to read them is right there. **Do not.** Consider extracting the health line into a function that is only ever passed knowledge rows, so that the genotypes are not in scope where it is computed — the way `fertilityPotential` is confined to one caller.

A stable breeding to another stable's stallion knows only what it has tested itself. That is correct, it is the market's price signal in embryo, and it is what makes disclosure a decision later.

### 7.4 Show eligibility

`src/engines/showing/eligibility.ts` gains a reason code for a horse barred by a condition with `bars_showing = 1`. Per slice 0008's established rule, **the engine returns a reason code and never a sentence** — the wording lives in `eligibilityMessage` in `src/render/shows.ts`, with the horse's name prepended by the route, so it reads like the existing refusals rather than a new voice.

Both doors into entering a horse — the horse page button and `/shows/:id`'s own form — already call `enterHorseInClass`, which re-checks eligibility server-side. One check, two doors, unchanged.

The NPC show barn's horses go through the same eligibility path, so an affected barn horse is excluded from topping up a field. No parallel path, per CLAUDE.md §13.

---

## 8. Where else it appears

**The horse page** gains a **Health** card, below Conformation. One row per applicable enabled condition: the name, the status the viewer is entitled to (§2.4), the `copies` count when affected, the `teaching_text` beside it, and the tested date on a known result. A **Test** button for the owner. Reuse the existing `.badge-success` / `.badge-warning` / `.badge-danger` pills — clear, carrier, affected — rather than inventing a fourth vocabulary.

**The barn list** gains a small marker for a horse that is visibly affected or dead. Do not put four columns of test results in the barn list; the compact conformation line already crowds that row.

**`/stables/:id/money`** needs no change — `vet` rows appear because the ledger renders whatever kinds exist. Check that the kind renders with a readable label rather than the bare word.

**`/admin/health`**, a new admin subpage in the existing subnav pattern, read-only, no editing form (CLAUDE.md §13). Per condition: name, severity, whether enabled, and counts of clear / carrier / affected across every living horse in the game. This is the operator's view of whether §3f's "most foals are healthy" is actually true, and it is the screen the founding-pool frequencies get tuned against. It reads truth directly, which is fine — it is the admin, and there is exactly one of them.

**`/admin/config`** gains the three tunables from §5.4, with a note beside `lethal_foal_death_game_days` saying it affects foals born after the change and not foals already carrying a snapshotted date.

**`src/db/reset.ts`** gains `horse_knowledge` and `horse_conditions` in `HORSE_TABLES`, both before `horses` in the delete order, since both have real foreign keys into it. Add them to `test/reset.test.ts`'s `REFERENCES` map in the same change — that test asserts the order against the foreign-key graph and is the only thing standing between a wrong order and a failed reset in front of the children. `conditions` and `loci` are reference data and are never cleared by either scope.

---

## 9. Seeds and reproducibility

**No new seeds are minted and no new sub-seed labels are needed.** Everything in this slice is deterministic given genotypes that already exist: the four new loci are drawn by `inheritance.ts` and the founding generator from streams that already exist, condition status is a pure function of a genotype, and the death date is arithmetic on `born_game_day`.

`test/rng.test.ts`'s golden values must be untouched. If they fail, something changed the RNG algorithm or the `LOCI` ordering, and per CLAUDE.md §11 that is the game's stored history becoming unreproducible rather than a test to update.

The one thing to check by hand: appending to `LOCI` lengthens the per-parent meiosis stream. Confirm that a foal bred from the same two parents with the same seed produces the *same colour* before and after the migration, and only differs in the four new keys. If it does not, the loci went in the wrong place.

---

## 10. Tests

`npm test` and `npx tsc --noEmit` both clean, plus:

**`test/health/status.test.ts`**
- Recessive: 0/1/2 copies map to clear/carrier/affected.
- Dominant: 0 copies clear, 1 and 2 both affected, and the word "carrier" never appears for a dominant.
- A genotype with the locus key entirely missing reads clear, for both modes. This is the whole existing population and deserves its own named test.
- `copies` is returned correctly for all six cases.

**`test/health/pools.test.ts`**
- Drawing many candidates from the Quarter Horse pool produces carrier and affected frequencies within tolerance of Hardy-Weinberg for the seeded allele frequencies. This is the test §5.2 of slice 0002 wanted for genetics generally, applied where it matters most.
- **No candidate is ever generated homozygous-affected for a lethal**, over a large number of draws (§4.3's clamp).
- Drawing from any of the other seven pools never produces a mutant allele.

**`test/health/knowledge.test.ts`** — the truth-versus-knowledge boundary, which is the thing most worth a test because it is invisible when broken:
- A stable with no knowledge rows sees `null` for a carrier, and `null` for a clear horse.
- A stable with no knowledge rows sees an affected status for a `signs_visible = 1` condition and **not** for a `signs_visible = 0` one.
- The breeding preview's health line, given two carrier genotypes and *no* knowledge rows, returns nothing.
- The same function, given knowledge rows for both, returns the one-in-four warning.

**`test/health/lethal.test.ts`**
- The death date is `born_game_day + window` from the value snapshotted at birth, not from live config — change the config between and assert the date does not move.
- The selection query's conditions, run twice against the same game day, kill a horse once.

**Extend `test/genetics/consistency.test.ts`** — it already parses `migrations/0015_seed_loci.sql` and asserts it matches `LOCI`. It must now also cover the new seed migration, including that the four new loci are last and in the right order. Extend rather than duplicate.

**Extend `test/reset.test.ts`** per §8.

---

## 11. Verifying it by hand

The eleven steps in §1, against a live `wrangler dev --local` with every migration applied through `/admin/migrations` — not the CLI, because `/admin/migrations` is the path the operator has and the seed migrations in this slice are exactly the shape that has broken it before (§5).

Step 9 needs a real forced case. Add nothing to the game to arrange it: use `/admin/horses/new` to create two horses with GBED carrier genotypes, breed them, and repeat until an affected foal arrives — or, if that is tedious, the existing `/admin/breeding` force-twins control is the precedent for a one-shot admin flag if you decide one is warranted. Say in your summary if you added one.

---

## 12. Documents to correct when this is built

- **`CLAUDE.md` §10** — the Health row moves to built, with what actually landed.
- **`CLAUDE.md` §11** — a dated entry. At minimum: the `src/engines/health/` pattern, the `signs_visible` / `bars_showing` columns being data rather than branches, the truth-versus-knowledge rule and where it is enforced, the append-only `LOCI` rule and why, the lethal clamp in the generator, the `ledger` rebuild, and the two new event kinds.
- **`src/lib/actions.ts`** — remove `genotype_test` from the comment's list of future entries now that it exists.
- **`docs/horse-game-overview.md` §3b** — already corrected when this document was written. The two "nobody has decided" items now carry the decisions in §2.2 and §2.3, with the reasoning kept. Nothing further is needed there.
- **`docs/horse-game-overview.md` §14** — test pricing stays open, but note the starting figures and where they came from.
- **`docs/horse-game-schema.md` §3.3, §4.4, §4.5** — record which columns were built and which were deliberately deferred, with the reasons from §3.2 and §3.3 above. A future session reading the schema document should not have to discover the difference by querying the database.

---

## 13. If this is too large for one session

Split it in two. The seam is clean and Part A is independently playable and worth playing before Part B is written.

**Part A — the panel and the paying.** The four loci, the pools, `conditions`, `horse_knowledge`, the status engine, the test screen, the Health card, the breeding preview's health line, `/admin/health`. Health becomes visible, testable and expensive. Nothing dies. Ends at §1 step 7.

**Part B — the consequences.** `horse_conditions`, the writes at creation, the tick's death stage, the two event kinds, the drafted wording, show eligibility, the `ledger` rebuild if Part A did not need it. Ends at §1 step 11.

Part A carries most of the value and all of the schema risk. Part B carries the one thing this slice exists to make true, which is that a test result matters.

---

## 14. What to raise rather than decide

- **If the Quarter Horse frequencies in §4.3 produce a panel that fires too often or never** — that is tuning, and it is the founding pools. Change the numbers, say what you changed them to, and note it. Do not change the mechanic.
- **If the 30 game day window turns out to read badly in practice** — say so. It was decided against a specific failure mode (§2.2) and is a config value, but a session that watches it happen knows something this document does not.
- **If you find yourself wanting a fifth condition, or a second breed's panel** — do not. §3f's scope control is the point, and the other seven breeds' panels have their own stage.
- **If the breeding preview's health line tempts you toward reading a genotype** — stop and say so in your summary. That is the one line in this slice that would be wrong in a way nobody notices for months.
- **If the `ledger` rebuild looks riskier than §5.5 makes it sound** — it is the money truth table and the operator cannot recover from a bad one. Raise it rather than improvising.
