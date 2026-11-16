import { checksCell } from './checkModel.js';
import { REVIEW_PATH, EDIT_PATH, SHARE_PATH, currentVersion } from './pitchStudioModel.js';

const refuseCodes = new Set([401, 402, 403]);
const reportedCheckStates = ['backed', 'founders_figure', 'mismatch', 'not_backed'];

/** D5129: a refused read has a different meaning from a source that failed. */
export function pitchReadFailure(status) {
  return refuseCodes.has(status) ? 'refused' : 'unavailable';
}

export function adapterRead(answer) {
  if (answer?.available === true && answer.value != null) return { status: 'ok', data: answer.value };
  return { status: pitchReadFailure(answer?.status), data: null };
}

export function draftState(read) {
  if (read.status !== 'ok') return { kind: read.status };
  const { cards, doc, updated_at: at } = read.data || {};
  if (!Array.isArray(cards) || !Object.hasOwn(read.data ?? {}, 'doc')) return { kind: 'unavailable' };
  return cards.length || doc ? { kind: 'saved', at } : { kind: 'empty' };
}

export function versionReadiness(checks, version) {
  if (checks == null) return { kind: 'loading' };
  if (checks === 'error') return { kind: 'unavailable' };
  if (checks === 'refused') return { kind: 'refused' };
  const summary = checks.get(Number(version.id));
  if (!summary || typeof summary.checked !== 'boolean') return { kind: 'unavailable' };
  if (!summary.checked) return { kind: 'unchecked', line: 'Not checked' };
  if (!reportedCheckStates.every((state) => Number.isInteger(summary.counts?.[state]) && summary.counts[state] >= 0)) return { kind: 'unavailable' };
  const issues = ['mismatch', 'not_backed', 'stale'].some((state) => summary.counts[state] > 0);
  return { kind: issues ? 'issues' : 'checked', line: checksCell(summary) };
}

/** A card counts only when it has a figure and every reported figure is linked. */
export function linkedCardCoverage(deck, figures) {
  if (!Array.isArray(deck?.slides) || !Array.isArray(figures?.figures)) return null;
  const byCard = new Map();
  for (const figure of figures.figures) {
    if (!Number.isInteger(figure?.card) || figure.card < 0 || figure.card >= deck.slides.length) return null;
    byCard.set(figure.card, (byCard.get(figure.card) ?? true) && figure.state === 'linked');
  }
  return { linked: [...byCard.values()].filter(Boolean).length, total: deck.slides.length };
}

/** Choose at most one action. Each recommendation needs an affirmative read. */
export function nextPitchStep({ current, readiness, draft, links, readOnly }) {
  if (readOnly || current?.id == null || current?.version == null) return null;
  const version = `v${current.version}`;
  if (readiness.kind === 'unchecked') {
    return { kind: 'review', path: REVIEW_PATH, label: `Review ${version}`, title: `Review ${version} before sharing it`, line: 'This saved version has not been checked yet.' };
  }
  if (readiness.kind === 'issues') {
    return { kind: 'review', path: REVIEW_PATH, label: `Open Review`, title: `Review the flagged figures in ${version}`, line: readiness.line };
  }
  if (draft.kind === 'saved') {
    return { kind: 'draft', path: EDIT_PATH, label: 'Open draft', title: 'Continue your working draft', line: `Your draft changes are separate from saved version ${version}.` };
  }
  if (readiness.kind === 'checked' && draft.kind === 'empty' && links.status === 'ok'
    && Array.isArray(links.data?.links) && links.data.links.every((link) => ['expired', 'withdrawn', 'used_up'].includes(link?.status))) {
    return { kind: 'share', path: SHARE_PATH, label: 'Open Share & analytics', title: `Create an investor link for ${version}`, line: 'There is no active investor link for this saved version.' };
  }
  return null;
}

export function selectedPitchVersion(versions, requestedDeck) {
  return requestedDeck == null
    ? currentVersion(versions)
    : versions.find((version) => String(version.id) === requestedDeck) ?? null;
}

export function pitchVersionHref(path, q, deckId) {
  const query = new URLSearchParams(q);
  query.set('deck', String(deckId));
  return `${path}?${query}`;
}
