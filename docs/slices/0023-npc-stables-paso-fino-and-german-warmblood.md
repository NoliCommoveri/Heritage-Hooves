# Slice 0023 — NPC stables for Paso Fino and German Warmblood

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts this slice
depends on are quoted or summarised below.**

This is a spec, not a build log — nothing in this document has landed yet.

Where this comes from: a direct request to give Paso Fino and German Warmblood breeders the same
thing Quarter Horse breeders already have — a real NPC rival that gets better over time, not just a
static field-filler. Nothing in the design documents names this gap explicitly; it falls out of
reading `docs/slices/0015-npc-stables.md` (which built the whole NPC-stable machinery generically,
but seeded only Quarter Horse personalities) against `docs/breed-ideal-vectors.md`'s 2026-08-04
update (all eight breeds now have an `ideal_vector`, so all eight already have a show class).

**The headline finding: this is a pure-data slice. No engine, tick, or route code changes.** Slice
0015 built `npc_policy`, `runNpcBreedingDecisions`, the ceiling schedule, the market listing/buying
stages, and the NPC stud mechanism to read *every* `npc_policy` row generically — never a hardcoded
stable or breed. Slice 0019 (founding specialists) and migration `0107` (breed ideal vectors) later
made every breed, not just Quarter Horse, a first-class citizen of that same machinery. Adding two
breeds' worth of NPC stables today is the same shape as migration `0108` seeding five disciplines
into an already-generic show system: rows in, nothing to build.

---

## 1. What already exists and must not be re-implemented

- **Three NPC stables today, all breeding Quarter Horses only** (`migrations/0085`, plus Fair
  Meadow's original `migrations/0040`): Fair Meadow (volume breeder, high noise), Cedar Hollow
  (conformation specialist, low noise), Willow Creek Barrels (discipline barn, targets Barrel
  Racing). Every mechanism below already reads `npc_policy` generically — nothing here is
  QH-specific in code, only in the data these three rows happen to carry.
- **`runNpcBreedingDecisions`** (`src/db/npcBreeding.ts`) iterates every `npc_policy` row, resolves
  its target (`target_breed_id` → the breed's `ideal_vector`, or `target_discipline_code` → a
  discipline's `ability_weights`) via `resolveSelectionTarget`, and runs the identical selection
  engine regardless of which breed or discipline the row names.
- **The ceiling** (`npc_ceiling_schedule`) is global — one schedule, two columns
  (`conformation_ceiling`/`ability_ceiling`), read fresh by every stable regardless of breed. A new
  Paso Fino stable is bound by exactly the same ceiling row a Quarter Horse stable is, on the day it
  is founded. No new ceiling machinery, no per-breed ceiling.
- **The show top-up** (`judgeOneClass`, `src/db/shows.ts`) already draws from every `is_npc = 1`
  stable's stock, not one, and `createShowIfMissing` already creates one class per breed in play
  with a non-null `ideal_vector` — which is all eight breeds as of `migrations/0107`. Paso Fino and
  German Warmblood classes exist and are judged today; they are just padded by static,
  never-improving Fair Meadow stock (via `stockShowBarn`'s admin button) rather than a genuine
  competitor.
- **NPC market listing, buying, stud, and the balance floor** (`src/db/npcMarket.ts`,
  `src/db/npcStud.ts`, `src/db/npcFinance.ts`) all iterate `listNpcPolicies` — every row, any breed.
  A new stable gets a working market presence, a stud listing for a qualifying stallion, and the
  income floor, from the moment its `npc_policy` row exists. Nothing to wire.
- **`stockNpcStable`** (`src/db/npc.ts`, slice 0015 §7.3) already takes a stable and a breed as
  parameters — the admin's "add an outcross batch" control at `/admin/npc`. This is how the two new
  stables get their first horses; nothing new needed there either.
- **Naming** (`resolveUniqueBarnName` / the NPC-foal-naming path in `foalDuePregnancies`) already
  takes the owning stable's own `prefix`, whatever it is. A new stable's foals are named correctly
  the moment its `stables` row exists.

Given all of the above, **the only genuinely open questions are data choices**, not architecture:
which personalities to found, which discipline (if any) each targets, what numbers to give their
`npc_policy` rows, and what to name them. §2 makes a recommendation on each; §7 restates the ones
that are the operator's call, not this document's.

---

## 2. Decisions and recommendations

### 2.1 One conformation specialist per breed, mirroring Cedar Hollow

Paso Fino and German Warmblood each get a Cedar-Hollow-equivalent: low selection noise, modest pace,
targeting that breed's own `ideal_vector`. This is the stable a serious breeder of either breed needs
to exist at all — without it, "beat the NPC's best" has no opponent for these two breeds, only for
Quarter Horse.

**Recommendation, not yet a decision:** do *not* also give either breed a Fair-Meadow-style volume
breeder. Fair Meadow's job — high-noise, high-volume, generic show-field padding — is already
breed-agnostic in effect, because `judgeOneClass`'s top-up draws from every NPC stable's stock
(including the static, admin-minted Paso Fino and German Warmblood horses already sitting in Fair
Meadow's own barn via `stockShowBarn`'s breed-aware top-up). A second volume breeder per breed adds
upkeep-free population growth without adding a new *kind* of competition a player doesn't already
face. If the operator wants Fair Meadow-style volume breeding to actually happen in these two breeds
(bred, not just admin-minted), rather than only padded, say so and this is a one-row addition later.

### 2.2 One discipline barn each — the natural-fit discipline, not a free choice

Willow Creek Barrels exists because Barrel Racing is a Quarter Horse discipline and the breed already
had a conformation stable to pair it with. The same logic:

- **Paso Fino → Gaited Pleasure.** The breed's `founding_allele_pool` is already seeded
  "near-fixed for the DMRT3 gait allele" (`migrations/0024`'s own comment), and Gaited Pleasure
  (`requires_gait = 1`) is the one discipline a Paso Fino enters as a matter of course rather than by
  exception (`docs/breed-ideal-vectors.md` §"Gaited classes"). This is close to a decision, not just
  a lean — there is no second discipline this breed fits nearly as well.
- **German Warmblood → open between Dressage and Show Jumping. Recommend Dressage, don't decide it
  here.** The breed's `ideal_vector` comment calls it "the modern sport horse" with "three of four
  traits carr[ying] weight above 1.0" — genuinely well-suited to both. Dressage's `ability_weights`
  lean hardest on `trainability` (1.6) and `agility` (0.9) with `speed` almost zero; Show Jumping
  leans on `jump_scope` (1.6) and `agility`/`trainability` roughly evenly. Both are defensible. This
  document recommends Dressage — it is the discipline German Warmblood breeding is most identified
  with in reality, and it is the discipline with no NPC stable at all yet (Show Jumping's own field
  is at least no worse off than any other non-Barrel discipline today). **Raise this with the
  operator rather than building both** — a breed with two personality stables competing in different
  disciplines is a bigger footprint than the Paso Fino side of this same slice, and should be a
  choice, not a default. See §7.

### 2.3 Four new rows if both breeds get both personalities: two `stables`, two `npc_policy` rows per breed

Following §2.1/§2.2's recommendation (one conformation specialist + one discipline barn, per breed):

| Stable (name TBD, see §7) | Personality | Breed | Targets |
|---|---|---|---|
| *Paso Fino conformation specialist* | `conformation_specialist` | Paso Fino | Paso Fino's `ideal_vector` |
| *Paso Fino discipline barn* | `discipline_barn` | — | Gaited Pleasure's `ability_weights` |
| *German Warmblood conformation specialist* | `conformation_specialist` | German Warmblood | German Warmblood's `ideal_vector` |
| *German Warmblood discipline barn* | `discipline_barn` | — | Dressage's `ability_weights` (recommended, not decided — §2.2) |

Same shape as `migrations/0085`: each personality is a `stables` row, a `stable_prefix_history` row,
and an `npc_policy` row with the market/stud/balance-floor columns already on that table
(`migrations/0093`, `0126`) filled in per §2.4, not left at their defaults.

### 2.4 Policy numbers: copy the existing personality's numbers, not invent new ones

`personality_code` already carries the behavioural meaning (§5.3's own comment: "Fair Meadow's role
… is expressed entirely through its `npc_policy` row … No code branches on personality"). The
honest, lowest-risk choice is to give each new stable **the same numbers as its Quarter Horse
counterpart**, breed/discipline substituted:

- Both conformation specialists: `selection_noise_sd 3.0`, `retention_bias 0.10`,
  `breeding_interval_game_days 180`, `max_pairs_per_cycle 2`, `market_price_multiplier 1.25`,
  `market_price_spread 0.08`, `balance_floor 5000` — Cedar Hollow's row, verbatim
  (`migrations/0085`, `0093`, `0126`).
- Both discipline barns: `selection_noise_sd 4.0`, `retention_bias 0.10`,
  `breeding_interval_game_days 150`, `max_pairs_per_cycle 2`, `market_price_multiplier 1.10`,
  `market_price_spread 0.10`, `balance_floor 5000` — Willow Creek Barrels' row, verbatim.

This is a recommendation with real reasoning, not a guess dressed up as one: these numbers have
already run against real play for Quarter Horse (§12.2/§12.3 of slice 0015 flagged them as
first-guesses to retune, and nobody has reported them badly wrong since). Reusing them means the two
new breeds start from the one data point this game actually has, rather than a second untested guess
sitting next to the first. If the operator wants either breed's stables to feel harder or easier to
beat from day one, that is a number to hand-tune at `/admin/npc` after founding, exactly the control
§7.3 of slice 0015 built for this.

`capacity`: 40, matching Cedar Hollow/Willow Creek Barrels (`migrations/0085`) — generous headroom,
no play data yet, same reasoning slice 0015 §12.2 already gave.

### 2.5 New stables start empty; stocked by hand, same as Cedar Hollow was

No migration mints horses directly. The admin stocks each new stable via `/admin/npc`'s existing
"add an outcross batch" control (`stockNpcStable`, already breed-parametrised — §1) once this
migration lands, the same way Cedar Hollow and Willow Creek Barrels were originally populated. This
document does not pick a starting headcount or quality band; that is the same button, used the same
way, for a new breed.

---

## 3. Not built here

### 3.1 A volume breeder for either new breed

§2.1's recommendation — Fair Meadow's generic top-up already reaches these breeds via
`stockShowBarn`'s breed-aware minting. Revisit only if the operator wants *bred* (not just minted)
volume stock for these breeds specifically.

### 3.2 Show Jumping for German Warmblood, or a second discipline barn for either breed

§2.2 — one discipline barn per breed, per the existing precedent. Adding a second is a pure-data
follow-up, identical in shape to this whole slice, the moment there's a reason to (a player actually
chasing Show Jumping on German Warmblood stock and finding no NPC rival there, the way this slice's
own motivation was "no NPC rival for Paso Fino/German Warmblood at all").

### 3.3 Any change to the ceiling schedule, the selection engine, the tick, the market, or stud

None needed. See §1. If this slice is built and any of those files change, something has gone wrong
with this document's own central finding and it's worth stopping to ask why.

### 3.4 Colour or pattern-specific NPC selection

Both breeds carry real colour/pattern genetics (Paso Fino's broad pinto palette, German Warmblood's
tobiano lines — `docs/breed-ideal-vectors.md` §5's colour table). Slice 0015 §2.1 already deferred a
"colour barn" personality generally, pending a reason to select on colour rather than conformation or
ability; nothing about these two breeds changes that reasoning. Not built here.

---

## 4. Data

Migration numbers are claimed at build time — check `migrations/` for the next free number
(`CLAUDE.md` §8; as of this writing that's `0136`). Register in `src/db/migrations.ts`.

One migration, `NNNN_npc_stables_paso_fino_and_german_warmblood.sql`, same shape as
`migrations/0085` repeated four times (or two, if the operator declines a discipline barn for one or
both breeds per §7):

```sql
-- Slice 0023: two new NPC personality stables per breed (Paso Fino, German Warmblood), giving both
-- breeds a real, improving competitor - same pattern as migrations/0085_npc_stables_and_policies.sql.
-- Pure data: no engine, tick, market, or stud code reads a breed or discipline code specially
-- anywhere in this game, so this migration alone is the entire slice.

-- Paso Fino conformation specialist. Numbers copied verbatim from Cedar Hollow's own row
-- (migrations/0085, 0093, 0126) - see slice 0023 §2.4.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, '<name TBD>', '<name TBD>', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = '<name TBD>'), '<name TBD>', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = '<name TBD>'),
  'conformation_specialist', 'conformation',
  (SELECT id FROM breeds WHERE code = 'PF'),
  3.0, 0.10, 180, 2, 1.25, 0.08, 5000
);

-- Paso Fino discipline barn, targeting Gaited Pleasure. Numbers copied from Willow Creek Barrels.
-- ...same shape, target_discipline_code = 'gaited'...

-- German Warmblood conformation specialist, target_breed_id = (breeds.code = 'GW'). Same shape as
-- the Paso Fino conformation specialist above.

-- German Warmblood discipline barn, target_discipline_code = 'dressage' (recommended - slice 0023
-- §2.2; confirm with the operator before this ships, per §7 below).
```

No change to `npc_ceiling_schedule`, `src/db/reset.ts`'s `RESET_TABLES`/`WORLD_ONLY_TABLES` handling
is already generic over every `stables`/`npc_policy` row (nothing there is enumerated by name except
the three existing personality stables' *re-seed-on-reset* block — see §5 below, the one real code
touch this slice needs).

---

## 5. The one place code does need to change: the world-reset re-seed block

`src/db/reset.ts` re-inserts Fair Meadow, Cedar Hollow, and Willow Creek Barrels (plus their
`stable_prefix_history` and `npc_policy` rows) after a full world reset's blanket `DELETE FROM
stables`, because the migrations that originally created them only ever run once
(`docs/slices/0015-npc-stables.md` §7.4). **The two (or four) new stables need the identical
treatment added to that same block**, or a world reset silently deletes them forever with no NPC
rival left for either breed. This is the one line item in this whole slice that is genuinely a code
change rather than pure data — small, mechanical, and in exactly the place slice 0015's own document
already flagged as needing it for every future personality stable.

---

## 6. Verifying it by hand

Against `wrangler dev --local`, after applying the migration and stocking each new stable via
`/admin/npc`'s outcross control:

1. `/admin/npc` shows five (or seven) NPC stables total, each with the right personality, breed, and
   (for discipline barns) discipline.
2. Stock each new stable with a small outcross batch. Advance ticks past each one's
   `breeding_interval_game_days`; headcount grows, every new foal is named under its own stable's
   prefix, and no event appears in any player's feed (the same guard slice 0015 §9's regression test
   already covers, unchanged).
3. `/shows` → judge a Paso Fino class and a German Warmblood class with one player entry each; the
   field is topped up with horses from more than Fair Meadow's static stock once the new stables have
   bred at least once.
4. Confirm a qualifying stallion from the new conformation specialists appears at `/market/stud`
   once his quality clears whatever the active ceiling permits, exactly like Cedar Hollow's stallions
   do today.
5. Trigger a full world reset from `/admin`; confirm all new stables and their `npc_policy` rows come
   back (§5) rather than vanishing.

---

## 7. What to raise rather than decide

Stop and ask if you hit these; don't pick one (`CLAUDE.md` §2).

- **Whether German Warmblood's discipline barn targets Dressage, Show Jumping, or gets one of each.**
  §2.2 recommends Dressage alone; both are defensible, and adding a second discipline barn doubles
  this breed's footprint relative to Paso Fino's.
- **Whether either breed also gets a Fair-Meadow-style volume breeder** (§2.1) — recommended against,
  since generic padding already reaches these breeds through `stockShowBarn`.
- **Names and prefixes for the new stables.** Left as `<name TBD>` throughout this document on
  purpose — a prefix is permanent the moment a horse is bred under it (`CLAUDE.md` §12), and slice
  0015 §14 raised the identical question for Cedar Hollow and Willow Creek Barrels rather than
  picking names unilaterally. Whoever builds this should bring name options, not decide alone.
- **Starting outcross quality/headcount for each new stable** — the same "not this document's call"
  answer slice 0015 gave for Cedar Hollow's own first stocking; `/admin/npc`'s existing control
  already puts this decision in the operator's hands at build time, not in this document.
