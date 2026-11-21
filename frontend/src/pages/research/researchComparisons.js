/**
 * D5157 part 3 (#5157) — what a Research Project's Comparisons tab and the
 * directories' Add to research / Compare say, read from
 * `routes/research_project_comparisons.ts`. Pure, so the pages and the tests
 * read the same words.
 *
 * HONEST STATES. A read is loading, unreadable or ok, and an unreadable read is
 * never an empty list. Each value names its source and date; a value the
 * directory does not hold reads Not recorded with the reason, a directory that
 * could not be read reads Unreadable, and a company or fund that left the
 * directory says so by the name the project kept. Nothing is scored or summed.
 *
 * D7167 (#7167): a fund cell that carries the Worker's `provenance` names its
 * publisher and reported date, the same chip as the fund's Sheet and profile;
 * a size is printed in the currency its list reported, never converted; and a
 * read that failed reads "Unavailable" on screen.
 *
 * D7167 part 2 (#7167, FND-P05, FND-P06 B, FND-P08 C to E): the project
 * picker's rows (`pickerView`: active projects with their membership, archived
 * ones read-only), the comparisons a fund can join in the chosen project
 * (`joinChoices`, n of 6, Full and Already in it), the sentence after joining
 * one (`joinOutcome`), the phone's By fund pager (`fundPage`) and where focus
 * goes after a column is removed (`columnAfterRemoval`).
 */
import { money } from '../../lib/companyDirectoryView.js';
import { eurM } from './fundDirectoryRead.js';
import { UNAVAILABLE, amount, day, sourceChip } from './fundProfileRead.js';
import { NOT_RECORDED } from './researchStates.js';

/**
 * The shells whose Research row has My Research (`shellConfig.js`), so Add to
 * research and Compare have somewhere to go. An admin browses Research as a
 * founder (`routes/researchProjects.jsx`).
 */
export const canAddToResearch = (role) => role === 'founder' || role === 'admin';

export const KIND_WORDS = {
  company: { one: 'company', many: 'companies', title: 'Companies', add: 'Add company' },
  fund: { one: 'fund', many: 'funds', title: 'Funds', add: 'Add fund' },
};

/** Where a company or a fund's own page is. */
export const subjectHref = (kind, uid) => (kind === 'fund'
  ? `/research/funds/catalog/${encodeURIComponent(uid)}`
  : `/research/companies/company/${encodeURIComponent(uid)}`);

/** Why a column has no values: the row left the directory, its list was taken down, or the read failed. */
export const MEMBER_STATES = {
  listed: null,
  removed: 'No longer in the directory, so nothing is shown for it.',
  withdrawn: 'Its list was taken down for its terms, so nothing is shown for it.',
  unreadable: 'Unavailable: the directory could not be read just now.',
};
export const memberNote = (m) => (m && m.state in MEMBER_STATES ? MEMBER_STATES[m.state] : MEMBER_STATES.unreadable);

const BACKING = (v) => {
  const named = [v?.eif === true && 'EIF', v?.eifo === true && 'EIFO'].filter(Boolean);
  if (named.length) return named.join(' and ');
  if (v?.eif === false && v?.eifo === false) return 'Neither named among the LPs';
  return null;
};

const VERDICT_WORDS = { 'republish allowed': 'Republishing allowed', 'cite only': 'Cite only', 'not allowed': 'Not allowed' };

/** One value as text, with what sits under it. `null` text means the value cannot be printed. */
function valueText(key, c) {
  const v = c.value;
  switch (key) {
    case 'employees': return { text: Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : null };
    case 'last_round': return { text: money(v, c.currency), detail: [c.type, c.date].filter(Boolean).join(' · ') || null };
    case 'funding_total':
    case 'revenue': return { text: money(v, c.currency) };
    case 'size': return { text: c.currency === 'EUR' ? eurM(v) : amount(v, c.currency), detail: c.currency || null };
    case 'source_use': return { text: VERDICT_WORDS[v] || null, detail: [c.reviewed_on && `reviewed ${day(c.reviewed_on)}`, c.imported_on && `imported ${day(c.imported_on)}`].filter(Boolean).join(' · ') || null };
    case 'vintage': return { text: String(v), detail: c.date || null };
    case 'backing': return { text: BACKING(v) };
    default: return { text: typeof v === 'string' || typeof v === 'number' ? String(v) : null };
  }
}

/**
 * One table cell: `recorded` with its text, source and date; `not_recorded`
 * with the reason; or `unreadable`. A member with no values (removed,
 * withdrawn, unreadable) gives `absent` for every row.
 */
export function cellView(key, cell, member) {
  if (!member || member.state !== 'listed' || !member.values) return { state: 'absent', text: null, reason: memberNote(member) };
  // D7167: a value the Worker left out (its read failed) reads Unavailable.
  if (!cell) return { state: 'unreadable', text: null, reason: 'Unavailable' };
  // D7177: the Worker's per-cell Unreadable (a value held in a form it cannot read) stays Unreadable, never Not recorded.
  if (cell.status === 'unreadable') return { state: 'unreadable', text: null, reason: cell.reason || 'Unreadable' };
  if (cell.status !== 'recorded') return { state: 'not_recorded', text: NOT_RECORDED, reason: cell.reason || NOT_RECORDED };
  const { text, detail = null } = valueText(key, cell);
  if (text == null) return { state: 'unreadable', text: null, reason: 'Unreadable: the value is held in a form this page cannot show' };
  const source = cell.source?.name || null;
  // D7167: the fund's provenance chip (publisher · reported date), else the list and its as-of date.
  const chip = key !== 'source_use' && cell.provenance ? sourceChip(cell.provenance) : null;
  const url = cell.provenance?.published_url || cell.source?.url || '';
  return {
    state: 'recorded',
    text,
    detail,
    source: chip || [source || 'Source not recorded', cell.as_of ? `as of ${cell.as_of}` : 'date not recorded'].join(' · '),
    // Only a web address is a link; anything else is printed, never opened.
    sourceUrl: /^https?:\/\//i.test(String(url)) ? String(url) : null,
  };
}

/** The tab's whole reading. */
export function comparisonsView(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ok') return { state: 'unreadable' };
  const v = read.value || {};
  const subjects = Array.isArray(v.subjects) ? v.subjects : [];
  const sets = Array.isArray(v.comparisons) ? v.comparisons : [];
  const attributes = v.attributes || {};
  return {
    state: 'ok',
    limit: Number(v.limits?.members) || 6,
    directory: v.directory || {},
    subjects: {
      company: subjects.filter((s) => s.kind === 'company'),
      fund: subjects.filter((s) => s.kind === 'fund'),
    },
    comparisons: sets.map((k) => {
      const members = Array.isArray(k.members) ? k.members : [];
      const rows = (attributes[k.kind] || []).map((a) => ({
        key: a.key,
        label: a.label,
        cells: members.map((m) => cellView(a.key, m.values ? m.values[a.key] : null, m)),
      }));
      const inSet = new Set(members.map((m) => m.uid));
      return {
        uid: k.uid,
        kind: k.kind,
        title: k.title,
        updated: k.updated_at || null,
        members: members.map((m) => ({ uid: m.uid, name: m.name, state: m.state, note: memberNote(m), href: subjectHref(k.kind, m.uid) })),
        rows,
        limit: Number(v.limits?.members) || 6,
        full: members.length >= (Number(v.limits?.members) || 6),
        // The project's own companies or funds not yet in this comparison.
        candidates: subjects.filter((s) => s.kind === k.kind && !inSet.has(s.uid)),
      };
    }),
    empty: !subjects.length && !sets.length,
  };
}

/** The tab's badge: the number of comparisons, and none at all while the read is not ok. */
export function comparisonsBadge(read) {
  const view = comparisonsView(read);
  return view.state === 'ok' ? view.comparisons.length : null;
}

/** The Worker's refusal codes in words; anything else is its own message. */
export const COMPARISON_ERRORS = {
  project_archived: 'This project is archived, so it cannot change until you restore it.',
  comparison_full: 'A comparison holds at most 6 columns. Remove one first, or start another comparison.',
  not_in_directory: 'That is no longer in the directory, so it was not added.',
  source_withdrawn: 'This fund’s source list was withdrawn, so nothing was added.',
  directory_unreadable: 'The directory could not be read just now, so nothing was added. Try again.',
  title_required: 'A comparison needs a title.',
  title_too_long: 'Keep the title under 160 characters.',
  invalid_uid: 'That entry cannot be added.',
  // D7177: Add to research's own limit, and the save's request id.
  too_many: 'Add to research takes up to 25 at a time. Remove some and try again.',
  request_id_reused: 'This sheet already saved a comparison in another project. Close it and start again.',
  invalid_request_id: 'This sheet cannot be saved. Close it and start again.',
  question_required: 'A new project needs a question.',
};
export const comparisonError = (err, fallback) => COMPARISON_ERRORS[err?.code] || err?.message || fallback;

/** "Added Nebula Compute to “EU GPU”", "Already in …", from the Worker's counts. */
export function addOutcome(names, projectTitle, res) {
  const added = Number(res?.added || 0);
  const already = Number(res?.already || 0);
  const what = names.length === 1 ? names[0] : `${names.length} entries`;
  if (added && !already) return `Added ${what} to “${projectTitle}”.`;
  if (!added) return `${what} ${names.length === 1 ? 'is' : 'are'} already in “${projectTitle}”.`;
  return `Added ${added} to “${projectTitle}”; ${already} ${already === 1 ? 'was' : 'were'} already there.`;
}

/** The most project reads the picker makes to learn membership; the rest say "not checked". */
export const MEMBERSHIP_READS = 20;

const updatedText = (value) => {
  const d = day(value);
  return d ? `updated ${d}` : null;
};

/**
 * FND-P05 (RFP05, RFP08 C): the picker's projects. `list` is the read of
 * `GET /api/research/projects?status=all`; `memberships` maps a project uid to
 * the read of its comparisons (`{ status, value }`), which holds its subjects.
 * Active projects are offered; a project that already holds every item says
 * Already here and is not offered for Add (Compare may still use it); a
 * membership read that failed says so and leaves the project offered, since
 * the add itself answers "already there". Archived projects are listed apart,
 * read-only, never offered. `kind` 'answer' has no membership to show.
 */
export function pickerView(list, memberships, items, kind, mode = 'add') {
  if (!list || list.status === 'loading') return { state: 'loading', active: [], archived: [] };
  if (list.status !== 'ok') return { state: 'unreadable', active: [], archived: [] };
  const rows = (list.value?.items || []).filter((p) => p && p.uid);
  const want = (items || []).map((x) => x.uid);
  const words = KIND_WORDS[kind] || null;
  const active = rows.filter((p) => p.status !== 'archived').map((p, i) => {
    const row = { uid: p.uid, title: p.title, offered: true, chip: null, meta: updatedText(p.updated_at), note: null };
    if (!words) return row;
    const m = memberships?.get?.(p.uid) || (i < MEMBERSHIP_READS ? { status: 'loading' } : { status: 'skipped' });
    if (m.status === 'loading') return { ...row, meta: ['Checking what it holds…', row.meta].filter(Boolean).join(' · ') };
    if (m.status === 'skipped') return { ...row, meta: ['What it holds was not checked', row.meta].filter(Boolean).join(' · ') };
    if (m.status !== 'ok') return { ...row, meta: [`${UNAVAILABLE}: what it holds could not be read`, row.meta].filter(Boolean).join(' · '), note: 'unavailable' };
    const subjects = (m.value?.subjects || []).filter((s) => s.kind === kind);
    const held = new Set(subjects.map((s) => s.uid));
    const there = want.filter((u) => held.has(u)).length;
    const meta = [`${words.title} · ${subjects.length}`, row.meta].filter(Boolean).join(' · ');
    if (want.length && there === want.length) {
      return { ...row, meta, chip: 'Already here', offered: mode === 'compare' };
    }
    return { ...row, meta, note: there ? `${there} of ${want.length} already here` : null };
  });
  const archived = rows.filter((p) => p.status === 'archived').map((p) => ({
    uid: p.uid, title: p.title, offered: false, chip: 'Read-only',
    meta: `${day(p.archived_at) ? `Archived ${day(p.archived_at)}` : 'Archived'} · restore it in My Research to change it`,
  }));
  return { state: 'ok', active, archived };
}

/**
 * FND-P06 B (RFP06B): the comparisons of this kind in the chosen project that
 * one item can join, each with n of 6. A full one is Full and a comparison
 * that already holds the item is Already in it; neither is offered. `read` is
 * that project's comparisons read.
 */
export function joinChoices(read, kind, itemUid) {
  if (!read || read.status === 'loading') return { state: 'loading', choices: [] };
  if (read.status !== 'ok') return { state: 'unreadable', choices: [] };
  const limit = Number(read.value?.limits?.members) || 6;
  const words = KIND_WORDS[kind] || KIND_WORDS.fund;
  const sets = (read.value?.comparisons || []).filter((k) => k && k.kind === kind);
  return {
    state: 'ok',
    limit,
    choices: sets.map((k) => {
      const members = Array.isArray(k.members) ? k.members : [];
      const n = members.length;
      const count = `${n} of ${limit} ${n === 1 ? words.one : words.many}`;
      if (members.some((m) => m.uid === itemUid)) return { uid: k.uid, title: k.title, count: n, limit, state: 'already', offered: false, meta: `${count} · already in it`, chip: 'Already in it' };
      if (n >= limit) return { uid: k.uid, title: k.title, count: n, limit, state: 'full', offered: false, meta: `${count} · remove one there first`, chip: 'Full' };
      return { uid: k.uid, title: k.title, count: n, limit, state: 'open', offered: true, meta: count, chip: null };
    }),
  };
}

/** RFP06B: "Added Dawn Capital Fund V to “Dawn Capital Opp · Afore IV”. 3 of 6." or already there. */
export function joinOutcome(name, choice, res) {
  if (res && res.added === false) return `${name} is already in “${choice.title}”. Nothing was added.`;
  return `Added ${name} to “${choice.title}”. ${Math.min(choice.count + 1, choice.limit)} of ${choice.limit}.`;
}

/** FND-P08 E: the phone's By fund pager, one column at a time; it stops at either end. */
export function fundPage(count, index) {
  if (!count) return { index: 0, count: 0, label: null, first: true, last: true };
  const i = Math.min(Math.max(0, Number(index) || 0), count - 1);
  return { index: i, count, label: `Fund ${i + 1} of ${count}`, first: i === 0, last: i === count - 1 };
}

/**
 * FND-P10: after a column is removed, focus goes to the column that took its
 * place (the next one, else the new last one); `null` when none is left, and
 * the caller focuses Add fund.
 */
export function columnAfterRemoval(members, at) {
  const list = Array.isArray(members) ? members : [];
  if (!list.length) return null;
  return list[Math.min(Math.max(0, Number(at) || 0), list.length - 1)].uid;
}
