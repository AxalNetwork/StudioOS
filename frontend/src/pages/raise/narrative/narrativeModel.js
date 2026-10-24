/**
 * D906 (#2454) — the Investor narrative tool's addresses, words and
 * derivations, kept pure so the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/investor-narrative` is CycleRoute's module
 * page, and every `/raise/investor-narrative/<word>` is its record route
 * (`/raise/:slug/:id`, `cyclePaths.js` RECORD_ID). A version is a record whose
 * id is its number, so the tool's tabs are words CycleRoute reads as tabs, not
 * records (`isNarrativeTab`). No route is added: the module page is Home, a
 * numbered address is still a version, and `/new` is still New version.
 *
 * WHAT IS READ, AND FROM WHERE. Every figure comes from a read on `main`:
 *   - `GET /api/cycles/raise/modules/investor-narrative` → Home (the card, the
 *     versions table, From Mercury), as CycleRoute draws it today;
 *   - `GET …/modules/investor-narrative/form-options` → the saved versions,
 *     for the version picker and the compare;
 *   - `GET …/modules/investor-narrative/records/:version` → one version's
 *     narrative rows and its consistency check, as the Worker states them.
 * Nothing is a sample. A read that fails says so where its figure would be.
 *
 * Story (D910, #2694) reads the narrative's own stores, D908's sections and
 * bound figures, and PITCH's source registry; its derivations are in
 * `storyModel.js`.
 *
 * D911 (#2695): Positioning is stored (D908) and drawn here, from
 *   - `GET /api/cycles/raise/narrative/positioning?version=` → the core, the
 *     version's own fields and what the version reads;
 *   - `GET …/narrative/positioning/draft` → Validate's segments and
 *     competitors, and Eadwyn's open proposals.
 *
 * WHAT IS NOT DRAWN YET, AND WHO DRAWS IT. Claims' states, the deck side
 * of the check and objections are slot tasks on #2454 (D906 §6); this file
 * grows the derivation when its read lands.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const SLUG = 'investor-narrative';
export const HOME_PATH = `/raise/${SLUG}`;
export const NEW_PATH = `${HOME_PATH}/new`;
export const POSITIONING_PATH = `${HOME_PATH}/positioning`;
/** The old address, now a redirect here (NAR18). */
export const POSITIONING_OLD = '/raise/pitch/positioning';

export const TITLE = 'Investor narrative';
// The canvas's line ends "with every claim backed."; nothing backs a claim
// until #2430's claim check lands, so the line stops before it.
export const LINE = 'The story you tell investors, one version per kind of investor.';

/**
 * The canvas's six tabs, less Claims, which waits for #2430's claim check.
 * `path` is the tab's segment under HOME_PATH; Home is the module page itself.
 */
export const TABS = [
  { id: 'home', label: 'Home', path: '' },
  { id: 'story', label: 'Story', path: '/story' },
  { id: 'positioning', label: 'Positioning', path: '/positioning' },
  { id: 'check', label: 'Check', path: '/check' },
  { id: 'versions', label: 'Versions', path: '/versions' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not a version. */
export const isNarrativeTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/**
 * The query a tab keeps: the venture and, when `withVersion`, the chosen
 * version (`version` when given, else the address's own). Nothing else.
 */
export function tabSearch(search = '', version = null, withVersion = true) {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const out = new URLSearchParams();
  const project = from.get('project_id') || from.get('project');
  if (project) out.set('project_id', project);
  const v = version ?? from.get('version');
  if (withVersion && v != null && /^\d+$/.test(String(v))) out.set('version', String(v));
  const s = out.toString();
  return s ? `?${s}` : '';
}

export const tabHref = (tab, search = '', version = null) => `${HOME_PATH}${tab.path}${tabSearch(search, version)}`;

/** A version's own page (its record), the venture kept. */
export const versionHref = (version, search = '') => `${HOME_PATH}/${encodeURIComponent(String(version))}${tabSearch(search, null, false)}`;

/** The saved versions from form-options, newest first; an unreadable list is []. */
export function versionsOf(options) {
  const list = Array.isArray(options?.versions) ? options.versions : [];
  return list
    .map((v) => ({ value: String(v?.value ?? ''), label: String(v?.label ?? '').trim() }))
    .filter((v) => /^\d+$/.test(v.value) && v.label)
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/** The version the address names, when it is saved; else the newest; else null. */
export function chosenVersion(versions, wanted) {
  if (!versions.length) return null;
  const hit = versions.find((v) => v.value === String(wanted ?? ''));
  return (hit || versions[0]).value;
}

/** The version before `version` in the list (for the compare), or null. */
export function previousVersion(versions, version) {
  const i = versions.findIndex((v) => v.value === String(version));
  return i >= 0 && i + 1 < versions.length ? versions[i + 1].value : null;
}

/** One section of a record read, main or side, by its key. */
export function sectionOf(record, key) {
  const all = [...(Array.isArray(record?.main) ? record.main : []), ...(Array.isArray(record?.side) ? record.side : [])];
  return all.find((s) => s?.key === key) || null;
}

/**
 * The version's words, as the record's "The narrative" section states them:
 * `{ label, text }`, with `text` null when nothing is recorded.
 */
export function storyRows(record) {
  const rows = Array.isArray(sectionOf(record, 'narrative')?.rows) ? sectionOf(record, 'narrative').rows : [];
  return rows
    .map((r) => ({ label: String(r?.a ?? '').trim(), text: String(r?.b ?? '').trim() || null }))
    .filter((r) => r.label);
}

const RESULTS = { Mismatch: 'bad', OK: 'ok', 'Not compared': 'grey' };

/**
 * The record's consistency check, as the Worker states it: one row per figure
 * with the Worker's own detail and result word. Nothing is re-derived here.
 */
export function checkRows(record) {
  const rows = Array.isArray(sectionOf(record, 'consistency')?.rows) ? sectionOf(record, 'consistency').rows : [];
  return rows
    .map((r) => {
      const result = String(r?.c ?? '').trim();
      return { figure: String(r?.a ?? '').trim(), detail: String(r?.b ?? '').trim() || null, result: result || NOT_RECORDED, tone: RESULTS[result] || 'grey' };
    })
    .filter((r) => r.figure);
}

/** The line over the check: counts by result, or "Nothing compared yet." */
export function checkSummary(rows) {
  if (!rows.length) return null;
  const n = (word) => rows.filter((r) => r.result === word).length;
  const mismatch = n('Mismatch');
  const ok = n('OK');
  const none = n('Not compared');
  if (mismatch + ok === 0) return 'Nothing compared yet.';
  return [
    `${mismatch + ok} compared`,
    mismatch ? `${mismatch} ${mismatch === 1 ? 'mismatch' : 'mismatches'}` : 'no mismatch',
    none ? `${none} not compared` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Two versions side by side, section by section: every label either names,
 * each side's text (null when not recorded), and whether they differ.
 */
export function compareRows(a, b) {
  const left = storyRows(a);
  const right = storyRows(b);
  const labels = [...new Set([...left, ...right].map((r) => r.label))];
  return labels.map((label) => {
    const l = left.find((r) => r.label === label)?.text ?? null;
    const r = right.find((x) => x.label === label)?.text ?? null;
    return { label, a: l, b: r, changed: l !== r };
  });
}

export const NO_VERSION = 'No narrative yet. Start a version for one kind of investor.';
// What the Worker's check reads today (raiseCycle.ts checkInputs): the figures
// the version states, and the venture profile's MRR, paying customers and
// funding needed. Part 1 (#2691) narrows it to what the version states.
export const CHECK_RUNS = 'The check runs each time a version is saved. It compares the figures the narrative states, and the MRR, paying customers and funding needed on the venture’s profile, with your stored metrics. The pitch deck’s own cards are not checked yet.';
export const FIX_NEWEST_ONLY = 'Eadwyn phrases a fix for the first mismatch in the newest version only.';

export { NOT_RECORDED };

// ── D914 (#2698): Admin and Super Admin read only (NAR13), and the no-permission panels (NAR14) ──
//
// The owner's answer to #2459 decision 3 for the narrative: an Admin on this
// deployment, or the Super Admin on HQ, reads the whole narrative read only and
// leaves notes; they give a reason first, which the founder sees. Reads:
//   - `GET /api/cycles/raise/narrative/reads`  → the reasons, and the caller's own unexpired one;
//   - `GET /api/cycles/raise/narrative/notes`  → the notes thread.
// An admin's other narrative reads answer 403 `read_reason_required` until a
// reason is given; their writes answer 403 `admin_read_only`.

/** An admin reads the narrative read only. Admins previewing another role through "View as" are that role here. */
export const isNarrativeAdmin = (user, viewMode = null) => String(user?.role || '') === 'admin' && (!viewMode || viewMode === 'admin');

export const READ_ONLY = 'Read only. Notes are visible to the founder.';
export const REASON_TITLE = 'Why are you opening this narrative?';
export const REASON_HELP = 'The founder sees this reason, who gave it and when. It lets you read the narrative for 8 hours.';
export const REASON_PLACEHOLDER = 'For example: quarterly portfolio review';
export const REASON_MIN = 3;
export const REASON_MAX = 200;
export const READS_TITLE = 'Who read this narrative';
export const NO_READS = 'No admin has opened this narrative.';
export const NOTES_TITLE = 'Notes';
export const NOTES_META = 'Visible to the founder';
export const NO_NOTES = 'No notes yet.';
export const NOTE_MAX = 2000;
export const NOTE_PLACEHOLDER = 'Write a note for the founder…';
export const NOTE_ANSWER_PLACEHOLDER = 'Answer the note…';

/** The reason an admin typed, checked as the Worker checks it; null when it may be sent. */
export function reasonProblem(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < REASON_MIN) return `Write a reason of at least ${REASON_MIN} characters.`;
  if (t.length > REASON_MAX) return `A reason is at most ${REASON_MAX} characters.`;
  return null;
}

const KIND = { admin: 'Studio admin', super_admin: 'HQ', founder: 'Founder' };
export const kindLabel = (kind) => KIND[kind] || NOT_RECORDED;

const when = (value) => {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(value)) ? `${String(value).replace(' ', 'T')}Z` : String(value);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** The line under the read-only banner: who opened it, for what, and that the founder sees it. */
export function openedLine(read, viewer) {
  if (!read?.reason) return null;
  const who = viewer === 'super_admin' ? 'Opened by HQ' : 'Opened by an admin';
  return `${who} for “${read.reason}”. The founder sees this reason.`;
}

/** One reason, as the founder reads it. A missing name is never invented. */
export function readRow(r) {
  return {
    id: r?.id,
    who: `${r?.by?.name || NOT_RECORDED} · ${kindLabel(r?.by?.kind)}`,
    reason: String(r?.reason || '').trim() || NOT_RECORDED,
    when: when(r?.created_at) || NOT_RECORDED,
  };
}

/** One note, as the thread draws it: its eyebrow (who, what, when, which version) and its words. */
export function noteRow(n) {
  const on = n?.version == null ? 'the narrative' : `v${n.version}`;
  return {
    id: n?.id,
    eye: `${n?.author?.name || NOT_RECORDED} · ${kindLabel(n?.author?.kind)} · ${when(n?.created_at) || NOT_RECORDED} · on ${on}`,
    body: String(n?.body ?? ''),
  };
}

/** What posting a note changes, said before it happens. */
export const notePosts = (version) => `This posts your note on ${version == null ? 'the narrative' : `v${version}`}. The founder and the venture’s admins see it. It changes nothing in the narrative.`;

// NAR14a: Investors, Advisors, Operating Partners and Explorers do not open the narrative.
export const BOUNDARY = {
  title: 'The Investor narrative is for the venture’s founders.',
  line: 'Ask them to share their deck.',
  action: 'Go to your home',
};
export const BOUNDARY_ROLES = new Set(['investor', 'advisor', 'partner', 'exploring']);
// NAR14b: a founder who opens another venture's narrative.
export const OTHER_VENTURE = {
  title: 'This narrative belongs to another venture.',
  line: 'You can open the narrative of a venture you found.',
  action: 'Open your own narrative',
};

/* ------------------------------------------------------------------ *
 * D911 (#2695) — Positioning (NAR4, NAR5, NAR18, NAR19d)
 * ------------------------------------------------------------------ */

/** NAR18: arriving from the old address. `?moved=positioning`. */
export const MOVED_KEY = 'positioning';
export const MOVED_NOTICE = 'Positioning is now Investor narrative › Positioning, under Raise.';
export const isMoved = (search = '') => new URLSearchParams(String(search || '').replace(/^\?/, '')).get('moved') === MOVED_KEY;

/** Where the old address goes: this tab, its query kept (but `moved` set once), its hash kept. */
export function movedHref(search = '', hash = '') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  q.set('moved', MOVED_KEY);
  return `${POSITIONING_PATH}?${q.toString()}${hash || ''}`;
}

/** The store's kinds (D908), in the canvas's order, with their longest. */
export const POSITIONING_FIELDS = [
  { kind: 'one_liner', label: 'One-liner', max: 200 },
  { kind: 'elevator', label: 'Elevator pitch', max: 1200 },
  { kind: 'line', label: 'Line', max: 300, many: true },
  { kind: 'category', label: 'Category', max: 300 },
  { kind: 'wedge', label: 'Wedge', max: 300 },
  { kind: 'for_whom', label: 'For whom', max: 300 },
  { kind: 'instead_of', label: 'Instead of', max: 300 },
];
export const MAX_LINES = 20;
const FIELD = Object.fromEntries(POSITIONING_FIELDS.map((f) => [f.kind, f]));

/** "One-liner", "Line 2". */
export const fieldLabel = (kind, position = 0) => (FIELD[kind]?.many ? `Line ${Number(position) + 1}` : FIELD[kind]?.label || 'Field');

/**
 * Where a field's words came from, in the canvas's words. The store keeps who
 * saved it but the read does not return a name, so an accepted proposal says
 * so without one (D911 §4).
 */
export function provenance(source) {
  if (!source || (!source.kind && (!source.label || source.label === 'typed'))) return 'Typed';
  if (source.kind === 'eadwyn') return 'Proposed by Eadwyn, accepted';
  if (source.kind === 'connector' || source.label === 'connector') return 'From a connected tool';
  if (source.kind === 'module') return 'From a module';
  return 'Typed';
}

const rowsOf = (list) => (Array.isArray(list) ? list : []);

/**
 * NAR4's core rows: each single field (its words, or null: "Not recorded"),
 * then every line in order and one empty "Add a line" slot while there is room.
 */
export function coreRows(core) {
  const list = rowsOf(core);
  const at = (kind, position = 0) => list.find((r) => r.kind === kind && Number(r.position) === position) || null;
  const out = [];
  for (const f of POSITIONING_FIELDS) {
    if (!f.many) {
      const r = at(f.kind);
      out.push({ kind: f.kind, position: 0, label: f.label, max: f.max, text: r?.text ?? null, provenance: r ? provenance(r.source) : null });
      continue;
    }
    const lines = list.filter((r) => r.kind === 'line').sort((a, b) => a.position - b.position);
    lines.forEach((r, i) => out.push({ kind: 'line', position: Number(r.position), label: `Line ${i + 1}`, max: f.max, text: r.text, provenance: provenance(r.source) }));
    const next = lines.length ? Math.max(...lines.map((r) => Number(r.position))) + 1 : 0;
    if (next < MAX_LINES) out.push({ kind: 'line', position: next, label: `Line ${lines.length + 1}`, max: f.max, text: null, provenance: null, add: true });
  }
  return out;
}

/**
 * "This version": for each field the core has (and each the version adjusts),
 * whether the version uses the core wording or its own. Toggling Adjust on
 * words it for this version; off clears it, and the core is read again.
 */
export function versionRows(core, overrides) {
  const c = rowsOf(core);
  const o = rowsOf(overrides);
  const key = (r) => `${r.kind}:${Number(r.position)}`;
  const keys = [...new Set([...c, ...o].map(key))];
  return keys
    .map((k) => {
      const [kind, pos] = k.split(':');
      const position = Number(pos);
      const own = o.find((r) => key(r) === k) || null;
      const base = c.find((r) => key(r) === k) || null;
      return { kind, position, label: fieldLabel(kind, position), max: FIELD[kind]?.max || 300, adjusted: Boolean(own), text: own?.text ?? base?.text ?? null, coreText: base?.text ?? null };
    })
    .sort((a, b) => POSITIONING_FIELDS.findIndex((f) => f.kind === a.kind) - POSITIONING_FIELDS.findIndex((f) => f.kind === b.kind) || a.position - b.position);
}

/** What a Save says it changes, before it is pressed. */
export function saveLine({ label, version = null, clearing = false }) {
  if (version == null) return clearing ? `This clears the core ${label.toLowerCase()}. A version that does not adjust it then has none.` : `This changes the core ${label.toLowerCase()}. Every version uses it unless it adjusts it.`;
  return clearing ? `Version ${version} uses the core ${label.toLowerCase()} again. Its own wording is removed.` : `This words the ${label.toLowerCase()} for version ${version} only. The core stays as it is.`;
}

export const PROPOSE_FOOT = 'Eadwyn reads your Validate and Build records. It writes no numbers.';
export const PROPOSAL_NOTE = 'Nothing lands until you accept it. Accept writes that line into your core positioning; Discard throws it away.';
export const REMOVED_LINE = 'A line with a number was removed. Insert figures yourself from your records.';
export const WITHHELD_LINE = 'Records with a number in them were not read.';
export const NO_FIGURES_READ = 'No figures are read. Eadwyn writes no numbers.';

/** Eadwyn's open proposals, in the store's field order. */
export function proposalRows(items) {
  return rowsOf(items)
    .filter((p) => p && FIELD[p.kind] && typeof p.text === 'string' && p.uid)
    .map((p) => ({ uid: p.uid, kind: p.kind, position: Number(p.position) || 0, label: FIELD[p.kind].many ? `Line ${(Number(p.position) || 0) + 1}` : FIELD[p.kind].label, text: p.text }))
    .sort((a, b) => POSITIONING_FIELDS.findIndex((f) => f.kind === a.kind) - POSITIONING_FIELDS.findIndex((f) => f.kind === b.kind) || a.position - b.position);
}

/** A part of the draft read: its items, or null when it could not be read. */
export const partItems = (part) => (part?.state === 'ok' && Array.isArray(part.items) ? part.items : null);
