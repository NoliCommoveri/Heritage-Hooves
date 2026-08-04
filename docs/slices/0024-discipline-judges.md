# Slice 0024: discipline judges

Resolves the open question slice 0012 §15 deliberately left unbuilt: *"Do disciplines want their
own judges?"* All six disciplines have been running since 2026-08-04 (CLAUDE.md §10); there is now
something to look at, which is what §15 said to wait for.

## 1. The problem

Every show class - conformation or discipline - has always carried a `judge_id`, drawn by the same
seeded `judge_N` sub-seed off the show's own seed (slice 0012 §8.1). But a discipline class's judge
was drawn from the same three-judge pool a breed class uses, and `judgeOneClass` never passed that
judge's `trait_weights` into `scoreAbilityEntry` - deliberately, per slice 0012 §8.1's own note,
since `trait_weights` only has opinions about conformation traits and contributes nothing to an
ability score.

Two consequences followed from that, both worth fixing together since they share one cause:

- **No judge variance in a discipline class.** Overview §9 calls judge variance one of the two
  parameters carrying most of the feel, and a discipline result varied only by noise (the judge
  having an ordinary day) - never by which judge showed up, the way a breed class always has.
- **A cosmetic mismatch.** `/shows/:id` renders "Judged by Marchbank - Likes a horse built the way
  the standard asks for, plainly" under a Barrel Racing class. The sentence describes an opinion
  that had zero effect on the result shown beneath it.

## 2. Judges get a `kind`

`judges` gains two nullable-by-convention columns (migration `0139`, plain `ALTER TABLE ADD
COLUMN` - no CHECK enforcing the trait_weights/ability_weights pairing, since a rebuild to add one
would have to pull `show_classes` and, in turn, `show_entries` along with it via their foreign
keys, the way migration `0064` had to; two nullable columns don't warrant that chain. `breeds.
ideal_vector`, migration `0034`, is the existing precedent for a nullable reference column with no
CHECK):

- `kind` (`'conformation'` | `'discipline'`, defaults `'conformation'` so the three existing judges
  don't move pools or change behaviour).
- `ability_weights` (JSON, same shape and same missing-key-reads-1.0 convention as `trait_weights` -
  `{ "v": 1, "traits": { "speed": 1.5, ... } }`). Null for a conformation judge.

Three discipline judges are seeded in migration `0140`, the performance-class counterpart to
`0033`'s three conformation judges - a neutral read and two judges pulling opposite directions,
same shape as Marchbank/Ellery/Halloway:

| code | name | lean |
|---|---|---|
| `even_hand` | Osgood | every ability trait at 1.0 - scores the discipline as written |
| `need_for_speed` | Ferris | speed 1.5, stamina 1.3, jump_scope 0.9, trainability 0.6, agility 0.8 |
| `clean_and_correct` | Winslow | speed 0.7, stamina 0.8, jump_scope 1.3, trainability 1.5, agility 1.3 |

`src/db/judges.ts`'s `getJudges(env, kind?)` now takes an optional pool filter; `getJudgeById`
stays kind-agnostic (a class already carries its own `judge_id`).

## 3. Scoring

`scoreAbilityEntry` (`src/engines/showing/abilityScore.ts`) gains an optional `judgeWeights`
parameter, defaulting to `{}` so every caller that predates this slice (NPC valuation in
`npcMarket.ts`/`npcBreeding.ts`, `selection.ts`, the existing test file) keeps producing exactly
today's number. Where it is supplied, it folds in exactly the way `scoreEntry`'s own `judgeWeights`
folds into `ideal.weight`:

```
weight_t = discipline_weight_t * judge_weight_t
```

A missing key in `judgeWeights` reads as **1.0** ("no opinion") - the opposite of the discipline's
own `weights`, where a missing key reads as **0** ("does not care about this ability at all"). Same
split `scoreEntry`/discipline `weights` already have, just mirrored onto the new parameter.

## 4. Class creation and the seed

`createShowIfMissing` (`src/db/shows.ts`) now fetches two pools - `getJudges(env, 'conformation')`
and `getJudges(env, 'discipline')` - and draws a breed class's judge from the first, a discipline
class's from the second. The `class_N`/`judge_N` sub-seed labels and their derivation are
**unchanged** (CLAUDE.md §5.2/§5.5) - only which array `judge_N`'s roll indexes into moved. A show
created before this migration is unaffected; only a NEW show's discipline classes draw from the new
pool.

`judgeOneClass` parses `judge.ability_weights` the same way it already parses `judge.trait_weights`,
reusing the existing `parseAbilityWeights` (no new parser needed - same JSON shape) and passes it
into `scoreAbilityEntry` as `judgeWeights`.

## 5. What this does not change

- **Noise (`noise_sd`) is untouched.** Judge variance and noise are different mechanics (§9 of the
  overview calls them out as the two separate parameters) - this slice only adds the first to
  disciplines, which were already tuned for the second (slice 0012 §6.5's per-discipline noise
  estimates).
- **No admin UI.** Judges are still edited approximately never, only via D1's console, per the
  existing convention in `src/db/judges.ts`'s own header comment.
- **`show_classes`/`show_entries` schema:** unchanged. `judge_id` already pointed at `judges.id`;
  it now just resolves into one of two pools depending on `class_type`, decided at creation time.

## 6. Tests

Pure-function coverage only, matching this codebase's convention (no D1 mock exists in `/test`).
`test/showing/abilityScore.test.ts` gained a `judgeWeights` describe block: the omitted-vs-`{}`
equivalence, the missing-key-reads-1.0 convention, a worked example checked by hand (Ferris against
the Barrel Racing weights), and a same-two-horses-different-winners case under Ferris vs Winslow
scoring a Show Jumping profile - the discipline counterpart to `score.test.ts`'s existing
Ash-vs-Birch-under-three-judges coverage.

## 7. Documents to correct when this is built

- **`CLAUDE.md` §10** - a new row for this stage.
- **`docs/build-log.md`** - a dated entry: the `kind` column and no-CHECK precedent, the three new
  judges, `scoreAbilityEntry`'s new optional parameter.
- **`docs/slices/0012-discipline-shows.md` §15** - worth one line pointing here, so a reader who
  lands on the open question finds out it was answered rather than still wondering.
