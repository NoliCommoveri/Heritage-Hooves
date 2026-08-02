# Slice 0003 — Pregnancy, heat cycles and fertility

**Status:** ready to build. Slices 0001 and 0002 are built. Nothing in this document exists yet.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those.

**What this slice is.** Breeding stops being a button that produces a foal. A mare comes into season on a rhythm, a covering is booked and resolved by the tick, conception is a roll that can fail, gestation takes eleven game months, and very rarely two foals are born instead of one.

**Why this comes now.** Slice 0002 §2.4 promised this. `breedNow()` in `src/db/horses.ts` is a labelled stand-in for conception-plus-gestation, and it explicitly says the genotype, pedigree and naming code beneath it must be reusable as-is. This slice cashes that in: it changes *when* the foal row is inserted, not *how* the foal is built.

---

## 1. What "done" looks like

On the live URL, on a phone, with no terminal:

1. Apply the new migrations from `/admin/migrations`.
2. Open a mare's page and see whether she is in season, and if not, roughly when she will be.
3. Go to the breeding page, choose a mare and a stallion, and press **Check pairing**. The page shows the COI (as it does today) *and* the estimated chance this covering takes, broken into the reasons.
4. Press **Book covering**. Nothing is born. The mare's page says she is booked to that stallion and will be covered when she next comes into season.
5. Press the admin advance button until the tick reaches her season. Her page now says she was covered, and either that she is in foal with a due date, or that she did not take and will come back into season.
6. Advance to the due date. A foal appears in the barn as "Unnamed filly", exactly as it does today, with a colour inherited from its parents and a COI that matches the number shown in step 3.
7. Try to book a mare who is already in foal, or out of season for the year, and be refused in a sentence that says why.
8. Breed an eighteen-year-old mare and watch the estimated chance drop, with age named as the reason.
9. From an admin page, see the twin rates and force the next covering to produce twins, to check the display works without waiting for a 1-in-330 event.

If all nine work, the slice is done.

---

## 2. The clock, and why this slice fudges biology

Read this before designing anything, because it is the constraint everything else bends around.

Current settings: `game_days_per_tick = 10`, three tick slots a day (`07:00`, `12:00`, `19:00`), `game_days_per_year = 360`.

| | game days | real time |
|---|---|---|
| One tick | 10 | 8 hours |
| One real day | 30 | — |
| A game year | 360 | 12 real days |
| Gestation | ~340 | **~11.3 real days** |
| Foal to breeding age (3y) | 1080 | 36 real days |

**A real mare's oestrous cycle is 21 days, with about 6 days in season. Both are shorter than a single tick.** There is no tuning that fixes this — the biology is finer-grained than the clock. Sampling a 21-day cycle at 10-day steps is worse than useless: because 10 and 21 alias against each other, a mare gets one heat, then an eleven-tick drought (nearly four real days), then six heats on alternating ticks. Unfair and inexplicable.

**So the cycle is measured in ticks, not game days.** This is a deliberate departure from realism, forced by time compression, and it is the only one in this slice apart from twin survival (§6). Say so in the code comment where the cycle is computed, so a future session does not "fix" it back into game days.

---

## 3. Decisions taken for this slice

Settled in conversation on 2 August 2026. Treat them as standing decisions.

**3.1 The oestrous cycle is 4 ticks long; the mare is in season for 1 of them.**

Not 3. With three tick slots a real day, a 3-tick cycle locks every mare to a fixed time of day forever — a child who plays in the evening would find one mare permanently in season and another permanently not. A 4-tick cycle walks one slot per day and returns to the same time of day every four real days, so no play schedule is privileged. In game terms it reads as "a bit over a month" against a real 21 days.

**3.2 Each mare's slot in the cycle is rolled, once, from her own seed.**

`horses.cycle_anchor_tick_seq` holds the `tick_seq` on which her cycle phase is zero. Set at creation (founding horses) and at birth (foals) to `world.tick_seq + makeRng(deriveSeed(horse.rng_seed, 'cycle_slot')).int(estrous_cycle_ticks)`. She is in season when `(tick_seq - cycle_anchor_tick_seq) mod estrous_cycle_ticks < estrus_ticks`.

Rolled at creation rather than at breeding age: nothing reads the cycle until she is old enough, so the two are equivalent in effect and this needs no "did she turn three this tick?" check.

**3.3 Breeding books a covering. The tick resolves it on her next in-season tick.**

You choose the pairing and confirm it; the tick does the rest. This is also how real breeding works — a mare goes to the stallion for a cycle and is bred when she is ready, not when her owner happens to be standing there.

The reason this matters more than it looks: with five family members on different schedules, making the heat window a test of *when you are logged in* would decide whether the feature is loved or resented. The scarce thing is cycles, not attendance. A booking eats a cycle; a failed conception eats another.

**3.4 Conception is a roll that can fail. There is no other loss mechanic in this slice.**

No abortion, no reduction, no mare death, no stillbirth. A covering either takes or it does not, and a pregnancy that starts always finishes. (Homozygous lethals — overview §3b — are a later slice and are presented as an early-term pregnancy that does not continue. Nothing here forecloses that.)

**3.5 Fertility is a heritable polygenic trait, not a marker.**

A ninth trait on the machinery slice 0002 already built. It is invisible: you discover a subfertile mare by having her miss, or later by paying a vet for a breeding soundness exam. A single "subfertility allele" would be simpler and worse — fertility is not binary, and a marker teaches the wrong thing.

**3.6 Mares are seasonally polyestrous. There is a breeding season.**

Real mares breed roughly February to September. `breeding_season_start_game_day = 30`, `breeding_season_length_game_days = 180`, against a 360-day year. That is about 4–5 cycles a year, and a year is 12 real days. Missing the season costs ~6 real days.

This is the strongest pressure in the slice and the reason fertility matters at all. It is also the thing most likely to frustrate a young player, so **both numbers are live tunables and the mare's page always says when the season next opens.** Never let a player discover the season by being refused.

**3.7 Twins are rare, both survive, and the real-world reduction is hidden.**

See §6. This is the second deliberate departure from realism, and it is on purpose.

**3.8 Gestation length is snapshotted onto the pregnancy.**

`CLAUDE.md` §5.5. Drawn at conception from `gestation_days_mean` / `gestation_days_sd` via the pregnancy's own seed and written to `pregnancies.gestation_days`. Changing the config afterwards must never move a mare who is already in foal.

**3.9 The foal's genetics are rolled at conception, not at foaling.**

Schema doc §5.1 recommends this and it is right. It makes the draw reproducible from a stored seed, it keeps the foaling tick to a row insert, and it is what lets a later slice detect a lethal homozygote at conception rather than at birth. The foal's `rng_seed` is minted at conception and stored on the pregnancy as `foal_rng_seed`; at foaling it becomes `horses.rng_seed` unchanged.

**3.10 The `horses` row is created at foaling, not at conception.**

Schema doc §5.1. An unborn horse in `horses` shows up in capacity counts, pedigree walks and barn lists unless every one of them remembers to exclude it, and one of them eventually will not.

**3.11 `breedNow()` is deleted, not deprecated.**

Slice 0002 built it as a labelled stand-in. Its genotype/pedigree/naming body moves wholesale into the foaling path. Do not leave both.

---

## 4. Fertility: the formula

A pure function in `src/engines/breeding/fertility.ts`. No database access — it receives plain objects and returns a number plus the reasons behind it (`CLAUDE.md` §5.1).

```
p = base
  × mareAgeFactor       × stallionAgeFactor
  × mareFertilityFactor × stallionFertilityFactor
  × conditionFactor     (always 1.0 in this slice — see §4.4)
  × methodFactor        (always 1.0 in this slice — see §4.5)
  × inbreedingFactor
clamped to [conception_min, conception_max]
```

Return the breakdown, not just `p`. The breeding screen renders it (§7), and a hidden 39% feels like the game cheating while a visible one feels like a decision.

### 4.1 Base

`conception_base = 0.68`, a live tunable. Real per-cycle conception on a fresh live cover runs 55–75%, so this sits at the optimistic end of accurate — deliberately, because gestation is already 11 real days and two failed cycles on top of that is a long time to a nine-year-old.

`conception_min = 0.05`, `conception_max = 0.90`. Never zero and never certain.

### 4.2 Age

Config holds knots, linearly interpolated between them, flat outside the ends. Age in game years = `(game_day - born_game_day) / game_days_per_year`.

```
mare_fertility_age_knots:     [[3,0.85],[4,1.00],[10,1.00],[14,0.92],[17,0.75],[20,0.50],[25,0.30]]
stallion_fertility_age_knots: [[3,0.90],[4,1.00],[15,1.00],[18,0.92],[22,0.80],[28,0.60]]
```

**Soft decay, no hard cutoff.** There is no age at which a horse becomes barren and no "your mare can no longer breed" notification. An old mare is a long shot, not a closed door.

Stallions decline later and more gently than mares. That asymmetry is real, and it is the entire reason slice 0004 (the semen bank) exists.

### 4.3 The fertility trait — and one trap you must not walk into

Add `fertility` to `TRAITS` in `src/engines/genetics/polygenic.ts`. It inherits through the existing meiosis with no other change.

**The trap:** `getPolygenicString` in `src/engines/genetics/genotype.ts` reads a missing trait as all zeros — the *bottom* of the range. That is the right default for a conformation trait, and catastrophic here: every horse born before this slice would read as very nearly sterile.

**Do not back-fill the genotype blobs.** Instead, give fertility its own missing-value rule: when a horse's genotype has no `fertility` key, derive its score from `deriveSeed(horse.rng_seed, 'fertility_legacy')` instead of reading zeros. Every horse alive gets a stable, reproducible, well-distributed score; horses born after this slice carry the trait explicitly and inherit it properly. Put this behind one function — `fertilityPotential(horse)` — and never read `fertility` through `getPolygenicString` directly.

Map the 0–20 score onto `[fertility_gene_min, fertility_gene_max] = [0.75, 1.10]`. Asymmetric on purpose: an unlucky mare is meaningfully harder to get in foal, a gifted one is only slightly easier. That is how it actually works.

### 4.4 Condition

`conditionFactor` is a parameter of the engine and is passed `1.0` by every caller in this slice. Care and health do not exist yet. Wire the parameter now so the health slice has somewhere to put its number, and say in the comment that it is a placeholder.

### 4.5 Method

Same treatment: `methodFactor` is a parameter, always `1.0` here because every covering is a live cover. Slice 0004 passes `0.85` for cooled and `0.60` for frozen.

### 4.6 Inbreeding

`inbreedingFactor = 1 - inbreeding_fertility_penalty × foalCoi`, with `inbreeding_fertility_penalty = 0.5`. A 25% COI pairing loses about 12% of its conception chance.

Inbreeding depression on fertility is real, and this is the best teaching hook in the slice: the COI number already shown before a pairing stops being trivia and starts costing cycles. Use the COI from `previewCoi` / `loadPedigreeContext` in `src/db/horses.ts` — the same value the foal is actually born with.

---

## 5. NPC stables must not see what they have not paid to learn

Nothing in this slice creates an NPC stable. This section exists so that the slice which does cannot get it wrong, because the shape has to be right *now*, in the engine signatures.

**The rule: an NPC reads `horse_knowledge`, never `horses.genotype`.** Same table, same rows, same cost as a player. An NPC that wants to know whether its mare carries a lethal pays for the test out of its own `stables.balance`, and the row lands in `horse_knowledge` exactly like anyone else's.

**The enforcement is structural, not a check.** `CLAUDE.md` §13 already establishes this pattern for token transfers: *the absence of the code path is the enforcement — do not add one and guard it with a check.* Apply it here. The NPC selection policy will be a pure function (`CLAUDE.md` §5.1), and **its input type must simply not contain a genotype field.** An NPC cannot read truth because the data is not in the room, not because an `if` says no.

What this slice must do to make that possible:

- `fertilityPotential(horse)` takes a genotype and is therefore truth. **It is only ever called from the conception roll**, which is the world resolving physics — not from anything that makes a decision on a stable's behalf.
- The fertility *estimate* shown on the breeding screen (§7) is computed from a separate function that takes only what the viewer knows. In this slice a player owns both horses and knows their ages, so the estimate is honest about age and COI and treats both fertility factors as unknown-average (`1.0`). **The displayed number is therefore not the number rolled**, and that is correct: a subfertile mare's owner finds out by missing. Comment this clearly — it will otherwise look like a bug.
- Do not add a "seller sees everything" or "NPC sees everything" shortcut anywhere, including in admin views. Admin may see truth; an NPC never may.

**On the economy:** it is real and it already exists structurally. `stables.balance` is an integer column, seeded from `starting_balance = 10000`, and NPC stables are rows in the same table (`is_npc`, `account_id IS NULL`). There is no separate NPC economy and there must never be one — `CLAUDE.md` §13, "no parallel scoring path for NPC horses," for the same reason: two paths drift and one ends up accidentally advantaged. The `ledger` table lands with the turns-and-tick slice; until then, balance changes are direct updates.

---

## 6. Twins

Two rolls, both internal, both from the covering's seed:

1. **Double ovulation** — `twin_double_ovulation_rate = 0.15`. Real, and genuinely repeatable in individual mares.
2. **Both continue** — `twin_both_continue_rate = 0.02`. In reality the rest reduce naturally by around day 40.

Net: **about one foaling in 330 produces twins.**

**Roll 2 is where the real-world reduction hides.** The player never sees a pregnancy that "was twins". A reduced conception is simply a single foal, indistinguishable from any other — no event, no notification, no record. Nothing is lost from the player's point of view, because from the player's point of view nothing was ever there.

Keep it as two rolls rather than collapsing it into one 0.3% chance, so a future session can tune "how often twins conceive" separately from "how often they survive" without touching the other.

**When twins do happen, both live and both are healthy.** Real live twins usually lose both foals and endanger the mare. This is a deliberate departure — write it down in the code as a departure, so it does not read as an oversight to the next session.

Not identical twins: separate ovulations means **two independent genotype rolls**, each with its own `foal_rng_seed`. Correct biology and simpler code.

**Schema consequence.** A covering can produce two pregnancies, so the mating event and the pregnancy are different things. `coverings` holds the event, the method and the conception roll; `pregnancies` holds one row per foal, with a `covering_id`. Everything downstream — due date, genotype, foaling — stays single-valued and needs no twin special case. This amends the schema document §5.1, which has no concept of a covering.

---

## 7. Screens

**Breeding page** (`/stables/:id/breed`, exists). Keep **Check pairing** exactly as it is and add the conception estimate beside the COI, with its reasons listed — "she is 18 (−25%)", "these two are closely related (−6%)". Then **Book covering** replaces **Confirm breeding**. Refusals name the reason: already in foal, still recovering, out of season, too young, no room.

**Horse page** (`/horses/:id`, exists). For a mare, one line of state: in season now / due back in season around day N / booked to X, to be covered when she next comes into season / in foal to X, due day N / recovering. Plain sentences, no jargon — "in season" is the one term worth teaching by using it.

**Barn list.** A small badge on mares who are in season now. Reuse `.badge` / `.badge-success` from `public/style.css`; do not invent new styles.

**Admin.** A page showing the live fertility and twin tunables, and a control to force the next covering to twin, so §1 step 9 is testable without waiting for a 1-in-330 event. No JavaScript (`CLAUDE.md` §11) — the force-twin control follows the existing `required`-checkbox pattern from `src/render/admin.ts`.

---

## 8. Migrations

Next number is `0017`. One logical change per file, and register each in `src/db/migrations.ts` (`CLAUDE.md` §8).

- `0017_horses_cycle_anchor.sql` — `horses.cycle_anchor_tick_seq INTEGER` (nullable; mares only).
- `0018_coverings.sql` — the mating event.
- `0019_pregnancies.sql` — one row per foal, `covering_id` foreign key, `gestation_days` snapshot, `rng_seed`, `foal_rng_seed`, `rolled_genotype`, `status`, `foal_id` nullable, `last_processed_tick_seq`.
- `0020_config_fertility.sql` — the tunables in §3 and §4, added with `json_set` on the single config row, following `0016_config_breeding.sql`.
- A backfill for `cycle_anchor_tick_seq` on mares that already exist. Separate file, per §8's one-change rule.

Add indexes only for the queries these screens actually make: pregnancies due on or before a game day, and coverings awaiting resolution. Say why in the migration comment.

---

## 9. Seeds and reproducibility

New sub-seed labels, all via `deriveSeed`, never a second `makeRng` from a stored seed (`CLAUDE.md` §5.2):

- from `horses.rng_seed`: `cycle_slot`, `fertility_legacy`
- from `coverings.rng_seed`: `conception`, `double_ovulation`, `twin_continue`
- from `pregnancies.rng_seed`: `gestation`
- from `pregnancies.foal_rng_seed`: the existing slice 0002 labels (`mendelian_sire`, `mendelian_dam`, `polygenic_sire`, `polygenic_dam`, `sex`), unchanged

Record these in `CLAUDE.md` §11 when the slice lands.

---

## 10. The tick

Two new stages, both idempotent (`CLAUDE.md` §5.4), both guarded by `last_processed_tick_seq`:

1. **Resolve coverings.** For each booked covering whose mare is in season this tick and within the breeding season: roll conception, write the outcome, and on success create one or two pregnancies with their genetics already rolled.
2. **Foal.** For each pregnancy whose due day has passed: insert the `horses` row and its `horse_ancestors` rows, set the dam's `last_foaled_game_day`, and reset her `cycle_anchor_tick_seq` to `tick_seq + 1` — foal heat, which is real, and which also desynchronises mares whose cycles happen to have lined up.

A missed tick must not skip a foaling: derive from `due_game_day <= game_day`, never from "is this the tick it was due on". A double-fired tick must not foal twice: `pregnancies.status` and `foal_id` make that checkable.

**On capacity:** a stable at capacity when a foal is due is a case that must be decided, not crashed on. Recommendation — foal anyway and let the stable be over capacity, with the overflow blocking further purchases until resolved. Refusing to foal is not a thing that can happen to a horse.

---

## 11. What this slice does not build

- Stud fees, stud bookings between stables, or any cross-stable breeding. Both horses are owned by the same stable, as today.
- Semen collection, freezing or shipping — slice 0004.
- NPC stables. §5 shapes the interfaces for them; it does not create one.
- Care, condition or health effects on fertility. §4.4 wires the parameter and passes 1.0.
- Lethal homozygotes. §3.4.
- Any twin-related complication: no size penalty, no extra risk, no special handling after birth. A child getting two foals should be pure delight, and one surprise at a time is enough.
