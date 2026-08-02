import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import { stableSubnav } from './stables';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import type { HorseRow } from '../db/horses';
import type { BreedRow, LocusRow } from '../db/breeds';
import type { Genotype } from '../engines/genetics/genotype';
import { LOCI } from '../engines/genetics/loci';

export function displayNameFor(horse: HorseRow): string {
  if (horse.registered_name) return horse.registered_name;
  if (horse.barn_name) return horse.barn_name;
  return horse.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt';
}

export function renderBarnList(params: {
  world: WorldRow;
  isAdmin: boolean;
  stable: StableRow;
  horses: { horse: HorseRow; description: string }[];
}): SafeHtml {
  const rows = params.horses.length
    ? params.horses.map(
        ({ horse, description }) => html`
        <div class="card">
          <h2><a href="/horses/${String(horse.id)}">${displayNameFor(horse)}</a></h2>
          <p>${description}</p>
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
    subnav: stableSubnav(params.stable.id, 'horses'),
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
  mares: HorseRow[];
  stallions: HorseRow[];
  describe: (h: HorseRow) => string;
  selectedMareId?: number;
  selectedStallionId?: number;
  preview?: BreedPreview;
  error?: string;
}): SafeHtml {
  const preview = params.preview;

  const previewBlock = preview
    ? html`
      <div class="card">
        <h2>This pairing</h2>
        <p><strong>Mare:</strong> ${preview.mareDescription}</p>
        <p><strong>Stallion:</strong> ${preview.stallionDescription}</p>
        <p><strong>Inbreeding coefficient of a foal from this pairing:</strong> ${preview.coiPercent}</p>
        ${preview.warning ? html`<p class="notice">${preview.warning}</p>` : raw('')}
        <form method="post" action="/stables/${String(params.stable.id)}/breed">
          <input type="hidden" name="action" value="confirm">
          <input type="hidden" name="mare_id" value="${String(preview.mareId)}">
          <input type="hidden" name="stallion_id" value="${String(preview.stallionId)}">
          <button type="submit">Confirm breeding</button>
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
    subnav: stableSubnav(params.stable.id, 'breed'),
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
  horse: HorseRow;
  description: string;
  ageYears: number;
  breed: BreedRow | undefined;
  gaited: boolean;
  breederStableName: string | null;
  pedigree: { sire: HorseRow | null; dam: HorseRow | null; sireSire: HorseRow | null; sireDam: HorseRow | null; damSire: HorseRow | null; damDam: HorseRow | null };
  canRegisterName: boolean;
  nameError?: string;
  barnNameNotice?: string;
  genotype?: Genotype;
  loci?: LocusRow[];
}): SafeHtml {
  const h = params.horse;
  const coiPercent = `${(h.coi * 100).toFixed(1)}%`;

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
      <p>${params.description}</p>
      <p><strong>Sex:</strong> ${h.sex} &middot; <strong>Age:</strong> ${params.ageYears < 1 ? 'under a year' : `${Math.floor(params.ageYears)} years`}</p>
      <p><strong>Breed:</strong> ${params.breed ? params.breed.name : h.is_cross ? 'Cross' : 'Unknown'} ${params.gaited ? html`<span class="badge badge-success">gaited</span>` : raw('')}</p>
      <p><strong>Bred by:</strong> ${h.breeder_prefix ? html`${h.breeder_prefix}${params.breederStableName ? ` (${params.breederStableName})` : ''}` : 'a founding stable (unbred stock)'}</p>
      <p><strong>Inbreeding coefficient:</strong> ${coiPercent}</p>
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
    subnav: params.owner ? stableSubnav(params.ownerStable.id, 'horses') : undefined,
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
