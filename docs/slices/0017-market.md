# Slice 0017 — The market: listing a horse, selling it, and what travels with it

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts of them this
slice depends on are quoted or summarised below.**

The market is the last structural piece of the economy. Everything before it produces horses;
nothing before it lets a horse leave a stable except by dying or being retired away. Three things
have been waiting on this stage since slice 0001:

- **`stables` under one account trade only through the market** (overview §1a, schema §2.4). There
  is deliberately no direct-transfer function, so until this slice exists a child running two barns
  cannot move a horse between them at all.
- **`horse_knowledge` transfers to the buyer on sale** (schema §4.4). The table has been per-stable
  since its first row specifically so this would be possible; nothing has ever exercised it.
- **`ledger.counterparty_stable_id` and `ledger.same_account`** were added by slice 0009 and have
  never been written. They exist for exactly this stage.

The market stage covers four mechanisms. **This document specifies all four and asks for one to be
built.**

| Part | What it is | Status |
|---|---|---|
| **A** | **Player sale listings, and the transfer itself** | **Build this** |
| B | NPC stables listing their stock for sale | Specified in §11, not built |
| C | NPC stables buying — a standing offers board *and* NPC purchases of open listings | Specified in §12, not built |
| D | Stud services, player and NPC stallions | Specified in §13, not built |

Parts B–D are written down now rather than later for one reason: **they share Part A's table, its
pricing engine, and its transfer path.** An NPC listing is a `listings` row with an NPC stable in
`seller_stable_id`. If Part A is built without knowing that, the transfer gets written assuming a
seller with an account and a session, and Part B becomes a rewrite instead of a policy.

---

## 1. What "done" looks like

Part A only.

- Any stable can **list a live horse it owns at any price**, from that horse's own page. Listing is
  free and costs no action. A horse can be on the market once at a time.
- The listing form shows a **guide value** — what the game reckons the horse is worth, and the
  three or four reasons why. It is advice. The seller types whatever price they like.
- **`/market` lists every open listing in the game**, with the same tabs and breed picker slice
  0016 gave the barn and the shows page. Each row names the horse, its breed, colour, age, sex,
  the selling stable, and the asking price.
- A listing shows **every disease the game tests for, each marked with the seller's result or with
  "not tested"** — the seller cannot hide a result they hold, and cannot let silence read as clear.
  It shows the horse's **show record**. It shows **no conformation number and no genotype**.
- **Buying costs one action** and takes the money out of the buyer's balance immediately. The buyer
  needs a free stall and enough money — not merely a non-negative balance.
- On sale the horse moves, **everything travels with it** — pedigree, genotype, conditions, care
  timers, image, show record, an unresolved covering, an active pregnancy, an unjudged show entry
  — the **barn name and notes clear**, and the **seller's test results are copied to the buyer**.
  The seller keeps their own copy.
- A **commission** comes out of the seller's proceeds. Three ledger rows, on two books, in one
  batch: the buyer's payment, the seller's receipt, the seller's commission.
- **`/market/sold` shows completed sales to everyone** — horse, price, both stables.
- A listing **expires** after a snapshotted number of game days and the seller is told. A seller can
  **withdraw** an open listing at any time, free.
- A listed horse is **still fully yours**: show it, breed it, feed it, turn it out. The listing is
  an advert, not an escrow.

Explicitly **not** in scope: NPC stables listing or buying anything, stud services, tack, tokens,
auctions, offers-below-asking, and any change to how a horse is bred, judged, aged or scored. **No
existing formula moves.** The one existing *function* that changes is
`buildLedgerStatements` (§6.2), and it gains two optional fields, nothing more.

---

## 2. Decisions taken for this slice

Every decision below was put to the operator on **3 August 2026**, with the alternatives and their
costs spelled out. They are settled. Read the reasoning — smaller choices follow from each, and
three of them close questions the design documents have carried as open since the beginning.

### 2.1 Fixed price, buy-now. No auction, no offers.

The seller sets a price; the first buyer with the money, a free stall and an action spends it and
the horse is theirs. Nothing is queued, nothing resolves on a tick, nobody loses a horse by being
asleep.

The alternatives were a make-an-offer inbox and a timed auction. Both were rejected for the same
reason: they add a thing a child must come back and check, and a way to lose a horse they wanted
through no decision of their own. A timed auction is genuinely the best price-discovery mechanism
available and would be fun — it is also bid state, a tick stage, and a losing bidder. **If auctions
are ever wanted, they arrive as a second listing type on the same table** (`listings.kind`), not as
a rewrite of this one. Build the fixed-price path so that stays true: nothing in §7 should assume
`price` is the only way a sale price can be arrived at.

### 2.2 No minimum listing duration. The ledger flag is the whole defence.

Overview §1a and schema §2.4 both recommend a minimum listing duration so that a sale between two
stables under one account is genuinely public — "a horse sitting on the open market for a real day
is one a sibling could have bought."

**The operator declined it.** Listings are buyable the moment they are posted, by anyone, including
the seller's own other stable.

What is built instead is the other half of schema §2.4's recommendation, and it is not optional:
**every ledger row from a sale carries `counterparty_stable_id`, and `same_account` is set to 1
when the buyer and seller stables share an `account_id`.** The leak is named, visible and
queryable rather than prevented. At five players this is very likely the right trade — the cost of
the duration rule is a real sale between two siblings being made to wait, and the benefit is
stopping a thing anybody can see in the ledger anyway.

Do not add the rule back in quietly. If it turns out to be needed, it is a config key
(`market_min_listing_game_days`, default 0) and a check in §7.1 — one line, once someone has
actually seen the pattern in the ledger.

### 2.3 Health is always disclosed — and disclosure means *what the seller knows*, never what is true

**This closes the open question in overview §2c, schema §4.4 and schema §7.1.** Every test result
the seller holds for that horse appears on the listing. There is no per-listing choice, and
therefore **`listings.disclosed_knowledge` is not built** — a column nothing writes is a column a
future session has to work out the meaning of (CLAUDE.md §9's "prefer the boring implementation",
and slice 0013's own instruction not to add a column until something writes it).

**The distinction this rests on is the one CLAUDE.md §12 calls load-bearing for the whole design.**
The listing reads `horse_knowledge` — what a stable has *paid to learn*. It never reads
`horse_conditions` or `horses.genotype` — what is *true*. So:

- The seller tested for HYPP and got carrier → the listing says **carrier**. They cannot omit it.
- The seller never tested for PSSM1 → the listing says **not tested**. The horse's real PSSM1
  status stays invisible to everyone, seller included.
- The seller has tested nothing → the listing says so, in a whole sentence.

**"Not tested" must be displayed as loudly as a result.** The listing renders one row per condition
the game tests for — not one row per result the seller happens to hold. A list of three clear
results with two conditions silently absent reads to a nine-year-old as a clean bill of health, and
it is not one. This is the single most important rendering detail in the slice.

Two things this preserves, both deliberate. The testing economy stays intact — a seller who wants
the tested-clear premium overview §5 describes has to pay for tests, and a buyer who does not trust
the gaps can buy the horse and test it themselves. And nobody can peek at a genome nobody paid for.

### 2.4 A listing shows the show record and the health results, and no measured number

Slice 0016 §2.2 decided that another player's horse shows "what a stranger at a show could see, and
nothing measured" — the rule is written in a comment at the top of `src/render/world.ts`. A listing
has to break that rule for health, because §2.3 says so.

**It breaks it once, for health, and not again for conformation.** A buyer judges on the horse's
show record (already public), its disclosed health results, its age, sex, colour, breed and
pedigree. No trait table, no guide value, no genotype.

Three reasons. The show record is the honest proxy — a horse with wins has *demonstrated* the
quality the trait table would assert, and it is already public. It keeps slice 0016's rule with one
named exception rather than two. And it means **showing your stock is how you prove it is worth
buying**, which is a good loop for a game about shows: an untested, unshown three-year-old is
genuinely a gamble, and it should be.

The consequence, accepted: a child can list a horse with excellent conformation and sell it cheap
because it has never been to a show. That is a lesson, not a bug.

### 2.5 Buying costs an action. Listing is free. The commission is the sink.

`src/lib/actions.ts` has named `'buy_horse'` and `'list_horse'` as expected future action kinds
since slice 0009. Only the first is built.

- **Buying: one action.** A purchase is a real decision and should compete with breeding, showing
  and testing for the day's turns.
- **Listing: free, no action, no fee.** A child can list their whole barn in one sitting. Accepted
  — the ones nobody buys expire, and a listing that costs nothing is a listing a child will
  actually use rather than hoard actions against.
- **A commission on completed sales**, `market_commission_percent` of the price, taken from the
  seller's proceeds. This is the market's money sink and the only one that scales with the size of
  a trade. It is never charged on a sale that does not happen.
- **No listing fee.** Rejected: it charges a child for a horse that did not sell.

Arithmetic worth having in view when tuning: at 5%, a 4,000 sale removes 200 from the game — about
a hundred game days of board for one horse, or a third of a first-place ribbon. Deliberately small.
This is a brake, not a tax, and the economy currently has one income source.

### 2.6 Everything travels, including a pregnancy and an unjudged entry

A sold horse arrives at the buyer complete. Pedigree, genotype, `horse_conditions`, care timers,
location and its settling clock, image, `horse_show_summary`, and any **active pregnancy**,
**unresolved covering** or **unjudged show entry**.

- **A mare in foal can be sold in foal, and the buyer gets the foal.** This falls out of the
  existing code rather than needing new code: `foalDuePregnancies` reads `dam.owner_stable_id` at
  the moment of foaling for both the foal's owner *and* its `breeder_stable_id`/`breeder_prefix`
  (`src/db/pregnancies.ts`). Sell the mare and the foal is born into the buyer's barn under the
  buyer's prefix, permanently. **Do not "fix" this.** It is the same rule Part D settles for stud
  services (§13.3): the breeder is the mare's owner.
- **An unresolved covering follows the mare**, which does need one line: `coverings.stable_id` is
  reassigned to the buyer in the sale batch, so the conception-or-miss event goes to whoever owns
  her when it resolves.
- **An unjudged show entry follows the horse**, which also needs one line:
  `show_entries.entered_by_stable_id` is reassigned, so the placing and any prize money land with
  the new owner.

**All three must be named on the buy confirmation page, by name and by date**, before the button is
pressed — "Bluebell is in foal, due about game day 1,240; the foal will be born in your barn under
your prefix" and "she is entered in the Spring Conformation class on game day 1,215; that entry, and
any prize, comes with her." A child who did not realise they were buying a pregnancy is a family
argument.

The alternatives were blocking the listing of a pregnant or entered horse, and cancelling the
pregnancy on sale. Both were rejected: a mare in foal is one of the most interesting things in the
game to price, and cancelling a foal because of a sale would be cruel.

### 2.7 The guide value is advice, and only the owner sees it

The listing form shows an estimated value and the reasons behind it. Any price from 1 to
`market_max_price` is accepted, guide or no guide. **Nothing is enforced and no warning blocks a
submission** — an over-priced listing is a choice, and finding out it does not sell is the lesson.

**The guide is shown to the horse's owner and to nobody else.** It appears on the listing form, on
the owner's own horse page, and never on `/market`, `/market/:id` or `/world`. A buyer sees the
asking price and judges it themselves.

This was chosen over showing the guide to buyers too. That option's appeal was protecting a younger
child from an older sibling's asking price; its cost is that it decides the negotiation in advance
and makes every listing either obviously good or obviously bad. The record and the health results
are what a buyer reasons from.

### 2.8 A listed horse is still yours

Show it, breed it, call the farrier, turn it out, rename it, retire it away. The listing is an
advert. Nothing is escrowed and nothing is frozen.

The consequence to handle rather than prevent: **the horse can change between a buyer reading the
listing and pressing buy** — it can win a class, fall overdue for the farrier, get in foal, or die.
Only two of those matter, and §7.1 handles both: a horse that is no longer alive or no longer owned
by the seller cannot be bought, and the guards are `WHERE` clauses, not just checks.

Retiring away a listed horse withdraws the listing, and the retire-away confirmation page names it
alongside the pregnancies and entries it already names (overview §7a).

### 2.9 Sales are public

`/market/sold` lists completed sales — horse (linked), price, selling stable, buying stable, game
day — newest first, visible to every logged-in player.

Public prices are the only mechanism that teaches a child what a horse is worth, and §2.2's whole
defence against same-account laundering rests on a sale being visible to a sibling after the fact,
since it is no longer delayed before the fact. A sale is public or §2.2 has nothing behind it.

---

## 3. Not built here

### 3.1 Anything an NPC stable does in the market

No NPC listings, no NPC buy offers, no NPC purchases. Specified in §11 and §12, built later.

**This is the largest known risk in shipping Part A alone, and it should be said plainly to the
operator on delivery:** with five players and no NPC participation, the market may sit empty. Every
listing needs another *child* to want that horse, have the money, have a stall, and have an action.
The three problems overview §10a says NPC stables exist to solve — empty classes, gene pool
collapse, and no exit for surplus stock — are only addressed for the first one so far.

If the market is quiet after a week of real play, that is not a bug in Part A. It is Part B and C
being missing, and it is the argument for building them next.

### 3.2 Stud services

Specified in §13. The market's most valuable mechanism for the *genetics* of this game — overview
§10f calls NPC stallions at stud "a cheaper, more realistic, better-targeted outcross mechanism
than outright sales" — and the one that requires the most care, because it is the first cross-stable
breeding in the game and the covering path currently refuses anything but two horses in one barn
(`src/routes/horses.ts`: "Choose a mare and a stallion from this stable").

### 3.3 Auctions, offers below asking, reserve prices, part-shares, leases

Not built, not specified, not implied by any table added here. §2.1 records how an auction would
attach if it is ever wanted.

### 3.4 Any change to breeding, judging, ageing, care, or scoring

No engine in `src/engines/` changes. `src/engines/market/appraise.ts` is new and is read by nothing
except the market screens — it never feeds a show score, a breeding decision or an NPC choice.

### 3.5 A price history chart, a market index, or any analytics

`/market/sold` is a list. Nothing aggregates it.

---

## 4. The model — appraisal

### 4.1 Where it lives and what it must not do

`src/engines/market/appraise.ts`. A pure function, no database access (CLAUDE.md §5.1), no
randomness, no wall clock. The caller reads the horse, its knowledge rows, its show summary and its
breed's ideal vector, and hands them all in already computed.

**It reuses `scoreEntry` from `src/engines/showing/score.ts` for the quality term rather than
inventing a second "how good is this horse" formula.** This is the same rule slice 0015 §2.2
applied to NPC selection, for the same reason: a retune of a breed's ideal vector must flow through
to what the game thinks a horse is worth, because it is the same function and not a copy of it.
Call it with `judgeWeights: {}` — no judge is involved in an appraisal, so every trait takes
`scoreEntry`'s own 1.0 default.

**It reuses `agePerformanceModifier` from `src/engines/ageing/performance.ts` for the decline
term**, for the same reason. A horse past its peak is worth less as a competitor, and the curve
that says how much less already exists and is already tunable from `/admin/config`.

### 4.2 The one thing it must never read

**`horses.natural_death_game_day` is not an input to this function, in any form.**

It is the horse's rolled lifespan, never rendered to a player in any form (slice 0011). A value
that quietly dropped when a horse crossed into its last two years would leak it — an owner
watching the guide value could read the death date off the curve.

What the appraisal may read is **`horses.frailty_notice_game_day`**: the announced Failing notice,
which the owner has already been told about explicitly. A failing horse is worth less, and by then
everybody who can see the number already knows why.

Write this as a comment at the top of the file. It is the kind of thing a future session adds "for
realism" without noticing what it exposes.

### 4.3 The shape

```
quality      = scoreEntry({ expressed, ideal, judgeWeights: {}, falloff }).rawScore   // 0..100
base         = market_base_value * (1 + market_quality_weight * quality / 100)

value        = base
             × youthFactor
             × agePerformanceModifier(ageGameDays, ...).modifier
             × (isFailing ? market_failing_factor : 1)
             × healthFactor
             × recordFactor
             × market_price_multiplier

result       = max(market_min_value, round to nearest 10)
```

- **`youthFactor`** — ramps linearly from `market_foal_value_factor` at birth to `1.0` at
  `min_breeding_age_game_days`, then stays at 1.0. It reuses the existing breeding-age key rather
  than inventing a second "old enough to be worth something" threshold. A weanling is a promise;
  a three-year-old is a horse.
- **`healthFactor`** — starts at 1.0 and walks the seller's knowledge rows. Each `clear` multiplies
  by `(1 + market_clear_premium)`, the whole clear premium capped at `market_clear_premium_cap`;
  each `carrier` multiplies by `market_carrier_factor`; each `affected` by
  `market_affected_factor`. **An untested condition changes nothing** — this is what makes the
  tested-clear premium real and untested stock a gamble, per §2.3.
- **`recordFactor`** — `1 + market_win_bonus × wins + market_place_bonus × (topThree − wins)`,
  capped at `market_record_cap`, read from `horse_show_summary`.

Every coefficient is a live tunable in config (§5.3). The engine takes them as one params object
and reads nothing global.

### 4.4 Seven breeds have no ideal vector, and the function has to say so

Only the Quarter Horse has a seeded `breeds.ideal_vector` (CLAUDE.md §10). `scoreEntry` returns
`weightSum: 0` for the rest, and its own guard scores 0.

**A quality of zero must not be mistaken for a bad horse.** When the ideal vector is absent or
empty, the appraisal drops the quality term entirely — the factor is 1.0, not 0 — and returns a
flag saying so. The listing form prints a plain sentence over the guide value: *"We can't judge
conformation for this breed yet, so this is a rough guess based on age, health and show record."*

This will be wrong-feeling and that is correct: it is the honest state of the game until the other
seven breeds are seeded, and it is better than confidently valuing a Morgan at nothing.

### 4.5 What it returns

```ts
export interface Appraisal {
  /** Integer, rounded to the nearest 10, floored at market_min_value. Currency: never a float. */
  value: number;
  /** The "why" line, in the order shown. e.g. [{ label: 'Conformation', detail: 'scores 84' },
   *  { label: 'Age', detail: '9 years — past its best' }, { label: 'Tested clear', detail: '3 of 5' }] */
  factors: { label: string; detail: string }[];
  /** True when the breed has no ideal vector and the quality term was skipped (§4.4). */
  qualityUnknown: boolean;
}
```

The `factors` array is what makes the guide teach something rather than assert a number. A child who
reads *"Age: 14 years — past its best"* learns why an old horse is cheap. A bare 900 teaches
nothing.

---

## 5. Data

### 5.1 Migration numbers

Three migrations. **Claim the numbers at build time by reading `migrations/`, not from this
document** (build log, 3 Aug 2026) — at the time of writing the next free is `0090`. Register each
one in `src/db/migrations.ts` in the same change (CLAUDE.md §8).

### 5.2 `listings` — the table

```sql
-- The market's one table (slice 0017 §5.2), from schema doc §7.1. Every sale in the game is a row
-- here: player-to-player today, NPC-to-player and player-to-NPC when Parts B and C land - an NPC
-- listing is this same row with an is_npc stable in seller_stable_id, not a second table.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  seller_stable_id INTEGER NOT NULL REFERENCES stables (id),
  -- price: what the buyer pays, in whole units. Integer, never a float (CLAUDE.md §7). Fixed at
  -- listing time and never changed - editing a price is withdraw-and-relist, so the sold list
  -- (§6.4) is a record of what was actually asked.
  price INTEGER NOT NULL,
  -- guide_value: the appraisal at listing time, snapshotted. Shown to the seller only (§2.7);
  -- stored so a later session can ask how far asking prices ran from the model without having to
  -- re-derive a value from a horse that has since aged, been tested, or won something.
  guide_value INTEGER,
  listed_game_day INTEGER NOT NULL,
  -- expires_game_day: SNAPSHOT (CLAUDE.md §5.5). Retuning market_listing_game_days must never move
  -- the expiry of a listing already posted.
  expires_game_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'withdrawn', 'expired')),
  buyer_stable_id INTEGER REFERENCES stables (id),
  sold_game_day INTEGER,
  -- commission_paid: what the seller actually lost to commission, snapshotted at sale. A receipt
  -- should say what it said at the time, not what the rate happens to be today - the same
  -- reasoning horse_knowledge.cost_paid already follows.
  commission_paid INTEGER,
  -- closed_game_day: set for withdrawn and expired too, so "when did this listing stop being open"
  -- is one column rather than three.
  closed_game_day INTEGER,
  created_real_ts INTEGER NOT NULL
);

-- A horse is on the market once at a time. This is what makes that true, rather than a check
-- somebody forgets - the same pattern idx_horse_knowledge_unique already establishes.
CREATE UNIQUE INDEX idx_listings_one_open_per_horse ON listings (horse_id) WHERE status = 'open';
-- The tick's expiry sweep, and /market's own list.
CREATE INDEX idx_listings_open ON listings (expires_game_day) WHERE status = 'open';
-- A stable's own listings, on the barn and the market's "yours" tab.
CREATE INDEX idx_listings_seller ON listings (seller_stable_id, id DESC);
-- /market/sold, newest first.
CREATE INDEX idx_listings_sold ON listings (sold_game_day DESC) WHERE status = 'sold';
```

**No `sold_price` column.** Buy-now means the sale price is the asking price. If §2.1's auction ever
arrives, that is when a `sold_price` appears — and it will need one.

**No `disclosed_knowledge` column**, per §2.3. This is a deliberate departure from schema §7.1 and
belongs in the build log.

### 5.3 The ledger's two dormant columns finally get a writer

Widen the `ledger.kind` CHECK constraint to add `'sale'`, `'purchase'` and `'commission'`, in a
migration of its own, exactly as `0057_ledger_add_vet_kind.sql` and
`0070_ledger_add_farrier_kind.sql` already did. **Keep `LedgerKind` in `src/db/ledger.ts` matching
the CHECK exactly** — that union and the constraint have always been kept in step by hand and the
file says so.

Three kinds rather than one net movement, because the ledger is a thing a child reads:

```
Sold Copper Penny to Willow Creek Barrels      +4,000
Sale commission                                  −200
```

reads better, and teaches more, than a single `+3,800`.

`buildLedgerStatements` gains two optional fields on `LedgerEntry`:

```ts
  /** The stable on the other side of this movement. Null for everything that is not a trade -
   * board, prizes, vet bills. Slice 0009 left this column unwritten for exactly this slice. */
  counterpartyStableId?: number | null;
  /** 1 when buyer and seller share an account_id (schema §2.4). The whole of §2.2's defence. */
  sameAccount?: boolean;
```

**This is the only change to slice 0009's single-writer function, and it must stay the only writer
of `stables.balance`.** That file's opening comment says what to do if you find yourself wanting a
second one: stop. Nothing in this slice needs one — the sale's balance movements go into the same
`env.DB.batch()` as the horse's ownership change (§7.2).

### 5.4 Config — all live tunables

One migration, `json_set` over the config row, following `0072_config_care.sql`'s shape. Add each
key to `ConfigValues` in `src/lib/config-cache.ts` with a comment saying which section it comes
from and whether it is live or snapshotted, and to the admin config form's allow-list in
`src/routes/admin.ts`.

| Key | Default | Notes |
|---|---|---|
| `market_commission_percent` | `5` | Live. §2.5. Applied as `Math.floor(price * pct / 100)` — integer arithmetic, never a float multiply. |
| `market_listing_game_days` | `90` | **Snapshotted** onto `expires_game_day`. Three real days. |
| `market_max_price` | `1000000` | Live. A typo guard, not a balance lever. |
| `market_price_multiplier` | `1.0` | Live. Overview §10f's "global price multiplier, adjustable in one place, because the first pricing model will be wrong." Multiplies the final appraisal only — it never touches an asking price a player typed. |
| `market_base_value` | `800` | Live. What a wholly unremarkable adult horse is worth. |
| `market_quality_weight` | `4.0` | Live. A conformation score of 100 is worth 5× base before every other factor. |
| `market_foal_value_factor` | `0.5` | Live. §4.3's youth ramp at birth. |
| `market_failing_factor` | `0.4` | Live. Applied on `frailty_notice_game_day`, never on the lifespan (§4.2). |
| `market_clear_premium` | `0.08` | Live. Per tested-clear condition. |
| `market_clear_premium_cap` | `1.4` | Live. Ceiling on the whole clear premium. |
| `market_carrier_factor` | `0.8` | Live. Per known carrier result. |
| `market_affected_factor` | `0.4` | Live. Per known affected result. |
| `market_win_bonus` | `0.15` | Live. Per win in `horse_show_summary`. |
| `market_place_bonus` | `0.05` | Live. Per top-three placing that was not a win. |
| `market_record_cap` | `2.5` | Live. Ceiling on the record factor. |
| `market_min_value` | `50` | Live. The floor a guide value never goes below. |

**Every number in that table is a guess.** They were chosen so that an average adult horse appraises
somewhere around 800–1,500 against a starting balance of 10,000 and board of 2 per horse per game
day — which is to say, a child can buy two or three horses from their opening balance and it costs
them something. Nobody has watched this economy run. Expect to retune all of them, from
`/admin/config`, with no deploy. That is why they are config and not constants.

---

## 6. The screens

### 6.1 `/market` — the open listings

Every open listing in the game. Reuses slice 0016's filter machinery rather than a second version
of it: the barn's tabs (`src/lib/barnFilter.ts` — All / Mares / Stallions / Foals / Geldings) and
the shows page's breed picker. Filtering happens in the query, not after the fetch.

Each row: the horse's name (linking to `/market/:id`), breed, colour phrase, age in years, sex,
**the selling stable's name** (linking to `/world/stables/:id`), and the asking price. A row for a
horse the viewing stable owns is marked *yours* and has no buy control.

Sort: newest listing first. There is no cleverness to add here yet — with five players there will
not be enough listings for sorting to be a feature.

A "Yours" tab shows the current stable's own open listings with a **Withdraw** control on each.

### 6.2 `/market/:id` — one listing

Everything `/world/horses/:id` shows — name, breed, colour, age, sex, image, pedigree, show record
— plus:

- **The asking price**, and what the buyer's balance would be afterwards.
- **The health panel**, per §2.3: one row per condition the game tests for, each showing the
  seller's result or **"not tested"**. The panel has a one-line heading that says what it is —
  *"What this seller has tested for"* — so a child understands they are reading the seller's
  paperwork, not the horse's biology.
- **What comes with her**, per §2.6: any active pregnancy with its due day, any unresolved
  covering, any unjudged show entry with its class and date. Only shown when there is something to
  show; never an empty "None" row.
- **The buy control**, or the reason there isn't one (§7.1's refusals, each as a plain sentence).

No conformation table, no guide value, no genotype (§2.4).

### 6.3 Listing a horse — from the horse's own page

`/horses/:id` gains a **"Sell this horse"** section, alongside the test, care, show-entry and
retire-away controls that already live there.

The form shows the guide value and its `factors` list (§4.5), a price field defaulting to the guide
value rounded, and a plain paragraph of what a sale does: *the barn name clears, your test results
go with her, and anything she is carrying or entered in goes too.*

Submitting posts to `POST /horses/:id/list`. No action is spent. The horse page then shows the live
listing, its expiry day, and a **Withdraw** control.

### 6.4 `/market/sold` — the sales record

Completed sales, newest first, capped at a sensible number of rows (reuse `shows_recent_count`'s
spirit; a `market_sold_count` key is not worth adding until someone wants a different number).
Horse (linked to `/world/horses/:id`, since it now belongs to someone else), price, selling stable,
buying stable, game day. Visible to every logged-in player (§2.9).

Commission is **not** shown here — it is the seller's business and appears in their ledger.

### 6.5 Nav, and the badge

A **Market** chip in the main nav, beside Shows. On the barn list, a horse with an open listing
carries a small badge with its asking price — a child listing eight horses needs to see at a glance
which are up.

---

## 7. The sale itself

This is the part to get right. Everything else in the slice is a screen.

### 7.1 What must be true before the buy button does anything

Checked in the route, in this order, each with its own plain-English refusal naming the horse:

1. **The listing is still open** and has not expired against today's `game_day`.
2. **The buyer is not the seller.** A stable cannot buy its own horse. A *different* stable under
   the same account **can** — that is §1a's intended trade route, and §2.2's flag, not a refusal.
3. **The horse is still alive** (`status = 'alive'`) and **still owned by `seller_stable_id`**.
4. **The buyer has an action** (`buy_horse`, one action).
5. **The buyer can afford it**: `balance - price >= 0`. Note this is stricter than
   `canTakeOnCost(balance)`, which only asks for a non-negative balance — that helper is the debt
   rule and it still applies, but a purchase additionally needs the money actually in hand. Do not
   route a purchase through `canTakeOnCost` alone.
6. **The buyer has a free stall**: alive horse count `< capacity`. Reuse the existing check at
   `src/routes/horses.ts`'s capacity guard rather than writing a second one.

### 7.2 The batch

One `env.DB.batch()` — D1 batches are one implicit transaction, so either the whole sale happens or
none of it does (build log, 2 Aug 2026):

1. `UPDATE listings SET status='sold', buyer_stable_id=?, sold_game_day=?, commission_paid=?, closed_game_day=? WHERE id=? AND status='open'`
2. `UPDATE horses SET owner_stable_id=?, barn_name=NULL, notes=NULL WHERE id=? AND owner_stable_id=? AND status='alive'`
3. `buildLedgerStatements` for three entries:
   - buyer `−price`, kind `purchase`, counterparty = seller, ref `('listing', id)`
   - seller `+price`, kind `sale`, counterparty = buyer, ref `('listing', id)`
   - seller `−commission`, kind `commission`, counterparty = null, ref `('listing', id)`
   
   with `sameAccount` set on all three when the two stables share an `account_id`.
4. `INSERT OR IGNORE INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, expires_game_day, cost_paid) SELECT <buyer>, horse_id, kind, subject_code, result, tested_game_day, expires_game_day, 0 FROM horse_knowledge WHERE stable_id=<seller> AND horse_id=?`
   — **copy, never reassign** (schema §4.4: the seller remembers what they knew about a horse they
   no longer own). `OR IGNORE` against the existing unique index handles a buyer who already tested
   this horse in a previous ownership. `cost_paid` is 0: the buyer did not pay for these.
5. `UPDATE coverings SET stable_id=? WHERE mare_id=? AND status='booked'` (§2.6).
6. `UPDATE show_entries SET entered_by_stable_id=? WHERE horse_id=? AND placing IS NULL` (§2.6).
7. The buyer's action spend.
8. An `events` row for **the seller** — kind `horse_sold`, payload
   `{"v":1,"horse_name":"...","price":4000,"buyer_stable_name":"..."}`. The buyer needs no event;
   they were there.

Nothing is written for the pregnancy: `foalDuePregnancies` already reads
`dam.owner_stable_id` at foaling (§2.6), so the foal follows the mare with no code at all.

### 7.3 Why the guards are also `WHERE` clauses

Steps 1 and 2 repeat checks the route already made, as conditions on the update. This is not
belt-and-braces for its own sake: two children can press buy on the same listing within the same
second, and the route's read-then-write has a gap between them.

`UPDATE ... WHERE status='open'` means the second write changes zero rows. **Check
`meta.changes` on the listing update after the batch and treat zero as "somebody else bought this
one first"** — a real sentence to the second buyer, not a 500. The same applies to the horse update
if the horse died between the read and the write.

### 7.4 Withdrawing, expiring, and dying

- **Withdraw** — `UPDATE listings SET status='withdrawn', closed_game_day=? WHERE id=? AND
  seller_stable_id=? AND status='open'`. Free, no action, no event.
- **Retire away** — the existing retire-away path withdraws any open listing in its own batch, and
  its confirmation page names the listing alongside the pregnancies, coverings and entries it
  already names.
- **Death** — a horse that dies while listed leaves an open listing pointing at a dead horse. The
  tick's expiry stage closes those too (§8), and §7.1's step 3 means nobody can buy one in the
  meantime.

---

## 8. The tick — one new stage

`expireListings(env, gameDay)` in `src/db/listings.ts`.

```sql
UPDATE listings
   SET status = 'expired', closed_game_day = ?
 WHERE status = 'open'
   AND (expires_game_day <= ?
        OR horse_id IN (SELECT id FROM horses WHERE status <> 'alive'))
```

...plus one `events` row per affected listing for the seller, kind `listing_expired`, payload
`{"v":1,"horse_name":"...","price":4000}`.

**Idempotency** comes free from the `status = 'open'` guard, the same way `killDueLethalFoals` gets
it from `status = 'alive'` — a re-fired tick finds nothing left to change. No processed-marker
column is needed (CLAUDE.md §5.4).

**Where it goes:** after `noticeCareDue` and before `deleteOldEvents`, inside the `paused === 0`
branch. Both reasons matter — a paused world must not expire listings (a family on holiday should
not come back to an empty market), and an event written by this stage is subject to the same
retention pass as any other, which is the ordering rule every event-writing stage already follows.

---

## 9. Where else it appears

- **`src/db/reset.ts`** — `/admin/reset` must delete `listings`. A world reset that leaves listings
  pointing at deleted horses breaks `/market` on the first page view.
- **`/world/horses/:id`** — a horse with an open listing gains a "For sale — 4,000" line linking to
  the listing. This is public information; it does not breach slice 0016 §6.6's rule, which is about
  measured values.
- **`src/lib/actions.ts`** — `ActionKind` gains `'buy_horse'` at cost 1. `'list_horse'` stays in
  the comment as a future entry; §2.5 decided listing is free.
- **`src/db/events.ts`** — two new kinds, `horse_sold` and `listing_expired`. `events.kind` is
  deliberately free text with no CHECK, so neither needs a migration; document both payload shapes
  in the same comment block in `migrations/0048_events.sql`'s style — put them in the new
  `src/db/listings.ts` file header instead, since the migration is already applied and must not be
  edited (CLAUDE.md §8).
- **The Money page** — the three new ledger kinds need display labels and, ideally, the counterparty
  stable's name rendered from `counterparty_stable_id` rather than only being in the description
  text.

---

## 10. Build order

Part A is one session's work if taken in this order. If it runs long, the split is after step 4 —
listing and browsing without buying is a coherent half that deploys and does nothing dangerous.

1. **Migrations and config** — `listings`, the ledger CHECK widening, the config keys. Register all
   three in `src/db/migrations.ts`.
2. **`src/engines/market/appraise.ts`** and its tests. Pure, testable with no database, and the
   thing everything else reads. Write the §4.2 comment first.
3. **`src/db/listings.ts`** — create, withdraw, read one, read open, read sold, expire.
4. **The screens** — the sell form on the horse page, `/market`, `/market/:id` (without a buy
   button), `/market/sold`, the nav chip, the barn badge.
5. **The sale** — §7 in full: the guards, the batch, `meta.changes`, the ledger widening, the
   knowledge copy, the covering and entry reassignment, the seller's event.
6. **The tick stage** and `reset.ts`.
7. **The confirmation copy** in §2.6 — the pregnancy, covering and entry sentences on the buy page.
   This is listed last and is not optional; it is the difference between a feature and an argument.

---

## 11. Part B — NPC stables sell (specified, not built)

Overview §10f: *"Sale listings priced from a formula over conformation score, tested genetics,
health status, pedigree, show record and age, plus a modest random spread."*

- **The same `listings` table**, with an `is_npc` stable in `seller_stable_id`. No second table and
  no second sale path — a player buying an NPC horse runs §7 unchanged.
- **The same `appraise()`**, times a per-personality multiplier on `npc_policy` (a conformation
  specialist asks more than a volume breeder) and a modest spread drawn from the stable's own seed.
  Seeded, per CLAUDE.md §5.2 — never `Math.random()`.
- **A tick stage** on the NPC stable's own cycle, sitting beside `runNpcBreedingDecisions`: list
  surplus stock when the stable is at or near `capacity`, or when a horse falls below what the
  policy wants to keep. This is also the first real answer to slice 0015 §12.2's "capacity is a
  guess" — a stable that can sell is a stable that does not simply stop breeding at the ceiling.
- **The decision that session must make, and should not default:** an NPC stable holds no
  `horse_knowledge` rows, so under §2.3 every NPC listing would read "not tested" on everything.
  The recommendation is that **an NPC stable pays for a full disease panel when it lists**, writing
  real `horse_knowledge` rows at the going price out of its own balance. It reuses the existing
  testing path, it costs the NPC real money (which now matters — see §12), and it is what makes
  overview §10f's "a tested-clear NPC stallion becomes genuinely valuable" true.

**Part B is the shortest route to the market not being empty, and it should probably be built
immediately after Part A.**

## 12. Part C — NPC stables buy (specified, not built)

The operator asked for **both** routes.

- **A standing offers board.** `buy_offers` per schema §7.2 — `id`, `stable_id`, `criteria` (JSON:
  breed, sex, age band, minimum quality), `max_price`, `active`, `created_game_day`. Rendered as an
  "Offers" tab on `/market`. A player picks a matching horse and sells into it instantly at the
  stated price: one action, the same commission, the same transfer batch. Deterministic and
  legible — a child can see exactly why a horse does or does not qualify, which the second route
  cannot offer.
- **NPC stables shopping open listings on the tick.** A tick stage where each NPC stable, on its
  cycle and within its policy and balance, buys player listings that fit. This is the one that makes
  the market feel alive — a listing sells while a child is at school.

**The risk this Part must carry, named now because the decision that creates it is already made:**
the operator chose **strictly real NPC balances, no top-ups** (over topping them up on a schedule,
and over treating NPC purchases as an unbounded faucet). That is the most honest economy of the
three, and it has one failure mode: **NPC stables can run out of money and quietly stop buying**,
at which point the exit for surplus stock closes and nobody gets told.

Three cheap mitigations for that session, none of which require changing the decision:

1. **A "buying power" figure on `/admin/npc`** — each NPC stable's balance next to what it has spent
   and earned this season. The operator can see the market drying up before the children feel it.
2. **Part B first.** An NPC stable that sells has income. Selling funds buying; that is the loop.
3. **The existing `adjustment` ledger kind.** An operator can already top a stable up by hand from
   the admin pages if it comes to it — a deliberate act with a ledger row, not an automatic faucet.

## 13. Part D — stud services (specified, not built)

Overview §10f calls this the best outcross mechanism available. Schema §7.3 sketches
`stud_listings`; a `stud_bookings` table joins it to `coverings`.

### 13.1 What it is

A stallion's owner lists him at stud for a fee, with a cap on bookings per season. Another stable
books their mare to him: the fee moves, and a `coverings` row is created exactly as
`/horses/breed` creates one today. The mare's owner never gives up a stall and the stallion's owner
never gives up their stallion.

### 13.2 The first cross-stable breeding in the game

The covering path today requires both horses in one barn — `validateBooking` in
`src/routes/horses.ts` reads both from `listStableHorses` and the form's error says *"Choose a mare
and a stallion from this stable."* Part D is what relaxes that, and every check in
`validateBooking` has to be re-read with a stallion in someone else's barn in mind: the pasture
check, the age checks, the season check, the debt check, and (most importantly) **which stable is
charged and which is credited**.

### 13.3 Whose prefix goes on the foal — decided

**The mare's owner.** They chose the cross, paid the fee, and carried the pregnancy, and it matches
real practice. The alternatives — the stallion's owner, or both prefixes joined — were rejected:
the first means a child's bloodline is built by other people's mares, and the second breaks §5d's
"one stable's permanent mark" into two.

**This costs nothing to implement**, which is the good news: `foalDuePregnancies` already reads
`dam.owner_stable_id` for both `owner_stable_id` and `breeder_stable_id`/`breeder_prefix`. Part D
changes nothing about foaling. It is decided here so that nobody "corrects" it later.

### 13.4 What that session must decide, and should not default

- **The live-foal guarantee.** Real stud contracts commonly refund or re-breed if the covering does
  not take. The game's conception roll fails often enough that this is a real question, and it is a
  fairness question a child will raise the first time they pay 2,000 for nothing.
- **Whether the commission applies to a stud fee** as it does to a sale.
- **NPC stallions at stud**, which is the whole outcross argument — and which needs the NPC
  ceiling (slice 0015 §2.4) thought about again, since a player breeding to the best NPC stallion
  in the game is a route around it.

---

## 14. Tests

`test/`, following the existing files' shape. The engine tests need no database.

1. **`appraise` is monotonic in the things it should be.** Same horse, one difference at a time: a
   better conformation score appraises higher; a known carrier appraises lower than untested; a
   tested-clear appraises higher than untested; a horse with three wins appraises higher than one
   with none; a fourteen-year-old appraises lower than a six-year-old.
2. **`appraise` never reads the lifespan.** Two horses identical in every input except
   `natural_death_game_day` appraise identically. Assert it directly — this is §4.2, and a test is
   the only thing that will catch a future session adding it "for realism."
3. **A breed with no ideal vector** returns `qualityUnknown: true` and a value well above
   `market_min_value` — not zero (§4.4).
4. **Commission arithmetic is integer.** `Math.floor` at 5% of 999 is 49, and the seller's three
   ledger rows sum to `price − commission`.
5. **The sale batch moves everything.** After a sale: owner changed, barn name null, notes null,
   the seller's knowledge rows exist for the buyer *and still exist for the seller*, the covering's
   `stable_id` moved, the unjudged entry's `entered_by_stable_id` moved, three ledger rows exist
   with `counterparty_stable_id` set, and both balances match the sum of their own ledger rows —
   which is slice 0009's stated invariant and the thing most worth asserting.
6. **`same_account` is set** when two stables under one account trade, and 0 when they do not.
7. **The second buyer loses gracefully.** Sell a listing, then run the buy path against it again:
   no second horse movement, no second ledger row, and a sentence rather than an exception.
8. **A horse cannot be listed twice** — the partial unique index rejects the second open listing.
9. **`expireListings` is idempotent.** Run it twice against the same game day: the second run
   changes nothing and writes no second event.
10. **A dead horse's listing closes** on the next tick and cannot be bought before it.

## 15. Verifying it by hand

On a deployed world with two player stables:

1. List a horse from stable A. Check the guide value's `factors` line reads like English.
2. Look at `/market` from stable B. Confirm the health panel shows **every** condition, with
   "not tested" where nothing was bought — this is §2.3 and it is the thing most likely to be got
   subtly wrong.
3. Test the horse for one condition from stable A, then reload the listing. The new result appears
   without relisting.
4. Buy it from stable B. Check: the horse is in B's barn with no barn name, B's money went down by
   the price, A's went up by the price and down again by the commission, A's Money page names the
   buyer, B's action count dropped by one, and B can see A's test result on the horse's page.
5. Check A's horse page: A still holds the test result for a horse they no longer own.
6. List a mare in foal. Confirm the buy page names the pregnancy and its due day *before* the
   button. Buy her, run the tick to her due day, and confirm the foal is born in B's barn under
   **B's prefix**.
7. Advance the world past a listing's expiry day and confirm the seller gets the event.
8. In `/admin`, look for the sale's ledger rows and confirm `same_account` reads 0 for two
   different accounts. Then do the same sale between two stables of one account and confirm it
   reads 1 — that flag is the entirety of §2.2's defence and it should be checked once, by hand,
   before the children start trading.

## 16. Balance risks to watch

- **The market may simply be empty** (§3.1). Part A alone needs another child to want the horse.
- **Commission is the only sink and it is small.** At 5% the market removes very little. If prices
  inflate, `market_commission_percent` is the lever, and it is live.
- **Same-account laundering is unrestricted** (§2.2). The ledger flag is the only defence, and it is
  after-the-fact. Watch for it before assuming it will not happen.
- **The guide value will anchor.** Children will treat it as the price, and a systematically wrong
  model will move the whole economy with it. `market_price_multiplier` moves every guide value at
  once, which is why it exists.
- **A foal appraises at little more than base**, since it has no record and no tests. The genetics
  of a well-bred foal are worth far more than the model says, and the model cannot see them without
  breaking §2.4. Expect children to trade foals on pedigree and conversation instead. That is
  probably correct and definitely worth watching.
- **Buying a horse the day before a show it is already entered in** collects a prize the seller paid
  the entry for. Not exploitable at a fixed price the seller sets, but it will happen and someone
  will notice.

## 17. Documents to correct when this is built

- **`CLAUDE.md` §10** — the Market row: built, Part A only, with the three unbuilt parts named.
- **`docs/build-log.md`** — a dated entry covering: `src/engines/market/` as a new engine
  directory; the ledger's counterparty/`same_account` columns having a writer at last and the
  single-writer rule surviving it; the always-disclosed decision and the "not tested is a displayed
  row" rule; and the departure from schema §7.1 (`disclosed_knowledge` deliberately not built).
- **`docs/horse-game-schema.md` §7.1** — record the built shape against the sketch, and mark
  `disclosed_knowledge` as decided-against rather than pending.
- **`docs/horse-game-schema.md` §4.4** — "**Not built** — there is no market yet, so nothing
  transfers" is now wrong. Knowledge transfers, by copy.
- **`docs/horse-game-schema.md` §11** — the open-questions list: **disclosure on listings** is
  closed (always disclosed, §2.3).
- **`docs/horse-game-overview.md` §14 / §2c** — same closure, in the overview's own words.
- **`docs/horse-game-overview.md` §1a** — record that the minimum listing duration was considered
  and declined, and that the ledger flag was built instead. It is the kind of decision a future
  session will otherwise re-propose.

## 18. What to raise rather than decide

- **If the market is empty after a week of play**, raise Part B rather than tuning Part A's prices.
- **If `appraise()` starts wanting a pedigree term** (overview §10f lists pedigree as a pricing
  input, and this slice does not use it): raise it. Valuing a horse by its ancestors' show records
  is a genuinely good idea and it is also a new query on every listing page.
- **If a child asks to change a listing's price without withdrawing it**: that is a small, sensible
  request and it interacts with §6.4's "the sold list records what was actually asked." Decide it
  deliberately.
- **Anything in §13.4.** Those are Part D's questions and they should not be answered by a session
  building Part A.
