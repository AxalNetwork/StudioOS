/**
 * D6060 (#6060, Pitch Studio v2 build 6/9, PS-06) — Review of one exact saved
 * version, pure: the six groups the canvas draws (completeness, evidence and
 * freshness, readability and layout, technical preflight, disclosure and
 * legal, approvals), each row with its status, its card and what to do. No
 * React and no fetch: `VersionReview.jsx` reads and draws it.
 *
 * It reuses what the studio already decides:
 *   · figures and their sources (`reviewTileModel.js`, D1523) with the deck
 *     check's claims (`checkModel.js`, D900) and its free consistency rules
 *     (D1555);
 *   · the preflight run on the saved version (`preflightModel.js` through
 *     `preflightUiModel.js`'s `groupsOf`, D1370): its "Couldn't check" stays
 *     its own status;
 *   · the forward-looking footnote and Confidential (`complianceModel.js`,
 *     D1546), whose wording stays with counsel (owner decision T, #3716);
 *   · the approvals D1570 stores (`reviewTileModel.js`'s `approvalView`).
 *
 * D6066: a card the founders mark `qualitative: true` reads "Qualitative by
 * choice" in the evidence group, never as evidence and never as a pass; the
 * mark only stops Review asking that card for a figure. Every figure the card
 * shows is still checked like any other.
 *
 * RULES. No readiness score and no verdict. A read that failed, a check that
 * has not run and a slide the page could not measure are "Couldn't check",
 * never "Passed". Every finding names its card and links to it.
 */
import { cardTitle } from './editorModel.js';
import { isTracked, statusOf } from './cardStatusModel.js';
import { FLS_FOOTNOTE, cardLines, settingsOf } from './complianceModel.js';
import { NEITHER_RIGHT, claimLine, consistencyView, cardsLabel } from './checkModel.js';
import { approvalView, claimFor, figureName, sourceLine } from './reviewTileModel.js';
import { EDIT_PATH } from './pitchStudioModel.js';

export const STATUS = Object.freeze({
  fix: 'To fix',
  look: 'Worth a look',
  unchecked: 'Couldn’t check',
  stale: 'Stale',
  approval: 'Needs approval',
  qualitative: 'Qualitative by choice',
  passed: 'Passed',
  running: 'Checking…',
});
/** The counts strip's order, the canvas's; "Checking…" shows only while a check runs. */
export const COUNT_ORDER = Object.freeze(['fix', 'look', 'unchecked', 'stale', 'approval', 'qualitative', 'passed', 'running']);

export const GROUPS = Object.freeze([
  { key: 'completeness', title: 'Completeness' },
  { key: 'evidence', title: 'Evidence & freshness' },
  { key: 'readability', title: 'Readability & layout' },
  { key: 'preflight', title: 'Technical preflight' },
  { key: 'disclosure', title: 'Disclosure & legal' },
  { key: 'approvals', title: 'Approvals' },
]);

export const NO_SCORE = 'No readiness score: each check says what it found, on which card, and what to do. A check that couldn’t run is not a pass.';
export const EXACT_LINE = 'The exact version investors would receive. Your working draft is not part of this check.';
export const NO_VERSION = 'There is no saved version to review yet. Save a version in the Editor, then review it here.';
export const QUALITATIVE_DETAIL = 'Marked by the founders: no figure is asked of this card. The mark is not evidence.';
export const MARK = 'Mark as intentionally qualitative';
export const CLEAR_MARK = 'Clear the mark';

/** Which preflight check reads in which group; `sources` is the evidence group's, from the figures and their records. */
const PREFLIGHT_GROUP = Object.freeze({
  layout: 'readability', overflow: 'readability', density: 'readability', font: 'readability',
  contrast: 'preflight', image: 'preflight', alt: 'preflight', theme: 'preflight',
  placeholder: 'completeness',
});

const str = (v) => String(v ?? '').trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─────────────────────────────────────────────────────────── the mark (D6066)

/** Whether a saved card carries the founders' mark. Only `true` is the mark. */
export const isQualitative = (card) => card?.qualitative === true;

/** The card with the mark set, or without it: unmarked is the field absent, as the Worker keeps it. */
export function withQualitative(card, on) {
  const { qualitative: _drop, ...rest } = card || {};
  return on ? { ...rest, qualitative: true } : rest;
}

/** The Editor card menu's item. */
export const markLabel = (card) => (isQualitative(card) ? CLEAR_MARK : MARK);

// ─────────────────────────────────────────────────────────── links

/** The Editor on card `index` (0-based); the link counts from 1. The venture rides along. */
export function cardHref(projectId, index) {
  const q = new URLSearchParams();
  if (projectId != null) q.set('project_id', String(projectId));
  if (Number.isInteger(index) && index >= 0) q.set('card', String(index + 1));
  return `${EDIT_PATH}?${q.toString()}`;
}

/** "Card 4 · Traction". */
export const cardName = (slides, index) => `Card ${index + 1} · ${cardTitle(slides?.[index], index)}`;

/** Whether a card carries anything: a block with content, or the older fielded shape's words. */
export function hasContent(card) {
  const blocks = Array.isArray(card?.blocks) ? card.blocks : [];
  if (blocks.some((b) => b && (b.kind !== 'text' || str(b.text)))) return true;
  if (str(card?.body) || (Array.isArray(card?.bullets) && card.bullets.some((x) => str(x)))) return true;
  const filled = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : Boolean(str(v)));
  return Array.isArray(card?.fields) && card.fields.some((f) => filled(f?.value));
}

// ─────────────────────────────────────────────────────────── rows

const row = (status, id, title, { detail = null, card = null, action = null } = {}) => ({ id, status, title, detail, card, action });
/** A read that failed: its own row, "Couldn't check", with Try again for that read. */
const failedRow = (id, title, read) => row('unchecked', id, title, { detail: 'It could not be read, so it was not checked. It is not a pass.', action: { kind: 'retry', read } });
const runningRow = (id, title) => row('running', id, title);
const isOk = (r) => r?.status === 'ok';
const isError = (r) => r?.status === 'error';

/** Completeness: every card has content, the cards tracked are Done, no placeholder is left. */
function completeness(slides, pf) {
  const rows = [];
  const empty = slides.map((s, i) => (hasContent(s) ? null : i)).filter((i) => i !== null);
  for (const i of empty) rows.push(row('fix', `empty:${i}`, `${cardName(slides, i)}: nothing on the card`, { detail: 'It would reach investors blank. Add its content, or remove the card.', card: i }));
  if (!empty.length) rows.push(row('passed', 'cards', `${plural(slides.length, 'card')}, each with content`));
  const tracked = isTracked(slides);
  const notDone = tracked ? slides.map((s, i) => (statusOf(s, tracked) === 'done' ? null : i)).filter((i) => i !== null) : [];
  for (const i of notDone) rows.push(row('look', `notdone:${i}`, `${cardName(slides, i)}: not Done`, { detail: 'Its status in the Editor is not Done. You can share with it.', card: i }));
  if (tracked && !notDone.length) rows.push(row('passed', 'done', 'Every card is Done'));
  rows.push(...preflightRows(pf, 'completeness', slides));
  return rows;
}

/**
 * Evidence and freshness, from the figures read, the deck check and the
 * refresh read. A figure: Mismatch and No source are To fix; Stale is Stale;
 * Not backed, a founder's figure and a typed figure are Worth a look; a
 * linked figure counts towards one Passed line. A card with no figure is
 * Worth a look, unless the founders marked it: then "Qualitative by choice".
 */
function evidence(slides, { figures, check, refresh, canCheck }) {
  const rows = [];
  const marked = new Set(slides.map((s, i) => (isQualitative(s) ? i : null)).filter((i) => i !== null));
  const hidden = (i) => slides[i]?.hidden === true;

  if (!isOk(figures)) {
    rows.push(isError(figures) ? failedRow('figures', 'The figures on this version', 'figures') : runningRow('figures', 'Reading the figures on this version'));
  } else {
    const list = (Array.isArray(figures.data?.figures) ? figures.data.figures : []).filter((f) => f && Number.isInteger(f.card) && f.card >= 0 && f.card < slides.length);
    const claims = isOk(check) ? check.data?.claims ?? [] : [];
    let linked = 0;
    list.forEach((f, n) => {
      const claim = claimFor(f, claims);
      const name = `${cardName(slides, f.card)}: ${figureName(f)}`;
      const id = `figure:${f.card}:${f.block_id ?? 'x'}:${n}`;
      const at = { card: f.card };
      const shown = claim?.display_state;
      if (shown === 'mismatch') rows.push(row('fix', id, name, { ...at, detail: claimLine(claim) || `It differs from the record. ${NEITHER_RIGHT}` }));
      else if (f.state === 'uncited') rows.push(row('fix', id, name, { ...at, detail: 'No source: nothing on file backs it. Link it to a record, or say where it comes from.' }));
      else if (shown === 'stale') rows.push(row('stale', id, name, { ...at, detail: claimLine(claim) }));
      else if (shown === 'not_backed' || shown === 'founders_figure') rows.push(row('look', id, name, { ...at, detail: claimLine(claim) }));
      else if (f.state === 'stated') rows.push(row('look', id, name, { ...at, detail: `${sourceLine(f)}. Link it to a record so an investor can see where it comes from.` }));
      else if (f.state !== 'linked') rows.push(row('look', id, name, { ...at, detail: 'Its source is not recorded.' }));
      else linked += 1;
    });
    const withFigure = new Set(list.map((f) => f.card));
    // D6066: a marked card is never a gap, and never counted as evidence.
    for (const i of marked) {
      const n = list.filter((f) => f.card === i).length;
      rows.push(row('qualitative', `qualitative:${i}`, cardName(slides, i), {
        card: i,
        detail: n ? `${QUALITATIVE_DETAIL} Its ${plural(n, 'figure')} ${n === 1 ? 'is' : 'are'} still checked here.` : QUALITATIVE_DETAIL,
      }));
    }
    slides.forEach((s, i) => {
      if (withFigure.has(i) || marked.has(i) || hidden(i)) return;
      rows.push(row('look', `nofigure:${i}`, `${cardName(slides, i)}: no figure`, { card: i, detail: 'Add a figure from your records, or mark the card as intentionally qualitative from its menu in the Editor.' }));
    });
    if (linked) rows.push(row('passed', 'linked', `${plural(linked, 'figure')} linked to ${linked === 1 ? 'its record' : 'their records'}`));
    if (!list.length && !marked.size && slides.every((_, i) => hidden(i))) rows.push(row('passed', 'nofigures', 'This version states no figures'));
  }

  // The deck check against the records (D900): a version never checked is not a pass.
  if (isError(check)) rows.push(failedRow('check', 'Figures against your records', 'check'));
  else if (!isOk(check)) rows.push(runningRow('check', 'Reading the check against your records'));
  else if (!check.data?.checked) {
    rows.push(row('unchecked', 'check', 'Figures against your records: not checked on this version', {
      detail: 'The check compares each figure with your records. Until it runs, nothing here is a pass.',
      action: canCheck ? { kind: 'run-check' } : null,
    }));
  } else {
    const view = consistencyView(check.data?.consistency);
    if (view.kind === 'unreadable') rows.push(failedRow('consistency', 'Consistency across cards', 'check'));
    for (const f of view.rows) rows.push(row('look', `consistency:${f.key}`, f.message, { card: f.cards.length ? f.cards[0] - 1 : null, detail: f.cards.length ? `On ${cardsLabel(f.cards)}.` : null }));
    if (view.kind === 'empty') rows.push(row('passed', 'consistency', 'Figures agree across cards'));
  }

  // Freshness (D896): a bound figure its store has moved past.
  if (isError(refresh)) rows.push(failedRow('refresh', 'Freshness of bound figures', 'refresh'));
  else if (!isOk(refresh)) rows.push(runningRow('refresh', 'Reading the freshness of bound figures'));
  else {
    const moved = new Map();
    for (const r of Array.isArray(refresh.data?.rows) ? refresh.data.rows : []) {
      if ((r?.state === 'stale' || r?.state === 'gone') && Number.isInteger(r.slide) && r.slide >= 0 && r.slide < slides.length) moved.set(r.slide, moved.get(r.slide) === 'gone' ? 'gone' : r.state);
    }
    for (const [i, state] of [...moved].sort((a, b) => a[0] - b[0])) {
      rows.push(row('stale', `fresh:${i}`, `${cardName(slides, i)}: ${state === 'gone' ? 'a bound figure is no longer in its store' : 'a bound figure has changed in its store'}`, { card: i, detail: 'Refresh it in the Editor, or keep it as of its date.' }));
    }
    const unknown = (Array.isArray(refresh.data?.rows) ? refresh.data.rows : []).filter((r) => r?.state === 'unknown').length;
    if (unknown) rows.push(row('unchecked', 'fresh:unknown', `${plural(unknown, 'bound figure')}: freshness unknown`, { detail: 'Its store did not say whether it moved. It is not a pass.' }));
    if (!moved.size && !unknown) rows.push(row('passed', 'fresh', 'Every bound figure is current'));
  }
  return rows;
}

/** The preflight's rows for one group: its findings, what it couldn't check, and the checks that passed. */
function preflightRows(pf, group, slides) {
  if (!pf) return [];
  if (pf.state === 'running') {
    const total = pf.total || slides.length;
    return [runningRow(`pf:${group}`, `Measuring ${plural(total, 'card')} at 1920 × 1080 · ${Math.min(pf.done + 1, total)} of ${total}`)];
  }
  if (pf.state !== 'done' || !pf.groups) return [runningRow(`pf:${group}`, 'Waiting to measure the cards')];
  const mine = (r) => PREFLIGHT_GROUP[r.check] === group;
  const rows = [];
  for (const r of pf.groups.fix.filter(mine)) rows.push(row('fix', `pf:${r.id}`, `${cardName(slides, r.card)}: ${r.headline}`, { card: r.card, detail: r.fix || r.detail || null }));
  for (const r of pf.groups.look.filter(mine)) rows.push(row('look', `pf:${r.id}`, `${cardName(slides, r.card)}: ${r.headline}`, { card: r.card, detail: r.fix || r.detail || null }));
  // What the page could not measure: a slide it could not draw counts in both measured groups; a check left "Not measured" in its own.
  for (const u of pf.groups.unchecked) {
    const check = u.id.startsWith('check:') ? u.id.slice(6) : null;
    if (check ? PREFLIGHT_GROUP[check] !== group : (group !== 'readability' && group !== 'preflight')) continue;
    const card = u.card ?? u.firstCard ?? null;
    rows.push(row('unchecked', `pf:${u.id}`, card != null && u.slide != null ? `${cardName(slides, card)}: couldn’t be measured` : `${u.where}: couldn’t be measured`, {
      card, detail: u.detail, action: u.slide != null ? { kind: 'remeasure', card: u.card } : null,
    }));
  }
  const measured = new Set(pf.groups.unchecked.map((u) => (u.id.startsWith('check:') ? u.id.slice(6) : null)).filter(Boolean));
  for (const c of pf.checks ?? []) {
    if (c.state !== 'pass' || PREFLIGHT_GROUP[c.key] !== group || measured.has(c.key)) continue;
    rows.push(row('passed', `pf:pass:${c.key}`, c.label));
  }
  if (pf.kitFailed && group === 'preflight') {
    // Contrast is measured against the brand kit's colours: without them it was not checked.
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].id.startsWith('pf:contrast') || rows[i].id === 'pf:pass:contrast') rows.splice(i, 1);
    rows.push(failedRow('kit', 'Contrast against your brand kit', 'kit'));
  }
  if (group !== 'completeness' && pf.dismissed) rows.push(row('passed', `pf:dismissed:${group}`, `${plural(pf.dismissed, 'warning')} dismissed in the Editor`, { detail: 'Dismissed for this version by an editor of the deck.' }));
  return rows;
}

/**
 * Disclosure: the forward-looking footnote on each card whose figure is a
 * projection (the rule `complianceModel.js` mirrors; its wording is
 * counsel's, untouched here), and Confidential.
 */
function disclosure(slides, theme, today) {
  const rows = [];
  const settings = settingsOf(theme);
  // The rule run with the footnote on, so a card that would need it is found even when the deck turned it off.
  const on = { ...(theme || { kind: 'brand', background: null }), compliance_fls: true };
  const projected = slides.map((s, i) => (cardLines(s, on, today).includes(FLS_FOOTNOTE) ? i : null)).filter((i) => i !== null);
  if (!projected.length) rows.push(row('passed', 'fls', 'No card shows a projection bound to your model'));
  else if (settings.compliance_fls) rows.push(row('passed', 'fls', `Forward-looking notice on ${cardsLabel(projected.map((i) => i + 1))}`, { detail: 'Added to every card that shows a projection.' }));
  else {
    for (const i of projected) rows.push(row('fix', `fls:${i}`, `${cardName(slides, i)}: shows a projection without the forward-looking notice`, { card: i, detail: 'The notice is turned off for this deck. Turn it back on in the Editor’s theme.' }));
  }
  rows.push(settings.confidential
    ? row('passed', 'confidential', 'Confidential on every card')
    : row('look', 'confidential', 'Confidential is off for this version', { detail: 'Every card reaches investors without the Confidential mark. Turn it on in the Editor’s theme.' }));
  return rows;
}

/** Approvals (D1570): each approver by name, waiting or approved this version. */
function approvals(approval) {
  if (isError(approval)) return [failedRow('approval', 'Approvals for this version', 'approval')];
  if (!isOk(approval)) return [runningRow('approval', 'Reading the approvals')];
  const view = approvalView(approval.data);
  if (!view.rows.length) return [row('passed', 'approval:none', 'No approval is asked for this version', { detail: 'No one is named to approve it.' })];
  return view.rows.map((a) => (a.approved
    ? row('passed', `approval:${a.id}`, `Approved by ${a.name}`, { detail: a.at ? `On ${a.at}` : null })
    : row('approval', `approval:${a.id}`, `Approval from ${a.name}`, { detail: 'Waiting. Sharing is held until they approve this version.' })));
}

/**
 * The whole Review of one saved version. `deck` is the version as read
 * (`{ id, version, slides, theme }`); every other argument is one read
 * (`{ status: 'loading' | 'ok' | 'error', data }`) except `pf`, the
 * preflight on the saved version (`{ state: 'running' | 'done', done,
 * total, groups, checks, dismissed, kitFailed }`): `checks` is
 * `runPreflight`'s own list, each with its state.
 */
export function reviewOf({ deck, figures, check, refresh, approval, pf = null, canCheck = false, today = new Date().toISOString().slice(0, 10) }) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: g.key === 'completeness' ? completeness(slides, pf)
      : g.key === 'evidence' ? evidence(slides, { figures, check, refresh, canCheck })
      : g.key === 'readability' || g.key === 'preflight' ? preflightRows(pf, g.key, slides)
      : g.key === 'disclosure' ? disclosure(slides, deck?.theme ?? null, today)
      : approvals(approval),
  }));
  return { groups, counts: countsOf(groups) };
}

/** How many rows are in each status, over every group. */
export function countsOf(groups) {
  const counts = Object.fromEntries(COUNT_ORDER.map((k) => [k, 0]));
  for (const g of groups || []) for (const r of g.rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

/** The strip: "2 to fix", "1 couldn’t check", … in the canvas's order, a status with none left out. */
export function countPills(counts) {
  return COUNT_ORDER.filter((k) => counts?.[k] > 0).map((k) => ({ key: k, label: `${counts[k]} ${k === 'running' ? 'checking' : STATUS[k].toLowerCase()}` }));
}

/** "v7 · saved 8 Nov, 16:40", the version the page checked. */
export function checkingLine(version, savedAt) {
  const v = version?.version == null ? 'Version not recorded' : `v${version.version}`;
  const when = savedLabel(savedAt);
  return when ? `${v} · saved ${when}` : v;
}

/** "8 Nov, 16:40" in UTC, or null when the stamp is missing or unreadable. */
export function savedLabel(at) {
  if (!at) return null;
  const s = String(at);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day}, ${d.toISOString().slice(11, 16)}`;
}

/** The action a row offers: Go to card for a finding, Try again for a read, Remind is not built. */
export function actionOf(r) {
  if (r.status === 'passed' || r.status === 'running') return null;
  if (r.action?.kind === 'retry') return { kind: 'retry', label: 'Try again', read: r.action.read };
  if (r.action?.kind === 'remeasure') return { kind: 'remeasure', label: 'Try again', card: r.action.card };
  if (r.action?.kind === 'run-check') return { kind: 'run-check', label: 'Run the check' };
  if (Number.isInteger(r.card)) return { kind: 'card', label: 'Go to card' };
  return null;
}
