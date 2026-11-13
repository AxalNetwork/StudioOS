/**
 * D1060 (#2930, part 4 of #2427) — the report builder's and the sent
 * report's rules over part 3's routes (D1059): figures by module with their
 * source chips, readiness, Eadwyn's lines and the Accept rule, recipients,
 * the preview, Send's dialog and the revision strip. No React here.
 *
 * A FIGURE is a real number, or a dash with its reason. `value: null` is
 * never drawn as 0, and a team-only Mercury figure reads "Team only" to
 * anyone the Worker withheld it from. Every figure here is the Worker's:
 * the builder sends choices (in or out, a reason, a share), never a value,
 * except the founders' own typed figures, which are labelled as typed.
 */
import { names, shortDay } from './deskModel.js';

export const STEPS = Object.freeze([
  { id: 'figures', label: 'Figures' },
  { id: 'narrative', label: 'Narrative and documents' },
  { id: 'recipients', label: 'Recipients' },
  { id: 'preview', label: 'Preview' },
]);

/** The Grow modules in their tab order (`reportFigures.ts` `MODULE_ORDER`). */
export const MODULE_ORDER = Object.freeze([
  'product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building',
]);
export const MODULE_TITLES = Object.freeze({
  'product-improvement': 'Product improvement', distribution: 'Distribution', 'revenue-and-traction': 'Revenue and traction',
  'team-expansion': 'Team expansion', 'partner-network': 'Partner network', 'market-expansion': 'Market expansion',
  'durable-company-building': 'Durable company-building',
});

const PROVIDER_WORDS = Object.freeze({
  stripe: 'Stripe', mercury: 'Mercury', manual: 'typed in Grow', roster: 'your team roster', job_postings: 'job postings',
  growth_partners: 'partner records', markets: 'markets', checklist: 'checklist', shipped: 'Roadmap', founder: 'entered by the founders',
});

const list = (v) => (Array.isArray(v) ? v : []);
export const TEAM_ONLY = 'Team only';

/** A figure's value in its unit, or null when there is none: the caller draws a dash with the reason. */
export function valueText(f) {
  const v = f?.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (f.unit === 'usd') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (f.unit === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (f.unit === 'months') return `${Math.round(v * 10) / 10} ${v === 1 ? 'month' : 'months'}`;
  return v.toLocaleString('en-US');
}

/**
 * The source chip: "Connector · Stripe · 31 Oct", "Connector · Mercury ·
 * computed", "Typed · entered by [company]", "◐ Team only · from your
 * Mercury". A figure with no value says "Not recorded".
 */
export function sourceChip(f, company = 'the company') {
  if (f?.typed) return `Typed · entered by ${company}${f.as_of ? ` · ${shortDay(f.as_of)}` : ''}`;
  if (f?.team_only && !f.shared && f.value == null && f.reason) return `◐ ${TEAM_ONLY}`;
  if (f?.team_only && !f.shared) return `◐ ${TEAM_ONLY} · from your Mercury`;
  if (!f?.source || f.value == null) return 'Not recorded';
  const s = f.source;
  return [s.word, PROVIDER_WORDS[s.provider] || s.provider, s.computed ? 'computed' : null, shortDay(f.as_of)].filter(Boolean).join(' · ');
}

/** Why a figure reads no value: the Worker's reason, never a zero. */
export const reasonOf = (f) => (f?.reason ? String(f.reason) : 'Not recorded');

/** Figures by Grow module in tab order; the founders' typed figures after them. */
export function figureGroups(figures) {
  const xs = list(figures);
  const groups = MODULE_ORDER.map((m) => ({ module: m, title: MODULE_TITLES[m], figures: xs.filter((f) => !f.typed && f.module === m) }))
    .filter((g) => g.figures.length);
  const typed = xs.filter((f) => f.typed);
  if (typed.length) groups.push({ module: 'typed', title: 'Typed by your team', figures: typed });
  return groups;
}

/** A module the Worker could not read: its figures read "Unreadable", the others still answer (RPT19a). */
export const unreadableTitles = (unreadable) => list(unreadable).map((m) => MODULE_TITLES[m]).filter(Boolean);

/**
 * Readiness: how many required figures go in, which are left out with a
 * reason, and which are left out with none (Send refuses those).
 */
export function readiness(figures) {
  const required = list(figures).filter((f) => f.required);
  const included = required.filter((f) => f.included);
  const out = required.filter((f) => !f.included);
  return {
    required: required.length, included: included.length,
    withReason: out.filter((f) => f.left_out_reason).map((f) => f.label),
    withoutReason: out.filter((f) => !f.left_out_reason).map((f) => f.label),
  };
}
export function readinessLine(r, unreadable = []) {
  if (!r.required) return 'No figure is required by a duty this report meets.';
  const parts = [`${r.included} of ${r.required} required figures included`];
  if (r.withReason.length) parts.push(`${r.withReason.length} left out with a reason`);
  if (r.withoutReason.length) parts.push(`${r.withoutReason.length} left out with no reason yet`);
  const u = unreadableTitles(unreadable);
  if (u.length) parts.push(`${names(u)} could not be read`);
  return parts.join(' · ');
}

/** The choice a figure row sends: in or out, a reason, a share. The Worker re-reads every value. */
export function choiceFor(f, patch = {}) {
  const c = { key: f.key, include: patch.include ?? f.included };
  if ('reason' in patch) c.reason = patch.reason;
  if ('share' in patch) c.share = patch.share;
  return c;
}
/** A figure with no value cannot go in; a team-only one goes in only once shared. */
export const canInclude = (f) => f?.value != null && (!f.team_only || !!f.shared);

// ---------------------------------------------------------------- Eadwyn's lines (AUTOFILL #2431's Accept rule)

export const LINE_KINDS = Object.freeze({ highlights: 'Highlight', lowlights: 'Lowlight' });

/** A line may be accepted only with text and a cited source (D654, #2431): a line with no source never lands. */
export const acceptable = (line) => !!(String(line?.text || '').trim() && String(line?.source?.label || '').trim());

/** Eadwyn's answer, as proposals waiting for the founders: each with its kind and its own key. */
export function proposals(draft) {
  if (!draft || draft.status !== 'drafted') return [];
  return ['highlights', 'lowlights'].flatMap((field) => list(draft[field]).map((l, i) => ({
    key: `${field}-${i}`, field, text: String(l?.text || ''), source: l?.source || null, state: 'waiting',
  })));
}
export function draftNote(draft) {
  if (!draft) return null;
  if (draft.status === 'nothing') return 'Eadwyn found nothing new in this period’s stored data. Write the lines yourself, or leave them out.';
  if (draft.status === 'unavailable') return draft.reason || 'Eadwyn could not draft this time. Write the lines by hand.';
  return `Eadwyn drafted ${list(draft.highlights).length + list(draft.lowlights).length} lines from your stored data. Accept the ones you want; nothing is sent until you press Send.`;
}
/** A line the founders write cites themselves, as Share an update's do (D654). */
export const ownLine = (text) => ({ text, source: { label: 'Written by the founders', ref: null, as_of: null } });

export const sourceLine = (l) => [l?.source?.label, l?.source?.as_of ? shortDay(l.source.as_of) : null].filter(Boolean).join(' · ') || 'No source';

// ---------------------------------------------------------------- recipients, preview and Send

/** Each holder the report reaches, with the duties it meets for them (`meets`, founders' view). */
export function recipientRows(meets) {
  const by = new Map();
  for (const m of list(meets)) {
    const name = m.holder?.name || 'Holder not named';
    const r = by.get(name) || { name, duties: [] };
    r.duties.push(`${m.title} · ${m.label}`);
    by.set(name, r);
  }
  return [...by.values()].map((r) => ({ ...r, line: [...new Set(r.duties)].join(' and ') }));
}
export const NO_NETWORK = 'There is no Network option. Reports never go to the network, and never to an advisor.';

/** Send's dialog (RPT5d): what freezes, what it meets, and what it is sent without, with whose reason. */
export function sendLines(report, preview) {
  const meets = list(preview?.meets ?? report?.meets);
  const lines = [report?.revision > 1
    ? `This is revision ${report.revision}. Everyone the last revision reached is told, with your reason: ‘${report.correction_reason || 'not given yet'}’.`
    : 'Figures freeze now. A later change is sent as a correction, and investors see both.'];
  const byDuty = new Map();
  for (const m of meets) {
    const k = `${m.title} · ${m.label}`;
    byDuty.set(k, [...(byDuty.get(k) || []), m.holder?.name || 'a holder not named']);
  }
  if (byDuty.size) lines.push(`This meets: ${[...byDuty.entries()].map(([k, hs]) => `${k} for ${names(hs)}`).join('; ')}.`);
  else lines.push('This report meets no open period.');
  const without = meets.flatMap((m) => list(m.without).map((w) => ({ ...w, holder: m.holder?.name || 'a holder not named' })));
  const grouped = new Map();
  for (const w of without) {
    const g = grouped.get(w.label) || { label: w.label, reason: w.reason, holders: [] };
    g.holders.push(w.holder); grouped.set(w.label, g);
  }
  if (grouped.size) {
    lines.push(`Sent without ${[...grouped.values()].map((g) => `${g.label} for ${names(g.holders)}${g.reason ? ` (‘${g.reason}’)` : ' (no reason yet: Send refuses until you give one)'}`).join('; ')}. They see your reasons.`);
  }
  return lines;
}
export const sendTitle = (report, count) => `Send the ${report?.period?.label || ''} report to ${count === 1 ? '1 investor' : `${count} investors`}${report?.include_team ? ' and your team' : ''}?`.replace(/\s+/g, ' ');

/** A refusal from Send, in the Worker's words; a privacy finding names its kind and where, never what it caught. */
export function sendRefusal(e) {
  const code = e?.code;
  if (code === 'pii_found') {
    const where = list(e?.data?.findings ?? e?.data?.extra?.findings).map((f) => `${String(f.kind || 'detail').replace(/_/g, ' ')} in ${String(f.in || 'the report').replace(/_/g, ' ')}`);
    return `${e.message}${where.length ? ` Found: ${where.join(', ')}.` : ''}`;
  }
  return e?.message || 'The report could not be sent. Nothing was sent. Try again.';
}

// ---------------------------------------------------------------- the sent report (RPT6)

export function revisionStrip(report) {
  if (!report) return null;
  const parts = [];
  if (Number(report.revision) > 1) parts.push(`Revision ${report.revision}${report.correction_reason ? ` · reason ‘${report.correction_reason}’` : ''}. Investors see both versions.`);
  if (report.corrected_by) parts.push(`Corrected by revision ${report.corrected_by.revision} on ${shortDay(report.corrected_by.corrected_on, true)}${report.corrected_by.reason ? ` · ‘${report.corrected_by.reason}’` : ''}.`);
  return parts.length ? parts.join(' ') : null;
}

export const sentLine = (report) => (report?.sent_at ? `Sent ${shortDay(report.sent_at, true)} · revision ${report.revision}` : 'Not sent');

export function recipientStatus(r) {
  const delivered = r.delivered ? 'Delivered' : (r.not_delivered_reason || 'Not delivered');
  return { who: r.audience === 'investor' ? 'Investor' : 'Your team', name: r.name || 'Not named', delivered, opened: r.opened_at ? shortDay(r.opened_at) : '—' };
}

/** Correct: a reason of 3 to 280 characters (D1059's `correct`). */
export const correctionError = (reason) => {
  const n = String(reason || '').trim().length;
  return n < 3 ? 'Say what the correction changes, in at least 3 characters.' : n > 280 ? 'Keep the reason to 280 characters.' : null;
};

/** The report's own address: the builder for a draft, the sent report otherwise. */
export function reportHref(uid, { draft = false, search = '' } = {}) {
  if (!/^[0-9a-f]{32}$/.test(String(uid || ''))) return null;
  return `/grow/reporting/${uid}${draft ? '/edit' : ''}${search}`;
}

/** A statement's size in words. */
export function sizeWords(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'size not recorded';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
export const DOCUMENT_MAX = 6 * 1024 * 1024;
export function documentError(file) {
  if (!file) return 'Choose a PDF.';
  if (file.type && file.type !== 'application/pdf') return 'Attach a PDF.';
  if (file.size > DOCUMENT_MAX) return 'A statement is at most 6 MB.';
  return null;
}
