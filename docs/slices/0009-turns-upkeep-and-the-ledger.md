# Slice 0009 — Turns, upkeep, and the ledger: money starts moving

**Status:** specified, not built. Next in the build order (`CLAUDE.md` §10, the "Turns and tick" row). Slices 0001, 0002, 0003, 0005, 0006, 0007 and 0008 are built. Slice 0004 (semen storage) and slice 0005 §7 (the parent's PIN) are specified but not built, and **nothing here depends on either.**

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those.

**What this slice is.** Today `stables.balance` is written once, when the stable is created, and never touched again. Nothing in the game earns or spends a penny, and nothing limits how much a child can do in one sitting. This slice turns both on: horses cost money to keep, winning a show pays money, every movement is recorded in an append-only ledger a child can read, and each account gets a budget of turns that refills on the tick.

**Why this comes now.** The build order calls this stage *"Turns, world tick, upkeep — with the world clock (§10g) rather than wall-clock calls, the tick slots in local time, and the time scale as config from the first line."* Two-thirds of that is already built: the world clock, the tick slots and the time scale all landed in slice 0001, and the tick has since grown breeding and show stages. What is left is the part that was deferred every time it came up — slice 0001 §232 (*"`actions_remaining` and `actions_reset_tick_seq` belong to the 'Turns and tick' slice"*), slice 0002 §535 (*"No action budget. Breeding costs nothing"*), slice 0008 §3 (*"'Turns and tick' has not been built, so nothing limits how much a player does per tick"*).

**One thing to hold onto while building.** Every number that moves a balance must be explainable to a child months later. Overview §2.8's rule is *"Balance alone is fast but unanswerable when a child asks where their money went."* There is exactly one function in this slice that may change `stables.balance`, and it writes a ledger row in the same breath. See §4.2 — that rule is the whole architecture of this slice.

---

## 1. What "done" looks like

On the live URL, on a phone, with no terminal:

1. Apply the new migrations from `/admin/migrations`.
2. Open a stable. It shows its balance, and underneath it, in plain words, what its horses cost to keep per game day.
3. Press the admin advance button. The balance has gone **down** by the number the page predicted, times the game days that passed.
4. Press it again several times in a row without advancing. Nothing is charged twice.
5. Pause the world from `/admin/world`, press advance several times, unpause. **Nothing was charged while paused** — no game days passed, so no board was owed.
6. Open the stable's **Money** page. Every charge is there: the day, what it was for, how much, and a running balance. The oldest row is the stable's starting balance.
7. Enter a horse in a show and advance the tick past the show's date. The top six placings are paid. The winning stable's Money page shows the prize, named for the show and the placing.
8. Open the show result. Alongside the ribbon it now says what the placing paid.
9. Let a stable run out of money. Its balance goes below zero and the page says so plainly. Try to book a covering — it refuses and names the reason. **Try to enter a show — it still works.** (§3.4: shows are the only way to earn, so debt must never lock a child out of them.)
10. Go to `/admin/money`. Add money to that stable with a reason. The balance recovers, the ledger records who added it and why, and breeding works again.
11. Every page now shows how many turns you have left. Book a covering, enter a show, claim a founding batch — each one costs a turn and the count goes down.
12. Spend them all. The next attempt refuses, says when more arrive, and takes nothing.
13. Press advance. The turns are back at full — not added to, but reset to full.
14. Pause the world and press advance. **Turns still come back** (§5.2 — a pause stops the world, not a child's afternoon).
15. Open `/stables`. A **While you were away** panel lists what happened: foals born, coverings that took and coverings that missed, show results. Press **Mark all read** and it clears.
16. Look at a horse page, a barn list, and the founding screen. Nothing anywhere shows a horse's speed, stamina, jump scope, trainability or fertility.

If all sixteen work, the slice is done.

---

## 2. Decisions taken for this slice

These four were decided in conversation on 2 Aug 2026, when this document was written. They are decisions, not recommendations.

### 2.1 Shows pay prize money — this reverses slice 0008 §2.3

Slice 0008 deliberately made the first shows ribbons-only, with this reasoning: *"Nothing in this game has spent or earned a penny yet; `stables.balance` has held its starting value since slice 0001 and nothing writes to it."* That was correct at the time. The missing piece was the ledger, and the ledger is what this slice builds.

**Upkeep without prize money would be a drain with no faucet.** The market is many stages away (`CLAUDE.md` §10); shows are already built, already judged monthly on the tick, and already rank horses honestly. Attaching a purse to the placings closes the loop in one slice: horses cost you money, good horses win some of it back, and a child who breeds well can see it in the balance rather than only on a ribbon.

**Entry fees are deliberately not built** — see §3.2. A fee plus the debt rule in §3.4 could lock a broke stable out of the only thing that earns.

**When this is built, correct the record**: `docs/horse-game-overview.md` §14's show-cadence entry currently reads *"the first shows carry no money at all (entry fees and prize money wait for the market stage)"*. That is now false for prize money and still true for entry fees. See §10.

### 2.2 Upkeep is charged per horse per **game day**, from the world clock

Not per tick. `CLAUDE.md` §5.3 is the reason: a paused world must not accrue board. `tick_seq` increments even while paused (deliberately — see §5.2), so a tick-driven charge would bill a family for a fortnight's holiday during which no game day passed and no horse ate anything.

This is a **deviation from the letter of `CLAUDE.md` §5.4**, which says to use *"the `last_processed_tick_seq` columns on `stables` and `pregnancies`"*, and from `docs/horse-game-schema.md` §2.1, which lists that column on `stables`. It obeys §5.4's actual principle exactly — *derive state from stored values rather than incrementing blindly, write `x = f(game_day - last_processed)`* — using a game-day column instead of a tick column. §4.3 spells out the arithmetic. **Leave `stables.last_processed_tick_seq` in place and unused**; it costs nothing and a later stage may want a genuinely per-tick marker.

### 2.3 Turns are per account, reset to full on the tick, and are never banked

Per `docs/horse-game-overview.md` §6c and schema §2.3: *"Recommendation: actions and tokens live on the account, not the stable… If actions were per-stable, a child would triple their turns by founding two more stables."* And: *"Unused actions do not bank: at tick time, set `actions_remaining` to the config value rather than adding to it."*

**Only big commitments cost a turn.** Booking a covering, entering a horse in a show, claiming a founding batch. Browsing, renaming, picking a picture, reading a pedigree and looking at results are all free, always. The budget is there to shape the decisions that matter, never to punish a child for looking around. §5.3 has the list, and names where the next entries go — genotype testing, buying and selling, and training all join it as those slices land.

### 2.4 A negative balance blocks breeding, never showing

Decided as *"go negative, actions blocked"*, with one correction made while writing this document and flagged here per `CLAUDE.md` §2.

The literal rule — *can't breed, enter shows or buy anything until back in the black* — has a trap in it. **Shows are currently the only way to earn money.** A stable that goes negative and is barred from entering shows can never get back out, and no amount of good play recovers it. That is a dead end with a child on the other side of it.

So: **debt blocks booking a covering** (which adds a horse, and therefore adds cost) **and will block buying, testing, training and tack as those land. It never blocks entering a show.** When you are in the red you cannot expand, but you can always compete your way out. §3.4 states the rule as code.

Nothing is ever taken away — no forced sale, no horse lost to arithmetic. And `/admin/money` (§7.3, asked for directly) is the parent's relief valve.

---

## 3. Not built here

Each of these was considered and deliberately left out. Say so in your summary if you build one anyway.

### 3.1 No care state, and no per-horse variation in upkeep

Every alive horse costs the same flat rate. Age, care, feed quality and condition all change what a horse costs to keep in reality, and all of them belong to the **Care and tack** stage (`CLAUDE.md` §10), which introduces `horses.care` and the modifiers. One flat number now; the rate becomes a function of the horse later, and `upkeep_per_horse_per_game_day` stays the base it is multiplied against.

### 3.2 No show entry fees

See §2.1. A fee is the natural pair to a purse and it will land with the market stage, where selling gives a second way to earn. Building it now, against §2.4's debt rule, would create exactly the lockout §2.4 exists to prevent.

### 3.3 No tokens, no PIN

`token_ledger`, `token_grants`, `token_products` and `token_purchases` are the **Tokens** stage, which comes after this one and is built over the PIN in slice 0005 §7. Nothing in this slice touches them. `CLAUDE.md` §13: there is no path that converts between game money and tokens in either direction, and this slice must not be the one that adds the first one.

### 3.4 No income other than prize money, and no bankruptcy

There is no wage, no allowance, no interest, and nothing sells. A stable in the red stays in the red until it wins something or an admin adds money. It is never closed, its horses are never seized, and its balance has no floor.

### 3.5 No per-horse or per-stable turn budgets

The budget is per account, full stop (§2.3). Do not add a second limiter anywhere.

**Keep `show_max_entries_per_stable` (default 3).** Slice 0008 §5.4 introduced it as *"the stand-in for the action budget that does not exist yet."* Now that the budget exists it might look redundant — it is not. It is a per-class fairness rule (one stable must not fill the field), which is a different job from limiting how much one child does in an afternoon. Leave it alone.

### 3.6 No events for money

The events feed (§6) is for things that happened to your **horses**. Upkeep is charged every tick against every stable; putting it in the feed would bury the foal announcements under three rows a day of board charges. Money lives in the ledger and on the Money page. Prize money appears in the feed only as part of the show-result event that would have been written anyway.

### 3.7 No NPC economy

The show barn is charged upkeep and paid prize money like anyone else — one code path, per `CLAUDE.md` §13's *"no parallel scoring path for NPC horses"* applied to money as well. Its balance will wander and nothing reads it. It does not breed, buy, sell or make decisions, and this slice must not give it any.

---

## 4. Money, precisely

### 4.1 The two halves

**`stables.balance`** is a denormalized cache. **`ledger`** is the truth. Schema §2.8: *"keep both a ledger and a denormalized `balance`… with the balance treated as a cache that can be rebuilt from the ledger, costs one column and settles arguments."*

The invariant, stated as a test you should actually write (§8): **for every stable, `balance` equals the sum of every `ledger.amount` for that stable, plus nothing else.** A stable's opening balance is itself a ledger row (§4.5), so there is no starting value sitting outside the sum.

### 4.2 One function moves money, and it is the whole architecture

**New file `src/db/ledger.ts`.** It exports one statement-building function and nothing else may write to `stables.balance`:

```ts
export type LedgerKind =
  | 'opening'      // the balance a stable is founded with (§4.5)
  | 'upkeep'       // board and feed, charged on the tick (§4.3)
  | 'prize'        // show winnings (§4.4)
  | 'adjustment';  // an admin adding or removing money by hand (§7.3)

export interface LedgerEntry {
  stableId: number;
  /** Signed. Negative is money leaving the stable. Integer — never a float (CLAUDE.md §7). */
  amount: number;
  kind: LedgerKind;
  /** What caused it, for tracing back: 'show_entry' | 'stable' | 'tick' | 'account'. Nullable. */
  referenceType: string | null;
  referenceId: number | null;
  /** One short sentence a child can read. "Board for 4 horses, 10 days." */
  description: string;
  gameDay: number;
}

/**
 * Returns the statements that post these entries: one INSERT into `ledger` and one balance UPDATE
 * per entry. NOTHING ELSE IN THIS CODEBASE MAY UPDATE stables.balance. Callers put these into
 * their own env.DB.batch() alongside whatever else the same action writes, so the money and the
 * thing that caused it land together or not at all.
 */
export function buildLedgerStatements(env: Env, entries: LedgerEntry[]): D1PreparedStatement[];
```

The balance update is `UPDATE stables SET balance = balance + ? WHERE id = ?` — relative, never absolute. An absolute write computed in JS would lose a concurrent charge; a relative one cannot, and it is also what makes the tick's catch-up arithmetic in §4.3 safe.

**Do not add a `balance_after` column.** Schema §2.8 does not list one, and a stored running total is wrong the moment two writes interleave. The Money page computes the running balance at read time over the rows it is already displaying.

### 4.3 Upkeep on the tick

**A new tick stage, `chargeUpkeep`, in `src/db/tick.ts`, running inside the `paused === 0` branch alongside the existing breeding and show stages.** Because it sits inside that branch it never runs on a paused tick, which is half of §2.2's guarantee; the game-day arithmetic below is the other half.

For every active stable, player-owned and NPC alike:

```
daysOwed = newGameDay - stable.last_upkeep_game_day
if daysOwed <= 0: skip this stable entirely, write nothing
horses   = count of alive horses owned by this stable
amount   = -(horses × daysOwed × upkeep_per_horse_per_game_day)
```

Then, in **one `env.DB.batch()` for the whole stage**:

- the ledger statements from §4.2 for every stable with a non-zero `amount`, and
- `UPDATE stables SET last_upkeep_game_day = ? WHERE id = ?` for **every** stable where `daysOwed > 0`, including ones that owe nothing because they hold no horses.

**Why this is idempotent** (`CLAUDE.md` §5.4): a re-fired tick recomputes `daysOwed` against the already-advanced `last_upkeep_game_day`, gets zero, and does nothing. A *missed* tick recomputes against a larger gap and charges the days that actually passed — which is right, because the horses ate on those days. This is §5.4's `x = f(game_day - last_processed)` shape exactly.

**A stable with no horses is still stamped forward.** Otherwise its `last_upkeep_game_day` sits at its founding day, and the day it buys its first horse it is charged for every game day since — a bill for horses it did not own.

**A horse counts as alive** by whatever `countAliveHorses` in `src/db/horses.ts` already means by it. Do not invent a second definition. A foal born mid-gap is charged from the tick after its birth, not from its birth day — a one-tick approximation that is not worth a per-horse `owned_from` calculation at this scale. Say so in a comment.

### 4.4 Prize money at judging

Prize money is paid **inside `judgeOneClass`'s existing single batch** in `src/db/shows.ts`, alongside the entry updates and the `horse_show_summary` upserts. Slice 0008 §6.2 built that batch to land atomically and this must not become a second write that can happen without it.

**The purse is snapshotted onto the class at creation, not read from config at judging** (`CLAUDE.md` §5.5). A new `show_classes.prize_schedule TEXT NOT NULL` column, copied from `config.values.show_prize_schedule` when `createDueShows` builds the class — the same treatment `ideal_vector`, `noise_sd` and `ideal_falloff` already get. A class judged months after someone retuned the purse pays what it advertised when it was scheduled.

The schedule is a JSON array, index 0 = first place:

```json
[600, 350, 200, 120, 80, 50]
```

Placings beyond the end of the array pay nothing. A placing pays to `show_entries.entered_by_stable_id` — which is the show barn's own stable id for an NPC entry, so the barn is paid like anyone else (§3.7).

Store what was paid: **`show_entries.prize_paid INTEGER NOT NULL DEFAULT 0`**, so a result screen years later can say what it paid without re-deriving it from a schedule that has since changed. This is the same "snapshot how a result was reached" discipline overview §9 asks for and slice 0008 §5.5 already follows.

One ledger row per paid entry, `kind = 'prize'`, `referenceType = 'show_entry'`, `referenceId = the entry id`, description naming the show and the placing: `"1st place, Cedar Hollow Spring Show, Year 2"`.

**A class with no entries pays nothing**, which falls out for free from slice 0008's zero-entry path.

### 4.5 The opening balance

Every stable's founding balance becomes a ledger row so §4.1's invariant holds with no special case. Two places:

- **`createStableWithPrefix`** in `src/db/stables.ts` adds the `kind = 'opening'` statements to the batch it already builds. Description: `"Starting balance."`
- **A migration** writes one `opening` row for every stable that already exists, with `amount = balance`, `game_day = created_game_day`, so the invariant is true for stables founded before this slice. This is a backfill and therefore its own migration file, per `CLAUDE.md` §8's one-logical-change rule.

`src/db/reset.ts` needs `ledger` and `events` added to its `RESET_TABLES` list and to `test/reset.test.ts`'s `REFERENCES` map — see §9.

### 4.6 The debt rule

**New pure function in `src/lib/money.ts`:**

```ts
/** True when this stable may take on a new cost. Debt blocks expansion, never competing (§2.4). */
export function canTakeOnCost(balance: number): boolean {
  return balance >= 0;
}
```

Called by `bookCovering`'s route before booking, and by nothing else in this slice. When it refuses, the message names the stable and the number: *"Willow Bend is 240 in the red. Win a show, or ask a grown-up to add money, before breeding again."*

**Do not call it from the show entry path.** Put a comment saying why, at the call site that does not exist, so a later session tidying up "the missing check" reads §2.4 first.

### 4.7 The numbers, and why they are low

| Key | Default | Why |
|---|---|---|
| `upkeep_per_horse_per_game_day` | `2` | 30 game days pass per real day, so this is 60 per horse per real day. A three-horse barn costs 180 a real day; a full ten-horse barn costs 600. |
| `show_prize_schedule` | `[600, 350, 200, 120, 80, 50]` | One show per real day. A win pays a full barn's board for the day; a third place pays a small barn's. |

Both are **deliberately gentle**, because the earning half of the economy does not exist yet — one monthly show is the only faucet in the game. The starting balance of 10,000 is roughly two months of real-time board for a small barn with no winnings at all, which is enough runway that nobody hits zero while the family is still learning what the buttons do.

**Revisit both at the market stage**, when selling a horse becomes a second way to earn. Say so on `/admin/config`.

---

## 5. Turns, precisely

### 5.1 The columns

```sql
ALTER TABLE accounts ADD COLUMN actions_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN actions_reset_tick_seq INTEGER NOT NULL DEFAULT 0;
```

Both default 0, which reads as "reset at tick 0, none left" — and because of §5.2's lazy rule, any account whose `actions_reset_tick_seq` is behind the current `tick_seq` is treated as full. So every existing account is at full budget the moment this migration lands, with no backfill.

### 5.2 The budget is derived, not written by the tick

**The tick does not touch `accounts` at all.** Instead, the budget is computed at read time:

```ts
// src/lib/actions.ts — pure, no database access.
export function actionsRemaining(
  account: { actions_remaining: number; actions_reset_tick_seq: number },
  tickSeq: number,
  actionsPerTick: number
): number {
  return account.actions_reset_tick_seq === tickSeq ? account.actions_remaining : actionsPerTick;
}
```

Three things fall out of this for free, and all three are why it is written this way rather than as a tick stage that UPDATEs five rows:

- **It is idempotent by construction.** There is no reset to double-apply. A tick that fires twice, or is missed entirely, changes nothing about how many turns anyone has.
- **It never banks.** A new tick discards whatever was left, exactly as overview §6c requires.
- **It refills while paused.** `tick_seq` increments on every tick including paused ones — slice 0001 §137 chose that deliberately, in these words: *"action budgets will reset against it later and a pause should not stop a child's turns coming back."* A pause stops the world, not a child's afternoon.

### 5.3 Spending

**The list of what costs a turn lives in one place**, so the next slice adds to a list rather than hunting for the pattern:

```ts
// src/lib/actions.ts
export type ActionKind =
  | 'book_covering'    // src/routes/stables.ts, the breeding form
  | 'enter_show'       // both doors: routes/horses.ts and routes/shows.ts
  | 'claim_founding';  // src/routes/founding.ts

/** Turns each action costs. Future slices add entries here: 'genotype_test', 'buy_horse',
 *  'list_horse', 'start_training' — decided in conversation, 2 Aug 2026. */
export const ACTION_COSTS: Record<ActionKind, number> = {
  book_covering: 1,
  enter_show: 1,
  claim_founding: 1,
};
```

**Spending is one conditional UPDATE**, in `src/db/accounts.ts`:

```sql
UPDATE accounts
   SET actions_remaining = CASE WHEN actions_reset_tick_seq = ?tick
                                THEN actions_remaining - ?cost
                                ELSE ?perTick - ?cost END,
       actions_reset_tick_seq = ?tick
 WHERE id = ?account
   AND (actions_reset_tick_seq <> ?tick OR actions_remaining >= ?cost)
```

Return `meta.changes === 1`. The `WHERE` clause is what makes it atomic — the check and the decrement are the same statement, so two forms submitted at the same instant cannot both spend the last turn.

**Order of operations: check, act, then spend.** Read the budget and refuse up front if it is empty; do the game action; then spend. If the spend loses a race and reports zero changes, let it pass and charge nothing.

That order gives away a turn in the rare race rather than taking one for nothing, and that is the right way round with these players: a child who is charged for something that did not happen has no way to find out why and no way to get it back. Write that reasoning in a comment where the spend happens, or a later session will "fix" the ordering.

**What does not spend a turn:** anything an admin does (`/admin/horses/new`, minting a founding batch, stocking the show barn), anything the tick does, and every read. Only the three actions above, taken by a logged-in player in their own session.

### 5.4 Where it shows

**In the header, on every page** (`src/render/layout.ts`'s `pageShell`), next to the game day: `6 turns left`. It needs the account's row and `world.tick_seq`, both of which `RequestContext` already carries — thread `actionsLeft: number | null` through `ShellParams`, null when logged out.

**When a turn is refused**, say when more arrive: *"You've used all your turns for now. More arrive at the next tick — 12:00."* The next slot comes from `world.tick_times_local` rendered through `config.values.display_timezone`; `src/lib/time.ts` and `src/tick/slot.ts` already have everything needed and **nothing here may call `Date.now()` to decide anything** (`CLAUDE.md` §5.3 — this is display, so reading the wall clock to render a time is fine; deciding anything from it is not).

### 5.5 The number

`actions_per_tick`, default **6**. Three slots a day makes 18 turns a real day.

That is enough that nobody hits it on an ordinary visit — one show entry, a covering, a look around — and tight enough to bite when a child with three stables tries to enter everything at once at 7am.

**This closes an open question in `docs/horse-game-overview.md` §14:** *"Do the per-tick action allowance and the tick schedule hold the daily total constant, or is the daily total meant to rise with more ticks?"* The answer is **neither automatically** — they are two independent config values (`actions_per_tick` and `world.tick_times_local`) precisely so that changing the schedule is a deliberate change to how much play a day contains, exactly as overview §6a asks: *"Keep the tick schedule and the per-tick allowance as two separate numbers, so changing the schedule does not silently change how much play a day contains."* Add a sentence saying so next to `actions_per_tick` on `/admin/config`, and update §14 (§10 below).

---

## 6. The events log

Schema §12 puts `events` in this stage. At 30 game days per real day, foals are born and shows are judged while nobody is watching; this is how a child finds out.

### 6.1 The table

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  game_day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject_horse_id INTEGER REFERENCES horses (id),
  -- payload: JSON, shape depends on kind. See §6.2.
  payload TEXT NOT NULL,
  read_at_real_ts INTEGER,
  created_real_ts INTEGER NOT NULL
);
```

**`read_at_real_ts`, not `read_at`.** Schema §10.1 names it `read_at`; `CLAUDE.md` §7 requires wall-clock columns to carry the `_real_ts` suffix so a reader can tell which clock a column belongs to. Follow the build convention and note the rename in your summary.

**Only stables with an `account_id` get events.** The NPC barn foals nothing and nobody reads its feed; writing rows for it is wasted storage. One `WHERE account_id IS NOT NULL` at every write site.

### 6.2 The kinds

Four, all written from inside the batch of whatever caused them, so an event cannot exist for something that did not happen:

| `kind` | Written by | `payload` |
|---|---|---|
| `foaled` | `foalDuePregnancies`, `src/db/pregnancies.ts` | `{"v":1,"foal_name":"…","dam_name":"…","sire_name":"…","sex":"filly"}` |
| `covering_conceived` | `resolveDueCoverings`, `src/db/coverings.ts` | `{"v":1,"mare_name":"…","stallion_name":"…","due_game_day":1234}` |
| `covering_missed` | `resolveDueCoverings` | `{"v":1,"mare_name":"…","stallion_name":"…"}` |
| `show_result` | `judgeOneClass`, `src/db/shows.ts` | `{"v":1,"horse_name":"…","show_name":"…","class_name":"…","placing":1,"prize":600}` |

`v` is the payload's own schema version, the same convention `horses.genotype` uses (slice 0002). A missing key must be legal — render defensively.

Twins produce **two** `foaled` events, one per foal, which is what a child would expect to see.

Future kinds attach here without a migration: condition onset, death, a sale completing, a service call finishing. `kind` is deliberately free text with no `CHECK`, so adding one is a code change in one place.

### 6.3 Where it shows

**On `/stables`**, the page a child lands on after logging in: a **While you were away** panel above the stable list, holding the unread events for every stable the account owns, newest first, capped at 30 rows, each one a sentence with the horse's name linking to its page. A `POST` **Mark all read** button sets `read_at_real_ts` on everything currently unread for that account's stables.

**On a stable's home page**, the same feed filtered to that stable, read and unread together, most recent 20.

**No JavaScript** (`CLAUDE.md` §11's 2026-08-02 entry) and **no writing from a GET** — marking read is the POST button, never a side effect of looking.

### 6.4 Retention

Schema §10.1: *"this table grows faster than any other. A retention rule — drop read events older than N game-days — is worth deciding early rather than discovering when a query gets slow."*

**Decided: one tick stage deletes every event older than `events_retention_game_days` (default 720) regardless of whether it was read.** 720 game days is two game years, about 24 real days.

One number rather than separate read and unread rules, because a child who has not logged in for three real weeks has lost the moment either way, and the durable records — the horse, its pedigree, its show results, the ledger — all survive regardless. `events` is a notice board, not an archive. Note in the migration that a kinder two-threshold rule is available if anyone misses an announcement.

This is the one deletion in the whole codebase that touches a growing table; `CLAUDE.md` §7 calls `events` append-only and requires *"an explicit, discussed retention job"* for exactly this. This is that discussion.

---

## 7. Where it appears

### 7.1 Player screens

- **Header, every page** — turns left (§5.4).
- **`/stables`** — the While you were away panel and Mark all read (§6.3).
- **Stable home** — balance, a plain-English line for what its horses cost per game day (*"4 horses, 8 a day"*), a red line when the balance is below zero, and a link to Money. Its subnav gains a **Money** entry next to Overview and Change prefix (`stableSubnav` in `src/render/stables.ts` is the existing pattern).
- **`/stables/:id/money`** — the ledger for one stable, newest first, paged or capped at 100 rows: game day, description, amount, running balance. Owner-only, on the same `notFound()`-for-a-non-owner shape every stable-scoped route already uses — an admin viewing someone else's stable gets no exception here, same as the image picker in slice 0007.
- **Show result page** — what the placing paid, next to the ribbon.
- **The breeding form** — refuses with the debt message when the stable is in the red (§4.6), and with the turns message when the budget is empty (§5.4).

### 7.2 `/admin/config`

Three new whole numbers on the existing numeric form — `upkeep_per_horse_per_game_day`, `actions_per_tick`, `events_retention_game_days` — added to the numeric key list in `src/routes/admin.ts`. `show_prize_schedule` is JSON and is edited from D1's console, like `quality_bands` already is; say so on the page.

Add the §4.7 warning next to the upkeep rate: these defaults are gentle because prize money is currently the only income in the game, and both want revisiting when the market lands.

### 7.3 `/admin/money` — adding money by hand

**Asked for directly, 2 Aug 2026.** A new admin subpage in the existing subnav pattern.

- Pick a stable from a list showing every stable, its owner and its current balance.
- Type an amount. **Negative is allowed** — this both gives and takes, so a mistake can be undone.
- Type a reason, required, free text. It becomes the ledger row's `description`, so a child reading their Money page sees *"Chore reward from Dad"* rather than an unexplained number.
- One `kind = 'adjustment'` ledger row, `referenceType = 'account'`, `referenceId` = the admin account that did it, written through §4.2 like every other movement.
- A short list of recent adjustments underneath, so the same one is not made twice.

Guard it the way `/admin/world`'s advance control is guarded: a `required` checkbox the admin ticks, re-checked server-side. No JavaScript, no `confirm()`.

**This is the relief valve for §2.4** — the way a stable that has run itself into the red gets out when the game itself has no answer yet.

---

## 8. Tests

Nothing here needs a database. Follow the existing `test/` layout.

**`test/actions.test.ts`** — `actionsRemaining`:
- an account whose `actions_reset_tick_seq` matches the current tick reports its stored remainder;
- an account behind the current tick reports a full budget regardless of what it has stored;
- an account **ahead** of the current tick (impossible, but assert it anyway) reports full rather than something negative;
- a fresh account with both columns 0, at tick 12, reports full.

**`test/money.test.ts`** — `canTakeOnCost`: exactly 0 is allowed; −1 is not; a large positive is.

**`test/upkeep.test.ts`** — the pure day-arithmetic helper §4.3 uses, extracted so it is testable without D1:
- 4 horses × 10 days × rate 2 = 80;
- `daysOwed` of 0 charges nothing;
- a 30-day gap charges 30 days, not one tick's worth — the missed-tick catch-up;
- 0 horses charges nothing but still reports that the marker must move.

**`test/ledger.test.ts`** — the running-balance helper the Money page uses: given an opening row and three movements, the running column ends at the stable's balance.

**Extend `test/reset.test.ts`** — `ledger` and `events` in the `REFERENCES` map, in the right position (both point at `stables`; `events` also points at `horses`).

**Do not touch `test/rng.test.ts`.** This slice draws no randomness at all — no new sub-seed labels, no `makeRng` calls, nothing. If you find yourself needing a random draw here, stop and re-read the slice.

---

## 9. Data summary

**Read `migrations/` and take the next free number.** At the time of writing the highest is `0041`, so this lands at `0042` — but `CLAUDE.md` §11's numbering entry has been wrong about this twice, so check rather than trust it. Register every new file in `src/db/migrations.ts` as well (`CLAUDE.md` §8), and keep bare `;` and `--` out of every string literal, per the `splitSqlStatements` warning slice 0008 hit the hard way.

Roughly seven migrations:

| Migration | What |
|---|---|
| `ledger` | The table in §4.2's shape, plus `counterparty_stable_id` and `same_account` as nullable/0 with a comment that nothing writes them until the market stage (schema §2.4). Index on `(stable_id, id DESC)` for the Money page. |
| `stables_upkeep` | `last_upkeep_game_day INTEGER NOT NULL DEFAULT 0`, plus a `UPDATE` setting every existing stable's value to the current `world.game_day` — otherwise the first tick after deploy charges every stable for every game day since the world started. **This one matters. Get it wrong and the first tick after deploying empties every balance in the game.** |
| `ledger_opening_backfill` | One `opening` row per existing stable (§4.5). Its own file, per `CLAUDE.md` §8. |
| `show_classes_prizes` | `prize_schedule TEXT NOT NULL DEFAULT '[]'` and `show_entries.prize_paid INTEGER NOT NULL DEFAULT 0` (§4.4). Two tables, so arguably two files — one is fine if the comment covers both, and say which you chose. |
| `accounts_actions` | §5.1's two columns. |
| `events` | §6.1's table. Index on `(stable_id, id DESC)` and one on `read_at_real_ts` for the unread count. |
| `config_economy` | `upkeep_per_horse_per_game_day`, `show_prize_schedule`, `actions_per_tick`, `events_retention_game_days`. Split across two files if you split the slice (§11). |

New files: `src/db/ledger.ts`, `src/lib/actions.ts`, `src/lib/money.ts`, `src/db/events.ts`, `src/render/money.ts`. New config fields on `ConfigValues` in `src/lib/config-cache.ts`, commented like every other block there.

---

## 10. Documents to correct when this is built

- **`CLAUDE.md` §10** — the "Turns and tick" row to built, with what landed and what did not.
- **`CLAUDE.md` §11** — a dated entry. The one-function-moves-money rule (§4.2) and the derived-not-written budget (§5.2) are the two a future session most needs and will not otherwise guess.
- **`CLAUDE.md` §7** — the append-only list names `events`; add the retention exception decided in §6.4.
- **`docs/horse-game-overview.md` §14 — already done**, when this document was written. The show-cadence entry records that its ribbons-only half is reversed (§2.1), and the action-budget open question is struck through and answered (§5.5). Read both to check they still describe what you actually built; do not write them a second time.
- **`docs/horse-game-schema.md` §2.1** — note that upkeep uses `last_upkeep_game_day` and why `last_processed_tick_seq` was left alone (§2.2). §10.1's `read_at` becomes `read_at_real_ts` (§6.1).
- **`docs/slices/0008-one-show-class.md`** — leave it alone. It is a historical record of what was decided then; §2.1 above supersedes its §2.3 and says so.

---

## 11. If this is too large for one session

It probably is. Split on the seam between money and turns; each half deploys on its own and neither breaks the other.

**Part A — money moves.** §4 entire, plus `/admin/money` (§7.3), the balance and Money screens (§7.1), and the debt rule (§4.6, §2.4). At the end of Part A, upkeep is charged, shows pay, every movement is explainable, and a parent can add money. Nothing yet limits how much a child does.

**Part B — turns and the log.** §5 and §6 entire. At the end of Part B the budget bites and the feed tells a child what happened while they were asleep.

Build A first. Part B's turn budget is only interesting once the actions it limits have consequences, and Part A is the half that makes the horses cost something.

---

## 12. What to raise rather than decide

- **If the numbers in §4.7 feel wrong once you can see real balances moving**, say so with the arithmetic rather than quietly changing them. They were chosen against one show a real day and no other income, and that is a guess about pacing that only play settles.
- **If a stable is going to hit zero within the first week of play**, that is worth naming out loud before it happens to a child, not after.
- **If you find yourself wanting a second function that writes `stables.balance`** (§4.2), stop. That is the rule this slice exists to establish, and the second writer is always where a ledger stops reconciling.
- **If the events feed needs a per-kind on/off switch**, do not build one here — it is a `config.flags` entry and a conversation.
- **If the turn cost of any action feels wrong in play** — a covering costing the same as looking at a show entry — say so. §5.3's `ACTION_COSTS` map exists so that is a number change, not a rewrite.
