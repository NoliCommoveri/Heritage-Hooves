# Slice 0004 — Cooled and frozen semen

**Status:** blocked on slice 0003. Nothing here exists yet.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and slice 0003. **Do not read the full design documents.**

**What this slice is.** A stallion can be collected from. The straws go in a tank and stay usable after he is dead. Breeding a mare to a straw is less likely to take than a live cover, permanently, no matter how long it has been frozen.

**Why this comes now.** Slice 0003 §4.2 gives stallions a long, gentle fertility decline. That decline is what makes an ageing stallion a problem worth solving, and this is the solution. Building it before mares can miss a cycle would make it pointless.

---

## 1. What "done" looks like

1. Open a stallion's page and press **Collect**. Money leaves the stable; a number of straws appear in the tank.
2. Open the tank page and see every straw batch: which stallion, what game day it was collected, how many are left.
3. Book a covering and choose the method: live cover, cooled, or frozen. The estimated chance changes visibly with the choice, and says why.
4. Book a frozen covering; the tick resolves it; one straw is gone whether or not she took.
5. The stallion dies of old age. His straws are still in the tank and still work. A foal is born from him after his death, and his page says so.
6. Use the last straw of a batch and see the batch disappear, with a sentence making clear no more can ever be collected.
7. Each tick, the tank costs money. The stable page shows what it is costing.

---

## 2. Decisions taken for this slice

**2.1 Frozen is permanently worse than live, and never improves.** `method_factor_frozen = 0.60`, `method_factor_cooled = 0.85`, `method_factor_live = 1.00`, passed into slice 0003's existing `methodFactor` parameter. Real frozen semen has materially lower per-cycle conception rates than fresh. Nothing in the game may ever raise this number.

**2.2 There is no time-based degradation, and this is a correction to the original request.**

Properly stored in liquid nitrogen, semen is viable for decades — there are foals born from straws older than their owners. The losses happen at freezing and at thaw, not in the tank. A decay curve would teach something false in a game whose whole appeal is that the biology is true.

The design goal behind the request was sound: a straw must not be a permanent free resource that removes the reason to keep breeding forward. That is solved by inventory instead, in §2.3 and §2.4.

**2.3 A collection yields a finite number of straws, and they are gone when used.** `straws_per_collection_min = 8`, `straws_per_collection_max = 15`, drawn from the collection's own seed and scaled by the stallion's own fertility potential (slice 0003 §4.3). A straw is consumed by the covering attempt, **not** by conception — a frozen breeding that misses still costs the straw. When the stallion is dead, no more can ever be made.

**2.4 The tank costs money every tick.** `straw_storage_cost_per_straw_per_tick`, a live tunable. Liquid nitrogen is a genuine recurring expense in real breeding operations, and it is exactly the kind of money sink the economy wants. Hoarding twenty straws from a stallion you are not using becomes a decision rather than a free option.

**2.5 Cooled semen requires a living stallion and is not stored.** It is booked and used within the cycle, which is what makes it the middle tier: better odds than frozen, no tank, but it dies with him.

**2.6 Geldings cannot be collected from.** Same guard as breeding (`src/routes/horses.ts:52`).

**2.7 Collection is only from stallions the stable owns.** Cross-stable stud services — collecting from someone else's stallion, or shipping to another stable — belong to the market slice. Do not build a market here.

---

## 3. Not built here

- **Per-thaw failure rolls.** A straw that does not survive thawing, lost without a covering, is real and would make each straw feel finite. It is deliberately left out as one mechanic too many for a first pass. If §2.3 and §2.4 turn out not to create enough pressure, this is the next thing to add, and the seed label `straw_thaw` is reserved for it.
- Cross-stable shipping, stud fees, stud books, or a stallion's season cap.
- Any use of a straw from a stallion the stable does not own.

---

## 4. Schema sketch

- `semen_batches` — `id`, `stallion_id`, `owner_stable_id`, `collected_game_day`, `straws_total`, `straws_remaining`, `rng_seed`.
- `coverings.method` — `live` / `cooled` / `frozen`, and `coverings.semen_batch_id` (nullable).

The stallion's `horses` row survives his death with genotype intact (schema doc §4.2), so a batch needs no snapshot of him — point at `horse_id` and let the pedigree work exactly as it does for a live cover.
