# Slice 0014 — Before the children play: age, management, and the genes we cannot add later

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts of them this
slice depends on are quoted or summarised below.**

This slice exists for one reason. The Quarter Horse is the breed the game has been developed
against, and it is ready enough to hand to the children — but three things are still open that
would, if built later, **change or invalidate a horse that already exists**. That is a different
class of problem from the long list of things still unbuilt (tack, training, the market, NPC
stables, five more disciplines). Those add new levers to a horse. These three rewrite what a horse
already is, or make it perform differently than it did last month for a reason its owner never chose.

The three, and what each one is:

| | What is open | What it does to a horse that already exists |
|---|---|---|
| **A** | **Age-based performance decline.** Promised by `docs/horse-game-overview.md` §7a, parked by slice 0011 §3.2, never built. A twenty-four-year-old scores exactly like a six-year-old today. | Nothing retroactive, but every horse in the game silently changes value the day it lands. Better to land it before anybody has valued anything. |
| **B** | **HYPP and PSSM1 management.** Slice 0013 Part B, deferred by its own §12. `conditionDelta` is hardcoded to 0, so an affected horse takes no mechanical penalty, managed or not. | These are the Quarter Horse's two signature diseases. A child showing an affected horse without a second thought would start losing classes for a reason that did not exist when they bought it. |
| **C** | **Polygenic health predispositions.** `docs/horse-game-overview.md` §3a's third category. Nothing exists — no field, no trait, no row. | **This is the one that cannot be fixed later.** `TRAITS` is append-only and a horse's genotype is written once, at birth. Every horse alive when a heritable trait is added is missing it permanently. |

**C is the whole reason this slice is happening now rather than in three weeks.** A and B are here
because they are small, they are already specified, and it is cheaper to land all three before the
first login than to explain to a child why their horse got worse.

---

## 1. What "done" looks like

- An old horse **visibly declines**. A nineteen-year-old's page says so in plain English, its show
  results say so on their own line, and the number is a live tunable on `/admin/config`.
- A HYPP or PSSM1 affected horse **can be put on a management plan** from its care page, for money
  and no turn, and **is penalised while it is not** — but only when its owner has been told it is
  affected.
- Every horse born from the deploy onward carries **three heritable soundness traits** that nothing
  reads yet. No screen changes. No horse page gains a line. The genes are simply there, inherited
  properly, waiting for the slice that gives them consequences.
- The world has been **reset once more**, and only then do the children get logins (§11).

Explicitly **not** in scope, and none of it invalidates a horse: tack (`tackModifier` still 1.0),
training (`trainingFactor` still 1.0), the market, NPC stables, the other five disciplines, the
other seven breeds. Those all add levers to a horse that already exists. They do not rewrite it.

---

## 2. Decisions taken for this slice

All three top-level scope decisions were taken with the operator on **3 Aug 2026, in conversation**,
before this document was written. They are settled — do not re-open them, but do read the reasoning,
because several smaller choices below follow from it.

### 2.1 Age decline is noticeable, not cosmetic — about −15% at the extreme

*Decided 3 Aug 2026, in conversation.* Offered a gentle version (about −5% by the mid-twenties, a
veteran can still win on a good day), a noticeable version (about −15% at the extreme, retiring an
old horse becomes the obvious call rather than a sentimental one), and building nothing at all. The
operator chose **noticeable**.

What that means in practice, so the builder can feel the size of it: the show scorer's noise is
`show_noise_sd = 5` on a roughly 0–100 score, and the entire care band is ±5%. A −15% modifier is
about three times the whole of care and comfortably larger than judge noise. A twenty-five-year-old
is not competitive with a nine-year-old, and is not meant to be.

### 2.2 This overrides slice 0011 §3.2 — and that section's own instruction was followed

Slice 0011 §3.2 declined a performance decline, and its §"What to raise rather than decide" said:

> **If you find yourself wanting to make failing horses score worse** — stop and raise it. §3.2
> declined it for reasons about the show scorer's tuning, and if those reasons are wrong that is a
> conversation, not a quiet multiplier.

It was raised, and it was answered. Record that plainly rather than quietly departing.

**But §3.2's actual argument survives intact, and this slice honours it.** Read it carefully: the
concern was that a *failing* horse should not be penalised, because "a last season is only a
meaningful choice if the horse can still win it." That is about the **Failing marker**, which is a
function of *remaining* life. This slice's modifier is a function of **age in days** and nothing
else. The two come apart in both directions:

- A horse that drew a short lifespan reads **Failing at thirteen** and takes **no age penalty at
  all** — it is not old, it is just near the end.
- A tough horse of twenty-six with a long roll may not be Failing yet and takes **the full
  penalty** — it is old, and old is what the modifier measures.

**Never key the modifier off `ageState`.** It reads `gameDay - born_game_day` and nothing else. This
is a test (§10, test 3), not a comment.

The part of §3.2 that is genuinely reversed is narrower: a last season is now a *harder* season. A
horse in its frailty window is typically twenty-two or twenty-three, which is around 0.90 on this
curve — down about nine points on a 90-point score. It can still win a weak class and it will
usually lose a strong one. That is the trade the operator chose, knowingly.

### 2.3 Age is its own modifier, not part of the care modifier

`scoreEntry` and `scoreAbilityEntry` both finish with the same multiplicative line. Age joins it as
a **new parameter, `ageModifier`, defaulting to 1.0** — it does not get folded into `careModifier`.
Three reasons, in order of how expensive they are to discover later:

1. **The care clamp would eat it.** `careModifier` is clamped to `[care_modifier_min,
   care_modifier_max]` = `[0.95, 1.05]`, and slice 0013 §2.4 is explicit that the clamp — not the
   components — is what guarantees that band. Adding a −0.15 age delta inside that clamp means a
   twenty-five-year-old and a neglected three-year-old produce **the same number**, and care stops
   doing anything at all for old horses.
2. **They have different remedies and must read differently.** Care is something an owner can fix
   this afternoon for 30. Age is not fixable by anyone. Slice 0013 §13.4 anticipated exactly this
   ("the result explanation should make it obvious which is which. It does, because care has its own
   line and age has none") — age now has a line too.
3. **The snapshot.** `show_entries.care_modifier_applied` exists so a judged result never changes
   afterwards. Age gets its own column for the same reason, and a combined column would make a
   result's explanation a guess.

### 2.4 Age modifies the show score. It never touches the displayed conformation numbers.

The other obvious home for decline is `realization()` in `src/engines/conformation/model.ts`, which
already carries an unused `careFactor` and whose slice (0006 §3, "Not built here") said "the ageing
and death stage adds the decline curve". **Do not put it there.** Two reasons:

- Slice 0013 §2.3 already decided that a performance modifier never moves a horse's displayed
  conformation. Care follows that rule; age must follow the same one, or the horse page tells two
  different stories about what a number means.
- It is also just wrong biologically. A twenty-two-year-old's neck is not shorter than it was at ten
  and its shoulder has not changed angle. What declines is what the horse can **do** with the body it
  has. That belongs in the scorer, not in expression.

This is also what slice 0011 §3.2 meant by "a decline multiplier would retune every class in the
game as a side effect" — through `realization()` it would have. As a separate multiplier on the
final score it does not touch a single ideal vector, falloff or weight.

### 2.5 No young-horse penalty

Only the old end of the curve is modelled. A three-year-old is already worse than a nine-year-old,
because `realization()` ramps from `conformation_realization_at_birth` up to 1.0 at
`conformation_maturity_years` and every trait it expresses is smaller until then. Adding a second
young-horse penalty would double-count the one thing already modelled — precisely the argument slice
0011 §3.2 used to refuse a second fertility penalty, and it was right about that.

### 2.6 The polygenic category is built as genes only: no onset, no screening, no consequences

*Decided 3 Aug 2026, in conversation.* Offered the full category (risk scores, onset probability,
the screening kind of knowledge, degenerative career endings), the substrate alone, and skipping it.
The operator chose **the substrate alone**.

So Part C appends three heritable traits and stops. Nothing reads them. No condition rows, no risk
display, no `conditions.risk_trait` column, no onset roll, no screening, no career endings. A horse
page after this slice looks exactly as it did before.

**This is deliberately building ahead, which `CLAUDE.md` §9 tells you not to do.** The reason it is
justified here, stated so a future session does not think it was an accident:

- `TRAITS` is **append-only** and a genotype is written **once, at birth**. `getPolygenicString`
  pads a missing trait with zeros, so a horse born before a trait exists reads **0 out of 20** —
  the bottom of the range — forever. For a soundness trait that means "maximally fragile", not
  "average".
- There are exactly two escapes and both are bad. A **world reset** deletes the children's horses,
  and the window where that is free closes the day they log in. A **legacy stand-in** like
  `fertilityPotential()` invents a stable score from the horse's own seed — which is fine for
  fertility, but here it means the score is **not inherited from the parents**, and heritability is
  the entire point of the system.
- The cost of building the substrate now is three strings of twenty characters per horse, one seed
  migration, one exempt-list in the founding generator, and one line in an existing test. That is
  very cheap insurance against the only irreversible mistake on the table.

### 2.7 The traits are named for tissue, not for disease, and higher means sounder

Three traits: **`foot_robustness`**, **`joint_robustness`**, **`ligament_robustness`**. Category
`hidden`, direction `higher_better`, ten loci each — the same shape as `fertility`.

Not `navicular_risk` / `ocd_risk` / `dsld_risk`, for two reasons:

- **One tissue feeds more than one condition.** Navicular and laminitis both read the foot; DSLD and
  a suspensory injury both read ligament. Naming a trait after one disease forces a second trait the
  day a second disease of the same tissue is wanted.
- **`TRAITS` can never be reordered or removed**, only appended to. A trait named after a condition
  the game turns out never to build is a dead name in a list nothing can clean up.

Higher-is-better rather than higher-is-riskier is a smaller decision with a concrete cause:
`TraitDirection` has exactly two values (`bidirectional`, `higher_better`) and `anchorFor` branches
on it. A third `lower_better` direction would ripple through `traits.ts`, `model.ts` and every
consumer for no gain, since a risk engine that wants a risk score can write `20 - potential(...)` in
one line.

### 2.8 Founding quality bands must not buy soundness

`generateCandidate` currently draws **every** polygenic allele at `polygenicOneChance`, the quality
band's number. If the robustness traits ride on that, a top-band founding horse is beautiful, fast
**and** sound, and the new axis is not an axis at all — it is a fourth reading of the same die.

So the three robustness traits draw at a **fixed `robustness_one_chance` (0.5), regardless of the
band**. Two consequences worth naming:

- Soundness becomes something a player has to breed for **separately** from the show ring, which is
  the only reason a hidden heritable trait is interesting.
- It protects the NPC quality ceiling (`docs/horse-game-overview.md` §10d, and `CLAUDE.md` §13's
  "one thing to hold onto above the rest"). If NPC stock is ever generated at a raised band, that
  raise must not silently make NPC horses sounder as well as better.

`fertility` is **not** changed — it stays band-weighted. That is not this slice's business, and
quietly changing it would be a second decision hidden inside a first.

---

## 3. Not built here

### 3.1 No onset, no screening, no risk display

Part C is genes and nothing else (§2.6). In particular `horse_knowledge.kind` still only ever holds
`'genotype'`; the `'screening'` kind, and the `expires_game_day` column actually going stale, still
belong to the slice that gives these traits consequences. Do not write a screening row "so it is
ready" — that is exactly the unread-promise `CLAUDE.md` §7 and slice 0010 §3.2 both refuse.

### 3.2 No colour-linked conditions, and no new Mendelian loci — and here is why that is safe

`docs/horse-game-overview.md` §3b says "**Homozygous Frame Overo is implemented**". It is not — check
`src/engines/genetics/loci.ts`. `LOCI` holds E, A, CR, G, DMRT3 and the four disease loci, and there
is no frame, tobiano, sabino or splash anywhere.

The natural worry is that this is the same trap as Part C, one door down. **It is not, and the
difference is worth understanding precisely, because it is what makes colour genuinely safe to
defer:**

- A **polygenic** trait missing from a genotype reads as **zero out of twenty** — the bottom of the
  range. That is a wrong answer masquerading as a real one.
- A **Mendelian** locus missing from a genotype reads as **two copies of the wild type** (slice
  0002's missing-locus rule, relied on by `getMendelianPair` and documented in
  `src/engines/health/status.ts`). That is a *correct* answer: a horse that predates the frame locus
  simply does not carry frame, which is true.

So adding a colour locus later needs no reset and breaks nothing. Its only cost is that no horse
alive at that moment carries the new allele, and it therefore enters the population through new
founding batches and imports rather than through the existing herd — which is how a real allele
enters a real closed population anyway.

Colour was right to set aside. It is now recorded *why*, so the next session does not re-panic about
it.

### 3.3 No management for HERDA or GBED

Part B applies only to `severity_class = 'manageable'` rows, read from the condition row, never
hardcoded to HYPP and PSSM1. GBED still kills a foal; HERDA still bars a horse from showing. Slice
0013 §4.5 is explicit about this and it is not softened here.

### 3.4 No lameness, no injury, no vet hold

Unchanged from slice 0013 §3.4. Age makes a horse score worse; it never makes a horse unable to
enter. The only thing in the game that bars a horse from a class remains HERDA, being at pasture, or
settling in from pasture.

### 3.5 No age effect on upkeep, fertility, or the barn round

Fertility already declines with age through `mare_fertility_age_knots` / `stallion_fertility_age_knots`
(slice 0003). Upkeep is flat. Both stay that way — this slice adds exactly one age-driven number to
the game, in the show scorer.

---

## 4. Part A — the age curve

### 4.1 The shape, in three numbers

Flat, then a straight line down, then flat again. No curve, no knots, no discontinuity anywhere —
the same shape discipline slice 0013 §4.1 applied to the care ramp, and for the same reason: a
future session must be able to hold it in their head and an operator must be able to retune it from
one screen.

```
modifier
  1.00  ────────────────────╮
                             ╲
                              ╲
  0.85                         ╰──────────────
        0        age_decline_start   age_decline_floor      age →
                 (5760 = 16 yrs)     (9000 = 25 yrs)
```

| Config key | Value | Game years | Why |
|---|---|---|---|
| `age_decline_start_game_days` | 5760 | 16 | Below `veteran_age_game_days` (6480 / 18 years) on purpose — a horse should start slipping a little *before* the game calls it a veteran, so the label confirms something the owner has already noticed rather than announcing it. |
| `age_decline_floor_game_days` | 9000 | 25 | Past `lifespan_mean_game_days` (8280 / 23 years). Most horses die partway down the ramp and never reach the floor; reaching it is a mark of an unusually long-lived horse. |
| `age_modifier_floor` | 0.85 | — | §2.1's decision. Three times the full care band, comfortably above judge noise. |

Between the two day thresholds the modifier is linear:

```
modifier = 1 - (1 - floor) * (age - start) / (floorDay - start)
```

Worked examples the builder should sanity-check against (§10, test 2):

| Age | Modifier | On a raw score of 90 |
|---|---|---|
| 15 years | 1.000 | 90.0 |
| 18 years (veteran) | 0.967 | 87.0 |
| 20 years | 0.933 | 84.0 |
| 23 years (mean lifespan) | 0.883 | 79.5 |
| 25 years and beyond | 0.850 | 76.5 |

**All three are live tunables**, read fresh on every scoring run and every page view. Nothing here is
snapshotted onto a horse (`CLAUDE.md` §5.5): retuning the curve should change how every horse scores
from the next show onward, because the curve is a statement about how ageing works, not a fact about
one animal. What *is* snapshotted is the modifier a judged entry was actually scored with (§7.1).

### 4.2 The engine

New file, `src/engines/ageing/performance.ts`. Pure, no database access, no randomness, no wall
clock — sits beside `lifespan.ts` in the directory slice 0011 created.

```ts
export type AgePhase = 'prime' | 'past_peak' | 'floor';

export interface AgeModifierConfig {
  age_decline_start_game_days: number;
  age_decline_floor_game_days: number;
  age_modifier_floor: number;
}

export interface AgeModifierResult {
  modifier: number;
  phase: AgePhase;
  /** Whole game years, for the display line - never recomputed by a render function. */
  ageYears: number;
}

export function agePerformanceModifier(
  ageGameDays: number,
  config: AgeModifierConfig
): AgeModifierResult
```

Rules it must hold, all of them cheap and all of them testable:

- `ageGameDays` below the start returns exactly `1.0` and phase `'prime'` — **exactly** 1.0, not
  0.9999, so the display can compare against 1 and the result explanation can say "Age: in its
  prime" rather than printing a number.
- At or past `age_decline_floor_game_days` it returns exactly `age_modifier_floor`, phase `'floor'`.
- A degenerate config where `floorDay <= start` must not divide by zero — return the floor for any
  age at or past the start. An operator can type anything into `/admin/config`.
- A floor above 1.0 (also typeable) is not this function's problem to police, but it must not throw.

### 4.3 Wiring it into the two scorers

Both scorers gain one optional parameter, defaulting to 1.0, exactly as `careModifier` did:

```ts
// score.ts
const finalScore = rawScore * careModifier * tackModifier * ageModifier + params.noise;

// abilityScore.ts
const finalScore = rawScore * careModifier * tackModifier * trainingFactor * ageModifier + params.noise;
```

That is the entire formula change in the game. Neither scorer learns what an age is; it is handed a
number, the same way it is handed a care number.

In `src/db/shows.ts`'s judging path (around line 654, where `careModifierForHorse` is already
called), add a matching `ageModifierForHorse(horse, config.values, gameDay)` in `src/db/ageing.ts`,
pass `ageModifier: age.modifier` into both scorer calls, and carry `ageModifierApplied` through the
same struct and the same `UPDATE show_entries` that already carries `careModifierApplied`.

**NPC horses go through this path unchanged.** `CLAUDE.md` §13 forbids a parallel scoring path and
this slice does not add one.

### 4.4 What an ageing NPC show barn now does to the game

Worth flagging because it is a new effect nobody asked for and it will be felt before it is
understood. The NPC show barn's horses age and die on the same code path as player horses (slice
0011). Before this slice, an old NPC horse was exactly as hard to beat as a young one. After it, a
barn that has not been restocked in a while gets **quietly easier to beat**, and the children's win
rate rises for a reason that has nothing to do with their breeding.

Nothing to build for it — `/admin/shows` already shows the barn's headcount against target and its
five oldest horses. But the operator should be told to look at that screen if the children start
winning everything, and it belongs in the balance section (§13.2) rather than being discovered.

---

## 5. Part B — managing HYPP and PSSM1

This is slice 0013 Part B, built as that document's §4.5 specifies. Read that section; it is short
and it is the specification. Summarised here only so this document stands alone:

- An **affected** horse (a `horse_conditions` row) whose condition is `severity_class = 'manageable'`
  and which has **no current plan** carries `unmanaged_condition_penalty` = **−0.03** on its care
  modifier.
- A **plan** costs `condition_management_cost` (150) and lasts `condition_management_interval_game_days`
  (180) — the same timer shape as a wellness visit.
- While the plan is current, the delta is zero.
- Management **does not hide the condition**, does not cure it, does not stop it being inherited, and
  does not apply to lethal or degenerative conditions.

### 5.1 The knowledge boundary, which is the only hard part

Slice 0013 §4.5 calls this "the single most important sentence in Part B" and it is right:

> **The penalty applies only when the owner is entitled to know** — reuse `ownerVisibleStatus` from
> `src/engines/health/status.ts`, which already encodes exactly that entitlement, rather than
> writing a second version of the rule.

A stable that has never tested, for a condition with no visible signs, cannot be penalised for
failing to manage something the game never told them about. This is `CLAUDE.md` §12's truth-versus-
knowledge line and it is invisible on screen the moment it is crossed.

**A trap specific to today's data:** both HYPP and PSSM1 have `signs_visible = 1`, so
`ownerVisibleStatus` returns affected for free on every affected horse, and **the boundary never
actually fires in play**. It would be very easy to write the wrong rule and never notice. That is
why the boundary needs a test with a *fabricated* manageable-and-not-signs-visible condition
(§10, test 6) rather than a screen check. Do not skip it because the screen looks right.

### 5.2 The knowledge check at judging time, without an N+1

`careModifierForHorse` in `src/db/care.ts` is synchronous and takes a horse row. Do not make it
async and do not let it query. Instead:

- Add a `conditionDelta: number` argument to `careModifierForHorse`, defaulting to 0, which it passes
  straight into the engine's existing `conditionDelta` parameter (already present, currently pinned
  at 0 with a comment naming slice 0013 §4.5 — that comment gets deleted here).
- The **caller** computes it. In the judging path that means one query per class, not per horse:
  load every entered horse's manageable-condition rows and the owning stable's knowledge rows in one
  go, then build a `Map<horseId, number>` before the scoring loop.
- New pure engine `src/engines/health/management.ts` holds the rule itself:

```ts
export interface ManageableConditionState {
  conditionCode: string;
  /** Whether this stable is entitled to know - the caller resolves this via ownerVisibleStatus. */
  ownerEntitled: boolean;
  managementUntilGameDay: number | null;
}

export function conditionDelta(
  states: ManageableConditionState[],
  gameDay: number,
  unmanagedPenalty: number
): { delta: number; unmanagedCodes: string[] }
```

Deltas **stack** across conditions — a horse affected by both HYPP and PSSM1 with neither managed is
−0.06. The care clamp catches the total, which is exactly what slice 0013 §2.4 says the clamp is for.
That is also the right answer on the merits: two unmanaged conditions is worse than one.

### 5.3 Buying and renewing a plan

- **Where:** a Management section on `/horses/:id/care`, below the farrier and wellness rows. Same
  page, same shape, same buttons. Shown only when the horse has at least one manageable condition
  the viewing stable is entitled to know about — otherwise the section does not exist, which is
  itself part of the knowledge boundary.
- **Cost:** `condition_management_cost` per condition, money and **no turn** (slice 0013 §2.2's rule
  for care purchases; a turn is for a decision with consequences, and paying a vet bill is not one).
- **The debt rule applies** — `canTakeOnCost` from `src/db/ledger.ts`, same as every other care
  purchase.
- **Ledger kind:** reuse the existing `'vet'` kind, with its own description text. Migration 0070's
  own comment already anticipated this ("Part B's (not built this session) management plans ride on
  the existing 'vet' kind"), and a fourth `CHECK`-constraint table rebuild for one more word on the
  money page is not worth it.
- **The barn round** at `/stables/:id/care` renews due plans alongside shoes and wellness, and its
  summary line says what it bought. One click doing the whole barn is slice 0013 §2.2's promise and
  a plan is part of the barn's routine.
- **Renewal is not stacking.** Buying a plan sets `management_until_game_day = gameDay + interval`
  from **today**, not from the old expiry. A player who renews early loses the overlap. That is the
  simple rule and it matches the farrier timer, which also resets from the day of the call.

### 5.4 No tick stage, and one NPC obligation

**No tick stage.** A plan's currency is derived at read time from `management_until_game_day` versus
`game_day` — the same derive-don't-write discipline `actionsRemaining` follows (`CLAUDE.md` §5.4 and
slice 0009's turn budget). Nothing needs to expire anything.

**One thing the tick does need:** slice 0013 §2.6 has the tick keep NPC-owned horses' care current
rather than exempting them at the scorer, precisely so there is no parallel path. Management plans
join that. An NPC show barn horse affected by PSSM1 must have a current plan for the same reason its
feet are kept shod — otherwise the show field silently weakens for a reason nobody can see, and NPC
horses would need a special case at the scorer, which `CLAUDE.md` §13 forbids.

---

## 6. Part C — the robustness genes

### 6.1 Three lines of code, and why each one is where it is

**`src/engines/genetics/polygenic.ts`** — append to `TRAITS`, after `agility`, in this order:

```ts
  // Added in slice 0014 §2.6/§2.7. Appended, like fertility and agility before them, so every
  // earlier trait's RNG draw sequence is untouched. Nothing reads these yet - they exist because
  // TRAITS is append-only and a genotype is written once at birth, so a heritable trait added after
  // a horse is born can never be given to that horse. See slice 0014 §2.6 before removing them.
  'foot_robustness',
  'joint_robustness',
  'ligament_robustness',
```

**`src/engines/conformation/traits.ts`** — three entries in `TRAIT_CATEGORY` (all `'hidden'`), three
in `TRAIT_DIRECTION` (all `'higher_better'`), and one new export:

```ts
/** Slice 0014 §2.8: the traits a founding quality band must NOT weight. Drawn at a fixed
 * robustness_one_chance instead, so a top-band founding horse is not automatically sound as well as
 * beautiful. fertility is deliberately not in this list - it stays band-weighted. */
export const ROBUSTNESS_TRAITS: readonly TraitCode[] = ['foot_robustness', 'joint_robustness', 'ligament_robustness'];
```

Category `'hidden'` is the load-bearing choice: `CONFORMATION_TRAITS` and `ABILITY_TRAITS` are both
`TRAITS.filter(...)` on category, so **both scorers and every display path exclude these three
automatically**, with no change to either scorer and no risk of a soundness trait leaking into a
halter class. This is the same mechanism that already keeps `fertility` out of both.

**`src/engines/founding/generate.ts`** — in the polygenic loop, choose the threshold per trait:

```ts
for (const trait of TRAITS) {
  const chance = ROBUSTNESS_TRAITS.includes(trait) ? input.robustnessOneChance : input.polygenicOneChance;
  ...
}
```

`robustnessOneChance` is a new required field on `GenerateCandidateInput`. Required, not optional
with a default — an optional one silently falls back to the band the day someone adds a second
caller, and that is the exact failure §2.8 exists to prevent.

### 6.2 What needs no change at all

- **`inheritPolygenic`** iterates `TRAITS`. Foals inherit the new traits correctly the moment the
  constant grows. Nothing to write.
- **`generateFounderPolygenic`** (the admin founder form) already draws every trait at a flat 50/50,
  which is what these traits want anyway.
- **Both scorers**, every render function, the barn list, the horse page, `/admin/*`. Category
  `'hidden'` does the work.
- **`horses.environmental_noise`** — `rollEnvironmentalNoise` draws one value per trait in `TRAITS`
  order, so three more draws happen at the end of that stream. Harmless and, again, nothing reads
  them.

### 6.3 Reproducibility

No new `deriveSeed` label, and none is needed. Every polygenic stream (`pool_polygenic`,
`founder_polygenic`, the two inheritance streams, `birth_noise`) draws a **fixed number of values per
trait in `TRAITS` order**. Appending traits adds draws at the *end* of each stream and changes no
earlier draw. Changing the threshold for the last three changes only those three. This is the same
argument slice 0012 made when it appended `agility`, and it is the entire reason `TRAITS` is
append-only rather than tidily grouped — `polygenic.ts`'s own comment says so.

### 6.4 The seed migration and the test that will fail

`quantitative_traits` gains three rows, matching the `fertility` row's shape exactly (`'hidden'`,
`'higher_better'`, `NULL` labels, `locus_count` 10, `enabled` 1), with `sort_order` 11–13 and
teaching text that says plainly that nothing reads them yet.

**`test/genetics/consistency.test.ts` will fail until it is updated, and that is the test working.**
Two edits: add the new migration's filename to the `migrationNames` array in the "TRAITS vs
migrations" describe block, and change

```ts
expect(seeded[seeded.length - 1].code).toBe('agility');
```

to assert `'ligament_robustness'`. That assertion exists to prove the newest trait is genuinely
last; moving it is the point of it, not a workaround.

---

## 7. Data

Eight migrations, one logical change each (`CLAUDE.md` §8). Each one also needs its import and list
entry in `src/db/migrations.ts` or `/admin/migrations` will not see it.

| File | What it does |
|---|---|
| `0075_show_entries_age_modifier.sql` | `ALTER TABLE show_entries ADD COLUMN age_modifier_applied REAL NOT NULL DEFAULT 1.0` — the snapshot, mirroring `care_modifier_applied` exactly. Existing judged rows correctly read 1.0: they *were* scored without a decline. |
| `0076_config_age_decline.sql` | `age_decline_start_game_days` 5760, `age_decline_floor_game_days` 9000, `age_modifier_floor` 0.85. |
| `0077_horse_conditions_management.sql` | `management_state TEXT NOT NULL DEFAULT 'unmanaged'` (values `unmanaged` / `managed`, the schema document's own names) and `management_until_game_day INTEGER` (nullable). Slice 0010 §3.2 named both as arriving with this stage. |
| `0078_conditions_management_text.sql` | `management_text TEXT` (nullable) on `conditions` — what a plan actually consists of, in a sentence a child can read. |
| `0079_seed_condition_management_text.sql` | Fills it for HYPP and PSSM1. Separate file: adding a column and populating it is two logical changes. |
| `0080_config_condition_management.sql` | `unmanaged_condition_penalty` −0.03, `condition_management_cost` 150, `condition_management_interval_game_days` 180. |
| `0081_quantitative_traits_robustness.sql` | The three `quantitative_traits` rows (§6.4). |
| `0082_config_robustness.sql` | `robustness_one_chance` 0.5. |

**`conditions.management_text` rather than slice 0013 §4.5's `management_options` JSON.** A rename
with a reason: a JSON blob promises a structure — options, prices, effects — that nothing in this
slice consumes, and `CLAUDE.md` §7 with slice 0010 §3.2 are both explicit that an unread column is a
promise nobody keeps. A plain text column is read directly by the one screen that exists (§5.3), and
it keeps the rule that the code never hardcodes HYPP and PSSM1. If a later slice genuinely needs
structured options, it can add them then, against a real reader.

**Two things deliberately not added:** `horse_conditions.risk_score` / `severity` (Part C builds no
polygenic conditions — §2.6), and `conditions.risk_trait` mapping a condition to a robustness trait
(nothing maps anything yet). Both arrive with the consequence slice. Say so in the migration
comments, so the next session finds it stated.

**Watch the SQL-splitting rule** when writing `management_text` and the migration comments: no
semicolons and no double hyphens inside any string literal. `src/lib/sql.ts`'s `splitSqlStatements`
has no awareness of string literals and will corrupt the migration in the browser path. Migration
0053's own comment records the afternoon this already cost once.

---

## 8. Where it appears on screen

### 8.1 The horse page — one age line, no new card

Beside the age, in the vitals, not in a card of its own:

- Prime: nothing at all. Silence is the correct display for "no effect".
- Past peak: **"Nineteen years old — past its peak. Scores about 5% below what it would have in its
  prime."**
- Floor: **"Twenty-six years old — well past its peak. Scores about 15% below what it would have in
  its prime."**

Percentages, not multipliers. A child reads "3% below"; nobody reads "0.967". Round to whole
percents.

### 8.2 The care page — a Management section

Per §5.3. One row per manageable condition the stable is entitled to know about, showing the
condition's name, `management_text`, whether a plan is current and until when, and a button that
either buys or renews. When a plan has lapsed, say so in the same words the farrier row uses when a
horse is overdue — consistency of vocabulary here is worth more than variety.

### 8.3 The show result explanation (`/shows/:id/entries/:entryId`)

A new line beside the existing care line, reading `age_modifier_applied` from the entry and never
recomputing it:

```
Care applied: 0.98 (farrier overdue by 12 days)
Age applied: 0.93 (twenty years old)
```

When the snapshot is exactly 1.0, print **"Age: in its prime."** rather than a number, matching how
the care line already handles a neutral value.

Slice 0013 §13.4 asked for care and age to be visibly separable so a child can tell the fixable
thing from the unfixable one. Two lines, always, is the answer.

### 8.4 The barn list

One quiet marker when the age modifier is below 1.0, in the same place and the same weight as the
care badge. Not a warning colour — being old is not neglect.

### 8.5 `/admin/ageing`

Add a distribution of the age modifier across living horses (how many at 1.0, how many between, how
many at the floor). The existing oldest-horses table gains a modifier column. This is how the
operator sees whether §2.1's tuning is doing what they thought it would.

### 8.6 `/admin/health`

Add unmanaged-affected counts to the existing per-condition census — the number the operator would
want if the children complain that a horse keeps losing.

### 8.7 `src/db/reset.ts`

**No change.** Every new column is on a table already in `HORSE_TABLES`, and the new
`quantitative_traits` rows are reference data, which a reset never touches — correctly, since
clearing them would break the game with no way back from the browser.

---

## 9. Tests

Numbered so a summary can say which ones were skipped.

1. **The curve is flat before the start.** Ages from 0 to `age_decline_start_game_days` return
   exactly 1.0 and phase `'prime'`. Exactly — assert `toBe(1)`, not `toBeCloseTo`.
2. **The worked examples in §4.1.** 15, 18, 20, 23, 25 and 30 game years against the seeded config,
   to three decimal places. This is the test that catches an off-by-one in the ramp arithmetic.
3. **Age decline never reads the failing state.** Two horses of the same age, one with
   `natural_death_game_day` inside the frailty window and one far outside it, produce the **same**
   modifier. And a thirteen-year-old inside its frailty window produces exactly 1.0. §2.2's whole
   argument, as an assertion.
4. **A degenerate config does not throw.** `floorDay <= start`; `floor` above 1.0; both zero.
5. **The scorers are unchanged when the parameter is absent.** Call `scoreEntry` and
   `scoreAbilityEntry` with no `ageModifier` and confirm the result is identical to today's. The
   default-1.0 promise, held the same way `careModifier`'s was.
6. **The knowledge boundary.** A fabricated condition, `severity_class = 'manageable'` and
   `signs_visible = 0`, on an affected horse whose stable holds **no** knowledge row: delta must be
   **0**. Add a knowledge row: delta becomes the penalty. This is §5.1's test and it is the most
   important one in the slice, because it is the one the screens cannot catch.
7. **Management deltas stack and the clamp catches them.** Two unmanaged manageable conditions give
   −0.06 unclamped; the final care modifier lands at `care_modifier_min`.
8. **A current plan zeroes the delta, an expired one does not.** Boundary day exactly:
   `management_until_game_day == gameDay` counts as current; `gameDay + 1` does not.
9. **`TRAITS` versus the seed migration** — the existing consistency test, updated per §6.4, now
   asserting `ligament_robustness` is last.
10. **Robustness ignores the quality band.** Generate many candidates at
    `polygenicOneChance = 0.9` and confirm the three robustness traits still average near 10 out of
    20 while the conformation traits average near 18. §2.8, as a property.
11. **Appending traits changed no earlier draw.** Generate a candidate from a fixed seed and assert
    the `neck_length` … `agility` bit strings match the values a pre-slice build produced. Capture
    those strings **before** editing `TRAITS` — they cannot be recovered afterwards. This is the
    single test that proves §6.3's reproducibility claim rather than asserting it in a comment.
12. **Inheritance covers the new traits.** A foal from two parents with known robustness strings
    carries ten loci per new trait, one allele from each parent at each locus.

---

## 10. Verifying it by hand

The operator does this after deploying and migrating, before the reset (§11) — on the world that is
about to be thrown away, which is the ideal place to try things.

1. `/admin/ageing` → bring a horse forward until it is about twenty. Its page should now carry the
   past-peak line, and the barn list its quiet marker.
2. `/admin/shows` → judge a class containing that horse and a young one of similar quality. Open the
   old horse's result explanation and confirm two separate lines, care and age.
3. Re-judge nothing — a judged result must not change. Open the same explanation an in-game month
   later, after the horse has aged further, and confirm the numbers on it are **identical**. That is
   the snapshot working.
4. `/admin/health` → find a HYPP or PSSM1 affected horse. Its care page should offer a plan; buy one
   and confirm the money page shows a `vet` line and the care modifier moves by 0.03.
5. Let the plan lapse (`/admin/ageing`'s time control) and confirm the penalty returns.
6. `/admin/founding` → mint a batch. Nothing about the candidates should look different. That is Part
   C succeeding.

---

## 11. The reset, and the order the operator does things in

Part C appends traits, so every horse alive before the deploy is permanently missing them (§2.6).
The operator confirmed on 3 Aug 2026 that slice 0012's reset **has already been run**, so this is a
second, separate reset — and the last free one, because the window closes when the children log in.

**The order, and it matters:**

1. Deploy (push to the branch; Workers Builds does the rest).
2. `/admin/migrations` → apply 0075 through 0082.
3. Do the by-hand checks in §10, on the old world.
4. `/admin/reset` → **full world scope**. This clears horses, stables, prefixes, the ledger and tick
   history. Accounts and config survive; breeds, loci, conditions, disciplines and
   `quantitative_traits` survive.
5. Re-create the stables, mint founding batches at `/admin/founding`.
6. **Then** hand out the logins.

**Anything created between now and step 4 is gone**, including any stable set up for testing. That
is the cost, it is small today, and it is infinite tomorrow.

**If the operator would rather not reset**, there is a fallback and it should be offered rather than
argued with: a one-shot backfill stage, in the shape of slice 0011's
`assignLifespansAndNoticeFrailty`, writing the three new trait strings into every existing horse's
genotype from `deriveSeed(rng_seed, 'robustness_backfill')`. It gives legacy horses real, stable,
properly-inherited-from-here-on strings. Its one honest cost: those horses' robustness was **not**
inherited from their parents, because their parents never had any — so the first generation's
soundness is invented, and only their foals onward are truly heritable. Say that plainly if it comes
up; do not build it unless asked.

---

## 12. If this is too large for one session

The three parts are genuinely independent — different files, different tables, no shared code except
the config migration pattern. Build in this order and stop wherever the session runs out:

1. **Part C first.** It is the smallest by a wide margin (three constants, one generator change, one
   seed migration, one test edit) and it is **the only part with a closing window**. A and B can land
   any time; C cannot land after the children log in without a cost nobody wants to pay.
2. **Part A second.** Self-contained: one engine, one parameter on two scorers, one column, three
   display touches.
3. **Part B last.** Smallest risk to the game if deferred again — an affected horse simply keeps
   taking no penalty, exactly as today — and the highest correctness risk if rushed, because of §5.1.

If Part B is deferred **again**, say so in the summary, leave `conditionDelta` returning 0, and
update the comment in `src/engines/care/modifier.ts` to name **this** document rather than slice
0013's, so the pointer stays current.

Do **not** ship Part C without the reset in §11. A half-applied Part C is worse than no Part C: a
world with some horses carrying the genes and some reading zero-out-of-twenty is the exact mess this
slice exists to avoid.

---

## 13. Balance risks to watch

### 13.1 −15% may be too much once there are real show fields

Right now the fields are the children's horses plus an NPC show barn. A −15% floor is a strong
statement and it was chosen deliberately (§2.1), but it is the number most likely to want changing
after two weeks of play. The symptom to watch: **nobody ever shows a horse over eighteen.** If
veterans vanish from the entry lists entirely, the decline has stopped being a career arc and become
a retirement cliff, and `age_modifier_floor` is the lever — 0.90 rather than 0.85 — with no deploy.

The reverse symptom is quieter: if a twenty-four-year-old still routinely wins, the *start* day is
too late rather than the floor too shallow.

### 13.2 The show barn ages too, and gets easier

§4.4. Watch `/admin/shows`' headcount and oldest-horses table. If the children start winning
everything at once, check the barn's ages before concluding their breeding got good.

### 13.3 Management could read as punishing a horse a child loves

Slice 0013 §15 flagged exactly this and it is worth repeating rather than burying: a manageable
condition is already a real cost in breeding decisions and will be a real cost in the market. Adding
a −0.03 show penalty on top can feel like being fined twice for one piece of bad luck. It is 150 to
make it go away entirely, which is cheap by design — the mechanic is meant to teach that a
manageable condition is *manageable*, not that it is a curse. If it still lands badly, halve the
penalty rather than removing the plan, so the lesson survives.

### 13.4 Age and care and management now stack

An overdue, poorly-fed, unmanaged twenty-three-year-old is at roughly 0.95 × 0.88 ≈ 0.84. That is a
horse that cannot win anything. Each component is individually defensible and the result explanation
names all of them separately, which is the mitigation — but this is the first time the game can
produce a horse that is bad for three compounding reasons, and the first child to own one will not
enjoy it.

---

## 14. Documents to correct when this is built

- **`CLAUDE.md` §10** — the Care row's "Part A only" note becomes built-in-full (or stays, correctly,
  if Part B is deferred again); the Ageing and death row gains the decline, explicitly noting it
  supersedes slice 0011 §3.2; a new row for this slice recording that the robustness genes exist and
  nothing reads them.
- **`docs/horse-game-overview.md` §7a** — record that decline is built, the shape, the numbers, and
  that it is keyed off age rather than off the Failing marker.
- **`docs/horse-game-overview.md` §3a** — record that the polygenic category has its *substrate*
  built and nothing else, name the three traits, and point at §2.6 here for why that was worth doing
  before the consequences.
- **`docs/horse-game-overview.md` §3b** — correct "Homozygous Frame Overo is implemented" to say it
  is decided but not built, and record §3.2's finding that it can be added later without a reset,
  with the missing-locus reasoning. This sentence has already misled one session.
- **`docs/slices/0011-ageing-death-and-removal.md` §3.2** — a note at the top that its decision was
  raised as it asked and reversed on 3 Aug 2026, pointing here. Do not delete the section; its
  reasoning about `realization()` is still correct and still binding (§2.4).
- **`docs/slices/0013-care-and-condition.md` §4.5/§12** — Part B built here, and the
  `management_options` → `management_text` rename with §7's reasoning.
- **`docs/slices/0010-health-first-pass.md` §3.2** — its promise about `management_state` has been
  kept; say where.
- **`docs/horse-game-schema.md` §4.5** — `management_state` and `management_until_game_day` now
  exist; `risk_score` and `severity` still do not, and now have a named reason (§2.6).
- **`docs/build-log.md`** — a dated entry covering: the `ageModifier` parameter as the fourth
  multiplier on both scorers and why it is not inside the care clamp; `ROBUSTNESS_TRAITS` and the
  band-exemption convention in the founding generator; and the append-only-`TRAITS` argument in §2.6,
  which is the part a future session most needs and is currently written down nowhere outside a code
  comment.

---

## 15. What to raise rather than decide

Stop and ask if you hit these; don't pick one (`CLAUDE.md` §2).

- **If four robustness traits look obviously right instead of three** — say so before appending,
  because appending is permanent. Three was chosen against
  `docs/horse-game-overview.md` §3f's "two or three polygenic predispositions shared across breeds",
  covering foot, joint and ligament. A fourth (respiratory, for the roaring conditions the
  Thoroughbred needs) is a real candidate and is *cheaper now than ever again* — but it is a
  decision about breeds that do not exist yet, so ask.
- **If the age curve wants to differ by discipline** — a barrel horse's career is not a halter
  horse's career, and this is true. It is also a per-discipline config table and a much larger slice.
  Ask; do not add a column speculatively.
- **If Part B's penalty feels wrong once you see it on a real horse** — §13.3. Raise it rather than
  quietly halving it.
- **If the reset in §11 cannot happen for any reason** — stop. Do not ship Part C, and do not
  improvise the backfill without asking; §11's fallback has a real cost and it is the operator's cost
  to accept.
