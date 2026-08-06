// The show circuit's player-facing screens (slice 0008 §8.1). Routes do all the loading and
// resolve every id into a name before calling here - these functions only template what they're
// given, the same split every other render/ file in this codebase follows.

import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import type { WorldRow } from '../db/world';
import type { ShowRow, ShowClassRow, ClassEntryDisplayRow, HorseResultRow } from '../db/shows';
import type { JudgeRow } from '../db/judges';
import { ribbonFor } from '../engines/showing/placing';
import type { EligibilityReason, ClassRank, ShowRank } from '../engines/showing/eligibility';
import { formatCalendarDate } from '../lib/calendar';
import { showsIndexUrl, showPageUrl, type ShowsFilterLike } from '../lib/showsFilter';

/** §8.1: "each refusal names the horse and says exactly which rule it failed" - the horse's own
 * name is prepended by the caller; this is just the rule fragment. */
export function eligibilityMessage(reason: EligibilityReason | 'class_closed' | 'not_found', params: { breedName: string; minAgeYears: number }): string {
  switch (reason) {
    case 'wrong_breed':
      return `isn't a ${params.breedName}, and this class is for ${params.breedName}s only.`;
    case 'crossbred_not_eligible':
      return 'is a cross, and this class is for purebreds only.';
    case 'too_young':
      return `isn't old enough yet - this class needs a horse at least ${String(params.minAgeYears)} years old.`;
    case 'too_old':
      return 'is too old for this class.';
    case 'wrong_sex':
      return "isn't the right sex for this class.";
    case 'requires_gait':
      return "doesn't have the gait this class requires.";
    case 'entry_cap_reached':
      return "can't enter - this stable already has as many horses in this class as it's allowed.";
    case 'already_entered':
      return 'is already entered in this class.';
    case 'barred_by_condition':
      return "can't be shown - a condition bars it from the ring.";
    // The location flag. Both name the way out, because both are entirely the owner's to undo -
    // unlike every other reason in this list, which is a fact about the horse.
    case 'at_pasture':
      return "is out at pasture. Bring it into the barn first - it'll need a little while to settle in before it can be shown.";
    case 'settling_in':
      return 'came in from pasture recently and is still settling back into work.';
    // Slice 0026 §1.3: a wait with an end date, the same shape as settling_in above.
    case 'recovering_from_gelding':
      return 'was gelded recently and is still recovering - not ready for the ring yet.';
    // Slice 0020 §5.4. Two reasons, two futures - an open incident clears on its own; a
    // degenerative outcome does not.
    case 'acute_incident':
      return "can't be shown right now - it's in the middle of a health incident.";
    case 'degenerative_incident':
      return "can't be shown - a past health incident left a lasting problem.";
    // Slice 0025 stage 4 §7.5. The horse page's own "Enter" button can never produce this - it
    // always targets the horse's own current rank - so this is only ever seen browsing /shows/:id's
    // list of open classes directly.
    case 'wrong_rank':
      return "hasn't earned the rank this class is for yet.";
    case 'class_closed':
      return "can't enter - this class isn't open for entries anymore.";
    case 'not_found':
      return "can't be found.";
  }
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${String(n)}th`;
  switch (n % 10) {
    case 1:
      return `${String(n)}st`;
    case 2:
      return `${String(n)}nd`;
    case 3:
      return `${String(n)}rd`;
    default:
      return `${String(n)}th`;
  }
}

/** A plain-text placing, with the ribbon colour named in words rather than shown as a coloured
 * swatch - no CSS work needed, and it reads fine to a screen reader or a colourblind judge alike. */
export function placingText(placing: number | null): string {
  if (placing === null) return 'not yet judged';
  const color = ribbonFor(placing);
  return color ? `${ordinal(placing)} - ${color} ribbon` : ordinal(placing);
}

const NEXT_RANK: Record<ShowRank, ShowRank | null> = { novice: 'open', open: 'champion', champion: null };

/** Slice 0026 §3.1: the Show record card's per-class_key rank line - "Dressage — Open · 2 of 4
 * top-three finishes and 1 of 1 wins toward Champion", with no progress clause once a horse is at
 * Champion (RANK_ORDER has nothing after it). Pure - HorseRankProgressRow (src/db/shows.ts) already
 * carries the label and counters, this only turns them into the sentence. */
export function rankProgressSentence(row: { rank: ShowRank; top3SincePromotion: number; winsSincePromotion: number }, top3Required: number, winRequired: number): string {
  const next = NEXT_RANK[row.rank];
  if (!next) return '';
  const nextWord = `${next[0].toUpperCase()}${next.slice(1)}`;
  return `${String(row.top3SincePromotion)} of ${String(top3Required)} top-three finishes and ${String(row.winsSincePromotion)} of ${String(winRequired)} wins toward ${nextWord}`;
}

/** Slice 0026 §3.1: the one rank badge every screen that shows a horse's record uses - the barn
 * list, a market listing, a stud listing, and /world/horses/:id. Named with the class it was
 * earned in ("Champion (dressage)") so it can never be misread as a single global rank. Null input
 * (no rank above novice) renders nothing, so a caller can drop it in unconditionally. */
export function rankBadgeHtml(highest: { rank: ShowRank; label: string } | undefined): SafeHtml {
  if (!highest) return raw('');
  const rankWord = `${highest.rank[0].toUpperCase()}${highest.rank.slice(1)}`;
  return html`<span class="badge badge-success">${rankWord} (${highest.label})</span>`;
}

// ---------------------------------------------------------------------------
// The Show record card's grouped placings. One builder and one renderer, shared by every screen
// that shows a horse's record - the owner's own horse page, a sale listing, a stud listing, and the
// public /world page. A horse's record reads the same wherever you meet it: a stranger's stallion
// standing at stud is judged on exactly the display the owner sees, split by class type.
// ---------------------------------------------------------------------------

/** Slice 0026 §3.2: one rank's placings within a class-type group - 'none' for a
 * young_conformation/ability_test result (never rank-bracketed, so it's the group's only
 * sub-group and renders flat, exactly as before this slice). isCurrent marks the horse's own
 * present-day rank in this class_key, the one sub-group rendered open rather than collapsed. */
export interface ShowResultRankGroup {
  rank: ClassRank;
  items: string[];
  isCurrent: boolean;
}

/** A Show record card group: one class type (Conformation, or a discipline's own name) the horse
 * has actually placed in, split into rank sub-groups (Novice/Open/Champion, or a single flat
 * 'none' sub-group for young-horse/ability results). Groups themselves are ordered
 * most-recent-first - falls out of the single pass in buildShowResultGroups, not sorted again
 * afterwards. Sub-groups are always ordered Novice -> Open -> Champion regardless of recency
 * (§3.2). */
export interface ShowResultGroup {
  label: string;
  subgroups: ShowResultRankGroup[];
}

/** How many placings each sub-group shows. A horse with a long career in one discipline shouldn't
 * push every other class type off the bottom of the card, which is what a single flat cap would
 * do - and, since slice 0026 §3.2, a Champion's current record shouldn't be crowded out by her own
 * Novice history either. */
export const SHOW_RESULT_GROUP_CAP = 5;

/** How many result rows a caller should ask listRecentResultsForHorse for before grouping. Well
 * above any real horse's career, because the cap applies per sub-group and the rows have to be
 * read before it's known which sub-group each one lands in. */
export const SHOW_RESULT_FETCH_LIMIT = 200;

const RANK_SUBGROUP_ORDER: ClassRank[] = ['novice', 'open', 'champion', 'none'];

/** Groups a horse's placings by class type, then by rank within each class type. Relies on
 * listRecentResultsForHorse returning rows newest-first: the first row seen for a not-yet-seen
 * label is by definition that group's most recent result, which is what puts the groups
 * themselves in most-recent-activity order (placings within a sub-group stay in that same
 * newest-first order too).
 *
 * currentRanks (horseClassRanksMap) says which sub-group is the horse's present-day rank in that
 * class_key - the one rendered open rather than collapsed behind a <details> (§3.2). A class_key
 * with no row there reads 'novice', matching horse_class_ranks' own no-row-means-novice rule.
 *
 * The made-up show name isn't included - what a player wants to know is what kind of class a result
 * came from (Conformation, Dressage, ...), not which of several near-identical fictional show names
 * it happened at. */
export function buildShowResultGroups(rows: HorseResultRow[], gameDaysPerYear: number, currentRanks: Map<string, ShowRank>): ShowResultGroup[] {
  const byLabel = new Map<string, { group: ShowResultGroup; subMap: Map<ClassRank, ShowResultRankGroup> }>();
  const groups: ShowResultGroup[] = [];
  for (const r of rows) {
    // Slice 0025 stage 3: young_conformation and ability_test get their own labels, deliberately
    // distinct from the adult groups they resemble - "ribbons from these classes do not count
    // toward progression in the adult classes" (§7.3) is a fact about a future stage 4, but
    // keeping them visually separate here is true today already, not a promise about later.
    const label =
      r.class_type === 'breed_conformation'
        ? 'Conformation'
        : r.class_type === 'young_conformation'
          ? 'Young Horse Conformation'
          : r.class_type === 'ability_test'
            ? `${r.ability_trait_name ?? 'Ability'} Test`
            : (r.discipline_name ?? 'Discipline');
    let entry = byLabel.get(label);
    if (!entry) {
      const group: ShowResultGroup = { label, subgroups: [] };
      entry = { group, subMap: new Map() };
      byLabel.set(label, entry);
      groups.push(group);
    }
    let sub = entry.subMap.get(r.rank);
    if (!sub) {
      const isCurrent = r.rank === 'none' ? true : r.rank === (currentRanks.get(r.class_key) ?? 'novice');
      sub = { rank: r.rank, items: [], isCurrent };
      entry.subMap.set(r.rank, sub);
      entry.group.subgroups.push(sub);
    }
    if (sub.items.length < SHOW_RESULT_GROUP_CAP) {
      sub.items.push(`${placingText(r.placing)} (${formatCalendarDate(r.scheduled_game_day, gameDaysPerYear)})`);
    }
  }
  for (const entry of byLabel.values()) {
    entry.group.subgroups.sort((a, b) => RANK_SUBGROUP_ORDER.indexOf(a.rank) - RANK_SUBGROUP_ORDER.indexOf(b.rank));
  }
  return groups;
}

function rankGroupLabel(rank: ClassRank): string {
  return `${rank[0].toUpperCase()}${rank.slice(1)}`;
}

/** The grouped placings' markup - a heading per class type, its rank sub-groups beneath. A 'none'
 * sub-group (young-horse/ability results) renders flat, exactly as before this slice. Of the real
 * ranks, the horse's own current one renders open; every lower rank is filed behind a collapsed
 * <details> naming its own placing count, so a Champion's career doesn't bury her current record
 * under her own Novice one. Empty for a horse that has never placed, so a caller can drop it in
 * unconditionally. */
export function showResultGroupsHtml(groups: ShowResultGroup[]): SafeHtml {
  return html`${groups.map(
    (g) => html`
      <h3>${g.label}</h3>
      ${g.subgroups.map((sg) => {
        const list = html`<ul>${sg.items.map((r) => html`<li>${r}</li>`)}</ul>`;
        if (sg.rank === 'none') return list;
        // §3.1: rank is public, shown wherever this builder is used - not just the owner's own
        // page - so the current sub-group is named too, not only the collapsed lower ones.
        if (sg.isCurrent) return html`<h4>${rankGroupLabel(sg.rank)}</h4>${list}`;
        return html`<details class="section-collapse"><summary>${rankGroupLabel(sg.rank)} record - ${String(sg.items.length)} placing${sg.items.length === 1 ? '' : 's'}</summary>${list}</details>`;
      })}`
  )}`;
}

function classRulesSentence(cls: ShowClassRow, minAgeYears: number): string {
  // The class's own title already names the breed (or says it's open to every breed), so restating
  // that here is redundant - this line is just the age band, plus rank, plus whatever other
  // restriction actually narrows the field (sex, gait).
  const ageRange = cls.max_age_game_days !== null ? `${String(minAgeYears)}-${String(Math.round(cls.max_age_game_days / 360))} years` : `${String(minAgeYears)}+ years`;
  const parts = [ageRange];
  if (cls.sex_restriction) parts.push(`${cls.sex_restriction}s only`);
  if (cls.requires_gait) parts.push('must be gaited');
  // Slice 0025 stage 4 §7.5: 'none' means young_conformation/ability_test, which are never
  // rank-bracketed - nothing to add there.
  if (cls.rank !== 'none') parts.push(`${cls.rank[0].toUpperCase()}${cls.rank.slice(1)}`);
  return parts.join(' · ');
}

/** Slice 0012 §5.5: "a class with fewer than three entries says so in words" - so a thin
 * Gaited Pleasure field (or, today, a thin Barrel Racing one before the barn is breed-aware and
 * before enough players have entered) reads as expected rather than as something broken. Slice
 * 0025 stage 3 widened this to young_conformation/ability_test too - both are new mechanisms a
 * young horse's owner has to discover before a field fills in, the same story a new discipline
 * has. Slice 0026 §3.5: breed_conformation is no longer excluded - rank brackets now split what
 * used to be one full breed-specific NPC pool three ways (Novice/Open/Champion), so a thin
 * Champion field is exactly as real as a thin field of any other class type. */
function thinFieldNote(cls: ShowClassRow, entryCount: number): SafeHtml {
  if (entryCount >= 3) return raw('');
  const noun =
    cls.class_type === 'discipline'
      ? 'a newer discipline'
      : cls.class_type === 'ability_test'
        ? 'a new kind of class'
        : cls.class_type === 'young_conformation'
          ? 'a new young-horse class'
          : 'a rank bracket that has not filled up yet';
  return html`<p class="muted">Only ${String(entryCount)} horse${entryCount === 1 ? ' has' : 's have'} entered so far - a thin field for ${noun}, not a bug.</p>`;
}

// ---------------------------------------------------------------------------
// The class-type tabs. The /shows index draws a fixed bar (every enabled discipline, whether or not
// anything is scheduled in it); one show's own page draws a bar built from the classes that show
// actually holds - "tabs by each type part of it", the operator's own words, 2026-08-06. Both read
// the same tab keys, so a tab clicked on one screen means the same thing on the other.
// ---------------------------------------------------------------------------

export interface ShowPageTab {
  /** The `class` query parameter value - 'all', 'conformation', 'young', or a discipline code. */
  key: string;
  label: string;
  /** How many of this show's classes the tab holds. Drawn beside the label, like the barn list's. */
  count: number;
}

/** Ordering for the class-type groups on a show page, and for the discipline tabs' position in the
 * bar: adult conformation, then disciplines, then the two young-horse types. The same order
 * buildShowCatalogue mints in, so the page reads the way the entry picker does. */
const CLASS_TYPE_SORT: Record<ShowClassRow['class_type'], number> = {
  breed_conformation: 0,
  discipline: 1,
  young_conformation: 2,
  ability_test: 3,
};

const RANK_SORT: Record<ClassRank, number> = { novice: 0, open: 1, champion: 2, none: 3 };

/** One class as the player thinks of it, with every parallel copy of it filed underneath. Since the
 * 2026-08-06 walkback (migration 0175) a request that finds its class full for that stable mints
 * another one beside it, so a busy household's show holds two or three identical "Conformation-
 * Quarter Horse, Open" classes - which, listed in mint order, interleave with every other class and
 * are impossible to tell apart. */
export interface ClassGroup<T> {
  /** class_key plus rank - what "the same class" means everywhere else in the codebase. */
  key: string;
  label: string;
  /** Every copy of this class, oldest first (the order entries were minted into). */
  sections: T[];
}

/**
 * Groups classes by (class_key, rank), and orders the groups the way the entry catalogue is built -
 * conformation, disciplines, young-horse classes - then by name, then Novice before Open before
 * Champion. Deliberately not mint order, which is the thing the operator asked to be rid of on
 * 2026-08-06: mint order interleaves a second copy of one class with whatever else happened to be
 * started between the two.
 *
 * Generic over the view type because both screens that list a show's classes need it and they carry
 * different payloads - the show page's own class cards, and the /shows index's one-line summaries.
 * One ordering rule, so the two screens can never disagree about what order a show's classes come in.
 */
export function groupClassesByKeyAndRank<T>(items: T[], clsOf: (item: T) => ShowClassRow): ClassGroup<T>[] {
  const byKey = new Map<string, { group: ClassGroup<T>; first: ShowClassRow }>();
  for (const item of items) {
    const cls = clsOf(item);
    const key = `${cls.class_key}|${cls.rank}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { group: { key, label: cls.name, sections: [] }, first: cls };
      byKey.set(key, entry);
    }
    if (cls.id < entry.first.id) entry.first = cls;
    entry.group.sections.push(item);
  }
  const entries = [...byKey.values()];
  for (const e of entries) e.group.sections.sort((a, b) => clsOf(a).id - clsOf(b).id);
  entries.sort(
    (a, b) =>
      CLASS_TYPE_SORT[a.first.class_type] - CLASS_TYPE_SORT[b.first.class_type] ||
      a.first.name.localeCompare(b.first.name) ||
      RANK_SORT[a.first.rank] - RANK_SORT[b.first.rank]
  );
  return entries.map((e) => e.group);
}

/** "A", "A and B", "A, B and C" - for naming the several winners or judges a split class has. */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function tabLabelFor(key: string, disciplines: { code: string; name: string }[]): string {
  if (key === 'all') return 'All';
  if (key === 'conformation') return 'Conformation';
  if (key === 'young') return 'Young Horse';
  return disciplines.find((d) => d.code === key)?.name ?? key;
}

/** Which tab a class belongs to - the inverse of classMatchesShowsFilter's own rule, for the one
 * case that predicate can't answer: "which tabs does this show need at all". */
function tabKeyForClass(cls: Pick<ShowClassRow, 'class_type' | 'discipline_code'>): string {
  if (cls.class_type === 'breed_conformation') return 'conformation';
  if (cls.class_type === 'discipline') return cls.discipline_code ?? 'discipline';
  return 'young';
}

/**
 * A single show's tab bar: All, then one tab per class type actually present, disciplines ordered
 * by name. `activeKey` is always represented even when the show holds nothing matching it (a link
 * carrying `?class=dressage` opened on a show with no dressage) - a bar with no active tab and an
 * empty page beneath it reads as broken, where an active tab reading "Dressage (0)" reads as true.
 */
export function buildShowPageTabs(
  classes: Pick<ShowClassRow, 'class_type' | 'discipline_code'>[],
  disciplines: { code: string; name: string }[],
  activeKey: string
): ShowPageTab[] {
  const counts = new Map<string, number>();
  const typeOrder = new Map<string, number>();
  for (const cls of classes) {
    const key = tabKeyForClass(cls);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    typeOrder.set(key, Math.min(typeOrder.get(key) ?? Infinity, CLASS_TYPE_SORT[cls.class_type]));
  }
  if (activeKey !== 'all' && !counts.has(activeKey)) {
    counts.set(activeKey, 0);
    // An absent tab has no class to read a type order off, so it sorts with the disciplines - the
    // only kind of key that can arrive here from a stale link in practice.
    typeOrder.set(activeKey, CLASS_TYPE_SORT.discipline);
  }

  const rest = [...counts.entries()]
    .map(([key, count]) => ({ key, label: tabLabelFor(key, disciplines), count, order: typeOrder.get(key) ?? 0 }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, count }) => ({ key, label, count }));

  return [{ key: 'all', label: 'All', count: classes.length }, ...rest];
}

export interface ShowsIndexNextClass {
  cls: ShowClassRow;
  judge: JudgeRow | undefined;
  breedName: string;
  entryCount: number;
  minAgeYears: number;
}

export interface ShowsIndexRecentClass {
  cls: ShowClassRow;
  judge: JudgeRow | undefined;
  breedName: string;
  winnerName: string | null;
}

/** Slice 0016 §5.1: the class-type tabs (All, Conformation, one per enabled discipline) plus, when
 * two or more breeds have classes, a breed picker - both plain links/a plain GET form, no
 * JavaScript (§3). The breed picker is only rendered on a non-discipline tab, since a discipline
 * class never carries a breed_id (mutually exclusive by construction).
 *
 * Shared by the /shows index and one show's own page (2026-08-06): the index passes the fixed tab
 * set (every enabled discipline, whether or not anything is scheduled in it), a show page passes
 * the tabs its own classes need. Both hand in the link builder for their own screen, so a tab click
 * stays on the page the player is already looking at. */
function filterControls(params: {
  tabs: { key: string; label: string; count?: number }[];
  filter: ShowsFilterLike;
  eligibleBreeds: { id: number; name: string }[];
  /** The GET form's target - '/shows' or '/shows/:id'. */
  action: string;
  hrefFor: (classType: string) => string;
}): SafeHtml {
  const usesBreed = params.filter.classType === 'all' || params.filter.classType === 'conformation';

  const tabNav = html`
    <nav class="subnav">
      ${params.tabs.map(
        (t) => html`<a href="${params.hrefFor(t.key)}" class="${t.key === params.filter.classType ? 'subnav-link is-active' : 'subnav-link'}">${t.label}${
          t.count !== undefined ? ` (${String(t.count)})` : ''
        }</a>`
      )}
    </nav>`;

  const breedPicker =
    usesBreed && params.eligibleBreeds.length >= 2
      ? html`
        <form method="get" action="${params.action}">
          <input type="hidden" name="class" value="${params.filter.classType}">
          <label>Breed
            <select name="breed">
              <option value="" ${params.filter.breedId === null ? raw('selected') : raw('')}>All breeds</option>
              ${params.eligibleBreeds.map(
                (b) => html`<option value="${String(b.id)}" ${b.id === params.filter.breedId ? raw('selected') : raw('')}>${b.name}</option>`
              )}
            </select>
          </label>
          <button type="submit">Show</button>
        </form>`
      : raw('');

  return html`${tabNav}${breedPicker}`;
}

export function renderShowsIndexPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  /** Slice 0025 stage 4 §7.5a: classes mint on demand now, so more than one show can be open for
   * entries at once - a list, not a single "next show". */
  openShows: { show: ShowRow; classes: ShowsIndexNextClass[] }[];
  recentShows: { show: ShowRow; classes: ShowsIndexRecentClass[] }[];
  classType: string;
  breedId: number | null;
  disciplines: { code: string; name: string }[];
  eligibleBreeds: { id: number; name: string }[];
}): SafeHtml {
  const filter: ShowsFilterLike = { classType: params.classType, breedId: params.breedId };

  // Both lists group a class's parallel copies exactly as the show page itself does (2026-08-06) -
  // three sections of one class were three near-identical lines here, which is where a player meets
  // the duplication first, before ever clicking into the show.
  const openBlock = params.openShows.length
    ? params.openShows.map(
        (openShow) => html`
      <div class="card">
        <h2>${openShow.show.name}</h2>
        <p><strong>Venue:</strong> ${openShow.show.venue} &middot; <strong>${formatCalendarDate(openShow.show.scheduled_game_day, params.gameDaysPerYear)}</strong> <span class="muted">(game day ${String(openShow.show.scheduled_game_day)})</span></p>
        ${groupClassesByKeyAndRank(openShow.classes, (c) => c.cls).map((g) => {
          const first = g.sections[0];
          const entryCount = g.sections.reduce((sum, c) => sum + c.entryCount, 0);
          const judges = joinWords(g.sections.map((c) => c.judge?.name ?? 'an unnamed judge'));
          return html`
          <div class="card">
            <h3>${g.label}${g.sections.length > 1 ? ` (${String(g.sections.length)} sections)` : ''}</h3>
            <p class="muted">${classRulesSentence(first.cls, first.minAgeYears)}</p>
            <p>Judged by <strong>${judges}</strong>${g.sections.length === 1 && first.judge ? html` - ${first.judge.blurb}` : raw('')}</p>
            <p class="muted">${String(entryCount)} horse${entryCount === 1 ? '' : 's'} entered so far.</p>
            ${g.sections.length === 1 ? thinFieldNote(first.cls, entryCount) : raw('')}
          </div>`;
        })}
        <p><a class="button-link" href="${showPageUrl(openShow.show.id, filter)}">View and enter</a></p>
      </div>`
      )
    : html`<p>No open classes match this filter right now. Enter a horse from its own page to start one - see "Enter in a show" there.</p>`;

  const recentBlock = params.recentShows.length
    ? params.recentShows.map(
        (r) => html`
        <div class="card">
          <h3><a href="${showPageUrl(r.show.id, filter)}">${r.show.name}</a></h3>
          <p class="muted">${r.show.venue} &middot; ${formatCalendarDate(r.show.scheduled_game_day, params.gameDaysPerYear)} (game day ${String(r.show.scheduled_game_day)})</p>
          ${groupClassesByKeyAndRank(r.classes, (c) => c.cls).map((g) => {
            const winners = joinWords(g.sections.map((c) => c.winnerName ?? 'no entries'));
            // A split class names every section's winner in one sentence, and drops the judges: with
            // three sections that is three names on top of three winners, and the show's own page
            // says who judged what.
            return g.sections.length === 1
              ? html`<p>${g.label}, judged by ${g.sections[0].judge?.name ?? 'an unnamed judge'}: <strong>${winners}</strong> won.</p>`
              : html`<p>${g.label}, ${String(g.sections.length)} sections: <strong>${winners}</strong> won.</p>`;
          })}
        </div>`
      )
    : html`<p class="muted">No shows have been judged yet.</p>`;

  const body = html`
    <h1>Shows</h1>
    ${filterControls({
      // The index's tabs are the fixed set - every enabled discipline gets a tab whether or not
      // anything is scheduled in it, since this screen is also how a player finds out a discipline
      // exists. No counts here: a tab spans every show on the page, not one show's class list.
      tabs: [
        { key: 'all', label: 'All' },
        { key: 'conformation', label: 'Conformation' },
        ...params.disciplines.map((d) => ({ key: d.code, label: d.name })),
        // Slice 0025 stage 3: young_conformation and ability_test share one tab, since a horse only
        // ever matches one age band at a time regardless of which of the two it entered.
        { key: 'young', label: 'Young Horse' },
      ],
      filter,
      eligibleBreeds: params.eligibleBreeds,
      action: '/shows',
      hrefFor: (classType) => showsIndexUrl({ classType, breedId: params.breedId }),
    })}
    <h2>Open for entries</h2>
    ${openBlock}
    <h2>Recent results</h2>
    ${recentBlock}
  `;
  return pageShell({
    title: 'Shows',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

export interface ShowPageEntryRow extends ClassEntryDisplayRow {
  name: string;
  /** Entered by one of the looking account's own stables. Marks the rows a player is actually here
   * to read, in a table that is mostly the show barn's horses (2026-08-06). */
  isYours: boolean;
}

export interface ShowPageClassView {
  cls: ShowClassRow;
  judge: JudgeRow | undefined;
  breedName: string;
  minAgeYears: number;
  entries: ShowPageEntryRow[];
  /** Present only while the class is still open - the account's own horses eligible to enter it. */
  eligibleHorses?: { horseId: number; name: string }[];
  /** How many of the account's horses were checked and found ineligible - shown as a count rather
   * than per-horse reasons, which live on each horse's own page instead. */
  ineligibleCount?: number;
}

export type ShowPageClassGroup = ClassGroup<ShowPageClassView>;

/** The show page's own grouping - the shared rule above, told where to find each card's class row.
 * Grouping is what makes this page readable when a class has been split; the tabs do the rest. */
export function buildShowPageClassGroups(classes: ShowPageClassView[]): ShowPageClassGroup[] {
  return groupClassesByKeyAndRank(classes, (c) => c.cls);
}

export function renderShowPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  show: ShowRow;
  /** Already filtered to the active tab by the route - the tab bar is built from the show's full
   * class list, which is why both are passed rather than one derived from the other. */
  classes: ShowPageClassView[];
  tabs: ShowPageTab[];
  filter: ShowsFilterLike;
  eligibleBreeds: { id: number; name: string }[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const s = params.show;
  const filter = params.filter;

  const sectionCard = (c: ShowPageClassView, sectionNumber: number, sectionCount: number): SafeHtml => {
    const open = c.cls.status === 'scheduled';
    const entryRows = c.entries.map(
      (e) => html`
      <tr>
        <td>${open ? '-' : placingText(e.placing)}</td>
        <td><a href="/world/horses/${String(e.horse_id)}">${e.name}</a>${e.isYours ? html` <span class="badge badge-success">Yours</span>` : raw('')}</td>
        <td>${e.stable_is_npc ? html`${e.stable_name} <span class="muted">(the game's own barn)</span>` : html`${e.stable_name}${e.owner_display_name ? html` <span class="muted">(${e.owner_display_name})</span>` : raw('')}`}</td>
        <td>${e.final_score !== null ? e.final_score.toFixed(1) : raw('&mdash;')}</td>
        <td>${e.placing !== null ? html`<a href="/shows/${String(s.id)}/entries/${String(e.id)}">Why?</a>` : raw('')}</td>
      </tr>`
    );

    const entryForm = open
      ? c.eligibleHorses && c.eligibleHorses.length
        ? html`
          <form method="post" action="${showPageUrl(s.id, filter)}">
            <input type="hidden" name="action" value="enter">
            <input type="hidden" name="class_id" value="${String(c.cls.id)}">
            <label>Enter one of your horses
              <select name="horse_id" required>
                ${c.eligibleHorses.map((h) => html`<option value="${String(h.horseId)}">${h.name}</option>`)}
              </select>
            </label>
            <button type="submit">Enter</button>
          </form>
          ${c.ineligibleCount ? html`<p class="muted">${String(c.ineligibleCount)} of your other horses aren't eligible for this class right now.</p>` : raw('')}
        `
        : html`<p class="muted">None of your horses are eligible for this class right now.</p>`
      : raw('');

    // Only one section: the card is headed by the class itself, exactly as before grouping existed.
    // Several: the group's heading carries the class name and rules, and each card is headed by
    // which section it is.
    const heading =
      sectionCount === 1
        ? html`
          <h2>${c.cls.name}</h2>
          <p class="muted">${classRulesSentence(c.cls, c.minAgeYears)}</p>`
        : html`<h3>Section ${String(sectionNumber)} of ${String(sectionCount)}</h3>`;

    const yoursCount = c.entries.filter((e) => e.isYours).length;
    const yoursLine = yoursCount
      ? html`<p class="muted">${String(yoursCount)} of your horses ${yoursCount === 1 ? 'is' : 'are'} in this ${sectionCount === 1 ? 'class' : 'section'}.</p>`
      : raw('');

    return html`
      <div class="card">
        ${heading}
        ${yoursLine}
        <p>Judged by <strong>${c.judge?.name ?? 'an unnamed judge'}</strong>${c.judge ? html` - ${c.judge.blurb}` : raw('')}</p>
        ${/* A split class has a thin section because it was split, not because the class went
             unentered - the group's own "split into N sections" line above says so already, and
             thinFieldNote's explanation ("a rank bracket that has not filled up yet") would be
             flatly untrue here. */ sectionCount === 1 ? thinFieldNote(c.cls, c.entries.length) : raw('')}
        <table>
          <thead><tr><th>Place</th><th>Horse</th><th>Stable</th><th>Score</th><th></th></tr></thead>
          <tbody>${entryRows.length ? entryRows : html`<tr><td colspan="5" class="muted">No entries yet.</td></tr>`}</tbody>
        </table>
        ${entryForm}
      </div>`;
  };

  const groups = buildShowPageClassGroups(params.classes);
  const classBlocks = groups.map((g) => {
    const count = g.sections.length;
    if (count === 1) return sectionCard(g.sections[0], 1, 1);
    const first = g.sections[0];
    return html`
      <div class="card">
        <h2>${g.label}</h2>
        <p class="muted">${classRulesSentence(first.cls, first.minAgeYears)}</p>
        <p class="muted">Split into ${String(count)} sections so every horse could get in - each one is judged on its own, with its own ribbons.</p>
        ${g.sections.map((c, i) => sectionCard(c, i + 1, count))}
      </div>`;
  });

  const emptyLine = classBlocks.length ? raw('') : html`<p class="muted">This show has no classes of that kind. Try another tab above.</p>`;

  const body = html`
    <h1>${s.name}</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <p><strong>Venue:</strong> ${s.venue} &middot; <strong>${formatCalendarDate(s.scheduled_game_day, params.gameDaysPerYear)}</strong> <span class="muted">(game day ${String(s.scheduled_game_day)})</span> &middot; <strong>Status:</strong> ${s.status === 'entries_open' ? 'open for entries' : 'judged'}</p>
    ${filterControls({
      tabs: params.tabs,
      filter,
      eligibleBreeds: params.eligibleBreeds,
      action: `/shows/${String(s.id)}`,
      hrefFor: (classType) => showPageUrl(s.id, { classType, breedId: filter.breedId }),
    })}
    ${classBlocks}
    ${emptyLine}
    <p><a href="${showsIndexUrl(filter)}">Back to shows</a></p>
  `;
  return pageShell({
    title: s.name,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

export type EntryResultTraitRow =
  /** A breed_conformation entry's row - distance-from-target scoring, as before. */
  | { kind: 'conformation'; name: string; expressed: number; target: number; weight: number; traitScore: number }
  /** Slice 0012 §9.1: a discipline entry's row - no target, because there is no target for an
   * ability trait, only a weight and what that weight times the expressed value contributed. */
  | { kind: 'ability'; name: string; expressed: number; weight: number; contribution: number };

/** §9.1: branches on the breakdown blob's own kind - a conformation entry shows
 * expressed/target/weight/trait score exactly as before; a discipline entry shows
 * expressed/weight/contribution, with no target column. */
export function renderEntryResultPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  show: ShowRow;
  cls: ShowClassRow;
  horseId: number;
  horseName: string;
  /** Slice 0016 §7.2: the entering stable and its owner, same shape as the placings table's own
   * Stable column - shown as a line under the placing. */
  stableId: number;
  stableName: string;
  stableIsNpc: boolean;
  ownerDisplayName: string | null;
  judge: JudgeRow | undefined;
  placing: number;
  prizePaid: number;
  traits: EntryResultTraitRow[];
  weightSum: number;
  rawScore: number;
  noise: number;
  finalScore: number;
  /** Slice 0013 §8.4: the care modifier this entry was actually scored with, read from
   * show_entries.care_modifier_applied - never recomputed, so this line does not change even
   * though the horse's own care state has moved on since. Undefined for an entry judged before
   * this slice (the column still defaults to 1.0, but there is nothing to say about it). */
  careModifierApplied?: number;
  careNote?: string;
  /** Slice 0014 §2.3/§8.3. The age modifier this entry was actually scored with, read from
   * show_entries.age_modifier_applied - never recomputed, mirroring careModifierApplied exactly.
   * Undefined for an entry judged before this slice. */
  ageModifierApplied?: number;
  ageNote?: string;
}): SafeHtml {
  const isAbility = params.traits.length > 0 && params.traits[0].kind === 'ability';

  const rows = params.traits.map((t) =>
    t.kind === 'ability'
      ? html`
        <tr>
          <td>${t.name}</td>
          <td>${String(t.expressed)}</td>
          <td>${t.weight.toFixed(2)}</td>
          <td>${t.contribution.toFixed(1)}</td>
        </tr>`
      : html`
        <tr>
          <td>${t.name}</td>
          <td>${String(t.expressed)}</td>
          <td>${String(t.target)}</td>
          <td>${t.weight.toFixed(2)}</td>
          <td>${t.traitScore.toFixed(1)}</td>
        </tr>`
  );

  const tableHead = isAbility
    ? html`<tr><th>Trait</th><th>Measured</th><th>Weight</th><th>Contribution</th></tr>`
    : html`<tr><th>Trait</th><th>Measured</th><th>Standard wants</th><th>Weight</th><th>Points</th></tr>`;

  const prizeSentence = params.prizePaid > 0 ? html` - paid <strong>${String(params.prizePaid)}</strong>` : raw('');

  // Slice 0013 §8.4: shown even when the modifier was exactly 1.0 ("Care: normal") rather than
  // hidden - a child comparing two results should be able to see that care was accounted for in
  // both.
  const careLine =
    params.careModifierApplied !== undefined
      ? html`<p>${params.careModifierApplied === 1 ? 'Care: normal.' : html`Care applied: <strong>${params.careModifierApplied.toFixed(2)}</strong>${params.careNote ? html` (${params.careNote})` : raw('')}`}</p>`
      : raw('');

  // Slice 0014 §8.3: a second, separate line beside care - two lines, always, so a child can tell
  // the fixable thing (care) from the unfixable one (age) at a glance.
  const ageLine =
    params.ageModifierApplied !== undefined
      ? html`<p>${params.ageModifierApplied === 1 ? 'Age: in its prime.' : html`Age applied: <strong>${params.ageModifierApplied.toFixed(2)}</strong>${params.ageNote ? html` (${params.ageNote})` : raw('')}`}</p>`
      : raw('');

  const stableLine = params.stableIsNpc
    ? html`${params.stableName} <span class="muted">(the game's own barn)</span>`
    : html`${params.stableName}${params.ownerDisplayName ? html` <span class="muted">(${params.ownerDisplayName})</span>` : raw('')}`;

  const body = html`
    <h1><a href="/world/horses/${String(params.horseId)}">${params.horseName}</a> at ${params.show.name}</h1>
    <p><strong>${placingText(params.placing)}</strong>${prizeSentence}, judged by ${params.judge?.name ?? 'an unnamed judge'}.</p>
    <p>Entered by <a href="/world/stables/${String(params.stableId)}">${stableLine}</a></p>
    <div class="card">
      <h2>How the score was reached</h2>
      <table>
        <thead>${tableHead}</thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Weighted average: <strong>${params.rawScore.toFixed(2)}</strong> (out of a possible 100, over a total weight of ${params.weightSum.toFixed(2)})</p>
      <p>Noise on the day: <strong>${params.noise >= 0 ? '+' : ''}${params.noise.toFixed(2)}</strong> - the judge having an ordinary human day, not a measurement of the horse.</p>
      ${careLine}
      ${ageLine}
      <p><strong>Final score: ${params.finalScore.toFixed(2)}</strong></p>
    </div>
    <p><a href="/shows/${String(params.show.id)}">Back to ${params.show.name}</a></p>
  `;
  return pageShell({
    title: `${params.horseName} at ${params.show.name}`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}
