// D5051 (#5051, part 1): a licence's legal readiness as Licences and Program access read it. Pure: it takes the
// two Worker reads and says, per agreement, per program and per package, where each stands, which canonical
// Contracts record it is, and what needs HQ. It decides nothing the Worker did not: every legal answer is the
// D5052 read's (`GET /api/admin/licence-agreement-policies/licences/:uid`), and the versions, envelopes, fields
// and dates are D5048's (`GET /api/admin/licence-agreements/licences/:uid`). A read that failed is Unreadable,
// and a policy nobody froze is Not recorded; neither is ever drawn as executed, in force or 0.
import { PROGRAMS } from './programGrants.js';
import { PACKAGE_OPTIONS } from './contractAgreements.js';

/** An agreement document's state, in the canvas's words (#5303, L33 to L35). */
export const DOC_STATE_WORD = Object.freeze({
  not_prepared: 'Not prepared',
  prepared: 'Prepared · not sent',
  awaiting_signature: 'Awaiting signature',
  executed: 'Executed',
  replacement_required: 'Replacement required',
  not_recorded: 'Not recorded',
  unreadable: 'Unreadable',
  not_required: 'Not required',
  not_applicable: 'Not applicable',
});

/** Worst first: the state a set of documents is summarised by. */
const WORST_FIRST = ['unreadable', 'not_prepared', 'prepared', 'awaiting_signature', 'replacement_required', 'executed'];

/** The word for each kind of document a program can need (D5052 §3). */
export const DOC_KIND_WORD = Object.freeze({
  package_master: 'Package master agreement',
  package_addendum: 'Schedule under the master',
  program_licence: 'Program licence',
  program_schedule: 'Program schedule',
  program_addendum: 'Program addendum',
});

export const programName = (key) => PROGRAMS.find((p) => p.key === key)?.name || key || 'Program';
export const packageName = (key) => PACKAGE_OPTIONS.find(([k]) => k === key)?.[1] || key || 'Package';

const STRATEGY_WORD = { per_program: 'per program', package_master: 'package master', none: 'no agreement' };
const GATE_WORD = { optional: 'optional', required_before_grant: 'required before grant', required_before_in_force: 'required before in force' };
export const strategyWord = (s) => STRATEGY_WORD[s] || s || 'Not recorded';
export const gateWord = (g) => GATE_WORD[g] || g || 'Not recorded';

const day = (v) => (v ? String(v).slice(0, 10) : null);
const enc = encodeURIComponent;
const IN_FLIGHT = ['draft', 'ready', 'sent', 'partially_signed'];

function parseList(v) {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

/** The Contracts type filter (D5050) a version's kind falls under. */
function contractsTypeOf(kind) {
  if (kind === 'package_master' || kind === 'package_addendum') return 'package';
  if (kind === 'program_licence') return 'program_licence';
  return 'program_schedule_addendum';
}

/**
 * The one canonical Contracts record an agreement version is. A version with an envelope IS that envelope's
 * row (D5050 §1), so it opens the agreement's workspace; a version with none is a row of its own that opens
 * nothing, so the link is the Agreements list filtered to this licence and slot. Never a second copy.
 */
export function contractsHref({ row = null, licenceUid, kind = null, programKey = null, packageKey = null }) {
  if (row?.envelope_uuid) return `/admin/contracts/agreements/doc/${enc(row.envelope_uuid)}`;
  const q = new URLSearchParams();
  if (licenceUid) q.set('licence', licenceUid);
  const k = row?.agreement_kind || kind;
  if (k) q.set('agreement_type', contractsTypeOf(k));
  const program = row?.program_key || programKey;
  const pkg = row?.package_key || packageKey;
  if (program) q.set('program', program);
  else if (pkg) q.set('package', pkg);
  return `/admin/contracts?${q}`;
}

/** v1, v2… by the order versions of one slot were made (the uid is not a number a person reads). */
export function versionOf(row, rows) {
  if (!row) return null;
  const same = (rows || []).filter((r) => r.slot_key === row.slot_key).sort((a, b) => Number(a.id) - Number(b.id));
  const at = same.findIndex((r) => r.uid === row.uid);
  return at < 0 ? null : `v${at + 1}`;
}

/**
 * One required document's state. `doc` is a D5052 required document (executed and in-flight uids, whether it
 * gates, whether it is awaiting signature); `missing` the program's missing slots. A gating schedule the grant
 * records as signed (a legacy or backfilled schedule with no canonical row) is executed on the grant's word.
 */
export function documentState(doc, { replacements = [], missing = [] } = {}) {
  if (!doc) return 'not_recorded';
  if (doc.executed_agreement_uid) {
    return replacements.some((r) => r.agreement_uid === doc.executed_agreement_uid) ? 'replacement_required' : 'executed';
  }
  if (doc.kind === 'program_schedule' && doc.gating && !missing.includes(doc.slot_key)) return 'executed';
  if (doc.awaiting_signature) return 'awaiting_signature';
  if (doc.in_flight_agreement_uid) return 'prepared';
  return 'not_prepared';
}

export function worstOf(states) {
  return WORST_FIRST.find((s) => states.includes(s)) || null;
}

const GRANT_WORD = { not_granted: 'Not granted', draft: 'Draft', ended: 'Ended', paused: 'Paused' };
const OPEN = (status) => !['not_granted', 'draft', 'ended'].includes(status);

/**
 * One program on one licence: the commercial grant, the agreement documents it needs (each with its state, its
 * canonical record and version), and whether it is legally in force, with what it waits on.
 * `program` is one entry of the D5052 read's `programs`; `agreements` is the D5048 read (null when unreadable).
 */
export function programReadiness(program, { licenceUid, agreements = null, replacements = [] }) {
  const rows = agreements?.agreements || [];
  const byUid = new Map(rows.map((r) => [r.uid, r]));
  const req = program.requirement || {};
  const missing = program.missing || [];
  const documents = (req.documents || []).map((d) => {
    const row = byUid.get(d.executed_agreement_uid) || byUid.get(d.in_flight_agreement_uid) || null;
    const state = documentState(d, { replacements, missing });
    return {
      ...d,
      state,
      word: DOC_STATE_WORD[state],
      kindWord: DOC_KIND_WORD[d.kind] || d.label,
      row,
      version: versionOf(row, rows),
      effective: state === 'executed' || state === 'replacement_required' ? day(row?.effective_from || row?.signed_at) : null,
      signedOnGrant: state === 'executed' && !d.executed_agreement_uid,
      href: contractsHref({ row, licenceUid, kind: d.kind, programKey: d.kind.startsWith('program') ? program.program_key : null, packageKey: d.package_key }),
    };
  });
  const gating = documents.filter((d) => d.gating);
  const counted = gating.length ? gating : documents;
  const notRecorded = req.basis === 'not_recorded';
  const agreementState = counted.length ? worstOf(counted.map((d) => d.state)) : notRecorded ? 'not_recorded' : 'not_required';
  const status = program.status;
  const inForce = status === 'in_force' ? 'in_force' : status === 'paused' ? 'paused' : OPEN(status) ? 'not_in_force' : 'none';
  const waitingOn = inForce !== 'not_in_force' ? []
    : missing.length ? documents.filter((d) => missing.includes(d.slot_key)).map((d) => `${d.kindWord.toLowerCase()} ${d.state === 'awaiting_signature' ? 'signed' : 'executed'}`)
      : ['its start date or the licence to be active'];
  return {
    programKey: program.program_key,
    name: programName(program.program_key),
    status,
    statusWord: program.word,
    grantWord: GRANT_WORD[status] || 'Granted',
    granted: OPEN(status),
    required: gating.length ? 'Yes' : notRecorded ? 'Not recorded' : 'No',
    policyRecorded: !notRecorded,
    basis: req.basis || 'not_recorded',
    strategy: req.strategy || null,
    gate: req.legal_gate || null,
    packageKey: req.package_key || null,
    documents,
    agreementState,
    agreementWord: DOC_STATE_WORD[agreementState],
    inForce,
    waitingOn,
    // Granted is a commercial decision; a granted program that is not in force is never working access.
    grantedNotInForce: OPEN(status) && status !== 'paused' && inForce !== 'in_force',
  };
}

/** Every program of the licence, from the D5052 read. */
export function programsReadiness(legal, ctx) {
  return (legal?.programs || []).filter((p) => p.program_key).map((p) => programReadiness(p, { ...ctx, replacements: legal?.replacements_required || [] }));
}

/** The package the licence holds now (its frozen holding), or null: no package is recorded. */
export function currentPackage(legal) {
  return (legal?.holdings || []).find((h) => h.scope_kind === 'package' && !h.superseded_at && h.current !== false) || null;
}

/**
 * L33's package agreement block and readiness card. Null package: "No Axal VC package recorded", and the
 * programs are standalone grants. Programs count in force only on the D5052 read's `in_force`.
 */
export function packageReadiness(legal, { licenceUid, agreements = null }) {
  const pkg = currentPackage(legal);
  if (!pkg) return { recorded: false };
  const rows = agreements?.agreements || [];
  const policy = pkg.policy || {};
  const programs = programsReadiness(legal, { licenceUid, agreements });
  const included = policy.programs || [];
  let master = null;
  if (policy.strategy === 'package_master') {
    const doc = programs.flatMap((p) => p.documents).find((d) => d.kind === 'package_master') || null;
    const row = doc?.row
      || rows.find((r) => r.slot_key === 'package_master' && r.package_key === pkg.scope_key && r.status === 'executed')
      || rows.find((r) => r.slot_key === 'package_master' && r.package_key === pkg.scope_key && IN_FLIGHT.includes(r.status))
      || null;
    const state = doc ? doc.state
      : row ? (row.status === 'executed' ? 'executed' : ['sent', 'partially_signed'].includes(row.status) ? 'awaiting_signature' : 'prepared')
        : 'not_prepared';
    master = {
      state, word: DOC_STATE_WORD[state], row, version: versionOf(row, rows),
      effective: state === 'executed' || state === 'replacement_required' ? day(row?.effective_from || row?.signed_at) : null,
      href: contractsHref({ row, licenceUid, kind: 'package_master', packageKey: pkg.scope_key }),
    };
  }
  const items = included.map((key) => {
    const p = programs.find((x) => x.programKey === key);
    if (!p || !p.granted) return { programKey: key, name: programName(key), state: null, word: p ? p.grantWord : 'Not granted', inForce: false, documents: [] };
    const own = p.documents.filter((d) => d.kind !== 'package_master');
    const state = own.length ? worstOf(own.map((d) => d.state)) : p.agreementState;
    return {
      programKey: key, name: p.name, state, word: DOC_STATE_WORD[state] || p.agreementWord,
      label: own.map((d) => d.kindWord).join(' · ') || 'Agreement',
      inForce: p.inForce === 'in_force', documents: own,
    };
  });
  return {
    recorded: true,
    key: pkg.scope_key,
    name: packageName(pkg.scope_key),
    policyVersion: pkg.policy_version,
    latestVersion: pkg.latest_version ?? null,
    behindLatest: !!pkg.behind_latest,
    strategy: policy.strategy || null,
    gate: policy.legal_gate || null,
    acceptedOn: day(pkg.frozen_at),
    origin: pkg.origin,
    master,
    items,
    inForce: items.filter((i) => i.inForce).length,
    total: items.length,
    standalone: programs.filter((p) => p.granted && !included.includes(p.programKey)).map((p) => p.name),
  };
}

/** The Needs HQ legal signals (#5051), in the canvas's order (L28) and words. */
export const SIGNAL_WORD = Object.freeze({
  not_prepared: 'Agreement not prepared',
  missing_fields: 'Missing fields',
  awaiting_send: 'Awaiting HQ send',
  awaiting_signature: 'Awaiting signature',
  stale: 'Stale after a term change',
});

const kindLabel = (row) => `${row.program_key ? `${programName(row.program_key)} · ` : row.package_key ? `${packageName(row.package_key)} · ` : ''}${DOC_KIND_WORD[row.agreement_kind] || row.agreement_kind}`;

/**
 * What needs HQ, legally, on one licence: each item names the agreement, why, and where to act. Only the
 * signals a read answered are listed; a failed read is reported by the caller as Unreadable, never as none.
 */
export function legalSignals(legal, { licenceUid, agreements = null }) {
  const out = [];
  const programs = programsReadiness(legal, { licenceUid, agreements });
  for (const p of programs) {
    if (!p.granted) continue;
    for (const d of p.documents) {
      if (d.gating && d.state === 'not_prepared') {
        out.push({
          kind: 'not_prepared', title: `${p.name} · ${d.kindWord}`, detail: 'No version exists yet.',
          // A schedule is built from the grant's terms and sent from Program access (D1120); every other kind is drafted in Contracts' record.
          href: d.kind === 'program_schedule' ? `/admin/licences/programs/studio/${enc(licenceUid)}` : d.href,
          action: d.kind === 'program_schedule' ? 'Open Program access' : 'Open in Contracts',
        });
      }
    }
  }
  const rows = agreements?.agreements || null;
  if (rows) {
    for (const r of rows.filter((x) => IN_FLIGHT.includes(x.status))) {
      const unresolved = parseList(r.unresolved_fields ?? r.unresolved_fields_json);
      const kind = ['sent', 'partially_signed'].includes(r.status) ? 'awaiting_signature' : unresolved.length ? 'missing_fields' : 'awaiting_send';
      out.push({
        kind, title: kindLabel(r),
        detail: kind === 'missing_fields' ? `${unresolved.length} ${unresolved.length === 1 ? 'field' : 'fields'} to fill: ${unresolved.join(', ')}`
          : kind === 'awaiting_send' ? 'Prepared, not sent: no envelope yet.' : `Sent ${day(r.sent_at) || ''}`.trim(),
        href: contractsHref({ row: r, licenceUid }), action: 'Open in Contracts',
      });
    }
  } else {
    // The versions could not be read: what the legal read alone says about documents in flight.
    for (const p of programs.filter((x) => x.granted)) {
      for (const d of p.documents.filter((x) => x.state === 'prepared' || x.state === 'awaiting_signature')) {
        out.push({ kind: d.state === 'prepared' ? 'awaiting_send' : 'awaiting_signature', title: `${p.name} · ${d.kindWord}`, detail: d.word, href: d.href, action: 'Open in Contracts' });
      }
    }
  }
  for (const r of legal?.replacements_required || []) {
    const row = rows?.find((x) => x.uid === r.agreement_uid) || null;
    out.push({
      kind: 'stale', title: row ? kindLabel(row) : r.slot_key,
      detail: `${r.why === 'package_changed' ? 'The licence moved to another package' : 'The grant’s terms changed'} after it was executed. `
        + (r.replacement_in_flight_uid ? 'A replacement is being prepared.' : 'No replacement is prepared yet.'),
      href: contractsHref({ row, licenceUid }), action: 'Open in Contracts',
    });
  }
  const order = Object.keys(SIGNAL_WORD);
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

const HISTORY_WORD = {
  drafted: 'drafted', readied: 'ready to send', sent: 'sent for signature', partially_signed: 'partly signed', executed: 'executed',
  voided: 'voided', superseded: 'superseded', signed_after_supersede: 'signed after it was superseded',
  policy_versioned: 'policy version recorded', policy_frozen: 'policy frozen on this licence',
  replacement_required: 'replacement required', replacement_prepared: 'replacement prepared',
  gate_satisfied: 'legal gate satisfied', gate_unsatisfied: 'legal gate not satisfied',
};

/** One line of the licence's legal history (D5052 §6), newest first by the caller. */
export function historyLine(e) {
  const subject = e.program_key ? programName(e.program_key) : e.package_key ? packageName(e.package_key) : e.scope_key || 'Licence';
  const kind = e.agreement_kind ? ` · ${DOC_KIND_WORD[e.agreement_kind] || e.agreement_kind}` : '';
  return {
    key: `${e.source}:${e.id}`,
    when: day(e.created_at),
    what: `${subject}${kind}: ${HISTORY_WORD[e.action] || String(e.action || '').replace(/_/g, ' ')}`,
    by: e.actor_user_id == null ? 'System' : `HQ user ${e.actor_user_id}`,
    reason: e.reason || null,
  };
}
