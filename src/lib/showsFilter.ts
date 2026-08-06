// The /shows class-type filter as a URL, in one place. Both screens that carry it - the /shows
// index and a single show's own page - build their links here rather than assembling query strings
// by hand, so a filtered link, a tab link and a POST redirect can never disagree about what the
// current filter is.
//
// The parse side of the same rule lives in routes/shows.ts (resolveShowsFilter); this module is the
// write side. Kept as a plain structural type rather than importing ShowsFilterParams from db/shows
// so nothing in lib/ depends on the database layer.

export interface ShowsFilterLike {
  classType: string;
  breedId: number | null;
}

/** resolveShowsFilter only reads `breed` on the 'all'/'conformation' tabs (a discipline or
 * young-horse class carries no breed_id worth filtering on), so a link never carries one on the
 * other tabs either - otherwise a stale breed would ride along invisibly and reappear the moment
 * the player clicked back to Conformation. */
export function showsFilterQuery(filter: ShowsFilterLike, extra: Record<string, string> = {}): URLSearchParams {
  const qs = new URLSearchParams({ class: filter.classType });
  if ((filter.classType === 'all' || filter.classType === 'conformation') && filter.breedId !== null) {
    qs.set('breed', String(filter.breedId));
  }
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  return qs;
}

export function showsIndexUrl(filter: ShowsFilterLike, extra: Record<string, string> = {}): string {
  return `/shows?${showsFilterQuery(filter, extra).toString()}`;
}

/**
 * One show's own page on a given filter. Every link into and every redirect back onto /shows/:id
 * goes through here - the same discipline slice 0026 §2.2 established for the horse page's tabs,
 * and for the same reason: a POST that lands the player back on the "All" tab hides their own
 * success notice behind a tab they are not looking at, which from the outside is indistinguishable
 * from the action having done nothing.
 */
export function showPageUrl(showId: number, filter: ShowsFilterLike, extra: Record<string, string> = {}): string {
  return `/shows/${String(showId)}?${showsFilterQuery(filter, extra).toString()}`;
}
