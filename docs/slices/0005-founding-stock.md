# Slice 0005 — Founding stock, eight breeds, and the parent's PIN

**Status:** ready to build. Slices 0001, 0002 and 0003 are built. Slice 0004 (semen storage) is specified but **not** built, and nothing here depends on it — the two can land in either order. Nothing in this document exists yet.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those. The design documents describe a game far larger than this slice, and reading them will make you build ahead.

**What this slice is.** Horses stop being hand-built. A stable receives a batch of generated candidates drawn from a breed's allele pool, the child picks their breed and claims three of them, and their barn has founding stock. Seven more breeds get allele pools, so a Friesian batch comes out black and an Icelandic batch comes out every colour. And a parent can grant a further batch from a four-digit PIN typed on the child's own phone, as a reward for whatever the household runs on.

**Why this comes now.** Three reasons, in order of weight.

1. **The game is not currently playable by the people it is for.** Every horse alive has to be built allele by allele by an admin at `/admin/horses/new`. Five children cannot start.
2. **The generator is written once and used forever.** Overview §12.3 and schema §10.2 both make the same point: founding stock and token-bought imports are the same problem — an unrelated horse of a given quality drawn from a breed's allele pool. Building the offer-and-candidate flow now means the tokens slice is a data row over machinery that already works, rather than a second implementation.
3. **Everything downstream wants more than one breed.** Crossbreeding, breed classes, ideal vectors and disease panels all sit behind having more than one gene pool. Slice 0002 built the once-a-cross-always-a-cross rule and noted that with one breed nothing could actually cross. This slice makes that live.

---

## 1. What "done" looks like

On the live URL, on a phone, with no terminal:

1. Apply the new migrations from `/admin/migrations`.
2. As admin, open `/admin/founding`, set a four-digit parent PIN, and grant a founding batch to each child's stable.
3. Log in as a child. Their stable page says new horses are waiting.
4. Open the offer. Choose a breed from eight, each with a sentence about what it looks like. Confirm — and be told plainly that the choice is final.
5. See six candidates: four mares and two stallions, each described in plain English the way the barn already describes horses — *"A palomino mare, 6 years old."* Each carries a registered name from a stable that is not in this game.
6. Tick two mares and one stallion, submit, and find exactly those three in the barn. The other three are gone.
7. Try to claim three mares and be refused in a sentence that says which count is wrong.
8. Breed two of them. It works exactly as it does today — the mare comes into season, conception rolls, gestation runs, a foal is born carrying the child's own prefix.
9. Grant a second stable a **Friesian** batch. Every candidate is black, apart from the occasional chestnut, and the page says why that horse could not be registered.
10. On a child's phone, in their own logged-in session, open the "A grown-up can add horses here" section, type the PIN, and watch a new batch appear in their stable without logging them out.
11. Type the PIN wrong five times and be locked out for fifteen minutes, with the lockout counted in real minutes and every attempt logged.
12. Breed a Quarter Horse to a Friesian and get a foal whose breed reads **Cross**, with a composition of half each.

If all twelve work, the slice is done.

---

## 2. Decisions taken for this slice

Settled in conversation on 2 August 2026, in answer to three questions the design documents had left open. Treat them as standing decisions.

**2.1 Founding stock arrives as a rolled batch the player picks from.** Overview §14 asked whether the founding population arrives as stock players already own or as something they choose from. It is a private batch of candidates per stable, from which the player claims a fixed number; the rest expire. Not a blind draw (which gives the player nothing to think about) and not a shared pool (which at five players is a race, and the fastest child takes the best horse every time).

**2.2 All eight breeds get allele pools now — colour genetics only.** Overview §4's eight breeds each get a `breeds` row and a `founding_allele_pool` covering the five loci that exist. **No ideal vectors, no disease panels, no eligible class types, no height or weight ranges.** Those belong to the polygenic, show and health slices, and writing an ideal vector for traits nothing expresses yet is guessing. See §5 for the pools and for the honest caveat about what five loci cannot yet express.

**2.3 Three free horses per batch: two mares and one stallion, chosen from six.** Free — the 10,000 starting balance is for the money sinks that arrive later. Six candidates (four mares, two stallions) and three claims (two mares, one stallion) guarantees a breedable trio no matter how the child chooses, while still making the choice real. All four numbers are config.

**2.4 A parent can grant further batches, and the PIN comes with them.** *Requested directly by the operator: extra founding batches are to be used as a reward for chores, granted from a PIN typed on the child's own phone rather than by logging in as admin.* This is overview §1b's household layer arriving early, and it is the right call — the reward loop is the thing that makes the game part of the household, and it does not work if it requires the parent to log the child out.

**What this does and does not pull forward.** It builds `accounts.pin_hash`, the `pin_attempts` table and the rate limiting — all specified in schema §2.5 — and one PIN-gated action. It does **not** build the token balance, the token ledger, the product catalogue or any notion of spending. The tokens slice later adds those over a PIN that already exists and is already rate-limited. See §7, and §7.5 for why the rate limit is the one place in this codebase that is allowed to read the wall clock for a decision.

**2.5 The admin form at `/admin/horses/new` stays.** Slice 0002 §2.5 built it as the testing instrument the genetics engine needs — it is how you construct a carrier × carrier cross deliberately and watch the ratios come out right. The generator does not replace it and must not delete it.

**2.6 Founding horses carry a synthetic origin prefix, not the claiming stable's.** A prefix means *bred by* (overview §5d). Stamping a child's prefix on a horse they did not breed would corrupt the one thing the prefix scheme exists to record. Each candidate arrives with a full registered name — origin prefix plus a generated name — from a stable that does not exist in this game. See §6.5.

**2.7 Candidates are visibly distinguishable by colour, sex, age and gait, and by nothing else — for now.** This is a real limitation and it is worth naming rather than discovering. The interesting choice the design imagines — "the flashy chestnut against the plainer mare with the better shoulder" — needs conformation display, which is the *next* slice. Two things make this acceptable:

- Every candidate's polygenic values are **real and stored** from the moment they are generated. When the polygenic slice lands, this screen gets richer with no regeneration and nothing lost.
- The alternative is reordering the build so nobody can play for another slice, which is worse.

Say so on the screen in one plain sentence, so a child is not hunting for information that is not there yet.

---

## 3. The generator

A pure function, no database access, `CLAUDE.md` §5.1. New directory: `src/engines/founding/`.

```
src/engines/founding/
  pool.ts       parse and validate a breeds.founding_allele_pool blob
  generate.ts   pool + band + seed -> one candidate
  names.ts      seed -> an origin prefix and a name
```

### 3.1 The shape

```ts
generateCandidate(input: {
  pool: AllelePool;            // parsed from breeds.founding_allele_pool
  polygenicOneChance: number;  // the quality band, snapshotted - §4
  sex: 'mare' | 'stallion';
  ageMinGameDays: number;
  ageMaxGameDays: number;
  seed: number;                // the candidate's own rng_seed
}): {
  genotype: Genotype;
  ageGameDays: number;
  originPrefix: string;
  namePart: string;
}
```

It returns a candidate's whole content and writes nothing. The caller reads the breed row, calls this, and inserts the row.

**Built 3 Aug 2026 (amendment 0017a §5.3): `generateCandidate` now has a second caller.** The
consignment dealer (`src/db/consignment.ts`'s `mintConsignmentBatch`) calls it exactly the same way
`chooseBreedForOffer` does — mid quality band, the breed's real pool, no changes to this function
itself — and then, only for its own candidates, applies a queued allele injection afterwards via a
separate pure function (`src/engines/founding/injection.ts`). **A change to this function now
affects the dealer's stock as well as founding batches.** Also: the breed a stable is offered to
choose from (`chooseBreedForOffer`'s caller, `routes/founding.ts`) is now filtered by `breeds.enabled`
— `getBreedsInPlay()` in `src/db/breeds.ts`, per that amendment's §6. A disabled breed simply does
not appear in the dropdown; `chooseBreedForOffer` itself is unchanged and still trusts whatever
`breed_id` it's given, since the route has already re-derived the choice from the in-play list before
calling it.

### 3.2 The Mendelian draw

**For each locus in `LOCI` order** — never `Object.keys(pool)`, per `CLAUDE.md` §11's slice-0002 entry — draw two alleles independently from that locus's frequencies, and sort the pair into canonical order with `sortAllelePair`.

Two independent draws at the population frequency is Hardy–Weinberg, and it is the correct model: a founding horse is a random sample from a gene pool, not a designed animal. It is also what makes §9's test possible — a pool with `E` at 0.55 must produce roughly 30% `E/E`, 50% `E/e` and 20% `e/e` over a large sample.

**A locus absent from the pool JSON is an error, not a default.** Every pool lists every locus the engine knows about (§5). This is deliberate: the missing-locus rule in `genotype.ts` exists for horses that predate a gene, and reusing it to mean "this breed is fixed for wild type" would make two different situations indistinguishable in the stored data. Write `"CR": {"cr": 1.0}` and let the draw produce `["cr","cr"]` explicitly. `pool.ts` validates this and throws with the locus code named.

**Consequence for whoever adds locus six.** The migration that adds a locus must also update all eight pools in the same change, or generation starts throwing. Put that sentence in `pool.ts`.

### 3.3 The polygenic draw

Every allele at every locus of every trait in `TRAITS`, drawn independently, `'1'` with probability `polygenicOneChance` and `'0'` otherwise. Same stored shape as `generateFounderPolygenic` — twenty characters per trait — and it replaces that function's flat 50/50 with a weighted one.

**Do not delete `generateFounderPolygenic`.** The admin form at `/admin/horses/new` still uses it, and 50/50 is the right thing for a deliberately-constructed test horse.

**Note on fertility.** `fertility` is one of the nine traits and gets drawn like the rest. At the mid band this puts the founding population's fertility factor around 0.92 for both parents, which is roughly a 15% haircut on the conception base — visible but not punishing. This is expected, not a bug; it is also why the low band is 0.42 and not something more dramatic (§4). A founding population that cannot get in foal is not a hard mode, it is a broken game.

### 3.4 Age

`ageGameDays` drawn uniformly from `[founding_age_min_game_days, founding_age_max_game_days]`, defaulting to four to eight game years. Founding horses must be breeding age on arrival — `min_breeding_age_game_days` is 1080, and a child who has to wait 36 real days to breed their starting stock has not been given starting stock.

`born_game_day = world.game_day - ageGameDays`, **which will usually be negative, and that is correct.** The world starts at day 0 and these horses were born before it. Every age calculation in the codebase is `game_day - born_game_day` and works unchanged. Put a comment on the insert saying so, or a later session will "fix" it and silently make every founding horse a newborn.

---

## 4. Quality bands

A band is one number: the probability that any given polygenic allele is a `'1'`.

```json
"quality_bands": { "low": 0.42, "mid": 0.50, "high": 0.58 }
```

Twenty alleles per trait means potential is Binomial(20, p) — a mean of 8.4, 10.0 or 11.6 with a standard deviation around 2.2. **The bands overlap heavily on purpose.** A low-band horse can still be excellent at one trait, which is what makes an unpromising import worth taking a chance on, and it is how real breeding works. A band that cleanly separated the tiers would turn the quality parameter into a purchase price.

**Founding batches are `mid`.** Not low. Founding stock is the baseline the whole game is measured against — if it starts below average, "average" is a moving target nobody can see. Later token-bought imports being low-to-mid (overview §12.3) then means exactly what the design wants it to mean: a source of alleles you do not have, not a shortcut past the work, because by then player-bred stock will have selected past the mid band.

**The band is snapshotted onto the offer, as a number, at the moment the offer is minted.** `CLAUDE.md` §5.5. Store both `quality_band` (the name, for display) and `polygenic_one_chance` (the number the generator actually uses) on `import_offers`. Retuning `quality_bands` in config must never change the candidates in an offer a child has not opened yet.

---

## 5. The eight breeds

### 5.1 The caveat, first

**With five loci, several of these breeds cannot yet look like themselves.** The Nokota's signature is blue roan, dun and grullo; none of those genes exist. The Icelandic's identity is silver and dun on top of everything else; neither exists. The Paso Fino's broad pinto palette needs pattern loci that do not exist.

They are still meaningfully different — the Friesian is black, the Arabian greys, two breeds are gaited and six are not — but these pools are **a first pass to be revisited as each locus lands**, not a finished statement of breed identity. Put that sentence at the top of the seed migration, and put the specific missing genes in a comment on the specific breed. Overview §4a's table is the target; this is the part of it that five loci can express.

### 5.2 Codes

**A breed code is permanent once horses exist**, because it is written into every horse's `composition` blob at birth (`CLAUDE.md` §11). `QH` is already seeded. `FR` and `NOK` were confirmed in conversation. The remaining five are proposed here so that the building session uses exactly these rather than inventing them:

| Code | Name |
|---|---|
| `QH` | Quarter Horse *(already seeded)* |
| `AR` | Arabian |
| `TB` | Thoroughbred |
| `PF` | Paso Fino |
| `IC` | Icelandic |
| `GW` | German Warmblood |
| `FR` | Friesian |
| `NOK` | Nokota |

**If any of these five is to be different, change it in this document before writing the migration.** Afterwards it is a rewrite of every horse in the database.

### 5.3 The pools

Every pool lists all five loci (§3.2). Frequencies are allele frequencies and sum to 1.0 within each locus.

| Breed | E | A | CR | G | DMRT3 |
|---|---|---|---|---|---|
| `QH` *(seeded)* | E .55 / e .45 | A .45 / a .55 | Cr .10 / cr .90 | G .03 / g .97 | C .98 / A .02 |
| `AR` | E .50 / e .50 | A .60 / a .40 | cr 1.0 | G .20 / g .80 | C 1.0 |
| `TB` | E .60 / e .40 | A .65 / a .35 | cr 1.0 | G .04 / g .96 | C 1.0 |
| `PF` | E .50 / e .50 | A .50 / a .50 | Cr .12 / cr .88 | G .08 / g .92 | A .95 / C .05 |
| `IC` | E .50 / e .50 | A .45 / a .55 | Cr .10 / cr .90 | G .10 / g .90 | A .90 / C .10 |
| `GW` | E .60 / e .40 | A .70 / a .30 | cr 1.0 | G .08 / g .92 | C 1.0 |
| `FR` | E .92 / e .08 | a 1.0 | cr 1.0 | g 1.0 | C 1.0 |
| `NOK` | E .55 / e .45 | A .40 / a .60 | cr 1.0 | G .02 / g .98 | C .90 / A .10 |

Reading notes for whoever writes the migration comments:

- **Arabian** greys heavily and carries no dilution at all. At G .20 roughly a third of Arabians come out grey, which is the breed people picture. `gaited_typical = 0`.
- **Friesian** is the hard-mode breed (overview §4a). Fixed `a/a` so black is the only base, fixed for no dilution and no grey. The `e` at .08 is the real recessive red that occurs in the studbook and is **unregistrable** — a chestnut Friesian is roughly one foal in 150, and the horse page should say plainly that it is a Friesian that could not be registered as one. That sentence is the single best teaching artifact in this slice: a recessive hiding in a closed population for centuries, surfacing when two carriers meet.
- **Paso Fino** and **Icelandic** are the gaited breeds and are near-fixed for the DMRT3 `A` allele. `gaited_typical = 1` for both — documentation only; actual gait still comes from the locus.
- **Nokota** carries the gait allele at 10%, so "some individuals gaited" comes out as roughly one in a hundred expressing it (`A/A` only — heterozygotes read as not gaited, per `expression.ts`). Its real signature genes do not exist yet; comment that.
- Every new row gets `enabled = 1`, `is_recognised_cross = 0`.

### 5.4 What this makes possible, and what to check

With eight breeds, **crossbreeding becomes reachable for the first time.** `foalComposition` in `src/engines/genetics/composition.ts` already implements the once-a-cross-always-a-cross rule and is tested, and `renderHorsePage` already falls back to displaying `Cross` when `breed_id` is null. Neither has ever run against two real breeds.

This slice does not build anything for crosses — but §1 step 12 exists so that the first cross is produced deliberately, on purpose, by someone watching, rather than by a child three weeks from now.

---

## 6. Offers and candidates

### 6.1 Use the schema document's table names

`import_offers` and `import_candidates`, exactly as schema §10.2 names them. Founding stock and token imports are one mechanism (§2 of this document, reason 2), and giving the founding path its own tables would guarantee two implementations.

**The player-facing wording never says "import."** The screens say "new horses" and "your founding horses." The table name is internal.

### 6.2 `import_offers`

- `id`
- `stable_id` — who this batch is for
- `account_id` — denormalised from the stable, so a later per-account limit is a query on this table
- `source` — `founding` / `chore_grant` / `admin_grant`. (`token_import` arrives with the tokens slice.)
- `granted_by_account_id` — nullable; which admin minted it, whether by the admin page or the PIN
- `status` — `pending` / `open` / `claimed` / `expired`
- `breed_id` — **nullable, filled at breed choice**, not at mint. See §6.4.
- `quality_band` — TEXT, the band name, snapshot
- `polygenic_one_chance` — REAL, the number, snapshot (§4)
- `mare_candidates`, `mare_claims`, `stallion_candidates`, `stallion_claims` — INTEGER, all snapshot from config at mint
- `age_min_game_days`, `age_max_game_days` — INTEGER, snapshot
- `granted_game_day`, `generated_game_day` (nullable), `claimed_game_day` (nullable)
- `expires_game_day` — **nullable; null means never**
- `rng_seed` — minted at offer creation with `randomSeed()`

**Everything the generator reads is snapshotted onto the offer at mint.** `CLAUDE.md` §5.5, applied to its full extent: retuning batch sizes or the age range must not change an offer a child has not opened.

**On expiry: default to never, and build no tick stage.** `founding_offer_expiry_game_days` is a config default used at mint, `0` meaning null. A chore reward that silently evaporates because a child had a busy week is a family argument, not a game mechanic. The column exists because the token-import slice will genuinely want it. Expiry is checked at claim time against `world.game_day`; when the tokens slice wants `status = 'expired'` to be true in the table rather than derived, it can add the sweep then. Do not build it now.

### 6.3 `import_candidates`

- `id`, `offer_id`
- `slot_index` — 0-based, and the sub-seed label depends on it (§8)
- `sex` — `mare` / `stallion`
- `age_game_days`
- `genotype` — TEXT, JSON, the same blob shape `horses.genotype` uses
- `origin_prefix`, `name_part` — the two halves of the registered name (§6.5)
- `rng_seed` — **this becomes `horses.rng_seed` unchanged on claim**
- `chosen` — INTEGER 0/1
- `horse_id` — nullable, set on claim

The seed passing through unchanged mirrors `pregnancies.foal_rng_seed` → `horses.rng_seed` from slice 0003. It means a claimed horse's entire genetic history is reproducible from the offer seed alone.

**Indexes:** one on `import_offers (stable_id, status)` — the query every stable page makes — and one on `import_candidates (offer_id)`. Nothing else; say why in the migration, per `CLAUDE.md` §7.

### 6.4 The three states, and why the breed is chosen late

An offer is minted `pending` with **no breed and no candidates.** The player opens it, picks a breed, and the candidates are generated at that moment from the offer's already-stored `rng_seed`. The offer becomes `open`.

**The breed choice is committed and cannot be changed.** If a player could switch breeds after seeing the candidates, they would have a free reroll: same seed, different pool, new horses. Write the candidate rows and the `breed_id` in one `env.DB.batch()`, and make the confirmation a `required` checkbox on the form — the no-JavaScript pattern already used for the manual tick advance (`CLAUDE.md` §11) — with the server re-checking it.

Letting the child choose the breed rather than the admin is the whole payoff for seeding eight pools. It is also the decision a nine-year-old will care about most.

### 6.5 Names

Founding horses arrive fully named. `src/engines/founding/names.ts` holds two small lists — roughly two dozen origin prefixes and sixty name words — and combines them from the candidate's own seed via `deriveSeed(candidate.rng_seed, 'founding_name')`.

- Keep the lists short and obviously extendable. They are content, not machinery; a later session or a child can add to them.
- The stored `registered_name` is `"<origin_prefix> <name_part>"`, matching how `horseNameRoute` assembles a bred horse's name.
- `horses.breeder_prefix` is set to the origin prefix. `breeder_stable_id` stays **null** — nobody in this game bred it. The horse page already renders this case as *"a founding stable (unbred stock)"*; extend that to name the origin prefix.

**Uniqueness.** `horses.registered_name` is `UNIQUE COLLATE NOCASE`, and a batch insert that violates it rolls back the whole claim. Resolve it before the batch: select the proposed names, and for any that collide, walk the deterministic name sequence to the next one. At five players a genuine race is not worth defending against — if the batch rolls back, the child retries and gets different names.

### 6.6 Claiming

Validate, then write in one `env.DB.batch()`:

- Exactly `mare_claims` mares and `stallion_claims` stallions ticked. Wrong counts come back as a sentence naming which is wrong, not a generic error.
- The offer is `open`, belongs to a stable this account owns, and is not past `expires_game_day`.
- The stable has room: `countAliveHorses` plus the claim count must not exceed `capacity`. Refuse with the stable's name in the sentence.

The batch holds the horse inserts, the `chosen`/`horse_id` updates on the candidate rows, and the offer's `status = 'claimed'`. One transaction — a half-claimed batch is worse than a failed one.

**Reuse `createFoundingHorse`, do not write a second insert path.** It needs two changes:

1. Take a full `Genotype` rather than just `mendelian`, so the caller supplies the band-weighted polygenic block. Move the `generateFounderPolygenic` call out into the admin route, which is where the 50/50 founder belongs anyway — that is `CLAUDE.md` §5.1's pure-engine/thin-database split done properly.
2. Accept `breederPrefix` and a pre-assembled `registeredName`.

Then split out `buildFoundingHorseInsertStatement(env, input): D1PreparedStatement` the way slice 0003 split out `buildFoalInsertStatements`, so the claim path can batch three of them. Founding horses have no `horse_ancestors` rows, so there is no just-inserted-id problem here — no `last_insert_rowid()`, no `SELECT MAX(id)` trick needed.

Mares get `cycle_anchor_tick_seq` rolled from `deriveSeed(seed, 'cycle_slot')` exactly as `createFoundingHorse` already does. Do not change that label — it is the same draw for the same purpose.

---

## 7. The parent's PIN

### 7.1 What it is for, and what it is not

One action: **mint a founding-batch offer into a stable.** That is the whole surface. No token balance, no ledger, no catalogue, no spending, no configuration changes. The tokens slice builds those over a PIN that by then already exists, is already rate-limited, and already has a log.

### 7.2 Where it lives

**In the child's own session, on the child's own phone.** This is the requirement that shapes the design — a reward that requires logging the child out and logging the parent in will not get used at the kitchen table.

On `/stables/:id` (and on the founding page when there is no offer waiting), a collapsed `<details>` block: *"A grown-up can add horses here."* Inside, a PIN field and a submit. On success the offer appears immediately and the child continues in their own session, still logged in as themselves.

The PIN authenticates the *grant*, not the session. Nothing about the child's login changes, no admin session is created, and no other admin capability becomes reachable. Make that explicit in a comment on the route — the temptation for a later session to reuse "PIN verified" as a general admin escalation is exactly the bug this shape avoids.

### 7.3 Storage and verification

- `accounts.pin_hash` — TEXT, nullable. Set from `/admin/founding` by an admin, for their own account.
- Hash with the existing `hashPassword` / `verifyPassword` from `src/lib/password.ts`. No second hashing scheme.
- Verification tries every account with `is_admin = 1 AND pin_hash IS NOT NULL`, and records which one matched in `import_offers.granted_by_account_id`.

**On PBKDF2 for four digits:** it is not what stops a guessing attack — ten thousand candidates is trivial to enumerate offline. There is no offline attack here, because the hash never leaves the server. §7.4 is the actual defence. Reusing the existing hasher is about not having two password schemes in one codebase, and it costs one PBKDF2 run per attempt, which the login path already pays.

### 7.4 Rate limiting

Overview §1b: *"The PIN is the one place in this whole design where the threat model is real, precisely because the adversary is at the kitchen table."*

- `pin_attempts` — `id`, `account_id` (nullable — a failed attempt matches no account), `attempted_by_account_id` (whose session it was typed in), `real_ts`, `success`.
- **The lockout is global, not per account or per session.** Five failures within fifteen real minutes locks PIN entry everywhere until the window clears. A per-child limit would let a determined eleven-year-old farm attempts across three stables and a sibling's login.
- Every attempt is logged, successful or not. `/admin/founding` shows recent attempts, so a parent can see that someone has been trying.
- `pin_max_attempts` and `pin_lockout_window_seconds` are config.

**Make the lockout decision a pure function**, in the shape `src/tick/slot.ts` already established: `decidePinAttempt(recentAttempts, nowSeconds, limits) -> { allowed: boolean; retryAfterSeconds: number }`, no database access, tested without one.

### 7.5 The one place this codebase reads the wall clock for a decision

`CLAUDE.md` §5.3 is categorical: game logic reads `world.game_day`, never `Date.now()`, and wall-clock timestamps are records of when something happened, never inputs to a decision.

**The PIN lockout window is a deliberate, named exception, and it is the only one.** The reasoning:

- A lockout measured in game days would stop while the world is paused, and would jump fifteen game days every tick. Neither has anything to do with how long a person has been guessing.
- The thing being defended against happens in real minutes, at a kitchen table, and the defence has to be measured in the same units.
- It is a security control, not game logic. Nothing about a horse, a pregnancy, a show or a balance depends on it.

Write those three sentences into the code where `nowUtcSeconds()` is compared against `pin_attempts.real_ts`, and add the exception to `CLAUDE.md` §11 when the slice lands. A future session finding a wall-clock comparison and no explanation will correctly assume it is a bug.

---

## 8. Seeds and reproducibility

New sub-seed labels, all via `deriveSeed`, never a second `makeRng` from a stored seed (`CLAUDE.md` §5.2):

- from `import_offers.rng_seed`: `candidate_0`, `candidate_1`, … one per `slot_index`. These become the candidates' own `rng_seed` values.
- from `import_candidates.rng_seed`: `pool_mendelian`, `pool_polygenic`, `founding_age`, `founding_name`.
- from a claimed horse's `rng_seed` (which is the candidate's, unchanged): `cycle_slot` for mares, exactly as today.

**`pool_polygenic` is deliberately not `founder_polygenic`.** The existing label belongs to the flat 50/50 draw the admin form uses; this one is band-weighted. Two different draws must never share a label, or a horse's genetics stop being reconstructible from its seed.

`randomSeed()` is called in exactly one new place: minting `import_offers.rng_seed`. Everything downstream derives.

---

## 9. Tests

`test/founding/`:

- **Hardy–Weinberg.** Ten thousand candidates from a pool with `E` at 0.55 produce `E/E`, `E/e`, `e/e` within a couple of points of 30/50/20. This is the test that proves the generator samples a population rather than picking a horse.
- **Friesian comes out black.** Every candidate from the `FR` pool is black or chestnut — never bay, never cream, never grey — and chestnut appears at roughly the expected low rate.
- **Bands order.** Mean polygenic potential over a large sample is strictly low < mid < high, and the distributions overlap (a low-band candidate exceeding the high-band mean must be possible, or the bands are separating tiers rather than shifting them).
- **Determinism.** The same offer seed and the same breed produce byte-identical candidates. Run it twice in the same test.
- **A pool missing a locus throws**, naming the locus (§3.2).
- **`decidePinAttempt`** — under the limit allows, at the limit denies, and denies again one second before the window clears but allows one second after.

Extend `test/genetics/consistency.test.ts`, which already parses `0015_seed_loci.sql` to check `LOCI` against the seeded rows: it should now also assert that **every seeded breed's `founding_allele_pool` lists every locus in `LOCI`, with only known allele symbols, summing to 1.0.** That single assertion is what turns §3.2's rule from a comment into a guarantee, and it will catch the locus-six migration that forgets to update the pools.

---

## 10. Migrations

Next number is `0022`. One logical change per file, and **register every file in `src/db/migrations.ts`** with a matching import and list entry, in order, or `/admin/migrations` cannot see it and the operator cannot apply it (`CLAUDE.md` §8).

| File | Contents |
|---|---|
| `0022_import_offers.sql` | the offers table |
| `0023_import_candidates.sql` | the candidates table |
| `0024_seed_breed_pools.sql` | the seven new `breeds` rows (§5.3) |
| `0025_accounts_pin.sql` | `accounts.pin_hash` |
| `0026_pin_attempts.sql` | the attempts table |
| `0027_config_founding.sql` | this slice's config keys |

`0024` inserts new rows only — it must not touch the Quarter Horse row.

**Numbering note, added 2026-08-03.** `0022`–`0024` landed as written. The two PIN migrations and the config file did not: §7 was deferred, so the config keys landed as `0025_config_founding.sql` and the PIN tables were never created. **Do not read `0025`/`0026` above as reserved for the PIN work** — take the next free number from `migrations/` when you build it. See `CLAUDE.md` §11's 2026-08-03 numbering entry; this table has been the example of that mistake twice now.

### 10.1 Config keys

Added with `json_set` on the single config row, bumping `version`, following `0020_config_fertility.sql`:

| Key | Value | Note |
|---|---|---|
| `founding_mare_candidates` | 4 | |
| `founding_mare_claims` | 2 | |
| `founding_stallion_candidates` | 2 | |
| `founding_stallion_claims` | 1 | |
| `founding_quality_band` | `"mid"` | a string — see below |
| `quality_bands` | `{"low":0.42,"mid":0.50,"high":0.58}` | JSON |
| `founding_age_min_game_days` | 1440 | four game years |
| `founding_age_max_game_days` | 2880 | eight game years |
| `founding_offer_expiry_game_days` | 0 | 0 means never (§6.2) |
| `pin_max_attempts` | 5 | |
| `pin_lockout_window_seconds` | 900 | real seconds (§7.5) |

Add all of these to `ConfigValues` in `src/lib/config-cache.ts`.

**`founding_quality_band` and `quality_bands` are not numbers**, so they do not fit `/admin/config`'s `NUMERIC_CONFIG_KEYS` loop. Leave that form as it is; the band for a specific grant is chosen on the grant form itself (§11), and the defaults are editable from D1's console like any other JSON. Do not widen the config form for this — that is a separate piece of work and the admin UI is deliberately unpolished (`CLAUDE.md` §13).

---

## 11. Screens

No JavaScript (`CLAUDE.md` §11). Reuse the tokens, badges and collapsible patterns already in `public/style.css`; add no new styles unless something genuinely has no equivalent.

**`/stables/:id/founding`** — the one player-facing page, in four states:

- *No offer.* One sentence saying so, plus the collapsed grown-up PIN block (§7.2).
- *Pending.* The breed picker: eight options, each with one plain sentence about what that breed looks like — *"Friesian — black, and only black. No dilutions, no patterns, no grey."* A `required` confirmation checkbox, because the choice is final.
- *Open.* The candidate list. Each candidate shows its registered name, its description from `describeHorse` (which already produces *"A palomino mare, 6 years old."*), a gaited badge where it applies, and a checkbox. One submit. Above the list, the one sentence from §2.7 about conformation not being visible yet.
- *Claimed.* A link to the barn.

**Stable home (`/stables/:id`)** — a callout when an offer is waiting. This is how a child finds out; nothing else notifies them.

**Stable subnav** — add "New horses" via the existing `stableSubnav` helper, shown only when there is an offer.

**`/admin/founding`** — a new admin subpage in the existing subnav pattern:

- Mint an offer into any stable: pick the stable, pick the band, submit.
- Set or change the parent PIN.
- Recent offers and their status.
- Recent PIN attempts (§7.4).

**Horse page** — for a horse with a `breeder_prefix` but no `breeder_stable_id`, name the origin prefix rather than only saying "a founding stable." And for a chestnut Friesian, the sentence from §5.3 about registration.

---

## 12. What this slice does not build

- **Tokens.** No balance, no ledger, no products, no purchases. §7.1.
- **The market.** Nothing is bought or sold. Founding stock is free.
- **NPC stables.** Nothing generated here is owned by anyone but a player.
- **Ideal vectors, disease panels, show classes or height and weight ranges** for any breed, including the seven new ones. §2.2.
- **Polygenic display.** Still the next slice. The values are stored and shown nowhere. §2.7.
- **Image slots.** A candidate is described in words, as every horse currently is.
- **Anything for crosses** beyond confirming the existing code works when two breeds finally exist. §5.4.
- **An offer-expiry tick stage.** §6.2.
- **Any PIN-gated action other than granting a batch.** §7.1.

---

## 13. If this is too large for one session

It is a big slice, and the honest split is clean: **§7 is separable.**

Build §3–§6 and §8–§11 first. The admin path at `/admin/founding` already mints batches, so the chore-reward loop works from the first day — it just requires the parent to be logged in as themselves rather than typing a PIN on the child's phone. Then land §7 as `0006`, adding `pin_hash`, `pin_attempts`, the lockout function and the in-session grant block.

Do not split it the other way. A PIN with nothing to grant is not shippable.
