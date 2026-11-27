/**
 * D6166 (#6166; D1587's founder control): pure words and derivations of
 * "Shared on a deal", the founder's grants of one frozen version to one
 * investor on one deal (`DeckGrants.jsx`, over `deckGrantsApi`).
 *
 * A row carries the investor's name and firm, the version, the four ticks and
 * the granted and withdrawn dates, and nothing else the Worker could send: a
 * row is built field by field, so an investor's note, score or decision never
 * reaches the screen even if a later read carried one.
 */
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { NOT_RECORDED, dayLabel, versionLabel } from './pitchStudioModel';

/** The four switches a grant carries (D902), in the share dialog's order. */
export const GRANT_TICKS = [
  { key: 'figures', label: 'Figures', long: 'Figures with chips' },
  { key: 'sources', label: 'Sources', long: 'Sources appendix' },
  { key: 'notes', label: 'Notes', long: 'Speaker notes' },
  { key: 'bands', label: 'Bands', long: 'Scorecard and Product-market fit bands' },
];

/** The Worker's default when nothing is ticked yet (`DEFAULT_SHARE_INCLUDE`). */
export const DEFAULT_TICKS = Object.freeze({ figures: true, sources: true, notes: false, bands: false });

export const SECTION_TITLE = 'Shared on a deal';
export const SECTION_LINE = 'One saved version for one investor on one of your deals. They open it on their own deal page, with only what you tick.';
export const GRANT_BUTTON = 'Share a version…';
export const DEALS_FAILED = 'Your deals could not be read.';
export const NO_DEAL = 'This venture has no deal yet. A version is shared with an investor on a deal.';
export const NO_GRANT = 'No investor has been given a version on this deal yet.';
export const NO_INVESTOR = 'No investor on this deal can receive a version yet. An investor needs an invitation or a commitment on the deal.';
export const NO_VERSION = 'Save a version of your deck first. Only a saved version can be shared.';

const STATUS_WORDS = { applied: 'Applied', scored: 'Scored', active: 'Active', funded: 'Funded', rejected: 'Passed' };

/** The venture's own deals, newest first, each with the label the picker shows. */
export function ventureDeals(list, projectId) {
  const rows = Array.isArray(list) ? list : [];
  return rows
    .filter((d) => d && d.id != null && projectId != null && String(d.project_id) === String(projectId))
    .map((d) => ({ id: Number(d.id), label: dealLabel(d) }));
}

export function dealLabel(d) {
  const status = STATUS_WORDS[d?.status] || 'Stage not recorded';
  return `Deal #${d?.id} · ${status} · opened ${dayLabel(d?.created_at)}`;
}

/** "Figures · Sources", or "None of the four" — never blank. */
export function tickWords(included) {
  const on = GRANT_TICKS.filter((t) => included?.[t.key] === true).map((t) => t.label);
  return on.length ? on.join(' · ') : 'None of the four';
}

const versionOf = (n) => versionLabel({ version: n == null || !Number.isFinite(Number(n)) ? null : Number(n) });

/** The list's rows: name, firm, version, ticks, granted, withdrawn. Only those. */
export function grantRows(grants) {
  return (Array.isArray(grants) ? grants : []).map((g) => ({
    uid: String(g.uid),
    userId: g.investor?.user_id == null ? null : Number(g.investor.user_id),
    name: String(g.investor?.name || '').trim() || NOT_RECORDED,
    firm: String(g.investor?.firm || '').trim() || NOT_RECORDED,
    version: versionOf(g.version),
    ticks: tickWords(g.included),
    granted: dayLabel(g.granted_at),
    withdrawn: g.withdrawn_at ? dayLabel(g.withdrawn_at) : null,
    live: !g.withdrawn_at,
  }));
}

/** The picker's investors, one per person (the Worker grants to a person's first firm on the deal). */
export function investorOptions(investors) {
  const seen = new Set();
  const out = [];
  for (const i of Array.isArray(investors) ? investors : []) {
    const id = Number(i?.user_id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const name = String(i.name || '').trim() || 'Name not recorded';
    const firm = String(i.firm || '').trim() || 'Firm not recorded';
    out.push({ id, name, label: `${name} · ${firm}` });
  }
  return out;
}

/** The saved versions the founder may share, newest first. */
export function versionOptions(versions) {
  return [...(Array.isArray(versions) ? versions : [])]
    .filter((v) => v && v.id != null)
    .sort((a, b) => Number(b.version ?? -1) - Number(a.version ?? -1))
    .map((v) => ({
      id: Number(v.id),
      label: `${versionLabel(v)} · ${String(v.title || '').trim() || 'Untitled deck'} · saved ${dayLabel(v.created_at)}`,
      short: versionLabel(v),
    }));
}

/** The investor's live grant on this deal, if they have one. */
export function liveGrantFor(rows, userId) {
  if (userId == null) return null;
  return (rows || []).find((r) => r.live && r.userId === Number(userId)) || null;
}

/** Said in the dialog before Share is pressed, when the investor already has a live grant. */
export function replaceLine(live, nextVersion) {
  if (!live) return null;
  return `${live.name} already has ${live.version} on this deal, shared ${live.granted}. Sharing replaces it: `
    + `${live.version} stops opening for them and ${nextVersion} opens instead, with the ticks below.`;
}

/** Said in the withdraw confirm: what the investor loses. */
export function withdrawLine(row) {
  return `${row.name} can no longer open ${row.version} on their deal page. Their deck panel will say the venture has not shared its deck with them. `
    + 'The row stays here with the date it was withdrawn.';
}

export const grantedLine = (name, version, replaced) => (replaced
  ? `${name} now opens ${version} on this deal. The earlier grant is withdrawn.`
  : `${name} can open ${version} on this deal.`);

export const withdrawnLine = (row) => `${row.name} can no longer open ${row.version} on this deal.`;

/** The POST body: the version, the investor and exactly the four ticks. */
export function grantBody({ deckId, investorId, ticks }) {
  const include = {};
  for (const t of GRANT_TICKS) include[t.key] = ticks?.[t.key] === true;
  return { deck_id: Number(deckId), investor_user_id: Number(investorId), include };
}

/** A refusal in the Worker's words; a bare failure says so plainly. */
export const refusalText = (e, fallback) => userFacingRaiseError(e, { fallback, scope: 'raise:pitch:deck-grants' });
