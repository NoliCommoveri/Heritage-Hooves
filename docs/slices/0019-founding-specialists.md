# Slice 0019 — Founding specialists: making a breed winnable in six months

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts this slice
depends on are quoted or summarised below.**

This is a spec. **Nothing in this document has landed.** Its open questions (§9) are the operator's,
not a session's.

Where this comes from — a conversation with the operator on 2026-08-03, in their words:

> *"these are kids playing. yes I want to teach. but i also want to make success reachable to a
> preteen who aren't gonna do complex equations before breeding every mare."*
>
> *"they have 8 breeds and will want more. I don't want to totally redesign everything. but i need a
> way for a kid to be 'successful' working a breed within 6-8 months."*

That is the whole brief: **six to eight real months per breed, no redesign, and it has to scale to
eight breeds and beyond.** This slice does it by changing what founding horses look like when they
arrive — nothing else.

Related, and deliberately separate:

- `docs/slices/0018-genetic-progress-and-inbreeding.md` — the long-run plateau. This slice does
  **not** fix it. It front-loads the good part so a child wins well before they reach the wall.
  Both can ship; neither depends on the other.
- `docs/horse-game-overview.md` §10a (gene pool collapse) and §12.3 (imports as the diversity
  valve). Part C is §12.3 arriving as a config edit.

---

## 1. The problem, measured

`docs/analysis/stable-timeline.mjs` (`node docs/analysis/stable-timeline.mjs`) simulates one
player's stable at tick resolution: real oestrous cycles, real conception rolls, gestation at the
operator's new 60 game days, ageing and death, the four Quarter Horse disease loci at their seeded
frequencies, GBED foals lost, affected horses excluded from breeding, and capacity culling on what
the player can *see* rather than on the truth. The player is a **casual child** — 45% of heats
missed, 35% of pairings chosen for a pretty foal instead of the best match.

At 30 game days per real day, a game year is 12 real days and a generation is about 40.

**As built, breeding for the show ring:**

| milestone | p25 | median | p75 | reached |
|---|---|---|---|---|
| 1 good horse | 65d | 127d | 231d | 182/200 |
| 3 good horses | 152d | 243d | 1.0y | 176/200 |
| 6 good horses | 271d | **1.2 yr** | never | **133/200** |

"Good" = conformation genes scoring ≥90 of 100 against the breed's ideal, and not disease-affected.

Two things are wrong with that. It is **twice the operator's target**, and **a third of children
never get there at all** — 19 lines in 200 died out entirely (lost the last stallion or last
breeding mare), and 48 were alive but stuck at COI ~45%.

**The discipline side is worse.** Breeding for Barrel Racing, the bar being six horses that
*dominate* the NPC field: median **1.8 years**, 124/200. See §4 for why the two sides differ so
sharply.

### 1.1 Why it takes so long, and why more foals is not the answer

A founding horse is drawn at the `mid` quality band — every polygenic allele an independent coin
flip (`quality_bands.mid` = 0.50, `src/engines/founding/generate.ts`). The Quarter Horse ideal wants
potentials of 11 / 14 / 7 / 10 out of 20. The **shoulder is four alleles short on every founder in
the game**, and closing that gap is most of what the first year of play is spent doing.

The alleles needed are already in the pool — this is a frequency shift, not a search for something
absent. So the fix is not to speed the clock up (the operator's gestation change already did that,
and moved the failure rate by one run in two hundred). The fix is to **stop making every child
re-derive the breed from a coin flip.**

---

## 2. The change, in one sentence

**Every founding horse arrives genuinely good at one thing.**

One conformation trait near its breed's target, and one ability trait high — chosen per horse,
drawn from that breed's own ideal vector and from whichever disciplines are actually running.
Everything else about the horse is exactly as it is today.

| | median to 6 good horses | reached |
|---|---|---|
| **conformation**, as built | 1.2 yr | 133/200 |
| conformation, specialists only | 353d | 137/200 |
| **conformation, specialists + Part C** | **199 days** | **194/200** |
| **barrels**, as built (dominate the field) | 1.8 yr | 124/200 |
| **barrels, specialists + Part C** | **221 days** | **200/200** |
| barrels, the *elite* bar (≥78) — the long game | 1.7 yr | 139/200 |

Both sides land at **roughly 6½ to 7½ months**, which is the brief. And the elite bar stays a long
way off, so there is still somewhere to go afterwards.

**Specialists and Part C do different jobs and neither works alone.** Specialists fix *speed* — the
good alleles are already in the barn, so the child is combining rather than waiting. Part C fixes
*reliability* — it is what takes the failure rate from 32% to 3% and extinctions to zero. Specialists
on their own barely move the failure rate (137/200); the outcross flow on its own leaves the median
around nine months.

---

## 3. Part A — the conformation specialist

In `generateCandidate` (`src/engines/founding/generate.ts`), after the existing genotype is built:

1. Choose **one** trait uniformly at random from `CONFORMATION_TRAITS`.
2. Read that trait's `target` from the breed's `ideal_vector`. The potential that expresses exactly
   on target is `target / 5`, since `geneticValue = potential × 5`.
3. Overwrite that trait's polygenic string so its potential is `target/5 + offset`, with `offset`
   drawn uniformly from `{-1, 0, +1}`.
4. Place those alleles at **random positions** among the twenty. Do not control zygosity — see §7.
5. Leave every other trait exactly as the band drew it.

**If the breed has no `ideal_vector`, skip Part A entirely** and generate exactly as today. This is
not an edge case: **seven of the eight breeds have no seeded ideal vector**, so Part A does nothing
for them until `docs/breed-ideal-vectors.md` is seeded. That is the real blocker on the operator's
"eight breeds" goal and it is a data change, not a code one — see §9 Q6.

## 4. Part B — the ability specialist

Ability traits work differently, and copying Part A's rule would be wrong.

`TRAIT_DIRECTION` (`src/engines/conformation/traits.ts`) marks all five ability traits
`higher_better` with an anchor of 0, and `scoreAbilityEntry` is a plain weighted mean with no target
and no falloff. **There is no ideal value — 20/20 is simply best.** Three consequences:

**4.1 High, not maxed.** Set the specialist's potential to `founding_ability_specialist_potential`
(**15**, i.e. 75% of maximum) `+ offset` from `{-1, 0, +1}`. Do not use 20: the child's standout
trait would already be at the ceiling with nothing left to breed for. Part A's "on target" is
correct for conformation precisely because overshooting an intermediate target is as bad as
undershooting it; here, overshooting is impossible and the headroom is the point.

**4.2 Only specialise in a trait some *enabled* discipline actually weights.** This one will bite.
**`jump_scope` has weight 0.0 in Barrel Racing, which is the only seeded discipline** (migration
0063), and `stamina` has 0.2. A `jump_scope` specialist today is a dead gift — a horse whose single
special quality cannot be scored anywhere in the game.

So draw from the ability traits with a nonzero weight in at least one row of `disciplines` where
`enabled = 1`. Today that is **agility, speed and trainability**. Follow the shape of
`getBreedsInPlay()` (`src/db/breeds.ts`): one helper, every call site reads it, and the pool widens
by itself the day a second discipline is seeded — no code change. If the set is empty, skip Part B.

**4.3 Do not judge the two sides on the same scale.** A mid-band founder scores about **78 of 100**
in the ring and only about **50 of 99** in a discipline, because the conformation targets are
intermediate and ability's are not. Chasing "90% of perfect" in a discipline is effectively
unreachable — it was 0 of 200 runs as built. It does not matter, because the NPC show barn is
stocked at the **same mid band** (`npc_show_barn_quality_band`), so ~50 is the field a child has to
beat. Success in a discipline means winning, not approaching perfection. §1's discipline bar of 70
is "dominates the field"; 78 is the long-term goal.

## 5. One of each, per horse

Give every founding horse **one conformation specialist and one ability specialist**. They are
scored in different classes, so they never stack inside a single show — the horse simply has a
halter side and a performance side, and the child chooses which career to chase. No horse becomes
stronger in any one ring; every founding candidate becomes worth twice as much thought.

## 6. Part C — the consignment rate

The consignment dealer already runs every candidate through `generateCandidate`, so it inherits
Parts A and B **for free** with no code change at all.

Its rate needs to roughly double: it currently mints 1–2 horses per 90 game days shared across every
player (~6 a game year in total), and the simulation's flow is 2 per player per game year. Drop
`consignment_cadence_game_days` from 90 to 60, or raise `consignment_batch_min`/`_max`.

**This is a config edit at `/admin/config`, not a deploy.** It is also the single most valuable
change in this document for the failure rate, and the operator can make it today, before any of the
rest is built.

---

## 7. Things to get right

**Do not control zygosity.** Place the specialist's alleles at random positions. It is tempting to
make them homozygous — it would make the trait breed truer — and it is exactly wrong here. Slice
0018 §1.1 measures homozygosity as *the* lever for reliable foals; handing it to a child in the
founding grant spends the game's best long-term reward on its first five minutes.

**Do not disturb the existing RNG streams.** `CLAUDE.md` §5.2 and the header of
`generateCandidate` both turn on the same rule: a stored seed must keep producing the same horse.
The polygenic loop draws 20 alleles for every trait off the `pool_polygenic` stream; if a specialist
trait *skips* those draws, every trait after it shifts and the same seed produces a different animal.

So: **let the existing loop run untouched, then overwrite the specialist trait afterwards from its
own separate stream.** This is precisely the pattern `applyConsignmentInjection`
(`src/engines/founding/injection.ts`) already uses — generate, then overwrite, never resample. Give
the new draws fresh labels that have never been used (`specialist_choice`, `specialist_alleles` or
similar) so no existing horse's genetics move.

**Only new horses change.** Founding offers, consignment horses and admin-created horses. No
migration touches an existing horse, no backfill, nothing already in the game moves. A child's
current barn is exactly as it was.

**Unclaimed founding offers are already-minted candidates.** Anything sitting in `import_candidates`
when this deploys was generated under the old rules and stays that way. Worth a sentence to the
operator rather than a surprise.

---

## 8. Scope

**In:** Parts A, B and C, and the tests in §10.

**Out, deliberately:**

- **Seeding a second discipline.** The operator ruled this out for now, in as many words. Worth
  knowing what it costs when they want it: it is a pure-data `INSERT` into `disciplines` (slice 0012
  §5.1 drafted all six), and with only Barrel Racing live, two of the five ability traits are
  unweighted — so a second discipline roughly doubles how many founding horses feel useful, at the
  cost of one migration and no code.
- Anything from slice 0018. Different problem, different timescale.
- Any change to genetics, inheritance, COI, the show scorers, or the quality bands themselves.

---

## 9. Open questions — the operator's, not a session's

Every one of these can be priced by `docs/analysis/stable-timeline.mjs` in about a minute. Use it
rather than guessing (`CLAUDE.md` §2).

- **Q1.** Specialist slack of ±1 allele — right? ±2 was measured and is meaningfully slower.
- **Q2.** Ability specialist at 15/20? 16 was measured and is a little faster; 20 removes the
  headroom entirely and should not be used.
- **Q3.** One specialist per side, or two? Two conformation specialists reaches six good horses in
  about 200 days *without* Part C — faster, but it hands the child most of the breed at the door.
- **Q4.** `consignment_cadence_game_days` 90 → 60, or a bigger batch instead?
- **Q5.** Should the founding *batch* guarantee coverage — so the six candidates a child chooses
  from between them cover all four conformation traits, rather than three of them happening to be
  shoulder horses? Not modelled; probably worth it for how the choice reads.
- **Q6.** **Seeding the other seven breeds' ideal vectors.** Part A does nothing for a breed without
  one, and seven of eight have none. This is the actual blocker on "eight breeds", it is a data
  migration from `docs/breed-ideal-vectors.md`, and it is worth doing before or with this slice.

---

## 10. Testing

- **Pure-engine unit tests.** All of Part A and Part B lives inside `generateCandidate`, which is
  already pure and already tested (`test/founding/`). No database needed.
- **A regression test that the RNG streams did not move** (§7): a fixed seed under the new code must
  produce, for every *non-specialist* trait, exactly the bytes the old code produced. This is the
  test that catches the failure §7 describes, and it is the one worth writing first.
- **Determinism:** same seed, same candidate, including which trait was chosen as the specialist.
- **A breed with no `ideal_vector` generates exactly as today** — seven of eight breeds hit this
  path, so it is the common case, not the edge case.
- **No enabled discipline weights a trait ⇒ Part B is skipped**, and `jump_scope` is never chosen
  while Barrel Racing is the only enabled discipline.
- **Re-run `docs/analysis/stable-timeline.mjs`** with the chosen numbers and paste the table into the
  build-log entry. **The acceptance test for this slice is that a casual player's median for six good
  horses lands inside 6–8 real months on both the conformation and the discipline line.** If it does
  not, the slice has not worked, whatever the unit tests say.
- Standing constraint from every entry in `docs/build-log.md`: no Cloudflare login in the sandbox,
  so nothing is verifiable against live D1 or `wrangler dev`. State what was and was not checked.

## 11. When it lands

- Update `CLAUDE.md` §10's row for this slice.
- Add a dated `docs/build-log.md` entry with the re-run table (`CLAUDE.md` §9).
- If the chosen numbers differ from what §2 assumed, **update the constants block in
  `docs/analysis/stable-timeline.mjs`** — its header explains why a drifted copy is worse than none.
