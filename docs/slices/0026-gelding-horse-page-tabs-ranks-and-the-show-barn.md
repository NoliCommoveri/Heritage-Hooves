# Slice 0026 — Gelding, horse-page tabs, rank display, and the show barn

Commissioned 2026-08-05. Four independent pieces; build in stage order, each stage deployable on its own.

Every decision below is settled. Where a number is a first guess it says so.

| Stage | Contents |
|---|---|
| 1 | Gelding: the action, the show bonus, the appraisal terms |
| 2 | Horse page: four tabs |
| 3 | Shows: rank display, ribbons grouped by rank, rank on the Enter button, catalogue pruning |
| 4 | The show barn: split from Apples and Oats Ranch, rank-seeded, auto-topped-up, dies at decline start |

Next free migration number is `0169`. Every migration also needs registering in `src/db/migrations.ts` (CLAUDE.md §8).

---

## 1. Stage 1 — Gelding

### 1.1 The action

`POST /horses/:id/geld`, with a `GET` confirmation page first. Same shape as `/retire` and `/pet-home`.

Add `/geld` to `HORSE_ROUTE`'s sub-path list **and** the handler chain in `src/router.ts`. `test/router-paths.test.ts` reads the router source and asserts the two agree — it will fail if only one is updated.

Refuse unless: alive, owned by the acting stable, `sex = 'stallion'`, in the barn (`availabilityForHorse` returns available), and **no unresolved paid stud booking against him**. There is no refund path; the refusal sentence names the booking and says to wait for it to resolve.

Costs one turn and `gelding_cost` (config, first guess 400). No PIN gate.

### 1.2 What gelding writes

In one batch:

- `horses.sex = 'gelding'`, `horses.gelded_game_day = <game_day>` (migration `0169`, nullable INTEGER).
- Withdraw any active stud listing (`withdrawStudListing`, `src/db/stud.ts`).
- Cancel every unresolved covering where he is the sire, `cancelled_reason = 'sire_gelded'` — a third value alongside `cancelledReasonFor`'s existing `sire_died`/`sire_removed` (`src/db/ageing.ts`). Add it as its own constant; do not widen `cancelledReasonFor`, whose signature is keyed on `status`.
- Ledger row, kind `gelding`.
- An `events` row for the owning stable.

**Existing pregnancies stand.** A conception already resolved is untouched.

### 1.3 Recovery

New `EligibilityReason`: `recovering_from_gelding`, returned while `game_day - gelded_game_day < gelding_recovery_game_days` (config, first guess 30). Wording in `render/shows.ts`'s `eligibilityMessage`, phrased as a wait with an end date, like `settling_in`.

Ordering inside `checkEligibility`: after the location checks, before age.

### 1.4 The show bonus

**A gelding's negative show noise is reduced. Mares and stallions are unchanged.** Applies to every class type — conformation, discipline, young-horse and ability alike.

One transform, at one place. `judgeOneClass` (`src/db/shows.ts`) computes `noiseForEntry(cls.rng_seed, horse.id, cls.noise_sd)` once and hands the result to whichever scorer applies, so the transform goes in `src/engines/showing/noise.ts` and reaches all four class types with no per-scorer branch:

```
geldingAdjustedNoise(noise, isGelding, relief):
  if (!isGelding || noise >= 0) return noise;
  return noise * relief;
```

Pure, no new RNG stream. The underlying draw is still derived from `(class seed, horse id)`, so a re-fired tick reproduces the class byte for byte (CLAUDE.md §5.2).

`show_gelding_noise_relief` is a **live config key, not snapshotted onto the class** — unlike `noise_sd` beside it, and following the `discipline_aptitudes` precedent. First guess **0.75**. At `show_noise_sd = 5` that is worth about +0.5 points of expected score.

`score_breakdown` gains a `gelding` block carrying the raw noise, the relief factor applied, and the adjusted noise. That block is the only surviving record of what a horse was judged with, since the factor is not snapshotted. The result page reads it.

### 1.5 Appraisal

`appraise()` (`src/engines/market/appraise.ts`) reads neither `sex` nor a show record today. Two new factors, both multiplicative alongside the existing ones, both modest:

- **`market_gelding_factor`** (first guess 0.75) — applied when `sex = 'gelding'`, otherwise 1.
- **A show-record factor** built from the horse's **rank**, not its win count: `market_rank_factors`, a JSON map `{"novice":1.0,"open":1.15,"champion":1.35}` (first guesses). Read the horse's **highest rank held across all `class_key`s**. A horse with no `horse_class_ranks` row reads `novice`, i.e. 1.0.

They compound, which is the intent: an intact stallion who also shows is premium; a gelding that has never shown is cheapest.

`AppraiseParams` gains `isGelding: boolean` and `highestRank: ShowRank`. Every existing caller must pass them — the appraisal is used by the market, the buy offers, the NPC purchase path and the horse page's guide value.

### 1.6 Also true, no work needed

`npcBuying.ts` already skips geldings on both NPC mechanisms, and `npcStud.ts` already requires `sex = 'stallion'`. The barn's Geldings tab (`src/lib/barnFilter.ts`) and the market's already exist and light up on their own. `describe.ts` already has gelding/colt nouns.

Delete the now-false comment at `src/render/horses.ts:490` ("there is no gelding path in the game today").

---

## 2. Stage 2 — Horse page tabs

`/horses/:id` renders seventeen blocks. Group them behind four tabs.

**No JavaScript.** Tabs are plain links with a query parameter, exactly like the barn list's (`renderBarnList`, `src/render/horses.ts`).

### 2.1 Layout

Always rendered, above the tab bar:

- the vitals card (portrait, description, sex/age, breed, bred by, COI, mare status)
- the Register-a-name and Barn-name forms
- any error or notice box
- the **Grow up** card while it applies (`params.timeWarp !== null`) — pinned, not filed under a tab

| Tab (`?tab=`) | Label | Cards |
|---|---|---|
| `genetics` (default) | Genetics | Conformation + evaluation, Ability, Colour and gait, Pedigree, Genotype (admin) |
| `care` | Health & care | Health, Incidents, Care, Location |
| `shows` | Shows | Show record, ranks, Enter a class |
| `market` | Buying & selling | Sell, Stud, Retire away / pet home, admin delete |

### 2.2 Rules

- An unrecognised or missing `tab` renders `genetics`.
- **Every POST handler on this page redirects back to its own tab** (`/horses/:id?tab=care` after a care action, and so on), so a success notice is never hidden behind a tab the player is not on.
- A tab whose cards would all be empty for this viewer (a non-owner sees no Health or Incidents rows) still renders its tab button, with a muted line inside. Do not hide tabs conditionally — the tab bar must be stable across viewers.
- `<details class="section-collapse">` stays exactly as it is for the sub-sections that already use it (colour groups, the evaluation block). Do not convert them.

### 2.3 Scope

`renderHorsePage` picks which cards to draw from the tab. **The route still loads everything.** Skipping the loads for hidden tabs is a real win and is deliberately not in this slice — it means making ~60 render params optional, and it should be a separate change once the tabs themselves are proven.

---

## 3. Stage 3 — Rank display and the Enter card

### 3.1 Show ranks on screen

`horse_class_ranks` (migration `0166`) stores `rank`, `top3_since_promotion` and `wins_since_promotion` and none of the three is rendered anywhere.

**Show record card** — one line per `class_key` the horse holds a row for, naming the rank and the progress toward the next:

> Dressage — **Open** · 2 of 4 top-three finishes and 1 of 1 wins toward Champion

A horse at `champion` reads the rank with no progress clause.

**Barn list** — one badge showing the **highest rank held across all `class_key`s**, worded so it cannot be misread as global (`Champion (dressage)`, naming the class it was earned in). A horse whose highest is `novice` gets no badge.

**Non-owner screens** — the market listing, the stud listing and `/world/horses/:id` all show rank. Rank is public; it is earned in public. Push it through the shared builder (§3.2) so the four screens cannot drift.

### 3.2 Ribbons grouped by rank

`buildShowResultGroups` / `showResultGroupsHtml` (`src/render/shows.ts`) are the one builder and renderer all four screens use. Both gain a level.

`listRecentResultsForHorse` already joins `show_classes`; add `sc.rank` to its select and to `HorseResultRow`. **No migration.**

Structure: class label (unchanged: Conformation, Dressage, Young Horse Conformation, `<Trait>` Test) → rank → placings.

- Rank sub-groups ordered **Novice → Open → Champion**.
- Placings within a sub-group stay newest-first, as today.
- `SHOW_RESULT_GROUP_CAP` (5) now applies **per sub-group**, not per label.
- **The horse's current rank in that class renders open; every lower rank renders inside a `<details class="section-collapse">`** with a summary naming the count ("Novice record — 6 placings").
- `rank = 'none'` (young-horse and ability classes) gets no sub-grouping. Flat, as today.

### 3.3 The Enter button names the rank

`buildCatalogueStatusForHorse` (`src/db/shows.ts`) already computes `targetRank` per catalogue row and discards it. Surface it on `CatalogueRowStatus` and on `EnterShowInfo`.

Button text: `Enter in Dressage (Open)`. For `rank = 'none'` rows, no bracket.

The existing `statusSentence` beneath it — "3 entered, judged in 6 days." vs "Nobody yet - starts a show, judged in 14 days." — is unchanged.

### 3.4 Prune the catalogue

The catalogue is 40 rows today (8 breed conformation + 6 discipline + 16 young conformation + 10 ability test). An adult Quarter Horse currently renders 7 buttons and **33 muted refusal lines**.

**Rule: render a row only if this horse could ever enter it.**

- **Drop the row entirely** when the refusal is a permanent fact about the horse: `wrong_breed`, `crossbred_not_eligible`, `wrong_sex`, `requires_gait`.
- **Keep the row** when the refusal is temporary or actionable: `too_young`, `too_old`, `at_pasture`, `settling_in`, `recovering_from_gelding`, `acute_incident`, `degenerative_incident`, `barred_by_condition`, `entry_cap_reached`, `already_entered`.

Put the split in one exported predicate next to `EligibilityReason` so the rule has a single home.

Then, in `enterShowBlock`:

- Eligible rows render as buttons, grouped under headings matching §3.2's labels (Conformation, each discipline, Young Horse, Ability Tests). Young Horse and Ability Tests render inside a collapsed `<details>`.
- Kept-but-not-eligible rows render inside one collapsed `<details>` — "9 more classes she isn't ready for yet" — never inline among the buttons.

### 3.5 Thin fields

`target_field_size` (default 8) is **a ceiling on how much padding to add, never a quota to meet.** A class judges with whatever it has. This already holds — `assignPlacings` places every entry it is given, and the prize loop iterates entries indexing `prizeSchedule[placing - 1]` with a `if (!prize) continue` guard. **Do not add a minimum-field check anywhere**, and in particular not to stage 4's two-tier fill.

Fix one stale exclusion: `thinFieldNote` (`src/render/shows.ts`) skips `breed_conformation` on the grounds that a breed class "already draws on a full breed-specific NPC pool built up over the whole game". Rank brackets split that pool three ways and made it false. **Drop the exclusion**; the note applies to every class type.

---

## 4. Stage 4 — The show barn

### 4.1 The problem

Migration `0040` created the show barn (`Fair Meadow`). Migration `0085` attached an `npc_policy` row to that same stable, making it the Quarter Horse volume breeder. Migration `0136` renamed it `Apples and Oats Ranch`. `SHOW_BARN_PREFIX` and the QH volume breeder are one stable.

**Split them.** Apples and Oats Ranch keeps its `npc_policy` row and stays the QH volume breeder, nothing else changes about it. A new stable takes over the show-barn role.

### 4.2 The new stable

Prefix and name: **`Fair Meadow Show Barn`** (prefix `Fair Meadow`, free again). Created by migration `0169` **and** by `src/db/reset.ts` — the reset path is the one that will actually run.

- `is_npc = 1`, `account_id = NULL`, `balance = 0`, `capacity = 100`.
- Its own `stable_prefix_history` row, so no player can claim the prefix.
- **No `npc_policy` row.** `npcBreeding.ts` iterates `SELECT * FROM npc_policy`, so this is what makes it never breed. Same shape as the Consignment Yard.

Repoint `SHOW_BARN_PREFIX` (`src/db/npc.ts`) at it and fix that file's header comment, which still claims the barn never breeds.

**Exclude it explicitly** from: NPC stud (`src/db/npcStud.ts` — add a stable-level exclusion, the existing `sex = 'stallion'` check is not enough), NPC market listing, NPC buying (`src/db/npcBuying.ts`), and the pet home. The income floor needs nothing — it reads `npc_policy.balance_floor`, and there is no row.

Prize money it wins accumulates in its balance and is never spent. `/admin/npc` labels it as a non-trading barn rather than hiding the number.

### 4.3 Stock

**10 horses per breed in play** (`getBreedsInPlay()`, filtered to breeds with an `ideal_vector` — as `stockShowBarn` already does). Three breeds today = 30 horses.

| Rank seeded | Count | Quality band |
|---|---|---|
| `novice` | 2 | `mid` (0.50) |
| `open` | 4 | `mid` (0.50) |
| `champion` | 4 | `high` (0.58) |

Config: `npc_show_barn_size` 6 → **10**; `npc_show_barn_quality_band` is replaced by `npc_show_barn_rank_plan`, JSON: `[{"rank":"novice","count":2,"band":"mid"},{"rank":"open","count":4,"band":"mid"},{"rank":"champion","count":4,"band":"high"}]`.

Founding specialists come free — `mintFoundingHorses` has passed the ideal vector and eligible ability traits to every NPC mint since 2026-08-04.

### 4.4 Rank seeding

Ranks are **written at mint**, never earned. A show-barn horse gets a `horse_class_ranks` row at its assigned rank for:

- its own breed's conformation key, `bc:<breed_id>`; **and**
- `disc:<code>` for every enabled discipline where **its breed's `discipline_aptitudes[code] > 1.00`** (`parseDisciplineAptitudes`, `src/engines/breeds/identity.ts`, migration `0144`).

With the three breeds in play that gives:

| Breed | Keys |
|---|---|
| Quarter Horse | `bc:QH`, `disc:barrels` (1.05), `disc:racing` (1.02) |
| German Warmblood | `bc:GW`, `disc:jumping` (1.05), `disc:dressage` (1.04) |
| Paso Fino | `bc:PF`, `disc:gaited` (1.05) |

**Endurance gets no show-barn coverage and that is intended** — no breed in play is above 1.00 in it. Do not add a fallback that assigns the best available breed. A thin Champion endurance field is a true statement about which breeds are being bred. It resolves on its own if Arabian (endurance 1.05) is ever enabled.

`top3_since_promotion` and `wins_since_promotion` are seeded 0.

### 4.5 Ranks are frozen

**Skip `writeHorseClassRank` for any horse owned by the show barn.** They win ribbons and never promote. Without this the Champion field slowly fills with computer horses that climbed there — the NPC ceiling problem through a side door.

`horse_show_summary` is left alone; it is per-horse and harmless.

### 4.6 They die at decline start

At mint, set

```
natural_death_game_day = born_game_day + age_decline_start_game_days
```

instead of rolling a lifespan from the horse's seed. `age_decline_start_game_days` is 5760 (16 game years) — the exact day `agePerformanceModifier` stops returning 1.0. A show-barn horse therefore competes at a 1.0 age modifier its whole life and dies the day it would first be penalised.

**Snapshot the value, do not read the config at death time** (CLAUDE.md §5.5). Retuning the decline curve must not retroactively kill or resurrect the barn.

`killDueOldHorses` (`src/db/ageing.ts`) needs **no change** — it already has no `is_npc` filter and simply reads the column. `noticeFrailty` is player-only, so no frailty notices are written.

**Mint them across a wider age spread than founding stock**, so turnover is continuous instead of arriving as a wave. New config keys `npc_show_barn_age_min_game_days` / `npc_show_barn_age_max_game_days`, seeded **1440 / 5040** (4 to 14 game years) against founding stock's 1440/2880. Pass these to `generateCandidate` in place of `founding_age_min/max_game_days` for show-barn mints only.

### 4.7 Auto top-up

A new tick stage tops the barn up to §4.3's plan every tick. Idempotent: it counts what the barn currently holds per (breed, rank) and mints only the shortfall, so a full barn mints nothing. Spends no money and no turns.

Place it before the judging stage, so a class judged this tick sees a barn already refilled.

The manual button at `/admin/shows` stays, and is upgraded per §4.8.

### 4.8 The mint control

Fold `stockShowBarn` and `stockNpcStable` into one `/admin` form taking **stable · breed (or "all in play") · quality band · count**, plus a **"Restock show barn to plan"** button that applies §4.3 in one press.

Pressing restock after enabling a new breed at `/admin/breeds` mints that breed's 10 and touches nothing else — it is a per-breed shortfall top-up. Say so on `/admin/breeds` next to the enable toggle.

### 4.9 Last-resort fill

`judgeOneClass` currently calls `listNpcStableHorses(env)` — every NPC stable's stock, undifferentiated — shuffles, and takes the shortfall. Make it two tiers:

1. `shortfall = target_field_size - player entries`. **Keep the existing floor: a class no player entered is never topped up at all.**
2. **Tier 1 — the breeding NPC stables** (those with an `npc_policy` row). Order them so barns scoped to this class draw first: `npc_policy.target_breed_id` matching a `breed_conformation` class's `breed_id`, or `target_discipline_code` matching a `discipline` class's `discipline_code`. Within a tier, shuffle off the class seed as today.
3. **Tier 2 — the show barn**, only for whatever shortfall remains.

Tier 1 is an **ordering, not a filter**. A hard "scoped barns only" filter would empty tier 1 for every class no barn targets and push everything straight to the show barn.

Both tiers run through `eligibleNpcHorsesForClass` unchanged — rank, breed, age, incidents and the per-stable cap gate an NPC exactly as they gate a player (CLAUDE.md §13: no parallel scoring or eligibility path).

If both tiers together cannot reach `target_field_size`, **the class judges short.** See §3.5.

### 4.10 Housekeeping

- Add the new stable's prefix constant to `src/db/reset.ts`'s list alongside the other eleven.
- Show-barn horses die, so they flow through the ordinary death path — `buildEndHorseParticipationStatements` cancels their open show entries. Nothing new needed.
- `/admin/shows`' "oldest barn horses" table should show each horse's `natural_death_game_day` now that it is deterministic.

---

## 5. Tests

1. `geldingAdjustedNoise` leaves positive noise and non-geldings untouched; the same `(class seed, horse id)` reproduces the same adjusted value across runs.
2. Gelding cancels unresolved coverings as `sire_gelded`, withdraws the stud listing, and leaves an existing pregnancy intact.
3. Gelding is refused while an unresolved paid outside stud booking exists.
4. `appraise()` on two identical horses differing only in `sex` returns the lower value for the gelding; differing only in highest rank returns the higher value for the champion.
5. `/geld` appears in both `HORSE_ROUTE`'s regex and the handler chain (extend `test/router-paths.test.ts`).
6. The catalogue prune drops `wrong_breed` rows and keeps `too_young` ones.
7. Ribbon grouping: a horse with placings at two ranks in one discipline produces two sub-groups, ordered novice-first, capped per sub-group.
8. Rank seeding: a German Warmblood show-barn horse at `champion` holds exactly three `horse_class_ranks` rows (`bc:GW`, `disc:jumping`, `disc:dressage`); a Paso Fino holds two. **No horse holds a `disc:endurance` row.** Read the aptitudes from the seed migration on disk rather than hand-copying them, as `test/showing/breed-aptitude.test.ts` already does.
9. Judging a show-barn horse writes no `horse_class_ranks` update.
10. A show-barn horse's `natural_death_game_day` equals `born_game_day + age_decline_start_game_days` exactly.
11. Auto top-up on a full barn mints zero; on a barn missing two Champions mints exactly two, at the `high` band.
12. Two-tier fill: with a scoped breeding barn holding eligible horses, the show barn contributes nothing; with tier 1 exhausted, the show barn fills the remainder; with both short, the class judges with fewer than `target_field_size` and pays prizes only for the placings that exist.

---

## 6. Numbers that are first guesses

`gelding_cost` (400) · `gelding_recovery_game_days` (30) · `show_gelding_noise_relief` (0.75) · `market_gelding_factor` (0.75) · `market_rank_factors` (1.0 / 1.15 / 1.35) · `npc_show_barn_size` (10) and its rank plan · `npc_show_barn_age_min/max_game_days` (1440 / 5040).

All live config, all editable at `/admin/config`. Expect to retune the noise relief and the rank factors after real play.
