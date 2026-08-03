# Horse Breeding & Showing Game — Design Overview

**Status:** Planning. Nothing here is built.

**How to read this document.** Everything below is a recommendation with reasoning attached, not a decision. Each significant recommendation carries the alternatives that were considered and a note on what would justify changing it. If you are a future session reading this: treat the reasoning as the substance and the recommendation as one defensible answer among several. Argue with it if you have grounds. Do not defer to it because it is written down.

This is a vision document. Detailed specification — schema, trait lists, breed data, scoring formulas — belongs in dedicated sessions and separate documents.

---

## 1. Concept

A text-based (non-animated) horse breeding and showing game for a small private group — one adult and her children. Players breed horses, manage their care and training, and compete them in shows judged against breed standards. The core intellectual content is a genetics engine detailed enough that breeding decisions are genuinely strategic and genuinely instructive.

**Scale:** roughly 4–6 accounts. Private, not public.

This scale matters more than it sounds. It removes anti-cheat, economy balancing against adversarial players, moderation, chat safety, scaling, and most account security from the problem space. Much of what makes commercial breeding sims expensive is other people.

**Genetic realism is the goal rather than the flavour.** Real loci with real names, real epistasis, real inheritance. This costs more than inventing convenient genes and constrains what can be added later, and that is the point — the game is meant to teach something true. Where realism and playability conflict, the conflict is worth surfacing explicitly rather than resolving silently in either direction.

**Who builds it.** Design and specification happen in conversation; implementation is delegated to Claude Code against a git-connected Cloudflare Workers project. The binding constraint is not build speed — it is the tuning that only real play reveals, and the coherence of the codebase across many separate sessions. §11 covers what follows from that.

### 1a. Accounts and stables

**An account is a person; a stable is a business.** One account may hold several independent stables, and the app opens on a stable picker. Each stable keeps its own books, its own stock and its own capacity, so a child running two barns is running two breeding programmes that happen to share an owner.

What this settles is where scarcity lives. **Anything scarce per human belongs to the account** — the action budget (§6c) above all, since actions held on the stable would triple the moment a child founded two more. **Anything that makes stables genuinely separate belongs to the stable** — money, capacity, stock, breeding prefix.

- **Stables trade with each other through the market like anyone else.** No direct transfer between one owner's own barns. It costs nothing, since the market already exists, and it keeps the separate-books claim honest.
- **The obvious leak is worth naming rather than plugging.** A horse listed by stable A and bought by stable B moves money between two books that were meant to be independent. A minimum listing duration, so a sibling could plausibly have bought it first, plus a marker on transactions where buyer and seller share an account, are both cheap and probably sufficient. At five players nobody may care.
  - **Settled 3 Aug 2026, when the market was specified, and built the same day.** The operator was offered the minimum listing duration and **declined it** — listings are buyable the moment they are posted, by anyone, including the seller's own other stable. The other half of the recommendation is what was built, and it is not optional: every ledger row from a sale carries `counterparty_stable_id`, and `same_account` is set to 1 when the two stables share an `account_id`. Completed sales are also public to every player at `/market/sold`. The leak is named, visible and queryable rather than prevented, which at five players is very likely the right trade — the cost of the duration rule is a real sale between two siblings being made to wait, and the benefit is stopping something anybody can see in the ledger anyway. **Do not quietly add the rule back.** If the pattern actually shows up, it returns as one config key (`market_min_listing_game_days`, default 0) and one check, once somebody has seen it.
- **A cap on stables per account** is probably wise. Unlimited invites a stable per horse.

### 1b. The parent's PIN, and the household layer

**Part of what the game hands out is earned outside it.** Whatever chore, reading or practice arrangement the household already runs, the parent can turn into something in the game — behind a four-digit PIN, typed on the child's own phone, in the child's own session. Nothing about the child's login changes; the PIN authenticates the grant, not the person.

**The household layer arrives in two stages, and the first one is not a currency.** The PIN's first use is the simplest possible one: granting a batch of horses directly. The founding stock generator (§12.3) mints a private batch into the child's stable, and that batch *is* the reward — no balance, no ledger, no catalogue, no spending. The parent types the PIN and the horses appear.

**Tokens are the second stage**: a stored balance on the account, spent against a product catalogue, built over a PIN that by then already exists, is already rate-limited, and already keeps a log. What that buys players is the ability to save up — several small rewards accumulating into one large purchase — which the direct grant cannot express.

- **Tokens sit on the account, not the stable**, for the same reason actions do.
- **They do not convert to game currency in either direction.** Two economies that never touch are far easier to reason about than an exchange rate that has to be tuned.
- **Children cannot transfer tokens to one another.** Best enforced by there being no path that moves them rather than by a rule someone later forgets. It stops tokens being pooled, traded, or extracted by an older sibling. It does not stop a child buying an import and selling the resulting horse for game currency, which is fine — the horse is real and the price is public.
- **What tokens buy is a catalogue rather than a set of features**, so a future premium idea is a data row rather than a code change. Imports (§12.3) are the first entry — the same generator the direct grant already drives, with a price on it; extra stalls, rerolls, name changes and recognised-cross unlocks are all plausible.

**Worth distinguishing what a token actually buys.** Access, cosmetics and capacity let a token buy something the game already contains. Advantage — extra actions, free test results, a thumb on a foal's genetics — buys a shortcut past a constraint the design is resting on. Neither is forbidden, and a chore-earned advantage is a defensible thing to want, but the question is better asked once per item than never.

**The PIN is the one place in this whole design where the threat model is real**, precisely because the adversary is at the kitchen table. Four digits is ten thousand guesses. Rate-limit attempts and log them — globally rather than per child, since a per-account limit can be farmed across a sibling's login, and in real minutes rather than game days, since what is being defended against is a person guessing rather than anything the world clock governs.

---

## 2. Genetics — recommended as two separate systems

The most consequential architectural recommendation in this document: **model qualitative and quantitative traits with different machinery, and keep them separate in code from the start.**

Merging them later is straightforward. Splitting them later is a rewrite. The separation also keeps each engine small enough to hold in one session's working memory, which matters more than it would with a single continuous author.

### 2a. Qualitative traits — discrete Mendelian

Coat color and pattern. Horse color genetics is unusually well documented and finite, which makes it the best-suited real-world domain for this kind of engine.

Suggested loci:

| Category | Loci |
|---|---|
| Base | Extension (E/e), Agouti (A/a) |
| Dilutions | Cream (incomplete dominance), Dun, Champagne, Silver, Pearl |
| Modifiers | Grey (dominant, progressive with age), Roan, Flaxen, Sooty |
| White patterns | Tobiano, Frame Overo, Splashed White, Sabino |
| Appaloosa | Leopard Complex (LP) + PATN1 |
| Gait | DMRT3 "gait keeper" |

These interact with real epistasis: `ee` masks agouti entirely, Grey progressively overrides the base coat as the horse ages, Cream is dose-dependent. This is a rules-and-lookup problem — deterministic, testable, and correct biology.

**DMRT3 earns its place because of the breed list (§4).** With two gaited breeds among eight, gait is not decoration: it is a single well-characterised mutation that gates eligibility for gaited classes, appears in some breeds and not others, and behaves as a clean teaching example of a discrete trait with an obvious phenotype. It also gives crossbreeding a visible consequence.

### 2b. Quantitative traits — polygenic additive

Conformation (neck length, shoulder angle, back length, hock set) and ability (stamina, jump scope, speed, trainability) are not Mendelian and should not be forced through the same system.

Recommended model:

1. **Genetic potential** = sum of N small-effect loci (8–20 per trait), inherited by independent assortment
2. **Environmental noise** applied at birth — same parents can produce different foals
3. **Expressed value** = potential × realization, where realization rises with age, training, and care

This produces bell curves rather than discrete outcomes, which is what makes selective breeding feel like selective breeding. It also gives the three-number display pattern seen in comparable games — *current value, breed ideal, genetic ceiling* — which communicates a great deal in one line of text.

### 2c. Genotype vs. phenotype as a mechanic

Players do not automatically know what their horses carry. Recessives and non-expressed genotypes stay hidden until the player pays for a test.

This is the highest-value single mechanic available. It converts breeding from arithmetic into decision-making under uncertainty, creates a money sink, and teaches carriers and recessives more effectively than any explanation could. §3 is what gives it stakes.

**Knowledge belongs to the player rather than to the horse.** What a horse carries is one thing; what a given player has paid to learn about it is another, and the two want keeping apart from the first table onwards. A test result travels to the buyer when the horse sells, and the seller keeps their own copy for their breeding records.

The consequence worth being ready for: a child can sell a carrier without disclosing it. That is arguably the lesson, and it is also an argument at some point. A disclosure flag on listings, or a parent-visible view of who knows what, are both available without disturbing anything.

### 2d. Inbreeding

Track pedigree and compute a coefficient of inbreeding (Wright's path method or the tabular method). Cap pedigree traversal depth — five or six generations is both sufficient and necessary, since deeper walks get slow and stop being meaningful.

Let COI raise defect probability and depress quantitative trait expression. Without this, optimal play is to mate the two highest-scoring animals repeatedly and the game has no strategy.

**COI should be previewable before a pairing is committed**, not only computed at birth. A number that arrives with the foal is a post-mortem; a number visible while choosing the stallion is a decision. This is the difference between storing parent IDs and materialising a pedigree at birth, so it is worth knowing it is wanted before the first horse exists.

---

## 3. Health and heritable conditions

Central to dog breeding sims and largely absent from horse ones. It transfers unusually well, because horses have a well-documented set of single-gene diseases with strong breed associations — several of them tied to coat colour loci already being modelled.

Why it earns its place, beyond being wanted:

- It gives §2c real stakes. Testing for a hidden coat colour is interesting; testing for something that kills foals is a decision.
- It makes §2d concrete. COI as a percentage is abstract; a recessive surfacing after two generations of line-breeding is not.
- It produces the sharpest strategic dilemma available — the outstanding stallion who is a known carrier — which is the actual dilemma real breeders face and argue about.
- It gives the vet profession (§8c) something substantive to do.

### 3a. Three categories, three mechanisms

**Single-gene conditions** run on the same Mendelian machinery as coat colour. More loci, no new engine.

| Inheritance | Examples | What it teaches |
|---|---|---|
| Dominant | HYPP, PSSM1, malignant hyperthermia | No hidden carriers — but the allele persists anyway because it travels with traits the show ring rewards |
| Recessive | SCID, GBED, HERDA, cerebellar abiotrophy, lavender foal syndrome, WFFS | Carriers are healthy and invisible until tested, or until two of them meet |

HYPP is worth building early as a teaching case. It traces to one enormously successful Quarter Horse sire and spread because the genetics that caused it also produced the muscling that won classes. That is the entire argument about selection pressure in a single example, and it is true.

**Colour-linked conditions** are consequences of loci already in §2a and require no new genetics whatsoever:

- Homozygous Frame Overo → lethal white syndrome
- Homozygous Silver → multiple congenital ocular anomalies
- Grey → melanoma risk rising with age
- Extensive white patterning → congenital deafness

These are the highest value per unit of work anywhere in this document. Zero new machinery, real biology, and they make the point that breeding for appearance carries costs — which is the point most worth a child absorbing.

**Polygenic predispositions** run on the same additive machinery as conformation: a heritable risk score, modified by age, workload, weight and care, producing a probability of onset rather than a fixed outcome. Osteochondrosis, insect bite hypersensitivity, degenerative suspensory ligament desmitis, laryngeal neuropathy, navicular disease.

This category also stops the Thoroughbred having nothing, since its heritable problems are mostly not Mendelian — which is itself accurate and worth showing.

**The substrate for this category is built (slice 0014, 3 Aug 2026), the consequences are not.** Three heritable soundness traits — `foot_robustness`, `joint_robustness`, `ligament_robustness` — exist on every horse born from that deploy onward, ten loci each, inherited exactly like conformation and fertility. Named for tissue rather than for one disease (one tissue feeds more than one condition; `TRAITS` can never be reordered or removed, only appended to), and drawn at a fixed chance regardless of a founding batch's quality band, so soundness is an axis a player has to breed for separately from the show ring rather than a fourth reading of the beauty-and-speed die. Nothing reads them yet — no onset roll, no risk display, no condition row maps to one. They were built now rather than with the rest of this category specifically because `TRAITS` is append-only and a genotype is written once at birth: a horse alive when a heritable trait is added is missing it permanently, and that is not a mistake a reset can fix once children are playing. See `docs/slices/0014-before-the-children-play.md` §2.6 for the full reasoning and `CLAUDE.md`'s slice-0014 build-log entry.

### 3b. Frame Overo and the lethal cases

**Homozygous Frame Overo is decided, not implemented — correcting an earlier draft of this document.** `LOCI` (`src/engines/genetics/loci.ts`) holds E, A, CR, G, DMRT3 and the four disease loci; there is no frame, tobiano, sabino or splash locus anywhere yet. The design below is what it will do once built.

Deferring it is safe in a way deferring the polygenic category (§3a) is not, and it's worth recording why so a future session doesn't re-panic about it: a **Mendelian** locus missing from a genotype reads as two copies of the wild type (slice 0002's missing-locus rule) — a horse that predates the frame locus simply does not carry frame, which is true, and adding the locus later needs no reset. A **polygenic** trait missing from a genotype reads as zero out of its range — a wrong answer masquerading as a real one, which is why §3a's substrate could not wait. Colour enters a real closed population the same way a real allele would: through new founding batches and imports, not through the existing herd.

Two things follow. First, it makes frame testing genuinely valuable rather than a curiosity. Second, it will happen at a moment nobody chose, so the wording is worth drafting in advance rather than at the point of failure. Softening remains available without abandoning the biology: the loss can be presented as an early-term pregnancy that does not continue rather than as a foaling, and the explanation can lead with the genetics rather than the outcome.

**Decided 2 Aug 2026, in conversation — the lethals are modelled fully.** Asked directly whether to model lethal white fully, soften it to a weak foal needing expensive intervention, or leave frame out of the founding pools altogether, the operator chose to model it fully. So a Fr/Fr conception is non-viable, with no intervention path and no survival roll. Two notes for whoever builds this:

- **The presentation question is also decided: the foal is born, and then dies.** *Decided 2 Aug 2026, in conversation.* The softening option above — presenting the loss as an early-term pregnancy that does not continue — was offered and declined. This is the biologically accurate version: an OLWS foal is born apparently healthy, and dies within a day or two of a colon that was never going to work. It is also the reason the allele persists in real populations, since nothing about the pregnancy warns you.

  **This makes the dead foal a real `horses` row**, not a pregnancy that resolves to nothing: it has an id, a genotype, a pedigree, a `status` of `dead` and an `end_reason`. It therefore stays in pedigrees and produce records permanently (§11 keeps identity, parents and genotype for dead horses), which is wanted — the record that a pairing produced a lethal is the teaching artifact.

  **Two things followed that the implementing session had to decide. Both were decided 2 Aug 2026, in conversation, while specifying `docs/slices/0010-health-first-pass.md` — see that document's §2.2 and §2.3. They are kept below because the reasoning is what a future session needs, not the answer on its own:**

  - **The death window is 30 game days** — three ticks, about a full real day at the current schedule, held as the config value `lethal_foal_death_game_days` and snapshotted onto the row at birth so retuning it never moves the death date of a foal already born. Birth and death are two separate events, and nothing at birth hints at what is coming. The reasoning that forced a number this large: **the death window is otherwise only a couple of game days, which is about two real hours.** At one game month per real day (§6), a foal that dies three game days after birth is born and dead well inside a single afternoon. The child will usually find both events already over, in a log — at which point "born and then died" collapses back into the early-term-loss experience that was just declined, and the decision is silently undone by the time scale. If the point of choosing this option is that the foal is genuinely seen alive first, the window needs to be long enough in game days to span a login, and the birth and the death need to read as two separate events rather than one combined message. This is a tuning decision with a real purpose behind it, not a detail.
  - **A lethal foal can be named, and nothing special-cases it.** Registered names are unique and permanent, so a named foal consumes its name from the game forever, and that cost stands. In practice foals are born unnamed and most affected ones will die unnamed, but a child who names one inside the window keeps the record. Blocking the naming flow was the alternative and was declined for a specific reason: the block would itself announce the diagnosis before the death, which is exactly what the silence above is arranging not to do.
- **Draft the wording before building the mechanic, not after.** `conditions.event_text` exists precisely so that this is written calmly rather than at the point of failure — see the schema document §3.3. Frame lives in the Quarter Horse's pool (§4), which is accurate, and Paint being an alias on Quarter Horse rather than a breed means the players most likely to be breeding for pattern are exactly the ones carrying it.

The same reasoning extends to the other lethal recessives — SCID, GBED, lavender foal syndrome, WFFS. **Recommendation: keep the lethal set small.** Four or five across the whole game is enough to make testing matter. A dozen makes foaling an anxious event rather than a hopeful one, and the difference is entirely in the tuning rather than in the biology.

### 3c. Testing, extending §2c

Two kinds of knowledge, and keeping them distinct is most of the educational content:

- **Genotype tests** return clear / carrier / affected. Permanent — a horse tested clear stays tested clear.
- **Screening** returns an observation at a point in time — a soundness assessment, a scope, a skin evaluation. It can change as the horse ages, so it needs redoing, and it never tells you what the horse carries.

That distinction is exactly what the dog games display, and it is worth keeping because it teaches something true: some things about an animal can be known with certainty and some can only be observed.

**Test pricing is a genuine tuning point.** Too cheap and everyone tests everything, which kills the hidden-information mechanic that makes breeding interesting. Too expensive and players breed blind, which is frustrating rather than strategic. Panels — testing several conditions at once at a discount — are a useful middle lever, and they are what the real market offers.

### 3d. Consequences should not all be fatal

- **Lethal** — the recessives above. A single event, resolved at conception or foaling.
- **Manageable** — HYPP and PSSM1 through diet and workload. Ongoing cost, ongoing decisions, horse still competes.
- **Degenerative** — DSLD, navicular. A career ends before the horse does, which is a different and quieter kind of loss.
- **Latent or cosmetic** — carrier status, mild ocular anomalies. Matters at breeding, not in the ring.

**The middle two should carry most of the weight.** Manageable and degenerative conditions produce recurring decisions and give the vet, farrier and feed systems something to interact with. Lethal conditions produce one event and then nothing.

### 3e. What this does to the rest of the game

- **The market** gains its most important price signal. A tested-clear horse commands a premium; an untested one is a gamble; a carrier with outstanding conformation is genuinely hard to price.
- **Breeding acquires its central dilemma.** The best stallion available is a carrier. Do you use him on tested-clear mares and test every foal, or refuse on principle?
- **Care stops being decorative.** Conditions that respond to management make §8a matter mechanically rather than as flavour.

### 3f. Scope control

Dog sims run forty or more conditions across body systems. That is a lot of data entry and a lot of tests, and it is not where this should start.

**Recommendation: two or three conditions per breed, plus the colour-linked set, plus two or three polygenic predispositions shared across breeds.** That is roughly twenty items — enough for a health panel that looks real, small enough to tune. Expanding later is data entry against machinery that already exists.

**Tune so that most foals are healthy.** If every foal arrives with something, the game becomes disease management rather than breeding, and the panel stops being read. Carrier frequencies in the founding population are the lever, and they should start low.

---

## 4. Breeds

Eight breeds: **Quarter Horse, Arabian, Thoroughbred, Paso Fino, Icelandic, German Warmblood, Friesian, Nokota.**

**Decided 2 Aug 2026, in conversation:** Friesian and Nokota were added to the original six at the players' request. A third request, **Paint, is deliberately not a breed** — see the note under the table. Appaloosa was requested and **deferred on purpose**, to be revisited once shows exist and it is clear whether the colour-led breeds are actually being played; it is the only requested breed that would add genetics nothing else needs (the appaloosa pattern loci, plus MCOA-style ocular disease riding along with them).

Neither addition costs new colour or gait genetics: every locus Friesian and Nokota need — dun, roan, tobiano, splash, frame, sabino — was already required by Quarter Horse or German Warmblood. The marginal genetic cost of both breeds is **two disease loci**, and both are the Friesian's.

**Breed codes, confirmed 2 Aug 2026: `FR` Friesian, `NOK` Nokota.** Paint gets no code, because it is not a breed. Codes are confirmed explicitly rather than left to the implementing session because a breed code is written into every horse's `composition` blob at birth, so changing one later means rewriting every horse in the database — see CLAUDE.md §11. The spelling is **Nokota**, the North Dakota Badlands breed; "Nakota" is a common variant spelling of the same horse and is not what goes in the `code` or `name` column.

### 4a. Breed identity comes mostly from data

Most of what makes one breed feel different from another is free:

- **Allele availability in the founding population.** Pure data, costs nothing, creates strong breed identity immediately.
- **Conformation ideal vectors.** Each breed gets its own target values and its own weighting of which traits matter most.
- **Height and weight ranges.**
- **Discipline aptitudes and eligible show classes.**
- **Characteristic heritable conditions**, which turn out to be one of the strongest identity markers of all.

**These do not all arrive together, and the split is deliberate.** All eight breeds get their founding allele pools with the founding stock generator (§13), because that is the first thing a child chooses and colour is what they are choosing between — a Friesian batch that comes out black and an Icelandic batch that comes out every colour is the whole payoff of having eight pools rather than one. Everything else on the list above is built for the **Quarter Horse** first, alongside the system that reads it — the ideal vector with the first show class, the disease panel with the first health pass — and then folded into the remaining seven in one later stage (§13). Building an ideal vector for a breed before there is a scorer to read it is guessing.

Roughly how the eight sit against each other:

| Breed | Colour genetics | Signature conditions | Role in the set |
|---|---|---|---|
| Quarter Horse | Cream, dun, champagne, pearl, roan, sabino, splash, frame; no tobiano, no LP | HYPP, PSSM1, GBED, HERDA | Richest palette, richest disease panel — most of the puzzles live here |
| Arabian | Bay/chestnut/black, grey very common, sabino; effectively no dilutions or patterns | SCID, cerebellar abiotrophy, lavender foal syndrome; melanoma via grey | The restricted one. Shows what a genuinely closed pool feels like |
| Thoroughbred | Bay/chestnut/black, grey, sabino/rabicano | Mostly polygenic — laryngeal neuropathy, bone and tendon fragility | Identity comes from performance; shows that heritable ≠ Mendelian |
| Paso Fino | Broad — most dilutions and pinto patterns | DSLD | Gaited |
| Icelandic | Nearly everything, including silver, dun, cream, pinto, roan | Insect bite hypersensitivity; MCOA via silver | The colour-diversity breed. Gaited |
| German Warmblood | Bay/chestnut/black, grey, tobiano in some lines, sabino | WFFS, osteochondrosis | Large sport type, performance-led |
| Friesian | Black only. No dilutions, no patterns, no grey. Recessive red occurs and is unregistrable | Dwarfism, hydrocephalus | The closed pool. COI and recessives *are* the experience — the hard-mode breed |
| Nokota | Blue roan is the signature; dun and grullo; frame occurs. Some individuals gaited | None distinctive | The landrace. Healthy, unrefined, unrelated to everything else — the outcross that answers gene-pool collapse (§10a) in-world |

Arabian against Icelandic is close to the widest colour-genetics contrast available among common riding breeds, and the disease panels differentiate them further. The cost is research and balance rather than code.

**Paint is a display alias on Quarter Horse, not a breed.** *Decided 2 Aug 2026, in conversation.* A Paint's `breed_id` is Quarter Horse and its `composition` is `{"QH": 1}`; when the horse expresses a pinto pattern, the UI shows its breed as "Paint" instead. There is no `breeds` row for Paint, no allele pool, no ideal vector and no disease panel — it shares the Quarter Horse's, which is correct, since APHA and AQHA horses are the same foundation stock and the same panel (HYPP, PSSM1, GBED, HERDA). This mirrors the real history: APHA exists because AQHA excluded excess-white "cropout" horses from the same gene pool.

Three consequences, all wanted:

- **The Quarter Horse × Paint cross problem disappears.** They are one breed, so no pairing between them produces a cross, and §4c's recognised-cross machinery is not needed for this case.
- **It reduces rather than multiplies show classes**, which cuts the right way against the thin-fields problem in §10a.
- **The alias belongs on the breed row as data, not as a rule in code.** Something like a `colour_display_alias` field — pattern to match, name to show — so a tobiano German Warmblood does *not* read as a Paint, and so no session ever writes `if (breed.code === 'QH')`. Per §12's rule that breeds are rows, not constants.

The one visible oddity, accepted: a solid foal out of two Paints displays as a Quarter Horse, where real APHA would call it Breeding Stock Paint. The label follows the phenotype, not the lineage — which is arguably the better lesson anyway, since the pattern *is* a gene rather than an inheritance of status.

"German Warmblood" is an umbrella over several separate studbooks. Treating it as one breed is a reasonable simplification at this scale; splitting it later is additive rather than disruptive.

### 4b. Silhouettes

Relevant only once generated art exists (§5c), and worth deciding then rather than now.

The breed choices make this cheaper than it would otherwise have been. All eight are riding types — no draft, no miniature. The Icelandic is compact and pony-proportioned and the Paso Fino is small and light, but nothing here is a Shire next to a Shetland. One base plus transform profiles may well be sufficient; two (light riding, compact) is the safer starting assumption.

**Revisit this if:** the transform approach produces breeds that read as obviously the same horse stretched. Test with Arabian and Icelandic before committing.

### 4c. Crossbreeding

**Crosses are permitted.** No ideal is defined for them and no attempt is made to judge them against a standard.

- **Stats inherit normally.** A cross's polygenic traits come through the same machinery as everything else. No special blending rule is needed, because ordinary inheritance already produces the intended result.
- **Colour, gait and health genes likewise** inherit normally. This is where crossing gets interesting: it is the only route by which a line acquires alleles its breed does not carry — including, worth noting, diseases its breed does not have.
- **Barred from conformation and breed classes**, since there is no standard to judge against.
- **Eligible for performance classes** — jumping, barrels, gaited classes where DMRT3 permits, and anything else scored on measured ability rather than breed type.

This gives crosses a genuine niche rather than making them strictly worse, and it means a player breeding for the in-hand ring and a player breeding for fences are running different programmes.

**Recommended rule, because the alternative leaks:** any horse with a non-purebred parent, or with parents of two different breeds, is a cross — and stays one, regardless of how many generations of purebred mates follow. Without a rule of this shape, breed allele restrictions dissolve within a few generations: cross once for tobiano, breed back twice, and the "Arabian" line now carries genes Arabians do not have. Those restrictions are most of what makes breeds feel like breeds.

**Recognised crosses** — Quarab, and whatever else the breed list supports — are a later addition. A recognised cross would get its own ideal vector and its own classes, at which point it behaves as another breed. Worth building the cross system so that promoting a pairing to recognised status is a data change rather than a structural one.

**Decided 2 Aug 2026, in conversation — the Paint case is resolved without recognised crosses.** The first pairing that was going to make the rule above feel wrong was Quarter Horse × Paint: routine in reality, registrable, and yet barred from breed classes forever under the once-a-cross-always-a-cross rule. Rather than build recognised-cross machinery to fix it, Paint stopped being a breed (§4). Two same-breed Quarter Horses cannot produce a cross, so there is nothing to except.

This is worth reading as a pattern and not just a one-off: **when a breed's identity is a phenotype the existing genetics already produce, a display alias is cheaper and more accurate than a breed row.** Reach for that before reaching for recognised crosses. The rule is still worth honouring for a genuine two-pool cross like Quarab, where the parents really are different gene pools — recognised crosses remain unbuilt and unneeded until one is wanted.

---

## 5. Presentation and identity

**Phenotype as structured data, rendered as text, with a per-horse image the players choose. In-app generated art is the long-term goal rather than a prerequisite for playing.**

### 5a. Structured phenotype is the load-bearing part

The expression engine should emit structured data, not prose — base coat, active modifiers, pattern genes with expression states, marking set, gait, build values, visible condition. Everything visible is a renderer over that object.

Get this wrong and every later renderer is blocked behind rewriting the expression layer. Get it right and text, images, and eventual SVG are all cheap additions that never disturb each other.

A text renderer over it — *"Bay tobiano filly, blaze, three white socks, 15.1hh, gaited"* — costs almost nothing and carries more than expected.

### 5b. Image library and per-horse selection

Every horse gets an image slot, filled by URL. A library of images is generated and hosted ahead of time; players select from it.

This removes image generation from the build entirely — no asset pipeline, no registration problem, no commissioning — while giving each horse a face from the first day of play.

- **Hosting the library as static assets in the Worker** rather than externally means the URLs never rot and the images load from the same origin as everything else. It costs nothing at this volume and it is one fewer external dependency.
- **A picker beats a text field.** Pasting URLs is error-prone on a phone. A grid the player scrolls, ideally filtered by colour or type, makes selection pleasant rather than administrative. An arbitrary-URL field can sit alongside it.

**The slot is permanent, not temporary.** If generated art arrives, a chosen image should override it for that horse rather than being replaced by it.

**Decided 2 Aug 2026, in conversation: images are matched on breed, and on nothing else.** The question had been whether to tie images to phenotype — a library organised by colour, defaulting to the horse's actual coat, against free selection, against the middle position of matching-by-default with an override.

Breed-only matching wins for two reasons. The library is being generated per breed with the colours chosen by hand at generation time, so the operator is already doing the colour curation that library metadata would otherwise have to encode. And a library that promises to match *colour* cannot keep that promise: the engine produces twelve visible colours today and the design plans roughly sixteen loci, at which point the colour space is combinatorial and no hand-built library will contain a silver dapple sooty roan tobiano. A library that never claimed to match colour is more honest than one that stops matching exactly as the colour genetics get interesting. Within a breed's set the player chooses freely.

**The consequence, accepted:** a child can pick a chestnut picture for a black horse. The picker shows the horse's actual colour in text beside the grid, and adding a colour tag to filenames later is purely additive if it turns out to matter.

**The library is a numbered set per breed, and the count is a column on the breed row.** Files are named `<breed code>-NN`, never renumbered and never deleted, so the app derives the list from the breed's code plus its `image_count` — no manifest file to hand-edit, no directory listing (Cloudflare's static assets have none), and adding images is an upload plus one number. This is what makes the library the operator's to grow without a session's help, which matters more here than in most places: the person running this project has no terminal, and the browser upload path is the only one they have.

### 5c. Generated art

The long-term goal, described here so the earlier layers stay compatible with it.

**SVG rather than raster.** Regions are named paths filled programmatically, so coat color costs zero assets; overlays live in the same coordinate space so registration is free; individual paths can be transformed, which is what makes both conformation expression and breed variants possible; and file sizes suit cheap Android devices.

Rough shape per base type: one silhouette split into ~12 named regions; ~10 pattern overlays; ~12 marking overlays; coat color as programmatic fill; spotting, roan mottling and dapples generated procedurally from the horse's seed. Roughly 35 assets per base type yields tens of thousands of visually distinct horses.

Most of this is geometry rather than drawing — socks are shapes clipped to leg paths, blazes are stripes clipped to the head, tobiano is irregular blobs clipped to the body outline. Expressed as coordinates in code, these are written, versioned and adjusted like any other part of the system.

**The base silhouette is the genuinely hard artifact.** It has to read as a horse, which is a drawing problem rather than a geometry one. Commissioned (roughly $50–150, with the region list specified explicitly in the brief), sourced from CC0 vector libraries, or traced in Inkscape from a reference.

**A constraint to be aware of:** current AI image generation handles style consistency well but does not reliably handle pixel-exact registration across separate generations. Generate freely for one-off assets and for the §5b library; the layer stack needs to share one coordinate system.

**Trait reference icons** are documentation, not gameplay. Deferrable indefinitely, and a plausible task to hand to the children.

### 5d. Names and breeding prefixes

**Every stable has a breeding prefix, unique across the game, stamped onto every horse it breeds.** Uniqueness wants enforcing properly rather than by convention — two stables sharing a prefix makes pedigrees ambiguous permanently.

Two names, one fixed and one not. A **registered name** is assembled once at birth from the breeder's prefix plus the name the breeder chooses, and never changes wording or ownership again. A **barn name** is whatever the current owner calls the horse day to day, freely editable and cleared when the horse changes hands.

**The prefix on the name is a snapshot rather than a live reference.** If a registered name were rendered from the breeder's current prefix, renaming a stable would silently rewrite the name of every horse it had ever bred, including ones sold to other players generations earlier. A permanent mark that changes retroactively is not a permanent mark. A separate record of who bred the horse still points at the live stable, so "who bred this, and what are they called now" stays answerable.

**This is what makes breeder credit survive a sale**, and it is most of what makes building a bloodline feel like building something. Ownership moves; origin does not. A horse sold three times still carries the prefix of the barn that bred it, on its name, visibly, for as long as it exists.

Whether a prefix can be changed at all once horses have been bred under it is worth deciding rather than inheriting. Keeping a small history of a stable's previous prefixes costs almost nothing and means a rename does not orphan twelve years of pedigree.

---

## 6. Time model and limiters

### 6a. Time scale

**One game month per real day**, advanced by a daily tick.

Consequences worth holding in view, because this number sets the pacing of everything:

- Gestation at eleven months is eleven real days. A breeding decision resolves inside a fortnight.
- A foal reaches competing age in roughly five real weeks. Generation turnover lands near six or seven.
- A horse's full life is on the order of ten to twelve real months.
- A mare can produce roughly thirty foals per year of real time. Population control (§7) is not a polish item.
- The gene pool (§10a) exhausts itself in real months rather than real years, raising the priority of NPC stables and imports.
- Age-onset conditions (§3) arrive quickly. A grey horse's melanoma risk and a sport horse's degenerative changes both land inside a real year, which makes them visible rather than theoretical.

None of this argues against the choice. It argues that this is the first number to revisit if the game feels frantic, and that the mechanisms absorbing speed need to exist rather than being deferred.

**Recommendation on granularity:** let the world clock run in game-days and have the tick advance thirty of them, rather than making a month atomic. Gestation countdowns, show dates and training then have day-level resolution, and changing the ratio later is a config change rather than a rework.

**Recommendation on frequency: several ticks per real day rather than one**, with the game-days-per-tick figure divided to compensate so the pacing above holds. A morning, lunchtime and evening tick give the children three moments in the day worth arriving for, and a lunchtime foaling is a better reason to finish schoolwork than an overnight one.

Two things follow, and both are cheap now and annoying later:

- **The action budget (§6c) resets per tick, not per day.** Three ticks at N actions is 3N actions a day. Keep the tick schedule and the per-tick allowance as two separate numbers, so changing the schedule does not silently change how much play a day contains.
- **The tick has to fire at a sensible local hour**, which is the entire point of having three of them. Scheduled jobs on most hosting run on UTC with no timezone setting, so the local hour is something the tick works out for itself — check the current local time on each invocation and return immediately if it is not one of the slots. Follow daylight saving rather than fixing an offset: a lunchtime tick that drifts to eleven for eight months of the year is the same confusion arriving by a different route. Keep the slots out of the small hours and the spring-forward gap never comes up.

Times of day are the only place the real-world clock enters the design at all. Everything else — ages, gestation, upkeep, shows, condition onset, NPC breeding — derives from the world clock, which is an integer that moves only when the tick moves it.

### 6b. Advancing time deliberately

- **A whole-world time jump** is coherent and cheap — the same lever as the pause in §10g pointed the other way. The tick either declines to advance the world clock or advances it further than usual, and everything downstream follows automatically.
- **Advancing an individual horse** is the one to be careful with. A horse aged past its siblings sits oddly against pedigree, COI, show eligibility and the fairness of a shared world. If the underlying want is "this foal takes too long to be useful," that is better answered by adjusting the maturation curve globally.

If per-horse advancement is wanted anyway, accelerating *training* rather than *age* carries most of the benefit and none of the pedigree problems.

### 6c. Activity limiter

- **Continuous energy regeneration** (points refill per hour) is what commercial games use, and it is engineered specifically to drive compulsive re-checking. Worth naming plainly given the players.
- **Discrete world tick** — the game advances at fixed hours; each account receives N actions per tick; unused actions do not bank. **Recommended.** Nobody gains from grinding, nobody loses from sleeping, and implementation is one scheduled job.

The budget is per account rather than per stable (§1a), so a second barn divides attention rather than multiplying it. Resetting means setting the allowance to the configured figure, not adding to it.

### 6d. Breeding limiter — biology rather than arbitrary caps

Gestation, one pregnancy per mare at a time, post-foaling recovery cooldown, fertility windows by age, and a stallion book cap per season. Self-explanatory to players, fair rather than imposed, and they teach something.

---

## 7. Economy and population control

The failure mode that kills breeding sims: animals accumulate, nothing removes them, and no decision matters. At one game month per real day it arrives faster than it otherwise would.

Recommended sinks, present from early on:

- Aging, retirement, and mortality
- Per-turn upkeep (feed, board)
- Stable capacity limits
- Money sinks: genetic testing and screening, veterinary care, farrier work, tack purchase and repair, show entry fees, stud fees, training

Tokens (§1b) sit outside this entirely. They are a faucet fed from the household rather than from the game, and since nothing converts between the two, they cannot inflate prices or substitute for the sinks above.

### 7a. Death and removal

**Horses die of old age**, and players can also remove a horse from play deliberately — sold on, retired away, placed with a distant buyer. Whatever it is called, it should not be grim, and it should read as a normal part of running a stable rather than a punishment.

- **Emotionally**, it gives players an honest way to manage a herd they cannot keep.
- **Structurally**, it is the pruning mechanism. Without a voluntary exit, capacity limits become a wall rather than a decision, and the tables grow without bound.

**On retention:** a removed or dead horse keeps only what pedigree display and COI calculation require — identity, sex, breed, birth and end dates, parents, and genotype, since carrier status in the ancestry is worth tracing and it is small. Everything heavy goes: show results, market history, training state, per-turn logs, notes.

This wants deciding before the first horse dies rather than after. The same is true of mortality generally — a herd that has never lost anything is a herd whose owners will experience the first loss as a bug.

**Worth thinking about:** whether decline is visible in advance. An ageing horse showing signs gives a child the chance to plan a last season and retire deliberately, which is kinder than an unannounced disappearance and closer to true. Degenerative conditions (§3d) already produce this shape naturally.

**Built 2026-08-02, in `docs/slices/0011-ageing-death-and-removal.md`** (§14 above records the announced-death decision itself). The shape that landed:

- **Lifespan** is a normal draw — mean 23 game years, sd 3.5, clamped to 14–33 — rolled once at birth from the horse's own seed and snapshotted, never a hazard rolled every tick. Roughly one horse in thirteen dies before eighteen, about one in eight passes twenty-seven. Never rendered to a player in any form.
- **The failing window** is 1.5 game years (about eighteen monthly shows), long enough to span a login gap and leave room for a real last season.
- **"Retire away"** is the name for voluntary removal — never "sell", "cull", or "delete". It is free, one-way, costs no turn, and moves no money; the confirmation page names any active pregnancy, booked covering, or unjudged show entry it is about to cancel or withdraw.
- **On retention, this departs from `docs/horse-game-schema.md` §4.2's recommendation** on two points, both argued in the slice document's §5.5: `image_url` is kept (the storage argument doesn't survive contact with a column that's a few dozen bytes), and `show_entries` are kept rather than pruned, because deleting them would retroactively falsify every show the horse competed in.

**Age-based performance decline is built (slice 0014, 3 Aug 2026, in `docs/slices/0014-before-the-children-play.md` §4), superseding this section's own earlier note that a decline was parked (slice 0011 §3.2).** Raised again per that section's own instruction to raise it rather than quietly add a multiplier, and this time the operator chose noticeable: flat until 16 game years, a straight line down to a floor of 0.85× at 25, applied as a fourth multiplier on the show score (never on the displayed conformation numbers — a horse's neck has not gotten shorter, only what it can do with the body it has). **It is keyed off age in days, never off the Failing marker above** — a horse with a short lifespan roll can read Failing at thirteen and take no age penalty at all, while a tough twenty-six-year-old not yet Failing takes the full one. The two ideas answer different questions (how old is this horse vs. how much life does it have left) and this slice keeps them answering different questions on purpose.

---

## 8. Care, tack, and professions

### 8a. Care state as a performance modifier

Every horse carries a care state — shoeing currency, veterinary currency, feed quality, condition, and the management status of any diagnosed condition. Well-maintained horses express slightly more of their genetic potential; neglected ones express slightly less.

**Recommendation: a tight band, somewhere near ±5%.** Set against show noise around 10–15% (§9) and genetic differences considerably larger than either, care becomes the thing that decides a close class rather than the thing that beats better breeding.

The failure mode is worth naming: if care and equipment swing results more than genetics does, breeding stops being the game. It is the same failure as excessive show noise, arriving by a different route.

Neglect should degrade gradually and recover, not produce cliff edges. A child who forgets the farrier for a week should see a small penalty rather than a lame horse.

**Built (2026-08-03), Part A of `docs/slices/0013-care-and-condition.md`.** Two of the four state pieces named above shipped — shoeing and veterinary "currency" as two piecewise-linear timers (`src/engines/care/modifier.ts`), plus a barn-wide feed level — as a modifier summed from three deltas and clamped last to `[0.95, 1.05]`, exactly the ±5% recommended here. The ramp is `+1%` the moment a call is made, decaying to `0` at the interval (45 game days for the farrier, 180 for wellness), then ramping to a full penalty (`-3%` farrier, `-2%` wellness) at three intervals of neglect and staying flat forever past it — no cliff edges, per the paragraph above, and verified by a continuity test that walks every day of the ramp. **Care never touches the displayed conformation numbers** — it modifies the show score only, decided against a real risk of double-counting (realization already feeds the score the modifier then multiplies again) and against teaching a false idea (a horse's neck does not get longer because the farrier came). "Condition" and "management status of a diagnosed condition" — the other two state pieces — were **not** built; management-of-a-diagnosed-condition is specified as that slice's Part B and was deferred (see `CLAUDE.md`'s Care row and the build log's 2026-08-03 entry).

### 8b. Tack

Better tack marginally improves performance; worn or wrong tack does not. No artwork — tack is data and text.

- **Tiers with diminishing returns.** The gap from poor to adequate should exceed the gap from good to excellent, so early purchases matter and late ones do not run away.
- **Tack wears.** Condition degrades with use; repair or replace. This is what makes tack a recurring sink rather than a one-time purchase, and it is most of the economic argument for having it.
- **Discipline specificity.** A jumping saddle does nothing in a gaited class. Cheap to implement, and it creates a reason to own several sets rather than one best one.
- **Shoes sit at the boundary** between tack and care — farrier-applied, wearing on a schedule, and the natural join between this section and the professions below.

**Pay-to-win risk worth watching:** with uneven engagement across five players and a shared economy, a wealthy player equipping everything at top tier widens gaps that breeding alone would not. Diminishing returns and the narrow band in §8a are the main defences; a cap on total equipment contribution is available if those prove insufficient.

### 8c. Professions

A player can qualify into a service profession — vet, farrier, trainer, and plausibly others — by paying a substantial one-off cost. Other players calling for that service can then choose them as provider, and money transfers.

**Providers spend no actions.** A service call is the client's action, not the provider's. The provider's involvement is setting prices, keeping stock, and improving their rating. This is what makes a profession a business rather than a chore, and it means a child can hold one without it eating their day's turns.

What providers control:

- **Price**, set by them, visible to clients
- **Inventory** — supplies consumed per service, bought in advance. This is the ongoing cost that stops a profession being pure income, and it is the main balancing lever
- **Effectiveness rating**, determining outcome quality and how attractive they are against alternatives

**Players compete with NPC providers.** NPC vets and farriers always exist, priced predictably and rated middling. They set the ceiling on what a player can charge and the floor on what service is available.

**A requirement rather than a preference: care must never be blocked by a player provider being absent, asleep, or out of stock.** A sick horse waiting because a sibling forgot to restock is a family argument, not a game mechanic. The NPC provider is always available and a client can always choose it.

Recommended shape for the remaining details, each of which could reasonably go another way:

- **Effectiveness driven by purchased upgrades rather than accumulated experience.** Experience compounds, so the first player into a profession accrues a lead nobody can close — which at this scale means one child permanently owns being the vet. Purchased tiers are a money sink instead of a moat, and a later entrant can catch up by spending.
- **Self-service at cost.** A player vet treating their own horses consumes inventory but pays no fee. Realistic, mildly advantageous, and simpler than forbidding it.
- **One profession per player at a time**, switchable at a cost. This spreads professions across the family rather than letting one player hold all of them. It also means the profession belongs to the account rather than to the stable: a stable is a business and a business has a trade, which is internally tidy, but it would let one child run a veterinary practice and a farriery side by side and restore exactly the concentration this rule exists to prevent. Worth deciding deliberately, since both readings are defensible.

**Trainer is the profession to think hardest about.** Training is normally an action a player spends; a trainer for hire converts money into training throughput, which partially routes around the action budget in §6c. Whether that is a feature or a hole depends on how tightly the budget is meant to bind. Options: make hired training slower than self-training, cap how many horses can be in outside training at once, or leave trainers out of the first pass and add them once the action economy has been watched in play.

**Economically, professions are a faucet with a matching sink** — client money flows to providers, provider money flows to inventory and upgrades. Worth confirming the sink is real when pricing is tuned, since a profession earning more than it consumes is an unlimited money printer at a scale where five players cannot absorb inflation.

**On family dynamics:** professions create visible asymmetry between players, which is either the appeal or the problem depending on the children. Multiple professions, cheap switching, and NPC alternatives all reduce the chance that one child ends up structurally advantaged and another feels shut out.

---

## 9. Shows

**Scoring shape:** weighted match of expressed traits against the relevant breed standard, plus training level, plus care and equipment modifiers (§8a), plus noise.

Two parameters carry most of the feel:

- **Noise magnitude.** Too low and the best horse always wins, so nobody else competes. Too high and breeding stops mattering. Somewhere around 10–15% is the usual working range; tune it against your actual players.
- **Judge variance.** Rotating judges who weight traits differently (one favors head, another movement, another substance) means no single horse dominates every class. This matters unusually much when the losing player is at your dinner table.

Class structure follows from §4c:

- **Breed and conformation classes**, judged against that breed's standard. Purebreds only.
- **Performance classes** — jumping, barrels, and similar — judged on measured ability. Open to crosses.
- **Gaited classes**, gated on DMRT3, which the Icelandic and Paso Fino enter as a matter of course and anything else enters only if it inherited the allele.

**Shows resolve on the tick**, alongside everything else the world clock advances. Entering is a player action; scoring is not.

**Show cadence is coupled to the time scale and worth setting together.** At one month per real day, a monthly circuit means a show every real day, which sits neatly against the tick schedule and the action budget. Anything more frequent produces more shows than a player has actions to enter, which quietly converts the action budget into the real limiter and makes the schedule decorative. Schedule shows in game-days rather than in ticks, so the calendar survives a change to how often the tick fires.

**Snapshot how a result was reached, not just the result.** The expressed traits, the care and tack modifiers, the training level and the noise, all recorded at scoring time. It costs a little storage and it means a child asking why their horse placed fourth gets an answer months later, and that a later change to the expression engine does not retroactively rewrite history.

### 9a. Registries and recognition

A hall of fame — a Circle of Excellence, and plausibly others by breed or discipline — recognising horses that reach a standard. Criteria as data rather than code: thresholds over wins, show tier, conformation score, health status, progeny record, age. Honours as permanent records that outlive the horse.

This is cheap once shows exist, and it is a large part of what makes a breeding programme feel like it is accumulating rather than just turning over. It also gives an ageing horse a last thing to be aiming at.

**Two forks worth deciding rather than inheriting.**

- **Standard or circle.** A registry with no capacity is a *standard*: anything meeting the bar is admitted, and admission is permanent. A registry with a capacity is a *circle*: only the best N hold places, and a new inductee displaces the weakest. Same machinery, one number's difference — and completely different to play. Standards accumulate and are kinder; circles stay genuinely prestigious but mean a child watches their horse pushed out by a sibling's. Worth thinking about before enabling, given who the players are.
- **Automatic or nominated.** Automatic evaluation after each show is the low-maintenance answer and what the criteria are for. A nominated mode, where a parent inducts a horse by hand, covers the honours that are about story rather than score — the first foal born in the game, the mare who founded a line. No threshold computes that.

**An honour should read on its own.** Who bred the horse, under which prefix, and what earned the place, all recorded on the entry — so it survives both a stable rename and the pruning that happens when a horse dies (§7a). A hall of fame whose members' achievements have been deleted is not a hall of fame, which is an argument for keeping a small permanent summary of every horse's show record regardless of what else is discarded.

---

## 10. NPC stables, show fields, and the market

*NPC-specific questions are deferred to a later session; this section stands as previously reasoned.*

### 10a. Why this is load-bearing rather than decorative

Three separate problems converge on the same solution.

- **Empty show classes.** With four to six players, a breed class might have two entries. Placings become meaningless when everyone places.
- **Gene pool collapse.** The more serious one. Every horse descends from founding stock within a handful of generations. COI climbs, defects surface, quantitative traits stop improving, and the game quietly stalls. At one game month per real day, the shelf life of a closed five-player pool is measured in real months.
- **No exit for surplus stock.** With only four other players, a market does not clear.

### 10b. Recommended structure — NPC stables as automated players

**An NPC stable is a bot player.** It owns horses with real genotypes, breeds them, ages them, trains them, enters shows, buys, and sells — all through the same code paths players use.

- NPC horses are generated by drawing a genotype from the breed's allele pool — including its disease alleles — and running it through the **same expression engine** as player horses. No parallel scoring path. Two scoring paths will drift apart and one will end up accidentally advantaged.
- NPC horses are stored entities with pedigrees, included in COI calculations, inspectable, purchasable, breedable, and testable.
- Writing an NPC stable is writing a *selection policy*, not a new subsystem.

**Alternative considered:** generate throwaway horses at scoring time from a deterministic seed, storing nothing. Cheaper, and it fills classes adequately — but such horses cannot be bought, bred, or remembered, so it solves only one of the three problems. Reasonable as an interim step; not recommended as the destination.

### 10c. Stable personalities

Give each NPC stable a weights vector describing what it selects for:

| Stable type | Selects for | What it supplies |
|---|---|---|
| Conformation specialist | Breed standard match | Expensive, competitive show stock |
| Discipline barn | One ability cluster | Performance prospects |
| Colour barn | Flashy pattern genes | Pattern genetics the players lack — and, plausibly, the disease alleles that ride with them |
| Bloodline preservationist | Rare/unrelated lines | Outcross material, high value |
| Health-focused barn | Tested-clear stock | Expensive, safe, genetically narrow |
| Volume breeder | Little selection at all | Cheap, mediocre stock and bargains |

Different barns produce visibly different horses, and recurring rivals become recognizable. Procedural naming (barn prefix plus a generated name) is cheap and adds a lot.

### 10d. The escalation risk — the main thing to get right

**If NPC stables breed with a selection policy and are not attention-limited, they will out-improve the players.** An NPC barn selecting optimally across many generations of real time will eventually produce horses no player can beat, and the game becomes unwinnable. This is the failure mode most likely to kill the project, and it is not obvious while you are building it.

**Recommended mitigation: make NPC improvement bounded and externally scheduled rather than emergent.** Define a ceiling parameter that rises on a fixed schedule and cap NPC stock against it.

Supporting measures worth combining:

- Imperfect selection — NPC choices carry noise, sentimental retentions, and occasional poor decisions
- Slower generation turnover than players achieve
- Tiered ceilings by show level (local / regional / national), so players self-select difficulty

Treat the ceiling and its rate of rise as parameters you expect to adjust repeatedly.

### 10e. Filling show fields

Pad each class to a target field size drawn from NPC stables whose horses are eligible and whose tier matches the show level. A class with one player entry gets six or seven NPC entries; a class with five gets two or three.

Parameters worth exposing: target field size, tier matching tolerance, and whether NPCs may take first place at all in the lowest tier.

### 10f. The market

**NPC stables must buy as well as sell.** Without NPC buyers, players can only sell to each other, and a five-person market does not clear.

- **Sale listings** priced from a formula over conformation score, tested genetics, health status, pedigree, show record, and age, plus a modest random spread
- **Buy offers** against stated preferences
- **Stud services.** NPC stallions standing at stud is a cheaper, more realistic, better-targeted outcross mechanism than outright sales, and it lets a player introduce new genetics without giving up a stall. Strongly recommended — and it is where a tested-clear NPC stallion becomes genuinely valuable.
- **A global price multiplier** adjustable in one place, because the first pricing model will be wrong

### 10g. Advancement while nobody is playing

If the family takes a two-week holiday at one game month per real day, they return to horses fourteen game *years* older. At this speed the question is not cosmetic.

**A global pause is the recommended answer, and it is nearly free — provided the world clock is designed for it early.**

Game logic should read a **world clock**, not the wall clock. Keep an accumulated elapsed value the tick advances only while unpaused, and derive everything — ageing, gestation, upkeep, condition onset, show schedules, NPC breeding — from that rather than from `Date.now()`. Pausing means the tick declines to advance the counter, and every timer stops for free. The deliberate time jump in §6b is the same lever pointed the other way.

Details worth settling:

- **Who can pause.** A pause button any child can press is a conflict generator. Parent-controlled is the obvious default.
- **Scope.** Recommended: pause everything, players and NPCs alike.
- **Automatic pause** after N days with no logins is a reasonable supplement, though one child checking in daily keeps the world running for everyone.
- **Partial or per-player pause** is probably not worth pursuing.

### 10h. Cost implications

A genuine scope increase — realistically it doubles the backend — but most of it is reuse.

- **The world tick gets substantially heavier.** Ageing every horse including NPC stock, advancing gestations, rolling condition onset, running breeding decisions, refreshing listings, scoring shows. At eight NPC stables of twenty-five horses each, the tick touches several hundred rows. This makes the paid Workers tier ($5/month, five minutes CPU) the realistic assumption, and it may be worth splitting the tick into staged jobs (age → health → breed → market → shows).
- **Idempotency matters more.** A re-fired tick could double-advance a barn. Recommended: a per-stable marker so a repeat run skips work already done.

**Both halves now built (2026-08-03), in `docs/slices/0015-npc-stables.md`.** Part A (the data and the selection engine) and Part B (wiring it into the tick, foal naming, and the show top-up) landed in two sessions the same day. Against each subsection above:

- **§10b** — confirmed as built: the selection engine (`src/engines/npc/selection.ts`) reuses the judge's own `scoreEntry`/`scoreAbilityEntry` rather than a second scoring formula, exactly per "no parallel scoring path," and the tick's `runNpcBreedingDecisions` (`src/db/npcBreeding.ts`) reuses a player's own booking eligibility (`availabilityForHorse`, `isInBreedingSeason`, the pregnancy/covering checks) rather than a second version of that rule either. An NPC-bred foal is a fully ordinary stored horse — pedigreed, testable, subject to the same disease loci and rolled lifespan as anything else — named at birth from its breeder's own prefix (`src/db/npc.ts`'s `resolveUniqueNpcFoalName`) since nobody will ever name it by hand.
- **§10c** — three of the six personalities, not all six: a conformation specialist (Cedar Hollow), a discipline barn (Willow Creek Barrels, targeting the one discipline that exists), and Fair Meadow repurposed as the volume breeder. The other three (colour barn, bloodline preservationist, health-focused barn) are deliberately deferred — each needs something the game doesn't have real use for yet (visible pattern genetics a player is chasing, an unrelated line worth a premium, a testing economy in active use). A pure-data addition to `npc_policy` once warranted (or a form submission at `/admin/npc`'s "Found a new NPC stable" control now that it exists), not a redesign.
- **§10d** — the ceiling is built as two columns (`npc_ceiling_schedule.conformation_ceiling`/`ability_ceiling`, not one `ceiling_value`), because the two personality kinds cap different quantities on different scales: a conformation trait's quality is closeness-to-target, an ability trait's is the expressed value itself. It clamps each trait's own quality score before the weighted average, using the scorer's own per-trait breakdown — not the aggregate, and not the raw expressed value (which would be wrong for a bidirectional trait, where "far from target" and "very high" are different things). Noise and retention bias are both built into the selection engine per-personality, and a population is bounded by `capacity` rather than by any culling mechanism (there is no NPC sale or stud service yet — an NPC stable simply stops proposing pairings once it's full). Editable from `/admin/npc` with no deploy, per this section's own closing line. **Not built:** tiered ceilings by show level — no tier exists in gameplay yet (`shows.tier` is schema, not something `createDueShows` uses), so this waits for tiered shows to be real.
- **§10e** — built: the show-field top-up (`judgeOneClass`) now draws from every `is_npc = 1` stable's stock, not Fair Meadow alone (`src/db/npc.ts`'s `listNpcStableHorses`). Tier matching still waits on real show tiers (unchanged from §10d's note).
- **§10f** — still explicitly out of scope, unchanged from this section's own note. NPC buying/selling/stud services wait for the Market stage. The one exception: `/admin/npc`'s "add an outcross batch" control mints founding-generator horses straight into any NPC stable by hand — the only way genetic material enters a stable's population from outside itself, since breeding stays same-stable-only and each NPC stable is therefore a closed line (a known, flagged limitation, not an oversight — see that slice's §3.3).
- **§10h** — realized so far: NPC stables are exempt from board (`chargeUpkeep` skips `is_npc = 1`), the same reasoning slice 0013 already applied to their care timers — there's nobody behind the wheel to respond to a bill. The tick is modestly heavier now (one new stage, bounded by three stables at launch), not yet at the "several hundred rows" scale this section anticipates at full size.

See `CLAUDE.md` §10's NPC stables row and the build log's 2026-08-03 entries for the concrete departures from this section's schema sketch.

---

## 11. Infrastructure and build practices

### 11a. Platform

**Cloudflare Workers with D1, static assets, and Cron Triggers in a single git-connected project.** This matches infrastructure already in use, so the deploy flow is familiar: push to the repo, Workers Builds deploys.

Cron Triggers give the scheduled world tick natively; the free tier comfortably covers this scale; static asset serving in the same Worker also hosts the §5b image library. Realistic cost at five players is zero, or $5/month if the tick outgrows the free tier.

**Not Pages.** Cron Triggers have never worked with Pages, and the world tick is the spine of this design. Cloudflare is directing new projects to Workers with static assets in any case.

1. **CPU ceiling.** Free tier allows 10ms CPU per invocation; paid allows 5 minutes. Ordinary page requests are nowhere near this. The world tick might be. Database waiting does not count toward CPU, only your own logic does — but plan on moving to the paid tier when the tick grows rather than contorting the design around 10ms.

2. **Cron triggers do not retry.** A scheduled invocation that throws or times out is skipped until the next fire, with no alert. **The recommended mitigation is architectural: make the tick idempotent and derive state from timestamps.** Write `energy = f(now − last_updated)` rather than `energy += 10`. A missed tick then self-heals and a double-fire changes nothing.

**Alternatives worth knowing you are declining:** a $5/month VPS with SQLite and a real crontab is a simpler mental model with full control, at the cost of maintaining a Linux box. Supabase provides Postgres, real authentication, and pg_cron if hand-rolling accounts turns out to be unwelcome.

**On authentication:** for five family members, pre-created accounts with a password each is likely sufficient. Choosing a stable (§1a) is a selection inside an already-authenticated session, not a second login. The parent's PIN behind grants (§1b) is the exception that needs treating seriously — verified server-side, never sent to the client, rate-limited and logged. It is also the one place in the design where a decision is measured against the real clock rather than the world clock: a lockout window has to be counted in the minutes a person is standing there guessing, and a pause must not suspend it.

### 11b. Building across many sessions

The codebase will be written by a series of separate sessions with no memory of each other. Three practices follow, all cheap now and expensive to impose later.

**Seeded randomness everywhere.** Every random draw — foal genotype, environmental noise, condition onset rolls, show noise, NPC selection error, procedural markings — should run through a seeded generator. Two reasons. First, genetics can then be tested: a session can assert that a carrier × carrier cross produces the expected quarter affected rather than eyeballing foals, which matters considerably more now that some of those outcomes are lethal. Second, anything that comes out wrong is reproducible, and a genetics bug you cannot reproduce is one you debug by anecdote.

**Pure engines, thin database layer.** The genetics engines, the health model, the show scorer, and the NPC selection policy are best written as functions that take data and return data, with no database access inside them. A session can then hold one entirely in view and change it without understanding the schema.

**A build record separate from this document.** Conventions, the seeded-RNG rule, module boundaries, and where things live belong in a file at the repo root that Claude Code reads on every session. This document is the design record; that file is the build record.

Migrations want a settled convention from the first table. The convention itself is a spec-session question.

---

## 12. Administration and configuration

A master settings layer, unattached to any player profile, holding global tunables and feature toggles.

Recommended to build early — not because it is interesting, but because nearly every number in this document is one you will get wrong initially and correct by observation. Time scale, carrier frequencies, test pricing, care and tack modifier bands, service prices, NPC escalation rate, market prices, upkeep, action budgets, show noise: all flagged above as things to tune against real play. If they live as constants in code, every adjustment is a session and a deploy, and you will make fewer of them than you should.

### 12.1 Two kinds of setting, behaving very differently

**Live tunables** affect future computation only and are safe to change at any moment: prices, upkeep, action budget, care and tack bands, NPC quality ceiling, show noise, training rates, stud and service fees.

**Structural settings have retroactive hazards.** Gestation length is the clearest case: if a mare is partway through and the setting changes, recomputing moves her position arbitrarily — potentially triggering an immediate foaling, or one that should have happened last week. The time scale itself is the largest member of this category. Carrier frequencies are another, since changing them cannot retroactively alter horses already born.

**Recommended handling: global config supplies defaults at creation time, and entities carry their own copy.** Store gestation length on the pregnancy record rather than reading config at every tick. The same applies to anything with a duration — training programmes, breeding cooldowns, listing expiry, tack wear rates, condition progression. Changes then affect new entities only.

**Alternative:** recompute everything live and accept the discontinuities, on the grounds that a confused pregnancy is a shrug rather than a crisis. Simpler, and defensible — but the snapshot approach costs one column and removes a category of confusing bug.

### 12.2 Feature toggles

Worth anticipating: imports open/closed, NPC market active, world paused, mortality enabled, player-to-player trading enabled, specific show tiers, recognised crosses, professions enabled, individual registries enabled, individual token products enabled, and individual conditions enabled or disabled.

Per-condition toggles are worth the small cost. If a particular disease turns out to be too grim or too frequent in practice, switching it off is preferable to a code change — and it lets the lethal set be tuned by observation rather than argued about in advance.

Worth distinguishing toggles that are cleanly reversible from those that leave residue. Anything changing eligibility rules after affected horses exist needs a decided answer for existing stock rather than just a boolean.

### 12.3 Imports as the genetic diversity valve

Fresh, unrelated horses entering the game supplement the NPC market as the control on gene pool collapse (§10a). It is the direct lever if COI climbs across the whole game, and at the chosen time scale it will be reached for sooner than it otherwise would.

**Imports are never bought with game currency.** They are the anchor of the household layer (§1b) — the thing actually worth earning — which keeps money from being the route to new blood, since NPC stud services (§10f) already cover that more cheaply and more realistically.

**What they cost changes as the household layer grows.** The founding batches, and the further batches a parent grants for chores, are free and gated only by the PIN. Token-priced imports arrive with the token catalogue, over the same generator and the same batch-and-claim screens, as a product row with a price on it.

Recommended shape:

- **A rolled batch rather than a blind draw or a standing pool.** A blind draw gives the player nothing to think about. A shared pool means the fastest child takes the best horse every time, which at five players is a race rather than a decision. A private batch of candidates gives a real choice — the flashy chestnut against the plainer mare with the better shoulder — and the ones not taken simply expire.
- **The player picks the breed, and the pick is final.** The batch is rolled from the pool of whichever breed they choose, which is what makes eight seeded pools worth having and is the decision a nine-year-old will care about most. Committing it before the candidates are visible is what stops the choice being a free reroll against the same seed.
- **Imports arrive untested.** This is what stops them undercutting §2c. A horse arriving with a clean panel would let tokens buy certainty, which is the one thing the hidden-information mechanic exists to withhold. Untested means the token buys *access to alleles you do not have*, and finding out what you actually got still runs through the vet, the testing economy and the same decision every other horse presents. An import that turns out to be a carrier is both true to life and considerably more interesting than a guaranteed prize.
- **A quality band as one parameter, snapshotted onto the batch when it is minted.** Founding batches sit at **mid** — founding stock is the baseline everything afterwards is measured against, and a baseline below average is a moving target nobody can see. Later token-bought imports sit **low-to-mid**, and that is worth defending: by then player-bred stock has selected past the mid band, so an import is a source of alleles you do not have rather than a shortcut past the work. Imports that outclass bred stock make breeding pointless and turn tokens into the real progression system. The bands should overlap heavily in any case, so an unpromising import is still worth a gamble.
- **One generator for founding stock and imports alike.** An unrelated horse of moderate quality drawn from a breed's allele pool is the same problem in both cases. A quality band parameter and a marker for where the horse came from is the whole of the difference, and it means the founding population is built by the machinery that will still be in use a year later.

Whether imports stay always-on with tokens as the only limiter, or are gated to announced windows, can be settled by observation — a toggle covers both, and tokens already rate-limit them per player without any further mechanism. Before tokens exist the limiter is the parent: a batch arrives only when someone types the PIN.

### 12.4 Practical shape

- **Storage:** a single-row config table in D1, read by the tick and by request handlers. Cache with a version counter so changes propagate without a redeploy.
- **Access:** an admin flag on your existing account.
- **Audit trail:** an append-only log of who changed what and when. Cheap, and useful both for correlating tuning changes to outcomes and for answering "why did feed suddenly cost more."
- **Separate the destructive controls.** Regenerating NPC stock or resetting the economy should sit apart from routine tunables, ideally with a preview of how many rows they would touch.
- **Resist building a polished admin UI.** A form over the config table, or a JSON blob you edit, is sufficient.

---

## 13. Suggested build order

The common failure is building forty conformation traits and never shipping a show. Ordering is soft; the groupings are suggestions for what sits naturally in one working session.

**Foundation** — repo, deploy pipeline, config table, seeded RNG, build-record conventions, accounts and stables with the picker and the prefix scheme.

**Genetics core** — genotype and inheritance; structured phenotype output; text description. Two horses, one breeding, a foal described in words.

**Founding stock generator** — an unrelated horse of a given quality band drawn from a breed's allele pool, arriving as a private batch the player claims from. Three things land together here, because they are one screen: the generator, **all eight breeds' founding allele pools** (colour and gait only — §4a), and **the parent's PIN**, gating a grant of a further batch as a chore reward. The same generator serves imports later, so it is worth writing once and parameterising now. This is the point at which the game becomes playable by the people it is for.

**Image slot** — library hosting and the picker (§5b). Specified in `docs/slices/0007-image-slot.md`. Matched on breed only, per the decision recorded there; the library is a numbered set per breed and its size is a column on the breed row, so it grows by upload rather than by code change. That slice declines one recommendation in §5b — the arbitrary-URL field alongside the picker — on the grounds that an external URL rots, is unmoderated content in a children's game, and is unpleasant to type on a phone; `horses.image_source` keeps it additive.

**One polygenic trait end to end** — potential, expression, display. Specified in `docs/slices/0006-conformation.md`, which corrects one thing in §2b: conformation traits are bidirectional measurements rather than ceilings, so realization moves a horse away from the population middle towards its own genetic value in either direction. §2b's `potential × realization` framing stays correct for the ability traits.

**One show class that scores it** — the Quarter Horse's ideal vector, and the class that judges against it. A playable loop exists here. Worth stopping to actually play it. Specified in `docs/slices/0008-one-show-class.md`, which settles the show cadence question in §14 (monthly) and takes three further decisions in its §2: an NPC stable of real stored horses fills thin fields rather than throwaway opponents generated at scoring time, the first shows hand out ribbons and no money, and the rotating judges of §9 arrive with the first class rather than later — they are a seed migration, not machinery, and without them one child's best horse takes every ribbon until the NPC stages land.

**Turns, world tick, upkeep** — with the world clock (§10g) rather than wall-clock calls, the tick slots in local time, and the time scale as config from the first line.

**Tokens** — the account balance, the token ledger and the product catalogue, over the PIN and the batch generator already built, with imports as the catalogue's first entry. This stage adds saving-up and spending to a household layer that already works; nothing here is a prerequisite for the reward loop. **Deferred past health on 2 Aug 2026, in conversation** — the sentence above is why it could be: nothing depends on it, so it can be picked up whenever there is an appetite for it.

**Health, first pass** — the Quarter Horse's Mendelian conditions, plus genotype testing. Worth doing early rather than late: it is the mechanic that makes §2c matter, and it touches the market, the vet profession and COI, so later systems are better built with it already present. The other breeds' panels come with their stage below. Specified in `docs/slices/0010-health-first-pass.md`, which takes four decisions in its §2 — the panel is the real Quarter Horse one minus malignant hyperthermia, affected status is visible without a test while carrier status never is, an affected horse may always be bred, and the two questions §3b left open are answered there.

**Remaining colour loci**, one gene at a time, with the colour-linked conditions attached as each gene lands rather than as a separate pass. Each gene also lands in all eight founding allele pools in the same change — a pool that does not list a locus is an error rather than a default — and each is a step towards the breeds in §4a looking like themselves, since blue roan, dun, silver and the pinto patterns are what several of them are actually known for.

**Care state** — the modifier and the farrier/vet call as a client action against NPC providers. Built (Part A only) in `docs/slices/0013-care-and-condition.md`. **Split from tack on 2 Aug 2026, in conversation**, and tack moved down the list past the market — see the tack bullet below for why. That document takes seven decisions in its §2; the two that change what §8a says are that care never touches a horse's *displayed* conformation numbers (a neck does not get longer because the farrier came — care multiplies the score a judge arrives at, and shows as its own line in the result), and that a care call costs money but **no turn**, with a one-click barn round, because a horse's welfare must not hinge on a seven-year-old remembering a chore. **Part B — keeping slice 0010's promise that manageable conditions get something to actually do about them — was not built**, per that document's own §12 scope-cut when the session ran long; a future session still owes it.

**Ageing, death, and removal** (§7a) — early enough that the first losses happen under rules that were designed rather than discovered. Built in `docs/slices/0011-ageing-death-and-removal.md`, which settles §14's "does death arrive announced?" (it does) and takes three further decisions in its §2. That document departs from `docs/horse-game-schema.md` §4.2 on two points, with reasons in its §5.5: `image_url` is kept on death, and `show_entries` are **not** pruned, because deleting a dead horse's entries would retroactively falsify every show it ever competed in. **Taken ahead of care and tack**, at the operator's direction on 2 Aug 2026 — the two are independent, and the tuning that ageing needs is a longer feedback loop than tack's.

**NPC stables as stored entities** — first as static show-field filler, without breeding.

**NPC breeding, ageing, and the ceiling parameter.** Where the escalation tuning in §10d gets its first real test.

**Market** — NPC sale listings, buy offers, stud services, player-to-player trading. (Player-to-player trading is built as of 3 Aug 2026; the other three are specified in `docs/slices/0017-market.md` §11-§13 and not built. The minimum listing duration this line used to promise was considered and declined — see §1a.)

**Tack** (§8b) — tiers, wear, repair or replace, and discipline specificity. **Separated from care and moved here on 2 Aug 2026**, for three reasons: discipline specificity is most of tack's design and needs more than one discipline seeded to be exercised at all; every price and wear rate in it is set against a market that does not exist until the stage above; and §8b's pay-to-win risk is worth taking deliberately, after the money in this game has been watched for a while, rather than on the same afternoon as the farrier. Care and tack share nothing structurally — they are two independent multipliers on one score line, and both scorers already take them as two separate parameters — so the split costs nothing.

**Registries** — criteria as data, inductions evaluated on the tick after each show.

**Professions** — player providers, pricing, inventory, effectiveness, competing against the NPC providers already in place.

**The other seven breeds** — the non-colour half of breed identity, folded in as one stage: ideal vectors, eligible class types and discipline aptitudes, height and weight ranges, and each breed's disease panel. The allele pools already exist from the founding stock generator, and every system these rows feed — the scorer, the health model, the show classes — already exists and has been tuned against the Quarter Horse. Largely data entry against machinery in place, which is exactly why it waits until the machinery is in place.

**Performance classes and the cross's niche** — the classes crosses are eligible for (§4c), and the eligibility rules that bar them from breed classes. Crosses themselves are producible from the moment eight pools exist; this is the stage that gives them somewhere to compete.

**Polygenic predispositions**, screening, and the wider health panel.

**Generated art, recognised crosses, trait reference icons** — the long tail.

### Two pieces sit outside this sequence

Both are fully specified, neither is built, and neither blocks or is blocked by anything in the list above. They can land whenever there is an appetite for them.

- **Cooled and frozen semen** (`docs/slices/0004-semen-storage.md`) — depends only on the breeding slice, which is built. It is the answer to the stallion fertility decline that already exists in the game.
- **The parent's PIN** (`docs/slices/0005-founding-stock.md` §7) — separated out when the founding stock slice was built. The chore-reward loop works today via an admin login; the PIN is what moves it onto the child's own phone.

### How the numbering works, because it is not the build order

**Slice document numbers record when a document was written, not when it is built.** Slice 0005 was built before slice 0004 was started, and the image slot is specified after slice 0006 but built before it. A number is an identifier; this section is the order.

**Migration numbers are claimed at build time, not when a slice is written.** A slice document proposing `0026`–`0029` is stating how many migrations it expects, not reserving those numbers — whichever slice is built first takes them. `CLAUDE.md` §9 already says to check `migrations/` for what actually exists rather than trusting a document, and this is the main reason it says so.

---

## 14. Open questions

- **How many conditions, and how frequent?** Twenty-ish is the suggested starting scope (§3f), with carrier frequencies low. Both are observation-tuned rather than reasoned out in advance.
- **Test pricing**, which decides whether hidden information stays hidden (§3c). **Starting figures set 2 Aug 2026, in `docs/slices/0010-health-first-pass.md` §5.4:** 250 for a single condition, 700 for the four-condition panel, both live tunables (`genotype_test_cost`/`genotype_panel_cost`). Reasoned against a founding stable's starting economy (10,000 balance, 3 horses at 60/tick upkeep, a show win paying 600) so a full panel costs roughly one win and panelling all three founding horses (2,100) is a real decision that does not end the stable. The question stays open in the sense that matters — these are a starting point to watch and retune via `/admin/health`'s counts, not a settled answer.
- **Frame lethal and the other lethal recessives** — implemented and explained; the wording of those notifications is worth drafting before one fires.
- ~~**Does death arrive announced?** Visible decline lets a child plan a last season; an unannounced end is more abrupt and arguably truer.~~ **Decided 2 Aug 2026, in conversation, while specifying `docs/slices/0011-ageing-death-and-removal.md`:** announced, with a visible late phase. Past a threshold on its own remaining life a horse reads as **Failing** on its page, in the barn list and — the part that matters — **in the events feed**, for roughly a game year and a half before it dies, so a child can plan a last season and retire deliberately rather than finding the horse gone. §7a asks for exactly this shape and calls it kinder and closer to true. The argument that settled it: **the GBED foal is already the unannounced case**, deliberately so (slice 0010 §2.2), and if ordinary old age were also silent then silence would be the game's only mode of loss and the foal's silence would stop meaning anything. The failing state is visible and carries **no mechanical penalty** — a last season is only a real choice if the horse can still win it. Three further ageing decisions were taken at the same time and are recorded in that slice's §2 rather than here: lifespan is mildly compressed (risk from ~18, few past 27, rolled once at birth and snapshotted rather than rolled as a hazard every tick), voluntary removal ships alongside death as a free, one-way **retire away** costing no turn and no money, and NPC show-barn horses age and die on the same code path as player horses, with the barn's headcount surfaced on `/admin/shows` so thinning show fields are visible rather than mysterious.
- **Does hired training route around the action budget** acceptably, or should trainers wait (§8c)?
- **Effectiveness by purchase or by experience**, and can a player hold more than one profession?
- **Which professions beyond vet, farrier and trainer?** Tack merchant, transport, show handler and feed supplier are all plausible; none is necessary.
- **Player-to-player trading is in.** Remaining question is whether trades need parental visibility, and what happens when a child gives away a horse they come to regret giving away.
- ~~**Disclosure on listings** — whether a seller's test results are shown, hidden, or optionally attached. More a family-dynamics decision than a technical one (§2c).~~ **Decided 3 Aug 2026, in conversation, while specifying `docs/slices/0017-market.md`:** always disclosed. A seller cannot hide a test result they hold. Crucially, this means *what the seller has learned* (`horse_knowledge`), never what is true (`horse_conditions`, `horses.genotype`) — an untested condition shows as **not tested** and its real status stays invisible to everyone, seller included. Untested stock therefore remains a genuine gamble and the testing economy stays intact. The listing renders one row per condition the game tests for, so "not tested" is displayed as loudly as a result rather than reading as clear by omission. `listings.disclosed_knowledge` is consequently not built.
- **Is profession per account or per stable?** The one place multi-stable ownership collides with an existing rule (§8c).
- **How many stables may one account hold?** (§1a) The second half of this question — does a minimum listing duration adequately keep same-owner sales honest — was **decided 3 Aug 2026, in conversation, while specifying `docs/slices/0017-market.md`: there is no minimum listing duration.** Listings are buyable the moment they are posted, by anyone, including the seller's own other stable. The other half of §1a's recommendation is built instead and is not optional: every sale writes `ledger.counterparty_stable_id`, and `ledger.same_account` is set when buyer and seller share an account. The leak is made visible and queryable rather than prevented, and completed sales are public to every player, which is what a sibling could otherwise only have noticed by watching the market in real time. If the pattern turns up in the ledger, the duration rule comes back as one config key and one check.
- **What else tokens buy**, and how much of that catalogue falls under *advantage* rather than access (§1b).
- ~~**Do the per-tick action allowance and the tick schedule hold the daily total constant**, or is the daily total meant to rise with more ticks (§6a)?~~ **Decided 2 Aug 2026, in conversation, while specifying `docs/slices/0009-turns-upkeep-and-the-ledger.md`:** neither, automatically. `actions_per_tick` and `world.tick_times_local` stay two independent numbers, exactly as §6a asks, so changing the tick schedule is a deliberate change to how much play a day contains rather than a silent one. The starting figures are 6 turns per tick against three slots — 18 a real day. Only big commitments spend a turn (booking a covering, entering a show, claiming a founding batch); browsing, renaming and reading are always free, and genotype testing, buying, selling and training join the list as those slices land.
- **Standards or circles** for the registries, and whether displacement between siblings is acceptable (§9a).
- ~~**Can a stable's prefix change** once horses have been bred under it (§5d)?~~ **Decided 2 Aug 2026, in slice 0001:** free to change until the stable breeds its first horse, permanent afterwards. Retired prefixes are never reissued to anyone.
- ~~**Are library images matched to phenotype**, freely chosen, or matched by default with an override?~~ **Decided 2 Aug 2026, in conversation:** matched on breed and nothing else, with free choice within a breed's set. Colour matching is not attempted, because the colour space is combinatorial once the remaining loci land and the library would quietly stop being able to keep the promise. See §5b.
- ~~**Recognised crosses** — which pairings, and do they get full breed treatment?~~ **Partly decided 2 Aug 2026, in conversation:** the Paint case — the one that forced the question — is resolved by making Paint a display alias on Quarter Horse rather than a breed (§4, §4c), so no recognised-cross machinery is needed and none is built. Still open for a genuine two-pool cross such as Quarab, if one is ever wanted.
- ~~**Show cadence**, set against the time scale and action budget together.~~ **Decided 2 Aug 2026, in slice 0008:** monthly — every 30 game days, which at the current settings (10 game days per tick, three tick slots a day) is one show per real day, exactly as §9 reasons. The interval is config (`show_interval_game_days`) and shows are scheduled in game days rather than ticks. Three further show decisions were taken at the same time and are recorded in `docs/slices/0008-one-show-class.md` §2 rather than here: one NPC stable of real stored horses fills thin fields, the first shows carry **no money at all** (ribbons only — entry fees and prize money wait for the market stage, which departs from the schema document's `entry_fee`/`prize_awarded` columns), and three rotating judges weight the breed standard differently from the first show onwards. **The ribbons-only half of that was reversed 2 Aug 2026**, in conversation, while specifying `docs/slices/0009-turns-upkeep-and-the-ledger.md`: shows pay **prize money** to the top six placings from the slice that builds the ledger, because upkeep lands in the same slice and a drain with no faucet is not a game. **Entry fees are still not built**, and deliberately so — a fee combined with that slice's rule that debt blocks breeding could lock a broke stable out of the only thing that earns.
- ~~**Does the founding population arrive as stock players already own**, or as something they choose from and buy into?~~ **Decided 2 Aug 2026, in slice 0005:** a private rolled batch per stable, free, from which the child claims a fixed number — two mares and one stallion out of six candidates — after choosing their breed from the eight. Not a blind draw, which gives the player nothing to think about, and not a shared pool, which at five players is a race the fastest child wins every time. Further batches are granted by the parent behind the PIN (§1b).
- **Per-horse time advancement** — wanted at all, and if so as training acceleration rather than ageing?
- **All NPC questions** (§10): how many stables, how far they may outclass players, whether they refuse to sell their best stock. Deferred.
