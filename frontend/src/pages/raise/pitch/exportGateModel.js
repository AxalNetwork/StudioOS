/**
 * D8772 (#8772) part 3 — the preflight gate inside Export (PTF05 to PTF07), pure:
 *
 *   - `scopeLine`: what the dialog's check read, a saved version, never the draft
 *     ("Checked: v7 · the saved version Export sends");
 *   - `confirmWords`: the confirmation that replaces "Export anyway", a checkbox
 *     ("Export v7 with these 3 warnings") with what the history keeps of it, and
 *     why Export waits ("Export PDF waits for the confirmation above.");
 *   - `findingKey` and `draftSummary`: a finding named by its card's uid, block,
 *     check and headline, so a finding of the saved version and one of the draft
 *     can be compared although hidden cards number the export's slides apart;
 *   - `draftDiffers`: the note under the gate when the draft has unsaved edits on
 *     the version being exported ("Your draft differs from v7. It has fixed 1
 *     finding v7 still has (Slide 3 · Metric · MRR $34.2k) and has 1 blocker v7
 *     doesn't have (Slide 5 · Title). Save version to export your draft.");
 *   - `inDraft` and `showInDraftLabel`: "Show in your draft", offered on a row
 *     only when its card is in the draft;
 *   - `confirmedIds` and `confirmedLine`: the warnings' ids the export sends for
 *     its ledger row (`deck_exports.warnings_confirmed`, migration 202611271712),
 *     and the history's "Exported with 3 warnings confirmed".
 * It reads `preflightUiModel.js`'s rows and gates and never changes them.
 */
import { cardUid } from './editorModel.js';
import { SEVERITY } from './preflightModel.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const vName = (version) => (version != null ? `v${version}` : 'this version');
const list = (wheres) => `${wheres.slice(0, 3).join(', ')}${wheres.length > 3 ? ` and ${wheres.length - 3} more` : ''}`;

/** PTF05: what Export's own check read. */
export const scopeLine = (version) => `Checked: ${vName(version)} · the saved version Export sends`;

/**
 * PTF05: the confirmation, by the version and the count of warnings. `record` is what the
 * ledger keeps of it, which is true once the export carries `confirmed` (part 3's column).
 */
export function confirmWords(version, count, button) {
  const n = Number(count) || 0;
  return {
    label: `Export ${vName(version)} with ${n === 1 ? 'this warning' : `these ${n} warnings`}`,
    record: `The export history records the version, the format, the file’s fingerprint and the ${n === 1 ? 'warning' : `${n} warnings`} you confirmed.`,
    waits: `${button || 'Export'} waits for the confirmation above.`,
    done: `Exporting ${vName(version)} with ${n === 1 ? 'the warning' : `the ${n} warnings`} above confirmed.`,
  };
}

/** A finding by what it is about, the same in the saved version's check and the draft's. */
export function findingKey(row, slides) {
  if (!row) return null;
  const card = Array.isArray(slides) && Number.isInteger(row.card) ? slides[row.card] : null;
  const where = cardUid(card) ?? (Number.isInteger(row.card) ? `#${row.card}` : '-');
  return `${where}|${row.block ?? '-'}|${row.check ?? '-'}|${row.headline ?? ''}`;
}

/**
 * The editor's draft, as Export reads it: which version it was edited from, whether it has
 * unsaved edits, the uids of its cards, and (when its check is current) its findings by key.
 * `groups` is the draft check's `groupsOf()`, or null when it has not run on this draft.
 */
export function draftSummary({ deck, cards, dirty, groups }) {
  const slides = Array.isArray(cards) ? cards : [];
  return {
    deckId: deck?.id ?? null,
    version: deck?.version ?? null,
    dirty: Boolean(dirty),
    uids: slides.map(cardUid).filter(Boolean),
    findings: groups ? [...(groups.fix || []), ...(groups.look || [])].map((r) => ({ key: findingKey(r, slides), severity: r.severity, where: r.where })) : null,
  };
}

/**
 * PTF05's note: with unsaved edits on the version being exported, how the draft differs from it.
 * Null with no edits, without a draft, or for another version than the draft's.
 * `rows` are the export gate's findings (to fix and worth a look); `slides` the export's cards.
 */
export function draftDiffers({ draft, version, rows, slides }) {
  if (!draft || !draft.dirty || version?.id == null || String(draft.deckId) !== String(version.id)) return null;
  const v = vName(version.version);
  const tail = 'Save version to export your draft.';
  if (!Array.isArray(draft.findings) || !Array.isArray(rows)) {
    return `Your draft differs from ${v}: its unsaved edits are not in this export and were not checked here. ${tail}`;
  }
  const inDraft = new Set(draft.findings.map((f) => f.key));
  const inVersion = new Set(rows.map((r) => findingKey(r, slides)));
  const fixed = rows.filter((r) => !inDraft.has(findingKey(r, slides))).map((r) => r.where);
  const added = draft.findings.filter((f) => f.severity === SEVERITY.blocking && !inVersion.has(f.key)).map((f) => f.where);
  const parts = [];
  if (fixed.length) parts.push(`has fixed ${plural(fixed.length, 'finding', 'findings')} ${v} still has (${list(fixed)})`);
  if (added.length) parts.push(`has ${plural(added.length, 'blocker', 'blockers')} ${v} doesn’t have (${list(added)})`);
  if (!parts.length) return `Your draft differs from ${v}, with the same findings. ${tail}`;
  return `Your draft differs from ${v}. It ${parts.join(' and ')}. ${tail}`;
}

/** "Show in your draft" is offered only for a finding whose card the draft still has. */
export function inDraft(draft, row, slides) {
  if (!draft || !row || !Number.isInteger(row.card)) return false;
  const uid = cardUid(Array.isArray(slides) ? slides[row.card] : null);
  return Boolean(uid) && Array.isArray(draft.uids) && draft.uids.includes(uid);
}

/** "Show metric MRR $34.2k in your draft": the row's own name, where the draft puts it. */
export const showInDraftLabel = (row) => String(row?.showLabel || 'Show this element').replace(/ on slide \d+$/, '') + ' in your draft';
export const SHOW_IN_DRAFT = 'Show in your draft';

/** The warnings an export confirms, by finding id, for its ledger row; none without a confirmation. */
export function confirmedIds(gate, confirmed) {
  if (!gate?.open) return [];
  return confirmed ? (gate.look || []).map((r) => r.id).filter((id) => typeof id === 'string') : [];
}

/** The ledger's "Exported with 3 warnings confirmed", or null when the row says none or never said. */
export function confirmedLine(row) {
  const n = row?.warnings_confirmed;
  return Number.isInteger(n) && n > 0 ? `Exported with ${plural(n, 'warning', 'warnings')} confirmed` : null;
}
