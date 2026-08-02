// The one player-facing screen for founding stock, in the four states slice 0005 §11 describes:
// no offer waiting, pending a breed choice, open for claiming, and claimed. The player-facing
// wording never says "import" - that is the table name, not what a child reads (slice 0005 §6.1).

import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import { stableSubnav } from './stables';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import type { BreedRow } from '../db/breeds';
import type { ImportOfferRow, ImportCandidateRow } from '../db/founding';
import type { ConformationDisplayRow } from '../engines/conformation/model';

/** One plain sentence per breed, for the breed picker (slice 0005 §11) - not stored on the breeds
 * row because it's display copy, not data anything else reads. Keep in sync with the breed pools
 * seeded in migrations/0014_seed_breeds.sql and 0024_seed_breed_pools.sql (slice 0005 §5.3). */
const BREED_BLURBS: Record<string, string> = {
  QH: 'Quarter Horse — solid stock colours (bay, black, chestnut, and the occasional palomino or buckskin), never gaited.',
  AR: 'Arabian — refined, no dilute colours, and prone to greying out as they age.',
  TB: 'Thoroughbred — solid colours only, built for speed, never gaited.',
  PF: "Paso Fino — smooth-gaited, almost always. Its famous pinto patches aren't in the game's genetics yet.",
  IC: "Icelandic — smooth-gaited, almost always, hardy little horses. Its famous silver and dun colours aren't in the game's genetics yet.",
  GW: 'German Warmblood — solid colours, built for jumping and dressage, never gaited.',
  FR: 'Friesian — black, and only black. No dilutions, no patterns, no grey.',
  NOK: "Nokota — tough range stock; about one in a hundred is gaited. Its famous roan and grullo colours aren't in the game's genetics yet.",
};

function candidateSexLabel(sex: 'mare' | 'stallion'): string {
  return sex === 'mare' ? 'Mare' : 'Stallion';
}

export function renderFoundingPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  stable: StableRow;
  offer: ImportOfferRow | null;
  breeds?: BreedRow[];
  candidates?: { candidate: ImportCandidateRow; description: string; gaited: boolean; conformation: ConformationDisplayRow[] }[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const s = params.stable;
  const hasFoundingOffer = params.offer !== null && (params.offer.status === 'pending' || params.offer.status === 'open');

  let body: SafeHtml;

  if (!params.offer) {
    body = html`
      <h1>New horses</h1>
      ${noticeBox(params.notice)}
      <p>No new horses are waiting for ${s.name} right now.</p>
    `;
  } else if (params.offer.status === 'pending') {
    const breedOptions = (params.breeds ?? []).map(
      (b) => html`
      <div class="card">
        <label>
          <input type="radio" name="breed_id" value="${String(b.id)}" required>
          <strong>${b.name}</strong> — ${BREED_BLURBS[b.code] ?? ''}
        </label>
      </div>`
    );
    body = html`
      <h1>New horses</h1>
      ${errorBox(params.error)}
      <p>${s.name} has a batch of founding horses waiting. Choose a breed - this choice is final and cannot be changed later.</p>
      <form method="post" action="/stables/${String(s.id)}/founding">
        <input type="hidden" name="action" value="choose_breed">
        ${breedOptions}
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, I've chosen - this breed can't be changed once I confirm.
        </label>
        <button type="submit">Confirm breed</button>
      </form>
    `;
  } else if (params.offer.status === 'open') {
    const offer = params.offer;
    const rows = (params.candidates ?? []).map(
      ({ candidate, description, gaited, conformation }) => html`
      <div class="card">
        <h2>
          ${candidate.origin_prefix} ${candidate.name_part}
          ${gaited ? html`<span class="badge badge-success">gaited</span>` : raw('')}
        </h2>
        <p class="muted">${candidateSexLabel(candidate.sex)}</p>
        <p>${description}</p>
        <p class="muted conformation-compact">${html`${conformation.map((row) => `${row.name}: ${String(row.expressed)}`).join(' · ')}`}</p>
        <label>
          <input type="checkbox" name="chosen_${String(candidate.slot_index)}" value="yes">
          Claim this one
        </label>
      </div>`
    );
    body = html`
      <h1>New horses</h1>
      ${errorBox(params.error)}
      <p>Choose ${String(offer.mare_claims)} mare${offer.mare_claims === 1 ? '' : 's'} and ${String(offer.stallion_claims)} stallion${offer.stallion_claims === 1 ? '' : 's'} from the ${String(offer.mare_candidates + offer.stallion_candidates)} below. The rest won't be seen again.</p>
      <form method="post" action="/stables/${String(s.id)}/founding">
        <input type="hidden" name="action" value="claim">
        ${rows}
        <button type="submit">Claim these horses</button>
      </form>
    `;
  } else {
    body = html`
      <h1>New horses</h1>
      ${noticeBox(params.notice)}
      <p>These horses have already joined ${s.name}.</p>
      <p><a class="button-link" href="/stables/${String(s.id)}/horses">Go to the barn</a></p>
    `;
  }

  return pageShell({
    title: 'New horses',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    subnav: stableSubnav(s.id, 'founding', hasFoundingOffer),
    body,
  });
}
