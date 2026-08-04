# Slice 0022 — Incidents untangled from genetics, and a plain word next to each conformation trait

**Read `CLAUDE.md` first, then this.** This is a **specification, not a build**. Nothing has changed
in the database or the code by writing it.

Two unrelated pieces of work, written up together because the operator raised them together. They
share no code and can be built in either order, or separately.

- **Part A** corrects a structural mistake in slice 0020: the twelve acquired conditions were filed
  in the genetics tables, which is the wrong shelf and keeps nearly making colic testable.
- **Part B** puts a word — *Poor*, *Acceptable*, *Outstanding* — next to each conformation trait
  once a horse has shown, so nobody has to memorise eight breeds' ideal numbers.

---

# Part A — Incidents are not genetic conditions

## A1. What went wrong

Slice 0020 built colic, laminitis, ulcers and nine more as rows in the `conditions` table, with
per-horse rows in `horse_conditions` — the same two tables that hold HYPP, HERDA, GBED and PSSM1.

Those tables are genetics tables. Every column in them is a genetics column, and for the twelve
acquired rows nearly all of them are dead weight or a lie:

| Column | What it means for HERDA | What it holds for colic |
|---|---|---|
| `locus_code` | the locus the condition reads | `NULL` |
| `trigger` | `{"locus":"HERDA","mutant":"Hrd","mode":"recessive"}` | a completely different JSON shape |
| `severity_class` | lethal / manageable / degenerative | `'acute'`, a fifth value invented for these rows |
| `test_cost_key` | what the genotype test costs | `NULL` |
| `breed_associations` | which breeds carry it | `'[]'` |
| `signs_visible` | is there a hidden carrier state to protect | `1` for all twelve — there never is |
| `teaching_text` | how inheritance works | a note that this is *not* inherited |

**The consequence is that every piece of genetics code now has to remember to exclude them.** There
are six such guards in the codebase today, all written in slice 0020:

- `src/routes/horses.ts:595` and `:1119` — the testing page and the horse page
- `src/routes/market.ts:187` — the listing's health disclosure
- `src/db/npcMarket.ts:165` — what an NPC pays to test before buying
- `src/db/consignment.ts:474` — the dealer's disease panel
- `src/db/health.ts:62` — `getLethalTriggers`

Every one of them is a filter written *after the fact* on a shared query (`getEnabledConditions`),
and every one of them is load-bearing. **Forget one and colic appears on the testing page with a
price next to it** — which is precisely the wrong idea about what colic is. Worse, some of them fail
loudly and some fail quietly: `parseConditionTrigger` throws outright on an acquired row's JSON,
while a display loop just renders nonsense.

The operator's objection is the right one, and it is not a cosmetic one. Colic being medical is
incidental. It is an **event** — novelty and chance — not something a horse carries, not something a
test reveals, and not something a breeder can select against by buying a panel.

## A2. The fix: two new tables, and every filter deleted

Move the twelve out of the genetics tables entirely.

**`incident_types`** — reference data, one row per incident, replacing the twelve `conditions` rows.
Carries only what an incident actually has: `code`, `name`, `risk_model` (today's `trigger` JSON,
renamed to say what it is), `treatment_window_game_days`, `treatment_cost_key`, `enabled`,
`description`, `event_text`, `sort_order`. No `locus_code`, no `severity_class`, no
`breed_associations`, no `signs_visible`, no `test_cost_key`, no `bars_showing`.

**`horse_incidents`** — one row per episode, replacing the acquired rows in `horse_conditions`:
`horse_id`, `incident_type_code`, `state` (`acute` / `resolved`), `onset_game_day`,
`resolve_game_day`, `treated_game_day`, `outcome`, plus its own `management_state` /
`management_until_game_day` columns.

After the move, all six filters in §A1 are **deleted rather than corrected**. The mistake stops
being something a future session has to remember and becomes something the schema will not let them
express.

## A3. What deliberately does not change

- **The risk maths.** `src/engines/health/acquired.ts` is a pure engine and keeps its numbers, its
  weights and its outcome tables exactly as they stand. This is a filing change, not a retune.
- **The tick stages, treatment, death path, show barring and the care penalty.** All keep their
  current behaviour; they read the new tables instead of the old ones.
- **The management engine.** `src/engines/health/management.ts` is pure and gets reused unchanged;
  only the columns it is fed from move.
- **The one genuine tie to genetics stays, and it is not a mistake.** Four of the twelve read a
  heritable robustness trait (`foot_robustness`, `joint_robustness`, `ligament_robustness`) as one
  input to onset *risk*. That is a horse being built a bit sounder than another horse — it is never
  a test result, never a carrier status, never a row in `horse_knowledge`, and never shown to a
  player as a fact about the horse. Risk is allowed to be heritable. A **condition** is not.

## A4. Migrations

Forward-only, one logical change each (`CLAUDE.md` §8), each registered in `src/db/migrations.ts`:

1. Create `incident_types`.
2. Seed the twelve from the values currently in `conditions` (a straight transcription of
   `0125_seed_acquired_conditions.sql`, restructured — no numbers change).
3. Create `horse_incidents`, plus the indexes the tick's two stages and the horse page actually use.
4. Backfill `horse_incidents` from the acquired rows in `horse_conditions`, **including open ones**
   — a colic in progress keeps its onset day, its window and its treated state, so no horse in the
   family's stables is left mid-incident with the incident vanished.
5. Delete the acquired rows from `horse_conditions` and the twelve rows from `conditions`.

**`horse_incidents` references `horses`, so it must be registered in one of the two lists in
`src/db/horseRemoval.ts`** — it belongs in `buildDeleteHorseStatements` (an incident is a fact about
one horse and goes with it), not in `deletableHorseSql`. This is exactly the case that file's own
comment warns a future migration about; if it is missed, the pet-home delete starts failing inside a
batch. `src/db/reset.ts` needs the new table added to its delete order too.

## A5. Vocabulary

`CLAUDE.md` §12 gains: **condition** means an inherited condition; **incident** means one of the
twelve. The code already half-agrees with itself — `rollAcuteIncidents`, `OpenIncidentView`,
`/admin/incidents` — so this finishes a rename the previous session had already started, across
`src/db/acquiredConditions.ts` (→ `src/db/incidents.ts`) and
`src/engines/health/acquired.ts` (→ `src/engines/incidents/risk.ts`).

## A6. The history gets trimmed

**Operator decision:** the horse page shows only incidents from roughly the last one to two game
years. A horse that lived a long life should not accumulate a permanent medical dossier — an
incident that happened, resolved, and left no mark is novelty, and novelty has a shelf life.

- **The trim is display-only. Rows are never deleted.** `/admin/incidents` is the tuning instrument
  for numbers that have never been checked against real play, and its outcome distribution is only
  worth reading because it covers everything that has ever resolved. Deleting old rows would quietly
  destroy the one measurement that says whether colic's 40%-untreated is right. Rows stay; the horse
  page just stops drawing the old ones.
- The window is a config value, `incident_history_game_days`, **default 720** — two game years at
  today's `game_days_per_year` of 360. A live tunable, read directly at render time, not snapshotted
  (`CLAUDE.md` §5.5): it only affects what is drawn on the next page load.
- The window is measured from the incident's `resolve_game_day`, not its onset.
- **An open incident is always shown regardless of the window**, and so is any incident whose
  outcome is `degenerative` — that one is not history, it is the reason the horse can't be entered
  in a class, and it must stay visible for as long as it applies.
- When the window hides at least one incident, the card ends on a plain count rather than silently
  dropping them: *"3 earlier incidents, all resolved."* Nothing is lost without being mentioned.

Worth the operator knowing when tuning this: at `game_days_per_tick` of 10, two game years is only
a few real weeks of play. If the list still feels long, the number to move is
`incident_history_game_days`, and it moves without a deploy.

---

# Part B — A plain word next to each conformation trait

## B1. What it is

The horse page's Conformation card currently ends on this line:

> *These are measurements, not marks — which end a breed wants arrives with the first show class.*

That promise has never been kept. The first show class arrived in slice 0008 and the card still
shows four (now five) bare numbers with no indication of which direction is good. A child deciding a
pairing has to hold eight breeds' ideal vectors in their head to read it.

**Once a horse has shown at least once, each conformation trait gains a one-word verdict** —
*Poor*, *Weak*, *Acceptable*, *Good*, *Outstanding* — saying how close that trait sits to what this
horse's own breed wants. A horse that has never shown reads **Unknown** on every trait.

## B2. Where the word comes from

Not a new opinion. The judge already computes exactly this number, per trait, in
`scoreEntry` (`src/engines/showing/score.ts`):

```
traitScore = max(0, 100 - |expressed - target| * show_ideal_falloff)
```

The label is a band on that same `traitScore`, using the horse's own breed's `ideal_vector` and
**no** judge weights (a weight says how much a judge cares, not how good the horse is). Reusing the
judge's own formula is deliberate: `CLAUDE.md` §13 forbids a second scoring path, and this is the
same rule applied to a display.

Band edges live in `config` as live tunables so the operator can move them without a deploy.
Starting proposal, at the default falloff of 2.0:

| `traitScore` | Distance from target | Word |
|---|---|---|
| 90–100 | within 5 | Outstanding |
| 75–89 | within 12 | Good |
| 55–74 | within 22 | Acceptable |
| 30–54 | within 35 | Weak |
| below 30 | further | Poor |

These are first guesses and want checking against real horses.

## B3. The gate: at least one start, and **Unknown** before it

The real word appears only when `horse_show_summary.starts >= 1` for that horse. Before that, every
trait reads **Unknown**.

**Unknown is rendered, not omitted.** This matters more than it looks: a blank column reads as a bug
or as an answer, and a child comparing two horses can't tell "we haven't found out yet" from
"nothing to say." *Unknown* says the thing plainly and, better, tells them exactly what to do about
it — enter the horse in a class.

This is the promise the card already makes, kept literally: showing a horse is how you learn what
the breed wants. It also keeps a real cost on the information — a child who wants to know whether a
young horse's shoulder is any good has to enter it and pay the entry fee, rather than reading the
answer off the page for free the day it is born.

A retired or dead horse that showed in its life keeps its labels; the gate is the show record, which
`horse_show_summary` is deliberately built to outlive the horse.

Where the horse's breed has no `ideal_vector` (possible only if a future breed is added without
one — all eight in play have had one since migration `0107`), every trait reads *Unknown* as well.
The two cases are genuinely the same sentence from the player's side: the game can't tell you yet.

The card's closing line changes with the gate. Never shown, it keeps today's wording; once shown, it
should stop promising something it has now delivered — one sentence saying the words are measured
against this horse's own breed, and that a different breed would score the same horse differently.

## B4. **The bars must get shorter**

This is the part most likely to be got wrong, so it is called out on its own.

Today's markup is a full-width bar:

```html
<div class="meter"><div class="meter-fill" style="width: 55%"></div></div>
```

`.meter` is a block element at 100% of the card's width. **Adding the word to the right of it
without shrinking the bar will push the word off the right edge of the screen on a phone**, which is
where the children actually read this game.

The bar and the word go in one flex row, and the bar takes what's left:

```css
.meter-line   { display: flex; align-items: center; gap: 0.5rem; }
.meter        { flex: 1 1 auto; min-width: 0; }   /* min-width: 0 is required */
.meter-verdict{ flex: 0 0 5.5rem; text-align: right; font-size: 0.8rem; }
```

`min-width: 0` on `.meter` is not optional decoration — a flex item defaults to `min-width: auto`
and will refuse to shrink below its content, which is the exact mechanism that produces the
horizontal overflow this note exists to prevent.

Size the reserved column against the longest word (*Outstanding*, 11 characters) at the smallest
supported width, and check the result at 320px before calling it done. There is no JavaScript
anywhere in this codebase and this introduces none.

The word must be legible on its own, not by colour alone — colour may reinforce the band, never
carry it.

## B5. The breeding preview gets them too

**Operator decision: yes.** This is where the labels earn their keep — the horse page is where you
read about one horse, the breeding page is where you actually decide a pairing, which is the reason
this slice exists at all.

`/horses/breed`'s "This pairing" card gains a conformation block: one row per trait, the mare's word
and the stallion's word side by side. It slots in beside the existing COI, conception-chance, health
and foal-colour blocks, which already follow exactly this shape.

- **Words only, no bars.** Five traits × two horses is ten bars on a card that already carries four
  other blocks. The same phone-width argument that shortens the bars in §B4 says not to put bars
  here at all. A two-column list of trait → word survives a narrow screen; twin bar charts do not.
- **Each parent is judged against its own breed's ideal, not a shared one.** A cross-breed pairing
  is possible in this game, and a Quarter Horse and an Arabian genuinely want different shoulders.
  Never score both parents against one vector, and never against the foal's breed — the foal doesn't
  exist yet and has no breed to have an opinion.
- **The gate is per parent.** An unshown mare booked to a proven stallion reads *Unknown* down her
  column and real words down his. That asymmetry is the honest picture and is worth showing.
- The route already has both horses, both breeds and both COI-relevant records loaded for the
  existing preview; this needs one extra lookup per parent (`horse_show_summary.starts`) and the
  same `conformationDisplayRows` call the horse page makes.

**A note the operator should hear before this ships:** the preview shows the *parents'* words, and a
foal is not the average of its parents. Two *Outstanding* shoulders can still throw a foal with a
poor one — that is what the genetics engine does and it is the point of the game. The block should
carry one plain sentence saying so, or the labels will quietly teach the children a rule that isn't
true.

## B6. Where it does not go

- **The barn list's compact line** (`Neck 55 · Shoulder 60 · …`). Five numbers already fill that
  line on a phone; five numbers plus five words would wrap into a paragraph per horse and make the
  list unreadable. Out of scope.
- **Anything about ability traits, health or care.** This slice touches conformation only.
