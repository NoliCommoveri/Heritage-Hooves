# Slice 0007 — The image slot: the library, the picker, and the count that grows it

**Status:** specified, not built. **This is the next slice built** — it comes before `docs/slices/0006-conformation.md`, whose own §9 records that reordering and the reasoning behind it. Slices 0001, 0002, 0003 and 0005 are built. Slice 0004 (semen storage) and slice 0005 §7 (the parent's PIN) are specified but not built, and nothing here touches either.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those.

**What this slice is.** Every horse in the game is currently a sentence. This slice gives each one a picture: a library of images the operator generates and uploads per breed, and a picker the child uses to choose one. It is the smallest slice in the queue and the one with the most visible effect.

**Why this comes now.** Slice 0005 made the game playable — a child claims three horses and breeds them. What arrives is text. A picture per horse is the cheapest thing in the whole build order that makes a barn feel like a barn, and it is unblocked: the operator is already generating the library, and overview §14's open question about whether images match phenotype was closed on 2 August 2026 (matched on breed only — §2.1 below).

**One thing to hold onto while building.** **The library is the operator's to grow, forever, without a session.** They have no terminal (`CLAUDE.md` §1) — their only tools are GitHub's web file editor and the deployed site. Every design choice here bends towards "upload a file, type a number, done". If you find yourself building something that needs a build step, a manifest file, an image pipeline or a redeploy to add one picture, you have taken a wrong turn. See §4.

---

## 1. What "done" looks like

On the live URL, on a phone, with no terminal:

1. Apply the new migrations from `/admin/migrations`.
2. Upload a handful of images through GitHub's web editor into `public/horses/`, named `qh-01.webp`, `qh-02.webp`, `qh-03.webp`. Wait for the deploy.
3. Open `/admin/breeds`. It lists all eight breeds with their current image count. Set the Quarter Horse's to `3` and save. The page states, in plain English, that the next file to upload is `qh-04.webp`, and warns that files are never renumbered or deleted.
4. Open any Quarter Horse's page. Where the picture goes, there is a placeholder card with the horse's colour in words and a **Choose a picture** button.
5. Press it. A grid of the three images appears, each one selectable, plus a **No picture** option. The horse's actual colour is stated in text above the grid.
6. Choose one and save. The horse's page now shows that picture at the top. Go back to the barn list — the picture is there too, small, beside the horse's name.
7. Change the choice. It changes. Choose **No picture**. It goes back to the placeholder.
8. Open a horse of a breed whose count is still `0`. The picker says there are no pictures for that breed yet, in a sentence, and offers nothing to press. Nothing is broken and no image is missing on the page.
9. Open a cross-bred foal (a QH × Arabian, if one exists). Its picker offers the Quarter Horse images *and* the Arabian images, Quarter Horse first if it is the larger share.
10. Open a horse belonging to someone else's stable while logged in as an admin. The picture shows; there is no **Choose a picture** button.
11. Go to `/horses/1` (or any real horse id). The horse page still loads — the image directory and the horse route share the `/horses/` path and this must keep working (§4.4).

If all eleven work, the slice is done.

---

## 2. Decisions taken for this slice

### 2.1 Matched on breed, and on nothing else

Already decided in conversation on 2 August 2026 and recorded in overview §5b and §14 — restated here because it is the decision the rest of the slice hangs off, and because it will look wrong to a session that has not read the reasoning.

The library is organised by breed. Within a breed's set the player chooses **freely** — a child can put a chestnut picture on a black horse, and that is accepted rather than prevented.

The reason it is not matched to colour: the engine produces twelve visible colours today and the design plans roughly sixteen loci, at which point the colour space is combinatorial and no hand-built library will contain a silver dapple sooty roan tobiano. A library that promises to match colour stops being able to keep that promise exactly as the colour genetics get interesting. A library that never claimed to match colour is more honest.

**The mitigation, and it is required, not optional:** the picker states the horse's real colour in text above the grid, so the child chooses knowing what the horse actually is. Adding colour tags to filenames later is purely additive if it turns out to matter.

### 2.2 The set a horse may choose from is derived from its `composition`, not its `breed_id`

`horses.breed_id` is **null for every cross** (see `foalComposition` in `src/engines/genetics/composition.ts` — a cross has no breed row). Keying the picker on `breed_id` would mean the first cross-bred foal in the game, the thing a child is most excited about, is the one horse that cannot have a picture.

**The rule: a horse's image set is the union of the library sets of every breed code in its `composition` blob, ordered by fraction descending, then by breed code.** `composition` is `NOT NULL` on every horse and is `{"QH":1}` for a purebred, so this single rule covers purebreds and crosses with no branch. A code in `composition` with no matching `breeds` row is skipped rather than throwing.

This is the same discipline as the 2026-08-02 breeds entry in `CLAUDE.md` §11: **if you find yourself typing `if (horse.is_cross)`, the thing you want is data instead.**

### 2.3 The count is a column; the list is derived; files are never renumbered

`breeds.image_count` is an integer. The picker builds the list as `<code>-01` … `<code>-NN` up to that number. There is no manifest file and no directory listing — Cloudflare's static assets have no listing API, and a manifest is a file the operator would have to hand-edit correctly in a browser every time, which is exactly the failure this design exists to avoid.

**The cost, which must be stated on `/admin/breeds` and not just here: files are never renumbered and never deleted, only replaced in place.** Deleting `qh-02.webp` and leaving the count at 3 renders a broken image rather than skipping a gap — the app cannot know the file is missing without fetching it. Replacing `qh-02.webp` with a different picture is fine and is the supported way to fix a bad image.

`image_count` is validated to `0..99`, because the number is zero-padded to two digits. If a breed ever genuinely needs a hundredth image, that is a deliberate change to the padding plus a rename of every file in that breed's set — do not pre-build for it.

### 2.4 No image is assigned at birth; the empty state is designed instead

A foal is born with `image_url` null and stays that way until someone picks. This is a real choice against the alternative, so here is the reasoning both ways.

Auto-assigning a random image from the breed's set would give every horse a face on day one, which is what overview §5b asks for. But with a library of a dozen images per breed, a barn of eight horses would show the same picture two or three times, chosen by nobody; and a picker whose answer is already filled in is a screen no child ever opens. The choosing is the point.

**So: no auto-assign, and the empty state is built properly rather than left blank** — a placeholder card carrying the horse's colour description and a prominent **Choose a picture** button, on the horse page and as a small neutral tile in the barn list. An unpicked horse should read as *waiting for you*, not as broken.

This is cheap to reverse if the family hates it: auto-assign is one `deriveSeed` call at the two insert sites. **The seed label `image_pick` is reserved for it and drawn nowhere** — same convention as slice 0004's `straw_thaw` and slice 0006's `ceiling_estimate`.

### 2.5 No arbitrary-URL field, and this is a departure from the design record

Overview §5b says *"An arbitrary-URL field can sit alongside it."* That is a recommendation, not a decision (`CLAUDE.md` §2), and this slice declines it. Three reasons:

- An external URL rots. The whole argument for hosting the library in the Worker is that its URLs never rot; a pasted URL reintroduces exactly that problem, per horse, invisibly, until one day a horse's picture is a broken image or somebody else's advertisement.
- It is an unfiltered path for arbitrary remote content into a game played by children, with no moderation layer (`CLAUDE.md` §13 removes moderation from the problem space *because* the content is all ours — a URL field quietly takes that back).
- Typing URLs on a phone is the specific experience overview §5b calls "error-prone" in the sentence immediately before it.

**`horses.image_source` still exists, with `custom` and `generated` as legal values**, so adding the field later — or the generated art of overview §5c — is a route and a form, not a migration. Say this departure in your summary.

### 2.6 The picker is a page, not a control on the horse page

`/horses/:id/image`, GET and POST, owner-only. A grid of a dozen or more images is not something to nest inside a `<details>` on a page that already carries the pedigree, the name forms and (one slice later) the conformation card.

**The POST never trusts the submitted value.** Re-derive the allowed set from the horse's own `composition` and the live `image_count`s, and reject anything not in it — do not accept a path from the form and write it to the column. This is the same shape as the `hh_stable` cookie rule in `CLAUDE.md` §11: the form says what the player *asked for*, the server decides what is true.

---

## 3. Not built here

Each of these is a real thing. Do not build them and do not leave stubs.

- **Generated art** (overview §5c). The long tail. `image_source = 'generated'` is a legal value and nothing writes it.
- **Custom URLs** (§2.5). `image_source = 'custom'` is a legal value and nothing writes it.
- **Colour or phenotype matching, filtering, or tagging** (§2.1). No filename tags, no filter controls, no default selection.
- **Thumbnail generation.** There is no build step and there will not be one. The barn list scales the full image down in the browser; §4.3 states the cost honestly and names the escape hatch if it bites.
- **Images on the founding candidate list.** A candidate is not a horse yet and has no slot. Showing a breed image beside a candidate would read as *that candidate's picture*, which it is not. The picker is a thing you do after claiming.
- **Images in the pedigree table, the breeding page selects, or the stable picker.** Two screens is the right amount for one slice.
- **Uploading images through the app.** The Worker has no write path to static assets; the upload path is GitHub's web editor and always will be (§4.5).
- **Clearing `image_url` on death.** Schema §4.2 asks for it. Nothing dies yet; the ageing-and-death stage adds it to the list it already maintains.
- **An `image_ext` column.** §4.1 names the constant to change instead if `.webp` proves painful.

---

## 4. The library, precisely

### 4.1 Naming and format

```
public/horses/<lowercase breed code>-<NN>.webp
```

`qh-01.webp`, `qh-02.webp`, … `ar-01.webp`, `nok-07.webp`. Zero-padded to two digits, starting at `01`, contiguous. The eight codes are `qh`, `ar`, `tb`, `pf`, `ic`, `gw`, `fr`, `nok` — lowercased from `breeds.code`, which is `QH`, `AR`, … in the database and is **permanent** (`CLAUDE.md` §11, 2026-08-02 breeds entry: a code is written into every horse's `composition` at birth).

`public/` is the static-assets directory (`wrangler.toml`'s `[assets]`), served at the site root, so `public/horses/fr-03.webp` is at `/horses/fr-03.webp`.

**The extension lives in one module constant**, e.g. `const LIBRARY_IMAGE_EXT = 'webp'` next to the path builder. Most image generators can export webp directly; if the operator's cannot, any browser-based converter will do, and if that turns out to be a recurring chore the fix is this one constant plus a rename of what is already uploaded. Do not add a per-breed extension column speculatively.

### 4.2 One pure function builds every path

```
libraryImagePath(breedCode: string, n: number): string     ->  "/horses/qh-03.webp"
imageOptionsFor(composition, breeds): ImageOption[]         ->  ordered, deduplicated, per §2.2
```

Pure, no database access, `src/engines/` or `src/lib/` — put them in `src/lib/images.ts`, because this is presentation plumbing rather than a game model and `src/engines/` is reserved for the simulation (`CLAUDE.md` §4, §5.1). An `ImageOption` carries at least `{ breedCode, breedName, index, path, alt }`.

**Alt text must not describe the horse.** `alt="Quarter Horse picture 3"` is correct. `alt="bay Quarter Horse"` is a lie the moment a child puts it on a black horse, and it would be a lie told specifically to the person using a screen reader.

### 4.3 What the operator's images should be, and what it costs

- **Aspect ratio: landscape, roughly 4:3.** The display box is a fixed 4:3 with `object-fit: cover`, so anything else is centre-cropped rather than breaking the layout — but a portrait-shaped image will lose its top and bottom.
- **Size: keep each file under about 250 KB.** There is no resizing pipeline, so the barn list downloads the same file it displays at 96px wide.

**The honest cost:** a barn of ten horses is roughly 2 MB of images on first load. Cloudflare caches them hard afterwards and `loading="lazy"` keeps the picker grid from fetching everything at once, so on wifi this is fine and on a slow connection it is noticeable. **If it does become annoying, the first thing to drop is the barn-list thumbnail, not the horse page** — and the second is a `-t` small-copy convention (`qh-03-t.webp`), which is purely additive but doubles the operator's per-image work and should not be built until asked for.

Give every `<img>` explicit `width` and `height` attributes so the page does not jump as images arrive.

### 4.4 `public/horses/` and `/horses/:id` share a path, deliberately and safely

This will look like a bug when you notice it. It is not, but check it rather than trusting this paragraph (acceptance step 11).

Static assets are matched before the Worker runs, so `/horses/qh-01.webp` is served as a file. `HORSE_ROUTE` in `src/router.ts` is `/^\/horses\/(\d+)(\/name|\/barn-name)?$/` — digits only — so no library filename can ever shadow a horse page, and no horse id can ever shadow a file. The directory name is already recorded as convention in `CLAUDE.md` §11 (2026-08-03 image library entry); keep it.

### 4.5 The operator's workflow, which is the whole point

Written out because it belongs in the summary you hand back, in these words:

1. Generate images for a breed. Save them as `.webp`.
2. In GitHub, go to `public/horses` → **Add file** → **Upload files**. Name each one for its breed and the next free number — the site tells you the exact next filename.
3. Commit. Wait for the deploy to finish.
4. On the site, go to **Admin → Breeds**, set that breed's count to the new total, and save.
5. The new pictures are in the picker. It can take up to a minute to appear on every page (§5.3).

No terminal, no code change, no session. That is the requirement this slice exists to meet.

---

## 5. Data

Two migrations. **The numbers below are the next free ones as this document is written** — read `migrations/` and take whatever is actually free, per `CLAUDE.md` §9 and the 2026-08-03 numbering entry in §11. Register both in `src/db/migrations.ts` as well as adding the files (`CLAUDE.md` §8).

### 5.1 `0026_breeds_image_count.sql`

```sql
ALTER TABLE breeds ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
```

Schema doc §3.1 already specifies this column; no change needed there. Default `0` means every existing breed row is correct without a backfill, and a breed with no images yet behaves exactly like one whose images have not been uploaded — the same empty state, not a special case.

### 5.2 `0027_horses_image.sql`

```sql
ALTER TABLE horses ADD COLUMN image_url TEXT;
ALTER TABLE horses ADD COLUMN image_source TEXT
  CHECK (image_source IS NULL OR image_source IN ('library', 'custom', 'generated'));
```

Two columns for one feature on one table is one logical change, so one file.

- `image_url` holds a **root-relative path** (`/horses/qh-03.webp`), never an absolute URL with a hostname — the site must survive moving domains. Null means no picture chosen.
- `image_source` is null exactly when `image_url` is null. This slice only ever writes `'library'`; the other two values exist so §2.5 and §3 are additive later.
- The `CHECK` must permit `NULL` explicitly as written, so that every horse alive today passes.

**Both nullable, no backfill, no default picture.** A horse born before this slice is indistinguishable from one born after and never chose — which is the correct reading of both.

**The one thing to know about storing a full path:** if `LIBRARY_IMAGE_EXT` (§4.1) ever changes, stored paths need a one-line `UPDATE horses SET image_url = REPLACE(...)` migration. That is a five-minute file, and it buys a column whose meaning is obvious to the next reader, which is the trade the schema doc's `image_url` already makes.

### 5.3 The breeds cache

`getBreeds` in `src/db/breeds.ts` caches rows in module scope for 60 seconds, per-isolate, with no cross-isolate invalidation (the comment at the top of that file explains why that was fine — nothing wrote to the table). This slice makes it the first thing that writes to `breeds`.

**Do not build cross-isolate invalidation.** Clear the module cache after the write so the admin's own next page load is correct, and **say the delay on the admin page in plain English** — *"new pictures can take up to a minute to appear everywhere."* That is a true sentence about a minute-long delay on an action performed a few times a year, and the alternative is machinery `src/lib/config-cache.ts`'s comment explicitly says not to build yet.

### 5.4 No config keys

Nothing here is tunable. Resist adding `images_enabled`.

---

## 6. Where it appears

Three screens, one new player route, one new admin route.

### 6.1 The horse page — `src/render/horses.ts`, `renderHorsePage`

A portrait at the top of the existing first card, above the description sentence. Chosen image, or the placeholder card of §2.4. Under it, for the owner only, a **Choose a picture** / **Change picture** link to `/horses/:id/image`. Admins viewing someone else's horse see the picture and no link, matching how the barn-name form is already gated on `params.owner`.

### 6.2 The picker — `/horses/:id/image` (new route, new render function)

Owner-only on both GET and POST; a non-owner gets `notFound()`, the same as every other stable-scoped route (`CLAUDE.md` §11, 2026-08-02 sessions entry).

- One line naming the horse's real colour, from the existing `describeHorse` output (§2.1's required mitigation).
- A grid of `<label><input type="radio" name="image" value="…"><img …></label>` — **no JavaScript** (`CLAUDE.md` §11, 2026-08-02). The selected state is CSS on `input:checked + img`; the input itself can be visually hidden but must stay focusable and keyboard-reachable.
- A **No picture** radio at the end of the grid, which clears both columns.
- If the horse's set is empty (every breed in its composition has `image_count = 0`), the grid is replaced by one sentence saying there are no pictures for this breed yet — not an empty box, not a broken image.
- Group the grid by breed with a small heading when a cross draws from more than one set, so a QH × Arabian reads as two labelled groups rather than one shuffled wall.
- **A courtesy label, and the first thing to cut if the session runs long (§10):** mark any option already used by another horse in the same stable with a quiet *"also used by Dusty"*. It does not prevent the choice — two horses may share a picture. It is one extra query over one stable's horses, which is tiny.

Add a `.image-grid` / `.horse-portrait` block to `public/style.css`, reusing the existing `:root` tokens rather than hardcoding colour (`CLAUDE.md` §11, 2026-08-02 UI entry).

### 6.3 The barn list — `renderBarnList`

A small thumbnail (about 96px wide) beside each horse's name, or the neutral placeholder tile. This is what makes a barn look like a barn rather than a list, and per §4.3 it is also the first thing to remove if the page feels heavy.

### 6.4 `/admin/breeds` — new admin page

Follows the established admin pattern exactly: a new `AdminSubnavPage` value, an entry in `adminSubnav()`, a `render…Page` in `src/render/admin.ts` through the existing `shell()`, a route in `src/routes/admin.ts`, a line in `src/router.ts`'s `/admin` block, and a button on the admin home page.

One table, one row per breed: code, name, current count, a number input, one **Save** for the lot. Plus, in words on the page:

- the exact next filename for each breed (`qh-04.webp`) — the single most useful thing this page can tell the operator;
- the never-renumber, never-delete, replace-in-place rule (§2.3);
- the up-to-a-minute delay (§5.3);
- the counts must be whole numbers `0..99`; reject anything else with a sentence naming the breed, the way `/admin/config` already does.

`CLAUDE.md` §13 says no polished admin UI. A table of number inputs is the right size. Do not build an upload widget, a preview grid, or a file browser.

---

## 7. Seeds and reproducibility

Nothing in this slice draws a random number. There is no new sub-seed, no change to any existing stream, and `test/rng.test.ts`'s golden values must still pass untouched.

**`image_pick` is reserved and drawn nowhere** (§2.4). If a future slice adds auto-assignment at birth, that is the label, derived from the horse's own `rng_seed`.

---

## 8. Tests

`src/lib/images.ts` is pure, so all of this runs without a database.

1. **Path building.** `libraryImagePath('QH', 3)` is `/horses/qh-03.webp`; `('NOK', 12)` is `/horses/nok-12.webp`. Padding is correct at 1, 9, 10 and 99.
2. **Purebred set.** `{"QH": 1}` against a QH row with `image_count = 3` yields exactly three options, in order 01, 02, 03.
3. **Zero count.** `image_count = 0` yields an empty list, not one option, and not a throw.
4. **Cross ordering.** `{"QH": 0.75, "AR": 0.25}` yields the QH options first, then the Arabian ones. `{"QH": 0.5, "AR": 0.5}` falls back to breed code order, deterministically.
5. **Unknown code.** A composition naming a breed code with no row is skipped, and the remaining codes still produce their options.
6. **Validation.** The function that validates a submitted choice accepts a path the set contains, and rejects `/horses/fr-01.webp` for a pure Quarter Horse, `/horses/qh-99.webp` when the count is 3, and anything that is not a library path at all (`../`, an `https://` URL, an empty string). This is §2.6 and it is the test that matters most.
7. **Count validation.** `0` and `99` are accepted; `-1`, `100`, `2.5` and `""` are rejected.

---

## 9. If this is too large for one session

It should not be — this is the smallest slice in the queue. If it runs long, the split, in order of what to drop:

1. The *"also used by Dusty"* label in the picker (§6.2). Pure courtesy, one query, ten minutes to add later.
2. The barn-list thumbnail (§6.3). A second renderer over a model that is by then finished.

**Do not split the picker from the admin count page.** A column the operator cannot edit is a column that will sit at `0` forever, and a picker with nothing in it is worse than no picker — it is a promise the game visibly fails to keep. Those two ship together or neither ships.

**Do not split the migrations from the screens.** Two nullable columns nothing reads is a thing a future session has to reason about with no screen to check it against.
