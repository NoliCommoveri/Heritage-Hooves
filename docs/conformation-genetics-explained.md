# How conformation genetics works (plain-English guide)

*Written 2026-08-03, for the operator — no code in this document. If you want the technical version, the actual formulas live in `src/engines/conformation/model.ts` and `src/engines/genetics/polygenic.ts`, and the breed targets are in `docs/breed-ideal-vectors.md`.*

This explains where a horse's neck, shoulder, back and hock numbers come from, why the breed standard is hard to hit at first, and how you actually get there. It uses real horses from your game as examples throughout.

---

## 1. The four numbers, and the scale they're on

Every horse has four **conformation** measurements, each shown as a number from about 1 to 99:

| Trait | A low number means... | A high number means... |
|---|---|---|
| Neck | short | long |
| Shoulder | upright | sloping |
| Back | short | long |
| Hock | straight | angled |

**None of these is "good" or "bad" on its own.** A high number isn't better than a low number — it's just a different shape of horse. What matters is how close a horse lands to what a given *breed* is supposed to look like. That's the breed standard.

## 2. The breed standard is a target, not a ceiling

Each breed has a target number for each trait — not "as high as possible," an actual target you can also overshoot. The Quarter Horse's targets, for example:

| Trait | Target |
|---|---|
| Neck | 55 |
| Shoulder | 70 |
| Back | 35 |
| Hock | 50 |

So a Quarter Horse with a shoulder of 95 is *not* a better Quarter Horse than one at 70 — it's overdone, same as one at 45 is underdone. 70 is the bullseye; distance in either direction costs points.

**Important and easy to miss: none of these targets sit in the exact middle of the 1-99 range.** That's deliberate — explained in §5 — and it's the reason a batch of ordinary starting horses will rarely land right on target.

## 3. Where a horse's number actually comes from

Three things combine to produce the number you see:

### a) Genetics ("potential") — the part that gets inherited

For each trait, a horse carries **10 genetic "slots"**, and each slot is either **on** or **off** (that's 20 "coin flips" total, since every slot has two copies — one from each parent). The more slots that are "on," the higher that horse's raw genetic number, roughly on the same 1-99 scale.

This is the only part of the number that passes down to foals. It's fixed for life the moment a horse is born.

### b) Random static ("environmental noise") — the part that doesn't get inherited

A small random nudge, up or down, gets added on top — usually within about ±12 points, occasionally more. Think of it as "this individual horse just happens to carry itself a little differently than its genes alone would predict." It's rolled once at birth and then fixed, but it is **not** passed to any foal — every foal gets its own fresh roll.

### c) Growing up, and family relatedness — how much of (a)+(b) actually shows

A horse's number doesn't fully show until it's grown. A young or closely-related (inbred) horse's number gets pulled partway back toward the *middle of the scale* (50) — not toward the breed standard, toward the flat middle. A fully mature, unrelated horse shows its full genetic number; a young or inbred one shows a blend that's dragged toward "average nothing-in-particular." This is why two full siblings from the same closely-bred litter tend to read a bit more "middling" than their parents did.

## 4. A worked example, using your own horses

You generated a batch of 17 Quarter Horses. Here's how three of them break down for shoulder (target: 70):

| Horse | Genetic slots "on" (of 20) | Random static | Final number shown |
|---|---|---|---|
| LS Noble Cause | 13 | +1 | 66 |
| SC Prime Example | 11 | +11 | 66 |
| BS Iron Valor | 5 | -2 | 23 |

`LS Noble Cause` got there mostly through genetics (13 of 20 slots on). `SC Prime Example` got to the same place with fewer genetic slots but a lucky static roll. `BS Iron Valor` has few slots on and an unlucky roll, landing well under target.

Across the full batch of 17, the genetic slots averaged out to about 9-10 of 20 "on" — right around the flat middle of the scale (50). That's not a bug or bad luck; see the next section.

## 5. Why the "starting" horses land below standard — on purpose

When the game hands you starting stock, it isn't trying to hand you horses that already meet the breed standard. It's handing you an **unselected, average population** — for shoulder, that means each of the 10 genetic slots has roughly a coin-flip chance of being "on," which averages out to a number right around the middle of the scale (50), regardless of what any particular breed wants.

The Quarter Horse standard for shoulder is 70 — twenty points above that average. So a "typical" starting horse reading in the 40s-50s for shoulder isn't broken. It's exactly what an average, not-yet-improved horse is supposed to look like. Getting to 70 is supposed to take work.

There's also a specific, deliberate reason the targets are never set to the exact middle of the scale (50): if a breed's target sat right on 50, then breeding two closely related horses together — which normally *hurts* a horse by dragging its numbers toward the middle — would accidentally *help* that horse's score on that trait, since "toward the middle" and "toward the target" would be the same direction. Keeping every target off-center avoids rewarding inbreeding.

When you generate starting stock, there's also a "quality band" dial (low / mid / high) that shifts how loaded those 10 coin flips are — mid is the honest average described above, high loads them more favorably, low less so. That's a knob available when granting new horses, separate from anything about breed standards.

## 6. So how do you ever reach 70, if nothing you start with is above it?

This is the real question, and the answer is the actual game: **breeding two horses together does not average their numbers — it recombines them.**

Each parent hands a foal one of its two copies at each of the 10 slots, chosen at random, independently slot by slot. That means a foal can inherit the "on" copy from its sire at one slot, and the "on" copy from its dam at a *different* slot — stacking favorable slots from both sides into one animal. A foal is not stuck being "no better than its best parent." It can beat both.

Using two of your own horses as an example — `LS Noble Cause` (13 of 20 slots on) and `WM Silver Anthem` (13 of 20 slots on) — most of their "on" slots overlap, but a few don't. Lay their slots side by side and the best possible foal from that pairing could land at **16 of 20 slots on** — noticeably higher than either parent, and enough to comfortably clear the 70 target. That won't happen on every single foal (each slot is still its own coin flip), but breed that cross a few times, keep the best result, breed *that* horse forward, and the population climbs.

That climb — not any single generation — is "breeding up," and it's the actual long-term game.

## 7. Quick answers to things that come up

- **"Why does my horse's number look different than I expected for its age?"** Young horses show a blend pulled toward the middle (50), not their full genetic number. Check back once they're mature.
- **"Why do two full siblings score differently?"** Same parents doesn't mean same slots — each foal gets its own independent set of coin flips at each slot, plus its own random static roll.
- **"Does training or care raise these numbers?"** Not yet — that system isn't built. Right now conformation is genetics + static + age/relatedness only.
- **"Is a higher number always better?"** No — only closer to the target matters. Overshooting costs points exactly like undershooting.
- **"Can two low-scoring parents ever produce a high-scoring foal?"** Yes, if their "on" slots are in different places — see §6. It's about which slots are on, not the raw total.
