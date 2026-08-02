# Barn name as the primary display name

Not a new stage, and not numbered like a slice - it's a small, standalone
display-convention fix within stages already built (genetics core, founding stock, one
show class), unrelated to build order. Pick it up whenever; no new row needed in
CLAUDE.md §10.

## The problem

Prompted by a screenshot of a live horse page: nothing on screen tells the player what
they call this horse. `displayNameFor` (`src/render/horses.ts:15-19`) currently prefers
`registered_name`, falling back to `barn_name`, falling back to "Unnamed filly/colt".
That's backwards for how the family actually plays - `registered_name` is often null for
a long time (founding stock is never auto-named; a player has to visit the name form and
choose to permanently register one), while `barn_name` is the thing they set on day one
and actually use. Per CLAUDE.md §12, barn name is explicitly "what the current owner
calls the horse" - that should be the name driving every screen, not the studbook name.

## What to change

1. **`displayNameFor` in `src/render/horses.ts`** - flip the priority to
   `barn_name → registered_name → "Unnamed filly/colt"`. This one function is already
   the single source of truth used by the barn list, the breeding dropdown (`optionsFor`),
   pedigree cells, the image picker's "also used by" label, and every eligibility/status
   sentence in `routes/horses.ts` and `routes/shows.ts` (mare/stallion status lines, show
   entry eligible-horse list, entry confirmation, "In foal to ___"). Fixing the one
   function is enough to make barn name the name shown everywhere a player picks or reads
   about a horse they own - no other call site should need touching.

2. **Horse detail page (`renderHorsePage`, same file)** - no change needed for the `<h1>`
   itself; it already sits above the portrait card and already calls `displayNameFor`, so
   it becomes the barn name automatically once (1) lands.

   Add the registered name as its own line **directly under the existing `Breed:` line**
   (`src/render/horses.ts:377`), inside the same card:
   ```
   <p><strong>Registered name:</strong> ${h.registered_name ?? 'not registered yet'}</p>
   ```
   Keep the existing "Register a name" form (`nameForm`, further down the page) as-is -
   this is just a read-only display of the name once it exists.

## What NOT to change

- The registration flow, the barn-name edit form, and the `horses.registered_name` /
  `horses.barn_name` columns are untouched - this is display-only.
- Don't add a fallback that invents a name from breed/colour - "Unnamed filly/colt" stays
  the last resort, unchanged from today.

## Verify

`displayNameFor` has no test file of its own today; if adding one, cover the three-way
fallback (`barn_name` set → `registered_name` set, no barn name → neither set). Otherwise
check by hand against `wrangler dev`: a founding horse with a barn name but no registered
name (the common case) should show the barn name as the `<h1>` and in the barn list, the
breeding dropdown, and the show entry list, with "not registered yet" under Breed on its
own page.
