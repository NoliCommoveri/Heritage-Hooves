/**
 * The listing page must offer what the buy handler would accept.
 *
 * This is the same bug class test/router-paths.test.ts exists for, in a different place: there, a
 * handler existed with no route to reach it; here, a handler existed with no button to press it.
 * `listingBuyRoute` has always allowed a *different stable under the same account* to buy - its own
 * §7.1 step 2 comment says so, `sellListing` computes a `sameAccount` flag for exactly that case, and
 * test/market/sale-d1.test.ts already proves the sale itself works and stamps `ledger.same_account`.
 * The page simply never drew the form: `buyerOptions` was computed as `isMine ? [] : ...`, so a child
 * with two barns saw only "This is your own horse" and had no way to move a horse between them.
 *
 * That matters more than a normal cosmetic gap because CLAUDE.md §13 deliberately has **no** direct
 * horse transfer between one owner's own stables - the market is the only route, so if the market
 * refuses, the horse cannot move at all.
 *
 * These read src/routes/market.ts itself rather than a hand-copied list, so a future session that
 * re-gates the picker fails here, named, instead of failing in front of the children.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'market.ts'), 'utf8');

/** The body of `export async function <name>(` up to the next top-level `export ` declaration. */
function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`market.ts has no ${name}`);
  const rest = SOURCE.slice(start + name.length);
  const next = rest.indexOf('\nexport ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('a child with two stables can move a horse between them through the market', () => {
  it('the listing page builds its buyer options for every viewer, seller included', () => {
    const body = functionBody('listingPageRoute');
    // buyerOptionsFor already excludes the selling stable, so it is the whole rule - it needs no
    // second guard in front of it, and a guard here is what broke this.
    expect(body).toContain('const buyerOptions = await buyerOptionsFor(ctx, listing.seller_stable_id);');
  });

  it('the buy handler refuses a stable buying from itself, never an account buying from itself', () => {
    const body = functionBody('listingBuyRoute');
    expect(body).toContain('buyerStableId === listing.seller_stable_id');
    // The buyer must still belong to the signed-in account - that check is ownership, not a refusal
    // to trade, and removing it would let anyone buy into somebody else's barn.
    expect(body).toContain("buyerStable.account_id !== ctx.account!.id");
    // ...but nothing may refuse the sale merely because the seller shares that account.
    expect(body).not.toContain('seller_account_id === ctx.account');
  });

  it('the seller-side view flag governs withdrawing only', () => {
    const body = functionBody('listingPageRoute');
    // isMine still exists and is still account-scoped - that is right for "may I withdraw this?".
    expect(body).toContain('const isMine = listing.seller_account_id !== null && listing.seller_account_id === ctx.account!.id;');
    // The one thing it may still suppress: a "you have no other stable" refusal aimed at a seller
    // who has no second stable, for whom the withdraw card is the whole story.
    expect(body).toContain('isMine && buyerOptions.length === 0');
  });
});
