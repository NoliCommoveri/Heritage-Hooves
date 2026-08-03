# Slice 0016 — Screens that scale, a world you can look at, and a lock on the admin door

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts of them this
slice depends on are quoted or summarised below.**

This slice is not a new mechanic. Every item in it is a screen that worked fine with two horses and
one show class, and stops working when there are thirty horses and six classes — plus three admin
capabilities that were left out because nothing forced the issue yet.

Eight things, asked for by the operator on **3 Aug 2026, in conversation**:

| | The ask | What it really is |
|---|---|---|
| 1 | Split the horses page on toggled filters: stud / mare / foal | The barn list is one unbroken column. It was fine at four horses. |
| 2 | Show placings should link the horse and name the player's stable | A placing today is a bare name with no way to find out whose it is. |
| 3 | Split shows by discipline on a toggle instead of a giant running list | Every show already carries every class; five more disciplines and seven more breeds make it unreadable. |
| 4 | Search shows by breed | The other half of the same problem. |
| 5 | An active stables view, players and NPC, so we can see each other's horses and money | **The largest item.** Today no player can see anything another player owns. |
| 6 | Modify or delete users | `/admin/accounts` can create, reset a password, and deactivate. Nothing else. |
| 7 | Admin pin gate | The Admin chip in the header is one tap away on an unlocked phone. |
| 8 | Show results shouldn't be visible where no player entries | The circuit currently publishes a wall of results the children had nothing to do with. |

Items 2 and 5 are the same piece of work in two places, and 3, 4 and 8 are three filters over one
query. That is the shape of the build order in §11.

---

## 1. What "done" looks like

- The barn page has **tabs** — All, Mares, Stallions, Foals — and lands on All. Every other control
  on that page (feed, the three care rounds) still works and comes back to the tab you were on.
- `/shows` has **tabs by class type** (All, Conformation, then one per enabled discipline) and, when
  more than one breed has classes, a **breed picker**. A judged class **nobody's horse entered
  simply isn't listed** — not hidden behind a flag, not greyed out; it does not appear.
- A placing names the horse as a **link** and names the **stable that entered it**, with the owner's
  name beside it. Clicking through works whether or not the horse is yours.
- There is a **`/world` section**: every active stable (players and NPC), what each one is worth,
  how many horses it keeps, and a read-only page per horse. What a stranger sees is **name, breed,
  colour, age, sex, picture, pedigree, show record** — and never a conformation number, a health
  result, a genotype or a care state.
- `/admin/accounts` can **rename an account, change its username, grant or remove admin, deactivate,
  and delete an account that owns nothing.** An account that owns something says so, by name, and
  offers deactivate instead.
- **Reaching any admin page needs a 4-digit PIN**, held for half an hour, rate-limited globally, with
  every attempt logged. An admin who has not set one yet is nagged, not locked out.

Explicitly **not** in scope: tokens, the market, NPC stables (slice 0015), tack, training, any
change to how a horse is judged, bred, aged or scored. **No formula in this slice moves.** That is
worth stating plainly, because §5 and §8 both change what is *displayed* about a judged class and
neither changes the judging.

---

## 2. Decisions taken for this slice

The three below were put to the operator on **3 Aug 2026** with the alternatives spelled out. They
are settled — read the reasoning, because smaller choices follow from each.

### 2.1 The PIN gates `/admin`. It is not slice 0005 §7's parent PIN.

Offered: a PIN in front of `/admin`; slice 0005 §7's grant PIN (a grown-up authorises a founding
batch from inside a child's own session); or both over one PIN store. The operator chose **the
`/admin` gate**.

So this slice builds `accounts.pin_hash`, `pin_attempts`, the pure lockout function and the config
tunables **exactly as slice 0005 §7.3/§7.4 specifies them**, and spends them on the admin door only.
When slice 0005 §7 is eventually built, it inherits all four and adds its own route. Do not invent a
second PIN scheme, a second attempt log, or a second lockout rule — §7.3's "no second hashing
scheme" argument applies with more force now that there are two consumers in prospect.

**Write the boundary into the code as a comment where the cookie is issued.** Slice 0005 §7.2 warns
against a later session reusing "PIN verified" as a general escalation. The same warning applies in
the mirror image here: unlocking the admin door proves *this admin is present*, and it must never
become a way for a non-admin session to become one. The `is_admin` check stays where it is and runs
first; the PIN is a second gate behind it, never a replacement for it.

### 2.2 Another player's horse shows what a stranger at a show could see, and nothing measured

Offered: roster and money only; a roster plus a read-only public horse page; or the full owner view.
The operator chose **the roster plus a public horse page**.

The line, in one sentence a future session can apply to a field it is unsure about: **if you could
learn it by standing at the rail watching the class, it is public; if it took money, a test or a
tape measure, it is the owner's.**

Public: registered name, barn name, breed, colour and markings in words, sex, age, picture, breeder
prefix, sire and dam (as links), show record and recent placings, whether the horse is alive, dead
or retired away, and whether it is out at pasture.

Owner-only, unchanged: conformation measurements, health knowledge and test results, genotype, COI,
care and management state, the itemised ledger.

Two edges of that line that are decided, not open:

- **A stable's balance is public; its ledger is not.** The operator asked to see each other's money,
  and a balance is one number that makes the world legible. The ledger is a list of every decision
  somebody made, and reading it is a different thing entirely. `/stables/:id/money` stays owner-only
  with no admin exception, exactly as it is today.
- **COI is owner-only even though pedigree is public.** A determined player could compute it from
  the pedigree, which is why this is a judgement call rather than a rule — but "measured numbers are
  the owner's" is a line a child can understand, and putting one measured number on the public page
  because it happens to be derivable makes it a line nobody can state.

### 2.3 Deleting an account that owns anything is refused, not cascaded

Offered: refuse and offer edit + deactivate; delete and hand the stables to somebody else; or delete
everything it owns. The operator chose **refuse**.

So: **delete is only ever available for an account with no stables and no founding grants to its
name** — in practice, one created with a typo and never used. Everything else gets rename and
deactivate, which is what `active = 0` already means and already does.

The reasoning worth keeping: a stable's horses appear in judged shows, in other horses' pedigrees,
and in the `ledger` and `events` tables that `CLAUDE.md` §7 declares append-only. Deleting an
account is the one action in this game that could retroactively falsify a show result — the same
argument slice 0011 §5.5 used when it refused to prune `show_entries`. Deactivation costs nothing
and loses nothing.

---

## 3. Not built here

- **No JavaScript.** There is none in this codebase and this slice does not introduce any. Every
  "toggle" in the operator's list is a **link with a query parameter**, and every "search" is a
  `<form method="get">` with a select and a button. Say this out loud in the render code, because
  "toggle" and "tab" both sound like they need script and neither does.
- **No pagination anywhere.** Five accounts, a few dozen horses, a show a month. Filters are the
  right tool at this size; pagination is not, and adding it now buys a screen nobody will hit.
- **No search box.** Item 4 is "search shows by breed", and a select of the breeds that actually have
  classes is a better answer than a text field that can be typed wrong.
- **No public ledger, no public conformation, no public health.** See §2.2.
- **No account self-service.** An account still cannot rename itself; §9 is an admin screen. The
  existing `/account/password` is the only thing a player changes about themselves.
- **No second admin role.** `is_admin` stays a single flag.
- **No rate limit on login.** The PIN gets one (§10.4) because slice 0005 §7.4 argues for one and
  the threat is real and local. Login does not have one today; this slice does not add one, and does
  not pretend the PIN protects against somebody who knows the password (§10.7).

---

## 4. Part A — the barn's filters

### 4.1 The tabs

`/stables/:id/horses?show=` — `all` (default), `mares`, `stallions`, `foals`, and `geldings` **only
when the stable actually has one**. There is no gelding path in the game today; rendering an empty
tab would be a promise nobody keeps.

Each tab carries its own count: `Mares (7)`. Counts come from the full list already loaded, not from
a second query.

An unrecognised `show` value reads as `all`. No error, no 404 — a filter is not an assertion.

### 4.2 What a foal is, and why the buckets don't overlap

New live tunable **`foal_max_age_game_days`**, default `360` (one game year — real foals are
weanlings and yearlings long before they are broodmares).

A horse younger than that is **in Foals and only in Foals** — a colt of six months does not also
appear under Stallions. This is the choice a child expects: "my mares" means the mares they breed,
not every female animal in the barn. Put the classification in a pure function so the rule lives in
one place and can be tested without a database:

```ts
// src/lib/barnFilter.ts
export type BarnBucket = 'foals' | 'mares' | 'stallions' | 'geldings';
export function bucketFor(horse: { sex; born_game_day }, gameDay: number, foalMaxAgeGameDays: number): BarnBucket;
```

`foal_max_age_game_days` is a **display tunable only**. Nothing in breeding, showing, care or ageing
may read it — those all have their own age thresholds already (`show_conformation_min_age_game_days`,
`care_start_age_game_days`, the fertility curve), and quietly reusing this one would couple a
cosmetic setting to a mechanic. Write that in the migration comment.

### 4.3 Ended horses

`listStableHorsesWithDead` still supplies the rows, and a died/retired-away horse still shows for
`barn_shows_ended_game_days` with its existing badge. It falls into whichever bucket its sex and age
put it in. `/stables/:id/past` is unchanged and still linked from the bottom of the page.

### 4.4 The detail that will be missed: the filter has to survive a care round

The feed form and the three round buttons POST to `/stables/:id/care` and `/stables/:id/feed`, which
redirect back to `/stables/:id/horses?care_notice=…`. As written, using any of them throws you back
to All.

Add a hidden `show` input to each of those four forms, and have both routes carry it onto the
redirect. It is two lines per form and it is the difference between the tabs feeling built and
feeling half-built.

### 4.5 Where the filtering happens

In `stableHorsesRoute`, **immediately after the list query and before the per-horse mapping.** That
mapping does a `getShowSummary` query per horse; filtering after it would do thirty queries to
display four rows. Counts for the tab labels come off the unfiltered array first.

---

## 5. Part B — the shows screen: class-type tabs, breed search, and NPC-only results

### 5.1 Three filters, one query

`/shows` gains three query parameters, all optional:

- `class=all|conformation|<discipline_code>` — the tabs. Built from `getEnabledDisciplines()` plus a
  Conformation tab plus All, so the five unbuilt disciplines appear the day they are seeded with no
  code change (slice 0012 §5.1's promise).
- `breed=<id>` — a `<select>` of breeds with a non-null `ideal_vector`, i.e. the breeds that actually
  get classes. **Rendered only when there are two or more.** Today that is the Quarter Horse alone,
  so today the control does not appear at all; it appears by itself when the other seven breeds land.
- Breed and discipline are mutually exclusive by construction: a discipline class has no `breed_id`,
  so when a discipline tab is active the breed picker is not rendered and `breed` is ignored.

The picker is `<form method="get" action="/shows">` with a hidden `class` and a Show button. No
script, no auto-submit.

### 5.2 Filtering happens on classes, and a show with nothing left drops out

The filter selects **classes**, not shows. A show whose classes all fail the filter is not listed at
all — an empty show card is noise.

Do this in SQL rather than by loading everything and filtering in TypeScript. One query for the
recent-judged list, shaped as "shows having at least one class matching every active condition":

```sql
SELECT s.* FROM shows s
WHERE s.status = 'judged'
  AND EXISTS (
    SELECT 1 FROM show_classes sc
    WHERE sc.show_id = s.id
      AND (? IS NULL OR sc.class_type = ?)          -- class-type filter
      AND (? IS NULL OR sc.discipline_code = ?)     -- discipline filter
      AND (? IS NULL OR sc.breed_id = ?)            -- breed filter
      AND EXISTS (SELECT 1 FROM show_entries se     -- §5.3, always on
                  WHERE se.class_id = sc.id AND se.is_npc = 0)
  )
ORDER BY s.scheduled_game_day DESC LIMIT ?
```

then the same conditions applied when listing that show's classes, so the two can't disagree. Put
the condition set in **one exported helper in `src/db/shows.ts`** that both the show list and the
per-show class list call — the failure mode to design out is a show appearing in the list and then
showing a different set of classes when opened.

### 5.3 Item 8: a judged class nobody entered does not publish results

The last `EXISTS` above is item 8, and it is deliberately not optional or configurable.

**The rule:** a **judged** class with no player entry (`show_entries.is_npc = 0`) is not displayed —
not on `/shows`, not on `/shows/:id`, and its entries' "Why?" pages return 404. A **scheduled**
class is always displayed regardless, because that is the form a player uses to enter it. The
distinction is the whole rule: hide results nobody was part of, never hide an opportunity.

Three things this does **not** change, and each is load-bearing:

- **Judging is untouched.** The class is still created, still judged, NPC horses still place and
  still receive prize money. `CLAUDE.md` §13 forbids a parallel path for NPC horses, and skipping
  judging for an NPC-only class would be exactly that — the show barn's horses would stop
  accumulating a record and their `horse_show_summary` rows would diverge from every other horse's.
  This is a display filter and lives only in the read path.
- **`/admin/shows` still shows everything.** The operator needs the truth, including the classes
  players ignored — that is the signal that a class is badly scheduled or a breed has no players.
- **A horse's own Show record card is unaffected.** It is that horse's history, shown to somebody
  entitled to see it.

Also fix the same thing on the entry-result route: `showEntryResultRoute` currently lets anybody
read an NPC entry's breakdown. Gate it on the class having a player entry, using the same helper.

### 5.4 Why this is worth doing beyond the ask

With one seeded breed and one seeded discipline, the show barn enters every class every month and
the children enter some of them. `/shows` therefore reads as a league the NPCs are running and the
players occasionally visit. Filtering out the classes they had no part in makes the circuit read as
theirs — and it is the cheapest countermeasure available to the escalation risk `CLAUDE.md` closes
on, because it removes the wall of NPC results a child would otherwise measure themselves against
every month.

---

## 6. Part C — `/world`: everyone's stables, and a public page per horse

This is the biggest part and the one with the most ways to leak something. Build it in the shape
described here rather than by relaxing the checks on the pages that already exist.

### 6.1 Why a new section instead of opening up `/stables/:id`

Every stable-scoped and horse-scoped route today begins with `loadOwnedStable` or
`horsePageRoute`'s owner check, and that uniformity is exactly why nothing has leaked. Relaxing
those checks means every one of them becomes a page with two modes, and each new field added to one
of those pages is a decision somebody has to get right.

Instead: **a separate section whose pages have never seen an owner's data.** `/world` builds its own
view objects containing only public fields, and the render functions in `src/render/world.ts` take
those view objects — not `HorseRow`, not `Genotype`, not `ConformationDisplayRow`. A future session
cannot leak a conformation number from a page that has no conformation number in scope.

Three routes:

| Route | What it is |
|---|---|
| `GET /world` | Every active stable, players and NPC |
| `GET /world/stables/:id` | One stable's roster |
| `GET /world/horses/:id` | One horse, read-only |

All three require a logged-in account (they sit above the `/admin` block in `router.ts` and below
the login redirect) and none require ownership. Nav gains one link — **"Everyone"** — beside Stables
and Shows in `pageShell`.

### 6.2 `/world` — the stables list

One row per stable from `listAllStables` (already `active = 1`, player and NPC alike):

- Stable name and prefix.
- Who runs it: the owning account's `display_name`, or **"Run by the game"** for `is_npc = 1`.
- Living horse count (`countAliveHorses`).
- **Balance.** Asked for explicitly (§2.2).
- A marker on your own stables — *"yours"* — so the list reads as a world rather than a leaderboard.

Sort by stable name. Do the account-name lookup as **one join, not a query per row**; the same goes
for the horse counts (`GROUP BY owner_stable_id` on living horses). This page is five to ten rows
today and it should still be two queries at a hundred.

Add a plain sentence at the top saying what is and is not shown — *"You can see what everyone keeps
and what they're worth. What a horse measures, what it has been tested for, and how each stable
spends its money stay private."* A child who understands the rule stops wondering whether they are
missing a page.

### 6.3 `/world/stables/:id` — the roster

Header: the stable's name, prefix, who runs it, balance, capacity, and how many horses it keeps.

Then one card per living horse — thumbnail, name (linking to `/world/horses/:id`), the same
one-sentence colour-and-sex description the barn list uses (`describeHorseRow`), and the ribbon badge
from `getShowSummary`. Deliberately **not** the conformation compact line, the care badge, the health
badge or the location badge that the owner's barn list carries.

Ended horses are not listed here; `/world/horses/:id` still resolves for one so old show results keep
working.

### 6.4 `/world/horses/:id` — the public horse page

Public, per §2.2: registered name and barn name, breed, the colour-and-markings sentence, sex, age
in years, picture (or the placeholder), breeder prefix, current stable (linked), sire and dam as
links to their own public pages, show record and recent placings, alive/died/retired-away status,
and "out at pasture" when that is where it is.

Two notes:

- **Pasture is public on purpose.** It is the answer to "why is her horse never in the shows", and a
  horse standing in a field is not a secret.
- **The pedigree links to `/world/horses/:id`**, which means a player can walk the whole ancestry of
  anyone's horse. That is correct — a pedigree is the public document in this hobby, it is already
  fully visible to an owner on their own horse's page, and it is what makes another stable's
  breeding programme legible enough to be worth competing with.

### 6.5 What happens to the owner-only horse page

`horsePageRoute` currently 404s for a non-owner. Change it to **redirect to `/world/horses/:id`**, so
a link pasted between two children resolves to something instead of a dead end. The owner and admin
path is otherwise untouched.

### 6.6 The rule to write in a comment at the top of `src/render/world.ts`

> These render functions receive plain view objects assembled by `src/routes/world.ts`. They must
> never take a `HorseRow`, a `Genotype`, a knowledge row or a config object. If you need a field
> here that is not on the view type, the question to answer first is whether §2.2 of slice 0016
> makes it public — not how to get it into scope.

---

## 7. Part D — the placing screen (needs Part C)

Item 2, and it is small once §6 exists.

### 7.1 The query

`listClassEntriesForDisplay` already joins `horses`. Add the stable and its account:

```sql
SELECT se.id, se.horse_id, se.is_npc, se.placing, se.final_score,
       h.registered_name, h.barn_name, h.sex,
       st.id AS stable_id, st.name AS stable_name, st.is_npc AS stable_is_npc,
       a.display_name AS owner_display_name
FROM show_entries se
JOIN horses h  ON h.id  = se.horse_id
JOIN stables st ON st.id = se.entered_by_stable_id
LEFT JOIN accounts a ON a.id = st.account_id
…
```

`LEFT JOIN` on accounts because an NPC stable has none. One query, no N+1 — the entry list is
already loaded once per class and this adds two joins to it.

### 7.2 What it renders

The entries table on `/shows/:id` gains a **Stable** column:

| Place | Horse | Stable | Score | |
|---|---|---|---|---|
| 1st — blue ribbon | SC Comet | Silver Creek *(Ellie)* | 84.2 | Why? |
| 2nd — red ribbon | FM Dancer | Fair Meadow *(the game's own barn)* | 81.7 | Why? |

The horse name links to `/world/horses/:id` for everyone — one destination, no branching on
ownership, and the owner's own richer page is one click from there via their barn. The existing
muted `(show barn)` marker beside the name is dropped; the Stable column now says it, better.

The same stable-and-owner line goes on `/shows/:id/entries/:entryId`, under the placing, and the
horse's name there becomes a link too.

---

## 8. Part E — `/admin/accounts`: modify and delete

### 8.1 The table gains what an operator actually needs to see

Username, display name, admin, active, **stables owned**, **last login**. Stable count is one
grouped query; last login is `accounts.last_login_real_ts`, already stored, rendered through
`config.values.display_timezone` per `CLAUDE.md` §6.

### 8.2 Edit

One row-level form per account, `action=edit`, taking display name and username together:

- Both required; username uniqueness enforced by the existing constraint and caught the way
  `createAccount`'s caller already catches it, producing *"That username is already taken."*
- Changing a username does not log anyone out — the session cookie carries the account id, not the
  name (`src/lib/session.ts`). Worth a comment; it is not obvious and it would be a reasonable
  thing to worry about.

### 8.3 Admin flag

`action=set_admin`, with two guards, both re-checked in the route rather than trusted from the form:

- **You cannot remove your own admin flag.** The single most likely way to lock the operator out.
- **You cannot remove the last admin.** Count first; refuse with a sentence naming why.

### 8.4 Delete

`action=delete`, guarded by the existing tick-box-plus-typed-word pattern `/admin/reset` uses (the
typed word is the account's own username).

Refused, each with its own plain-English sentence, when the account:

1. **owns any stable** — active or inactive. Name them: *"Ellie's Stables and Riverbend still belong
   to this account. Deactivate the account instead, or move the stables first."* There is no
   move-stables path in this slice; the sentence is honest about that.
2. **has granted a founding batch** — `import_offers.granted_by_account_id` is a real foreign key, so
   the delete would fail with a database error instead of a sentence. Check it and say so.
3. **is you**, or **is the last admin**.

Otherwise: delete the row. `config_audit.changed_by_account_id` has no foreign key and is append-only
(`CLAUDE.md` §7), so its rows survive with an id that no longer resolves — render those as
*"a deleted account"* rather than leaving a bare number.

Deactivate stays exactly as it is, and the page should say in one line that **deactivate is the
normal answer and delete is for a mistyped account nobody ever used.**

---

## 9. Part F — the admin PIN gate

### 9.1 What it is, honestly

A lock on the admin door for **a child holding an unlocked phone that is already logged in as a
grown-up.** That is the whole threat model, it is the one slice 0005 §7 and
`docs/horse-game-overview.md` §1b describe, and it is a real one at a kitchen table.

It is **not** protection against somebody who knows the admin password — §9.7's recovery path hands
admin back to anyone who does, by design. Write that sentence into the code. A future session that
mistakes this for a second factor will build the wrong thing on top of it.

### 9.2 Storage — slice 0005 §7.3, unchanged

- **`accounts.pin_hash`** — `TEXT`, nullable. Hashed with the existing `hashPassword` /
  `verifyPassword` from `src/lib/password.ts`. No second hashing scheme.
- **`pin_attempts`** — `id`, `account_id` (nullable: a failed attempt matches no account),
  `attempted_by_account_id`, `real_ts`, `success` (INTEGER 0/1). Append-only.

The PIN is set at a new `/admin/security` page, by an admin, **for their own account**, and setting
or changing it **requires typing the account password**. An admin cannot set another admin's PIN.

### 9.3 The lockout is a pure function

Per slice 0005 §7.4, and in the shape `src/tick/slot.ts` established:

```ts
// src/lib/pin.ts — no database access, tested without one
export function decidePinAttempt(
  recentAttempts: { real_ts: number; success: number }[],
  nowSeconds: number,
  limits: { maxAttempts: number; windowSeconds: number }
): { allowed: boolean; retryAfterSeconds: number };
```

**The lockout is global**, not per account and not per session — slice 0005 §7.4's argument holds
here for the same reason: a per-account limit lets a determined eleven-year-old farm attempts across
a sibling's login. Five failures in fifteen real minutes locks PIN entry everywhere until the window
clears, correct PIN included.

`/admin/security` lists recent attempts, so the operator can see that someone has been trying.

### 9.4 The wall-clock exception, and where to write it down

`CLAUDE.md` §5.3 is categorical: game logic reads `world.game_day`, never `Date.now()`. **This
lockout window is a deliberate, named exception and the only one**, for slice 0005 §7.5's three
reasons: a lockout measured in game days would stop while the world is paused and jump fifteen days
a tick; the thing being defended against happens in real minutes; and it is a security control, not
game logic — no horse, pregnancy, show or balance depends on it.

Write those three sentences at the comparison of `nowUtcSeconds()` against `pin_attempts.real_ts`,
and record the exception in `docs/build-log.md` **and** as one line under `CLAUDE.md` §5.3. (Slice
0005 §7.5 says "§11"; that file has been renumbered since — the rule it means is §5.3.)

### 9.5 The gate

A signed cookie, in the shape `src/lib/session.ts` already uses — HMAC over `${accountId}.${issuedAt}`
with `SESSION_SECRET`, named `hh_admin`:

- Issued on a correct PIN, `maxAgeSeconds` = `admin_pin_grace_seconds` (config, default 1800).
- **Re-checked server-side against the config value on every admin request**, not merely trusted to
  expire in the browser — lowering the tunable then takes effect immediately.
- Bound to the account id in the payload, so it is worthless in another account's session.
- Cleared on logout, alongside the session cookie.

In `router.ts`, inside the existing `path.startsWith('/admin')` block and **after** the `is_admin`
check: no valid cookie means render the unlock page for the requested path rather than the page.
`/admin/unlock` (GET and POST) is exempt, obviously.

### 9.6 The two ways to lock the operator out permanently, and how each is avoided

Both are worth building deliberately, because the operator has no terminal and cannot fix either
from a dashboard.

- **An admin who never sets a PIN.** If a missing `pin_hash` meant "locked", the first deploy locks
  the operator out of the game. So: **`pin_hash IS NULL` means the gate is off for that account**,
  and every admin page carries a banner — *"Anyone holding this phone can reach these pages. Set an
  admin PIN."* — linking to `/admin/security`. Nagging, never blocking.
- **`/admin/migrations` is the page that fixes everything, and it bypasses `buildContext`.** It
  cannot read config (the config table may not exist yet) and it runs **before** the migration that
  adds `pin_hash` exists. Gate it, but gate it defensively: verify the signed cookie against a
  hard-coded ceiling constant rather than the tunable, and if reading `pin_hash` fails for any reason
  — missing column, missing table — **let the request through as it does today.** A locked-out
  operator who cannot run migrations cannot recover by any route at all. Comment it as the deliberate
  hole it is.

### 9.7 Forgetting the PIN

`/admin/unlock` carries a *"I've forgotten the PIN"* link to a form taking the account's **password**,
which clears the PIN and sends you to `/admin/security` to set a new one.

This grants nothing new: knowing the password already means being that admin. It is what keeps a
forgotten four-digit number from permanently bricking a game whose operator cannot open a terminal.
Log those attempts in `pin_attempts` too, marked as the password path, so the log stays a complete
record of everything that opened the admin door.

---

## 10. Data

### 10.1 Migrations

Forward-only, one logical change each, and **each one also registered in `src/db/migrations.ts`**
per `CLAUDE.md` §8 — an import plus a list entry, in order, or `/admin/migrations` cannot see it.

| File | What |
|---|---|
| `0083_accounts_pin_hash.sql` | `ALTER TABLE accounts ADD COLUMN pin_hash TEXT` |
| `0084_pin_attempts.sql` | The attempt log, plus an index on `real_ts` (the lockout query's only filter) |
| `0085_config_admin_and_ui.sql` | The six tunables in §10.2 |

No index is added for §5.2's or §7.1's queries. `show_entries` already has `UNIQUE (class_id, horse_id)`,
which serves the `EXISTS` lookups, and the stables/accounts joins are on primary keys. Add one later
against a query that is actually slow, with the reason in the migration (`CLAUDE.md` §7).

### 10.2 Config

| Key | Default | What it is |
|---|---|---|
| `foal_max_age_game_days` | 360 | Display only — §4.2. Nothing mechanical may read it. |
| `shows_recent_count` | 6 | How many judged shows `/shows` lists after filtering. Matters more now that a filter can empty it. |
| `pin_max_attempts` | 5 | Slice 0005 §7.4 |
| `pin_lockout_window_seconds` | 900 | Real seconds — §9.4's named exception |
| `admin_pin_grace_seconds` | 1800 | How long one unlock lasts |
| `admin_pin_required` | `true` (flag) | In `config.flags`, beside `force_next_twins` and `care_notice_enabled`. Lets the operator switch the gate off from `/admin/config` without a deploy. |

The four whole-number keys go in `NUMERIC_CONFIG_KEYS` in `src/routes/admin.ts`, or they are not
editable from `/admin/config`. The `_seconds` suffix is deliberate: `CLAUDE.md` §7's suffix rule
covers `*_game_day` and `*_real_ts`, and these are neither — they are real-time *durations*, and the
suffix has to say so.

### 10.3 No schema changes for Parts A–E

Worth stating: items 1–5 and 8 are entirely query and render work. Only the PIN touches the schema.

---

## 11. Build order

Four commits, each deployable on its own, ordered so the riskiest thing lands last against a
codebase the operator has already seen working.

1. **Part A — the barn's filters** (§4). Self-contained, no schema, immediately visible.
2. **Parts B — the shows screen** (§5), including item 8. Also no schema. Item 8's helper is used by
   the filter query, so they are one change, not two.
3. **Part C then D — `/world`, then the placing screen** (§6, §7). D depends on C: the horse names in
   a placing link to the public page C builds. Do not build D first and link to a 404.
4. **Part E then F — accounts, then the PIN** (§8, §9). Both admin-only. The PIN goes last because it
   is the only one that can lock the operator out, and because §9.6's two escape hatches are easier
   to reason about against a `/admin/accounts` that already works.

**Deploy note for the operator, to be repeated in the summary at the end:** after the PIN commit
deploys, apply migrations at `/admin/migrations`, then go to `/admin/security` and set a PIN. Until
that is done, admin pages will nag but still open — that is deliberate, not a bug.

---

## 12. Tests

Following `CLAUDE.md` §5.1, the pure functions carry the tests; the routes are exercised by hand.

- **`test/barn-filter.test.ts`** — `bucketFor`: a colt under the foal age is a foal and *not* a
  stallion; the day it crosses `foal_max_age_game_days` it becomes a stallion; a gelding is a
  gelding at any age; the boundary day itself belongs to exactly one bucket.
- **`test/pin.test.ts`** — `decidePinAttempt`: allowed under the limit; refused at exactly the limit;
  attempts older than the window do not count; `retryAfterSeconds` counts from the *oldest attempt
  still inside the window*, not the newest; an empty log allows.
- **The visibility line is worth one test that does not need a database.** Whatever function assembles
  a `PublicHorseView` from a row (§6.6) should be pure, and a test should assert the assembled object
  has no genotype, no conformation, no COI and no health keys — a test that fails loudly the day
  somebody adds a field to the view type without reading §2.2.
- By hand, after deploy: each barn tab; a care round from a non-All tab returning to that tab; each
  show tab; the breed picker's absence with one breed seeded; a judged NPC-only class absent from
  `/shows` and present on `/admin/shows`; a placing's horse link from a logged-in non-owner; another
  player's horse page showing no measurements; deleting a fresh unused account; the delete refusal
  naming a stable; the PIN gate, a wrong PIN five times, the lockout message, and the forgotten-PIN
  password path.

---

## 13. What to raise rather than decide

- **Whether `/world` should show a stable's balance to the children.** Decided yes, because the
  operator asked for it explicitly (§2.2). Flagging it once, here, for the session that builds it:
  a visible balance turns money into a scoreboard between siblings. If that goes badly in play, the
  fix is one field on one page, not a redesign — and it is the operator's call, not a builder's.
- **Whether hiding NPC-only results (§5.3) makes the circuit look empty in the first weeks.** With
  one breed and one discipline seeded and few players entering, `/shows` may show almost nothing for
  a while. That is arguably honest and arguably discouraging. Do not solve it by weakening the rule;
  if it grates, the answer is more player entries or fewer NPC-only classes, both of which are
  scheduling questions for slice 0015.
- **A gelding path does not exist**, so the Geldings tab is written but never appears (§4.1). If the
  operator wants gelding as an action, that is its own small slice, not a line in this one.
- **Moving a stable between accounts** would make §8.4's first refusal unnecessary. It is a genuinely
  useful admin capability and it is deliberately not in this slice — it touches ownership of horses,
  ledger rows and events, and it deserves its own thinking rather than a form at the bottom of the
  accounts page.
