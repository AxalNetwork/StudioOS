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
 */
import { money } from '../../lib/companyDirectoryView.js';
import { eurM } from './fundDirectoryRead.js';
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
  unreadable: 'Unreadable: the directory could not be read just now.',
};
export const memberNote = (m) => (m && m.state in MEMBER_STATES ? MEMBER_STATES[m.state] : MEMBER_STATES.unreadable);

const BACKING = (v) => {
  const named = [v?.eif === true && 'EIF', v?.eifo === true && 'EIFO'].filter(Boolean);
  if (named.length) return named.join(' and ');
  if (v?.eif === false && v?.eifo === false) return 'Neither named among the LPs';
  return null;
};

/** One value as text, with what sits under it. `null` text means the value cannot be printed. */
function valueText(key, c) {
  const v = c.value;
  switch (key) {
    case 'employees': return { text: Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : null };
    case 'last_round': return { text: money(v, c.currency), detail: [c.type, c.date].filter(Boolean).join(' · ') || null };
    case 'funding_total':
    case 'revenue': return { text: money(v, c.currency) };
    case 'size': return { text: c.currency === 'EUR' ? eurM(v) : null };
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
  if (!cell) return { state: 'unreadable', text: null, reason: 'Unreadable' };
  if (cell.status !== 'recorded') return { state: 'not_recorded', text: NOT_RECORDED, reason: cell.reason || NOT_RECORDED };
  const { text, detail = null } = valueText(key, cell);
  if (text == null) return { state: 'not_recorded', text: NOT_RECORDED, reason: 'Not recorded: the value is held in a form this page cannot show' };
  const source = cell.source?.name || null;
  return {
    state: 'recorded',
    text,
    detail,
    source: [source || 'Source not recorded', cell.as_of ? `as of ${cell.as_of}` : 'date not recorded'].join(' · '),
    // Only a web address is a link; anything else is printed, never opened.
    sourceUrl: /^https?:\/\//i.test(String(cell.source?.url || '')) ? cell.source.url : null,
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
  directory_unreadable: 'The directory could not be read just now, so nothing was added. Try again.',
  title_required: 'A comparison needs a title.',
  title_too_long: 'Keep the title under 160 characters.',
  invalid_uid: 'That entry cannot be added.',
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
