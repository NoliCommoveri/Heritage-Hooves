import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import { stableSubnav } from './stables';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import type { HorseRow } from '../db/horses';
import type { BreedRow, LocusRow } from '../db/breeds';
import type { Genotype } from '../engines/genetics/genotype';
import { LOCI } from '../engines/genetics/loci';
import { NO_PICTURE_VALUE, type ImageOption } from '../lib/images';

export function displayNameFor(horse: HorseRow): string {
  if (horse.registered_name) return horse.registered_name;
  if (horse.barn_name) return horse.barn_name;
  return horse.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt';
}

/** A small thumbnail beside a barn-list row, or a neutral tile - slice 0007 §6.3. First thing to
 * drop if a heavy barn list ever becomes a problem (§4.3), which is why it's its own function
 * rather than folded into the card markup. */
function barnThumbnail(horse: HorseRow): SafeHtml {
  if (horse.image_url) {
    return html`<img class="horse-thumb" src="${horse.image_url}" width="96" loading="lazy" alt="">`;
  }
  return html`<span class="horse-thumb horse-thumb--placeholder" aria-hidden="true"></span>`;
}

export function renderBarnList(params: {
  world: WorldRow;
  isAdmin: boolean;
  stable: StableRow;
  hasFoundingOffer: boolean;
  horses: { horse: HorseRow; description: string; inSeason: boolean }[];
}): SafeHtml {
  const rows = params.horses.length
    ? params.horses.map(
        ({ horse, description, inSeason }) => html`
        <div class="card horse-row">
          ${barnThumbnail(horse)}
          <div>
            <h2><a href="/horses/${String(horse.id)}">${displayNameFor(horse)}</a> ${inSeason ? html`<span class="badge badge-success">in season</span>` : raw('')}</h2>
            <p>${description}</p>
          </div>
        </div>`
      )
    : html`<p>No horses here yet.</p>`;

  const body = html`
    <h1>${params.stable.name}'s horses</h1>
    ${rows}
    <p><a href="/stables/${String(params.stable.id)}/breed">Breed two horses</a></p>
  `;
  return pageShell({
    title: `${params.stable.name} · Horses`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    subnav: stableSubnav(params.stable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

export interface BreedPreview {
  mareId: number;
  stallionId: number;
  mareDescription: string;
  mareAgeYears: number;
  stallionDescription: string;
  stallionAgeYears: number;
  coiPercent: string;
  warning?: string;
  conceptionPercent: string;
  conceptionReasons: string[];
}

function optionsFor(horses: HorseRow[], selectedId: number | undefined, describe: (h: HorseRow) => string): SafeHtml {
  if (horses.length === 0) return html`<option value="" disabled selected>None available</option>`;
  return html`${horses.map(
    (h) => html`<option value="${String(h.id)}" ${h.id === selectedId ? raw('selected') : raw('')}>${displayNameFor(h)} - ${describe(h)}</option>`
  )}`;
}

export function renderBreedPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  stable: StableRow;
  hasFoundingOffer: boolean;
  mares: HorseRow[];
  stallions: HorseRow[];
  describe: (h: HorseRow) => string;
  selectedMareId?: number;
  selectedStallionId?: number;
  preview?: BreedPreview;
  error?: string;
}): SafeHtml {
  const preview = params.preview;

  const conceptionReasonsBlock = preview && preview.conceptionReasons.length
    ? html`<p class="muted">${preview.conceptionReasons.join(', ')}</p>`
    : raw('');

  const previewBlock = preview
    ? html`
      <div class="card">
        <h2>This pairing</h2>
        <p><strong>Mare:</strong> ${preview.mareDescription}</p>
        <p><strong>Stallion:</strong> ${preview.stallionDescription}</p>
        <p><strong>Inbreeding coefficient of a foal from this pairing:</strong> ${preview.coiPercent}</p>
        ${preview.warning ? html`<p class="notice">${preview.warning}</p>` : raw('')}
        <p><strong>Estimated chance this covering takes:</strong> ${preview.conceptionPercent}</p>
        ${conceptionReasonsBlock}
        <form method="post" action="/stables/${String(params.stable.id)}/breed">
          <input type="hidden" name="action" value="book">
          <input type="hidden" name="mare_id" value="${String(preview.mareId)}">
          <input type="hidden" name="stallion_id" value="${String(preview.stallionId)}">
          <button type="submit">Book covering</button>
        </form>
      </div>
    `
    : raw('');

  const body = html`
    <h1>Breed</h1>
    ${errorBox(params.error)}
    <form method="post" action="/stables/${String(params.stable.id)}/breed">
      <input type="hidden" name="action" value="check">
      <label>Mare
        <select name="mare_id" required>${optionsFor(params.mares, params.selectedMareId, params.describe)}</select>
      </label>
      <label>Stallion
        <select name="stallion_id" required>${optionsFor(params.stallions, params.selectedStallionId, params.describe)}</select>
      </label>
      <button type="submit">Check pairing</button>
    </form>
    ${previewBlock}
    <p><a href="/stables/${String(params.stable.id)}/horses">Back to horses</a></p>
  `;
  return pageShell({
    title: 'Breed',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    subnav: stableSubnav(params.stable.id, 'breed', params.hasFoundingOffer),
    body,
  });
}

interface PedigreeSlot {
  label: string;
  horse: HorseRow | null;
}

function pedigreeCell(slot: PedigreeSlot): SafeHtml {
  if (!slot.horse) return html`<td class="muted">unknown</td>`;
  return html`<td><a href="/horses/${String(slot.horse.id)}">${displayNameFor(slot.horse)}</a></td>`;
}

export function renderHorsePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  owner: boolean;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  description: string;
  /** The horse's real colour in one word, e.g. "bay" - stated beside the placeholder so a picture
   * choice is made with the truth in view, per slice 0007 §2.1's required mitigation. */
  visibleColour: string;
  ageYears: number;
  breed: BreedRow | undefined;
  gaited: boolean;
  breederStableName: string | null;
  /** Bred by a Friesian pool but came out chestnut - the recessive e is real in the studbook and
   * unregistrable (slice 0005 §5.3). */
  unregistrableFriesianChestnut: boolean;
  pedigree: { sire: HorseRow | null; dam: HorseRow | null; sireSire: HorseRow | null; sireDam: HorseRow | null; damSire: HorseRow | null; damDam: HorseRow | null };
  canRegisterName: boolean;
  nameError?: string;
  barnNameNotice?: string;
  genotype?: Genotype;
  loci?: LocusRow[];
  mareStatus?: string;
}): SafeHtml {
  const h = params.horse;
  const coiPercent = `${(h.coi * 100).toFixed(1)}%`;

  const bredByLine = h.breeder_prefix
    ? h.breeder_stable_id
      ? html`${h.breeder_prefix}${params.breederStableName ? ` (${params.breederStableName})` : ''}`
      : html`${h.breeder_prefix} <span class="muted">(a founding stable, not one in this game)</span>`
    : html`a founding stable (unbred stock)`;

  const nameForm = params.canRegisterName
    ? html`
      <div class="card">
        <h2>Register a name</h2>
        ${errorBox(params.nameError)}
        <p class="muted">The stable's prefix is stamped on automatically. Once registered, the name is permanent.</p>
        <form method="post" action="/horses/${String(h.id)}/name">
          <label>${h.breeder_prefix ?? params.ownerStable.prefix}
            <input type="text" name="name" required maxlength="40">
          </label>
          <button type="submit">Register name</button>
        </form>
      </div>`
    : raw('');

  const barnNameForm = html`
    <div class="card">
      <h2>Barn name</h2>
      ${noticeBox(params.barnNameNotice)}
      <form method="post" action="/horses/${String(h.id)}/barn-name">
        <label>What you call ${h.sex === 'mare' ? 'her' : 'him'} around the barn
          <input type="text" name="barn_name" maxlength="60" value="${h.barn_name ?? ''}">
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  `;

  const pedigreeTable = html`
    <table>
      <thead><tr><th>Sire</th><th>Dam</th></tr></thead>
      <tbody>
        <tr>${pedigreeCell({ label: 'sire', horse: params.pedigree.sire })}${pedigreeCell({ label: 'dam', horse: params.pedigree.dam })}</tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Sire's sire</th><th>Sire's dam</th><th>Dam's sire</th><th>Dam's dam</th></tr></thead>
      <tbody>
        <tr>
          ${pedigreeCell({ label: '', horse: params.pedigree.sireSire })}
          ${pedigreeCell({ label: '', horse: params.pedigree.sireDam })}
          ${pedigreeCell({ label: '', horse: params.pedigree.damSire })}
          ${pedigreeCell({ label: '', horse: params.pedigree.damDam })}
        </tr>
      </tbody>
    </table>
  `;

  const portraitBlock = h.image_url
    ? html`<img class="horse-portrait" src="${h.image_url}" width="480" alt="">`
    : html`
      <div class="horse-portrait horse-portrait--placeholder">
        <p>${displayNameFor(h)} is ${params.visibleColour}.</p>
        ${params.owner ? html`<a class="button-link" href="/horses/${String(h.id)}/image">Choose a picture</a>` : raw('')}
      </div>`;

  const pictureLink = params.owner && h.image_url
    ? html`<p><a href="/horses/${String(h.id)}/image">Change picture</a></p>`
    : raw('');

  const genotypeBlock =
    params.isAdmin && params.genotype && params.loci
      ? html`
        <details class="section-collapse">
          <summary>Genotype (admin only)</summary>
          <table>
            <thead><tr><th>Locus</th><th>Alleles</th><th>Notes</th></tr></thead>
            <tbody>
              ${params.loci.map((locus) => {
                const pair = params.genotype!.mendelian[locus.code];
                return html`<tr><td>${locus.name}</td><td>${pair ? `${pair[0]}/${pair[1]}` : 'unknown (predates this locus)'}</td><td class="muted">${locus.teaching_text}</td></tr>`;
              })}
            </tbody>
          </table>
        </details>`
      : raw('');

  const body = html`
    <h1>${displayNameFor(h)}</h1>
    <div class="card">
      ${portraitBlock}
      ${pictureLink}
      <p>${params.description}</p>
      <p><strong>Sex:</strong> ${h.sex} &middot; <strong>Age:</strong> ${params.ageYears < 1 ? 'under a year' : `${Math.floor(params.ageYears)} years`}</p>
      <p><strong>Breed:</strong> ${params.breed ? params.breed.name : h.is_cross ? 'Cross' : 'Unknown'} ${params.gaited ? html`<span class="badge badge-success">gaited</span>` : raw('')}</p>
      <p><strong>Bred by:</strong> ${bredByLine}</p>
      ${params.unregistrableFriesianChestnut
        ? html`<p class="notice">This Friesian is chestnut - a recessive that hides for generations in a closed studbook and occasionally surfaces. It could not be registered as a Friesian.</p>`
        : raw('')}
      <p><strong>Inbreeding coefficient:</strong> ${coiPercent}</p>
      ${params.mareStatus ? html`<p>${params.mareStatus}</p>` : raw('')}
    </div>
    <h2>Pedigree</h2>
    ${pedigreeTable}
    ${nameForm}
    ${params.owner ? barnNameForm : raw('')}
    ${genotypeBlock}
    <p><a href="/stables/${String(params.ownerStable.id)}/horses">Back to horses</a></p>
  `;
  return pageShell({
    title: displayNameFor(h),
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    subnav: params.owner ? stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer) : undefined,
    body,
  });
}

interface ImageOptionGroup {
  breedCode: string;
  breedName: string;
  options: ImageOption[];
}

function imageOptionTile(option: ImageOption, checked: boolean, usedByName: string | undefined): SafeHtml {
  return html`
    <label class="image-option">
      <input type="radio" name="image" value="${option.path}" ${checked ? raw('checked') : raw('')}>
      <img src="${option.path}" width="160" loading="lazy" alt="${option.alt}">
      ${usedByName ? html`<span class="image-option-note">also used by ${usedByName}</span>` : raw('')}
    </label>`;
}

/** The picker's page - slice 0007 §6.2. Owner-only on both GET and POST (the route enforces this;
 * this function just renders what it's given). No JavaScript: the selected tile is CSS on
 * `input:checked + img`, and the radio stays keyboard-focusable rather than display:none. */
export function renderImagePickerPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  visibleColour: string;
  groups: ImageOptionGroup[];
  usedBy: Map<string, string>;
  error?: string;
}): SafeHtml {
  const h = params.horse;
  const totalOptions = params.groups.reduce((n, g) => n + g.options.length, 0);
  const showGroupHeadings = params.groups.length > 1;

  const gridBody =
    totalOptions === 0
      ? html`<p>There are no pictures for ${displayNameFor(h)}'s breed yet.</p>`
      : html`
        <form method="post" action="/horses/${String(h.id)}/image">
          ${params.groups.map(
            (group) => html`
              ${showGroupHeadings ? html`<h2>${group.breedName}</h2>` : raw('')}
              <div class="image-grid">
                ${group.options.map((option) =>
                  imageOptionTile(option, option.path === h.image_url, params.usedBy.get(option.path))
                )}
              </div>`
          )}
          <div class="image-grid">
            <label class="image-option image-option--none">
              <input type="radio" name="image" value="${NO_PICTURE_VALUE}" ${h.image_url === null ? raw('checked') : raw('')}>
              <span class="image-placeholder-tile">No picture</span>
            </label>
          </div>
          <button type="submit">Save</button>
        </form>`;

  const body = html`
    <h1>Choose a picture for ${displayNameFor(h)}</h1>
    ${errorBox(params.error)}
    <p>${displayNameFor(h)} is really ${params.visibleColour} - pick whichever picture you like, it doesn't need to match.</p>
    ${gridBody}
    <p><a href="/horses/${String(h.id)}">Back to ${displayNameFor(h)}</a></p>
  `;
  return pageShell({
    title: `Picture for ${displayNameFor(h)}`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    subnav: stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

export function renderAdminHorseNewPage(params: {
  world: WorldRow;
  stables: StableRow[];
  breeds: BreedRow[];
  loci: LocusRow[];
  error?: string;
  form?: Record<string, string>;
}): SafeHtml {
  const f = params.form ?? {};

  const stableOptions = html`${params.stables.map(
    (s) => html`<option value="${String(s.id)}" ${f.stable_id === String(s.id) ? raw('selected') : raw('')}>${s.name}</option>`
  )}`;

  const breedOptions = html`${params.breeds.map(
    (b) => html`<option value="${String(b.id)}" data-code="${b.code}" ${f.breed_id === String(b.id) ? raw('selected') : raw('')}>${b.name}</option>`
  )}`;

  const locusRows = LOCI.map((locus) => {
    const locusRow = params.loci.find((l) => l.code === locus.code);
    const [a1, a2] = locus.alleles;
    const selected1 = f[`locus_${locus.code}_1`] ?? locus.wildType;
    const selected2 = f[`locus_${locus.code}_2`] ?? locus.wildType;
    const alleleOption = (value: string, selected: string) => html`<option value="${value}" ${value === selected ? raw('selected') : raw('')}>${value}</option>`;
    return html`
      <fieldset>
        <legend>${locusRow ? locusRow.name : locus.code} (${locus.code})</legend>
        <label>Allele 1
          <select name="locus_${locus.code}_1">${alleleOption(a1, selected1)}${alleleOption(a2, selected1)}</select>
        </label>
        <label>Allele 2
          <select name="locus_${locus.code}_2">${alleleOption(a1, selected2)}${alleleOption(a2, selected2)}</select>
        </label>
        ${locusRow ? html`<p class="muted">${locusRow.teaching_text}</p>` : raw('')}
      </fieldset>
    `;
  });

  const body = html`
    <h1>Create a founding horse</h1>
    ${errorBox(params.error)}
    <form method="post" action="/admin/horses/new">
      <label>Owning stable
        <select name="stable_id" required>${stableOptions}</select>
      </label>
      <label>Sex
        <select name="sex" required>
          <option value="mare" ${f.sex === 'mare' ? raw('selected') : raw('')}>Mare</option>
          <option value="stallion" ${f.sex === 'stallion' ? raw('selected') : raw('')}>Stallion</option>
        </select>
      </label>
      <label>Breed
        <select name="breed_id" required>${breedOptions}</select>
      </label>
      <label>Name
        <input type="text" name="name" required maxlength="40" value="${f.name ?? ''}">
      </label>
      <label>Age in years
        <input type="text" inputmode="numeric" name="age_years" required value="${f.age_years ?? '4'}">
      </label>
      <h2>Genotype</h2>
      ${locusRows}
      <button type="submit">Create horse</button>
    </form>
  `;
  return pageShell({ title: 'Create a founding horse', world: params.world, loggedIn: true, isAdmin: true, section: 'admin', body });
}
