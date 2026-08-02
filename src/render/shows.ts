// The show circuit's player-facing screens (slice 0008 §8.1). Routes do all the loading and
// resolve every id into a name before calling here - these functions only template what they're
// given, the same split every other render/ file in this codebase follows.

import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import type { WorldRow } from '../db/world';
import type { ShowRow, ShowClassRow, ClassEntryDisplayRow } from '../db/shows';
import type { JudgeRow } from '../db/judges';
import { ribbonFor } from '../engines/showing/placing';
import type { EligibilityReason } from '../engines/showing/eligibility';

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

function classRulesSentence(cls: ShowClassRow, breedName: string, minAgeYears: number): string {
  const parts = [`${breedName}`, cls.crosses_eligible ? 'purebreds and crosses' : 'purebreds only'];
  let sentence = `${parts[0]} · ${parts[1]} · at least ${String(minAgeYears)} years old`;
  if (cls.max_age_game_days !== null) sentence += ` · no older than ${String(Math.round(cls.max_age_game_days / 360))} years`;
  if (cls.sex_restriction) sentence += ` · ${cls.sex_restriction}s only`;
  if (cls.requires_gait) sentence += ' · must be gaited';
  return sentence;
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

export function renderShowsIndexPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  nextShow: { show: ShowRow; classes: ShowsIndexNextClass[] } | null;
  recentShows: { show: ShowRow; classes: ShowsIndexRecentClass[] }[];
}): SafeHtml {
  const nextBlock = params.nextShow
    ? html`
      <div class="card">
        <h2>${params.nextShow.show.name}</h2>
        <p><strong>Venue:</strong> ${params.nextShow.show.venue} &middot; <strong>Game day:</strong> ${String(params.nextShow.show.scheduled_game_day)}</p>
        ${params.nextShow.classes.map(
          (c) => html`
          <div class="card">
            <h3>${c.cls.name}</h3>
            <p class="muted">${classRulesSentence(c.cls, c.breedName, c.minAgeYears)}</p>
            <p>Judged by <strong>${c.judge?.name ?? 'an unnamed judge'}</strong>${c.judge ? html` - ${c.judge.blurb}` : raw('')}</p>
            <p class="muted">${String(c.entryCount)} horse${c.entryCount === 1 ? '' : 's'} entered so far.</p>
          </div>`
        )}
        <p><a class="button-link" href="/shows/${String(params.nextShow.show.id)}">View and enter</a></p>
      </div>`
    : html`<p>No show is currently open for entries.</p>`;

  const recentBlock = params.recentShows.length
    ? params.recentShows.map(
        (r) => html`
        <div class="card">
          <h3><a href="/shows/${String(r.show.id)}">${r.show.name}</a></h3>
          <p class="muted">${r.show.venue} &middot; game day ${String(r.show.scheduled_game_day)}</p>
          ${r.classes.map(
            (c) => html`<p>${c.cls.name}, judged by ${c.judge?.name ?? 'an unnamed judge'}: <strong>${c.winnerName ?? 'no entries'}</strong> won.</p>`
          )}
        </div>`
      )
    : html`<p class="muted">No shows have been judged yet.</p>`;

  const body = html`
    <h1>Shows</h1>
    <h2>Next up</h2>
    ${nextBlock}
    <h2>Recent results</h2>
    ${recentBlock}
  `;
  return pageShell({ title: 'Shows', world: params.world, loggedIn: true, isAdmin: params.isAdmin, body });
}

export interface ShowPageEntryRow extends ClassEntryDisplayRow {
  name: string;
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

export function renderShowPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  show: ShowRow;
  classes: ShowPageClassView[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const s = params.show;

  const classBlocks = params.classes.map((c) => {
    const open = c.cls.status === 'scheduled';
    const entryRows = c.entries.map(
      (e) => html`
      <tr>
        <td>${open ? '-' : placingText(e.placing)}</td>
        <td>${e.name}${e.is_npc ? html` <span class="muted">(show barn)</span>` : raw('')}</td>
        <td>${e.final_score !== null ? e.final_score.toFixed(1) : raw('&mdash;')}</td>
        <td>${e.placing !== null ? html`<a href="/shows/${String(s.id)}/entries/${String(e.id)}">Why?</a>` : raw('')}</td>
      </tr>`
    );

    const entryForm = open
      ? c.eligibleHorses && c.eligibleHorses.length
        ? html`
          <form method="post" action="/shows/${String(s.id)}">
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

    return html`
      <div class="card">
        <h2>${c.cls.name}</h2>
        <p class="muted">${classRulesSentence(c.cls, c.breedName, c.minAgeYears)}</p>
        <p>Judged by <strong>${c.judge?.name ?? 'an unnamed judge'}</strong>${c.judge ? html` - ${c.judge.blurb}` : raw('')}</p>
        <table>
          <thead><tr><th>Place</th><th>Horse</th><th>Score</th><th></th></tr></thead>
          <tbody>${entryRows.length ? entryRows : html`<tr><td colspan="4" class="muted">No entries yet.</td></tr>`}</tbody>
        </table>
        ${entryForm}
      </div>`;
  });

  const body = html`
    <h1>${s.name}</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <p><strong>Venue:</strong> ${s.venue} &middot; <strong>Game day:</strong> ${String(s.scheduled_game_day)} &middot; <strong>Status:</strong> ${s.status === 'entries_open' ? 'open for entries' : 'judged'}</p>
    ${classBlocks}
    <p><a href="/shows">Back to shows</a></p>
  `;
  return pageShell({ title: s.name, world: params.world, loggedIn: true, isAdmin: params.isAdmin, body });
}

export function renderEntryResultPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  show: ShowRow;
  cls: ShowClassRow;
  horseName: string;
  judge: JudgeRow | undefined;
  placing: number;
  traits: { name: string; expressed: number; target: number; weight: number; traitScore: number }[];
  weightSum: number;
  rawScore: number;
  noise: number;
  finalScore: number;
}): SafeHtml {
  const rows = params.traits.map(
    (t) => html`
    <tr>
      <td>${t.name}</td>
      <td>${String(t.expressed)}</td>
      <td>${String(t.target)}</td>
      <td>${t.weight.toFixed(2)}</td>
      <td>${t.traitScore.toFixed(1)}</td>
    </tr>`
  );

  const body = html`
    <h1>${params.horseName} at ${params.show.name}</h1>
    <p><strong>${placingText(params.placing)}</strong>, judged by ${params.judge?.name ?? 'an unnamed judge'}.</p>
    <div class="card">
      <h2>How the score was reached</h2>
      <table>
        <thead><tr><th>Trait</th><th>Measured</th><th>Standard wants</th><th>Weight</th><th>Points</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Weighted average: <strong>${params.rawScore.toFixed(2)}</strong> (out of a possible 100, over a total weight of ${params.weightSum.toFixed(2)})</p>
      <p>Noise on the day: <strong>${params.noise >= 0 ? '+' : ''}${params.noise.toFixed(2)}</strong> - the judge having an ordinary human day, not a measurement of the horse.</p>
      <p><strong>Final score: ${params.finalScore.toFixed(2)}</strong></p>
    </div>
    <p><a href="/shows/${String(params.show.id)}">Back to ${params.show.name}</a></p>
  `;
  return pageShell({ title: `${params.horseName} at ${params.show.name}`, world: params.world, loggedIn: true, isAdmin: params.isAdmin, body });
}
