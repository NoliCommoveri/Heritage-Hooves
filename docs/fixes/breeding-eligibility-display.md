# Fix: stop offering breeding to horses that cannot breed

Two operator-reported display defects, same root cause, same fix. Unrelated to
`docs/fixes/breed-disease-panels.md` — filed separately because it touches breeding
screens, not genetics.

Neither is a rules bug. Every refusal below is **already enforced correctly** at the point
of action: `validateBreeding` (`src/routes/horses.ts:424-467`) and `validateStudBooking`
(`src/db/stud.ts:200-240`) are near-identical ladders that check age, pasture settling,
pregnancy, booked covering, foaling recovery, season, and capacity. A child cannot
actually breed an ineligible mare. The bug is that all three screens **invite them to try**
and only refuse after the click.

---

## 1. Heat and "Offer at stud" on immature horses

`min_breeding_age_game_days` is 1080 (three game years, `migrations/0016`). Until then a
horse cannot breed, and both refusal ladders say so. But:

- **`mareStatusLine`** (`src/routes/horses.ts:1095-1143`) runs its whole priority ladder on
  any live mare regardless of age, so a yearling filly's page reads *"In season now."* or
  *"Due back in season around June, Year 3."* She is not cycling and could not be covered
  if she were.
- **The barn-list "in season" badge** (`src/routes/horses.ts:304-311`, rendered at
  `src/render/horses.ts:534`) has the same gap — foals get the green badge.
- **The "Offer at stud" card** (`src/render/horses.ts:424-459`) renders on any live
  stallion's own page, colts included.

**Fix.** One shared predicate, since three call sites need the same answer:

```ts
// src/engines/breeding/maturity.ts — pure, no DB
export function isOldEnoughToBreed(bornGameDay: number, gameDay: number, minAgeGameDays: number): boolean
```

- `mareStatusLine` returns early for an immature mare with a line that says what is
  actually true and when it changes — *"Too young to breed. She can be bred from around
  {date}."* — reusing `formatCalendarDate` so it reads like every other date on the page.
  Put this check **above** the pregnancy branch: nothing else in the ladder can be true.
- The barn badge suppresses `inSeason` for an immature mare. `isInSeason` itself is
  untouched — the engine is right, the display was asking it the wrong question.
- The "Offer at stud" card is not rendered for an immature stallion. Prefer a short muted
  line over silence — *"Old enough to stand at stud from around {date}."* — so the card's
  later appearance is not a surprise.

**Also worth checking while in there:** `mareStatusLine`'s `cycle_anchor_tick_seq === null`
branch already returns *"Not yet cycling."* If that anchor is only set at maturity, the age
check makes it unreachable and it should say so in a comment rather than be deleted — it is
also the correct answer for a mare who has never had one for another reason.

---

## 2. The mare pickers offer mares that cannot be bred

Three pickers, all built by filtering on sex alone:

| Screen | Code | Today |
|---|---|---|
| Breed page, mare picker | `src/routes/horses.ts:572` | `allHorses.filter(h => h.sex === 'mare')` |
| Breed page, own stallions | `src/routes/horses.ts:573` | same, no eligibility |
| `/market/stud` mare picker | `src/routes/market.ts:699` | `if (horse.sex === 'mare') options.push(...)` |

So a child with four mares — one in foal, one booked, one recovering from foaling, one
free — is shown all four and finds out by pressing the button. That is the same papercut
the 2026-08-04 build-log entry fixed one layer up (the refusal used to replace the picker
entirely, so they could not even pick again); this fixes the layer below it.

**Fix — reuse the ladder, do not restate it.** The refusal functions already compute
exactly this. Factor the mare-side, stallion-independent checks out of both into one pure
engine function:

```ts
// src/engines/breeding/eligibility.ts
export type MareIneligibility =
  | 'too_young' | 'in_foal' | 'booked' | 'recovering' | 'at_pasture' | 'settling';

export function mareIneligibility(input: MareEligibilityInput): MareIneligibility | undefined;
```

`validateBreeding` and `validateStudBooking` both call it and keep their own wording; the
pickers call it to decide what to list. **Do not add a fourth copy of the rule** — CLAUDE.md
§13's no-second-scoring-path principle applied to eligibility, and there are already two
copies of this ladder, which is the reason it is worth factoring now rather than later.

Season and capacity stay out of `mareIneligibility` — they are barn-wide, not per-mare, and
belong in a single sentence above the picker rather than repeated against every mare.

### Show why, do not just hide

Silently dropping mares is the wrong cure for a child who is looking for one by name. List
only eligible mares in the `<select>`, then one muted line under it naming who was left out
and why:

> Not shown: Bella (in foal), Daisy (booked to Rio), Pepper (recovering from foaling).

Only render the line when something is excluded. When **no** mare is eligible, say so
instead of drawing an empty picker with a live button:

> None of your mares can be bred right now. Bella is in foal, Daisy is booked to Rio, and
> Pepper is recovering from foaling until around April, Year 4.

The stud page's picker spans every stable on the account, so its exclusion line needs the
stable name too — the same `stableName` its options already carry.

---

## Tests

1. `isOldEnoughToBreed` at the boundary — one day under and one day over
   `min_breeding_age_game_days`.
2. `mareIneligibility` returns the right reason for each of: in foal, booked, recovering,
   too young, at pasture, settling — and `undefined` for a free mare.
3. The two refusal ladders still refuse everything they refused before. This is the
   regression that matters: the factoring is only safe if `validateBreeding` and
   `validateStudBooking` come out behaviourally identical.
4. A picker built from a barn where every mare is ineligible yields no options and the
   no-eligible-mares sentence — the empty-picker-with-a-live-button case.
