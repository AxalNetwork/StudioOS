/**
 * D4819 (#4819), Build part 2 — the Terms section as a contractual schedule
 * (Licences v2 boards L05 read, L06 amendment, L07 conflict), as pure
 * functions over the reads the section makes: the licence (`GET /:uid`, the
 * core terms and `terms_revision`), the schedule (`GET /:uid/terms`, D797's
 * terms, their contract sections and `revision`) and, while amending, the
 * licence's contracts (`GET /:uid/contract`).
 *
 * TWO RECORDS, TWO REVISIONS, ONE AMENDMENT. The core terms (fee, term,
 * shares, dates) are `territory_licences` and are written by `PATCH /terms`;
 * the schedule is `licence_terms` and is written by `PUT /terms`. Each write
 * names the revision it read (D4694). An amendment that touches both sends
 * the core write first and the schedule write second; this file builds both
 * bodies with the two existing form modules, so nothing here re-states a
 * range, a unit or a wire key:
 *   - `lib/licenceCoreTermsForm.js`  the core form (text values, dirty keys, the PATCH body);
 *   - `lib/licenceTermsForm.js`      the schedule form (D797's field list, units, the PUT body).
 *
 * THE SESSION IS A SNAPSHOT. While an amendment is open, the values it shows
 * as "before" are the ones it started from, and the write names their
 * revisions. A change made elsewhere meanwhile is not merged in silently: the
 * write is refused and the conflict view (L07) shows start, now and yours.
 *
 * UNKNOWN IS NOT ZERO. A term nobody recorded reads Not recorded; a schedule
 * that could not be read reads Unreadable; a fee of 0 reads 0 in its currency.
 */
import { bpsPercent } from '../../lib/bps';
import { NOT_RECORDED } from '../../lib/absence';
import { TOKEN_SPLIT_HQ_INPUT, TOKEN_SPLIT_HQ_LABEL } from '../../lib/tokenSplit';
import { buildCoreSave, coreFormFrom, coreRevision, dirtyKeys } from '../../lib/licenceCoreTermsForm';
import {
  DEFAULT_TERM_SECTIONS, LICENCE_TERM_FIELDS, TERM_GROUP_TITLES, buildSave, displayValue, initialForm, termSections, toInput,
} from '../../lib/licenceTermsForm';

export const UNREADABLE = 'Unreadable';

/**
 * Step 4's core terms, by the schedule group they belong to. `input` is the
 * label the edit field carries; `label` is how the schedule reads it.
 */
export const CORE_TERMS = Object.freeze([
  { key: 'term_years', group: 'renewal', label: 'Term', input: 'Term (years)', type: 'number', min: 1 },
  { key: 'starts_on', group: 'renewal', label: 'Start', input: 'Start', type: 'date' },
  { key: 'renews_on', group: 'renewal', label: 'Renewal date', input: 'Renewal date', type: 'date' },
  { key: 'annual_fee', group: 'money', label: 'Annual licence fee', input: 'Annual licence fee', type: 'number', min: 0, step: '0.01' },
  { key: 'currency', group: 'money', label: 'Currency', input: 'Currency', type: 'text', max: 3 },
  { key: 'revenue_share_bps', group: 'money', label: 'Revenue share', input: 'Revenue share (basis points)', type: 'number', min: 0, max: 10000 },
  { key: 'token_split_bps', group: 'money', label: TOKEN_SPLIT_HQ_LABEL, input: TOKEN_SPLIT_HQ_INPUT, type: 'number', min: 0, max: 10000 },
]);
const CORE_BY_KEY = new Map(CORE_TERMS.map((t) => [t.key, t]));
const SCHEDULE_BY_KEY = new Map(LICENCE_TERM_FIELDS.map((f) => [f.key, f]));

/** The canvas's title where it names a group differently from the schedule tab. */
const GROUP_TITLES = { ...TERM_GROUP_TITLES, money: 'Fees and revenue share' };

/** Seat types as the licence record keys them (`licenceShared.SEAT_TYPES`). */
const SEAT_LABELS = [['founder', 'Founder seats'], ['investor', 'Investor / LP seats'], ['advisor', 'Advisor seats'], ['partner', 'Service partner seats']];

/** A core term's text value as the schedule reads it. The empty field is Not recorded; 0 is 0. */
export function coreDisplay(key, text, currency) {
  const t = String(text ?? '').trim();
  if (!t) return NOT_RECORDED;
  const n = Number(t);
  switch (key) {
    case 'annual_fee':
      return Number.isFinite(n) ? `${currency || ''} ${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`.trim() : t;
    case 'revenue_share_bps':
    case 'token_split_bps':
      return bpsPercent(t) || t;
    case 'term_years':
      return Number.isFinite(n) ? `${t} ${n === 1 ? 'year' : 'years'}` : t;
    default:
      return t;
  }
}

/** The licence's core terms as the read view shows them: the currency is the licence's own, never a default. */
export function coreReadForm(licence) {
  return { ...coreFormFrom(licence), currency: licence?.currency || '' };
}

/** A schedule term's contract section: HQ's override, else the canvas's default, else none. */
export const sectionOf = (stored, key) => stored?.sections?.[key] || DEFAULT_TERM_SECTIONS[key] || null;

/**
 * The read view's rows, by group, in the schedule's own group order. Each row
 * is `{ id, source, key, label }`: `core` and `schedule` rows are amendable;
 * `fixed` rows are facts of the licence record with their own editors
 * elsewhere (`tab` names it).
 */
export function termsGroups() {
  const fixed = {
    parties: [
      { id: 'fixed.legal_entity_name', source: 'fixed', key: 'legal_entity_name', label: 'Licensee', tab: 'contract' },
      { id: 'fixed.signatory', source: 'fixed', key: 'signatory', label: 'Signatory', tab: 'contract' },
    ],
    territory: [{ id: 'fixed.territories', source: 'fixed', key: 'territories', label: 'Countries', tab: 'territory' }],
    seats: SEAT_LABELS.map(([k, label]) => ({ id: `fixed.seats.${k}`, source: 'fixed', key: `seats.${k}`, label, tab: 'seats' })),
  };
  return termSections().map((s) => ({
    group: s.group,
    title: GROUP_TITLES[s.group] || s.title,
    rows: [
      ...(fixed[s.group] || []),
      ...CORE_TERMS.filter((t) => t.group === s.group).map((t) => ({ id: `core.${t.key}`, source: 'core', key: t.key, label: t.label })),
      ...s.fields.map((f) => ({ id: `schedule.${f.key}`, source: 'schedule', key: f.key, label: f.label })),
    ],
  }));
}

/** A fact of the licence record, for a `fixed` row. An empty territory list is None: the read succeeded. */
export function fixedValue(licence, key) {
  const l = licence || {};
  if (key === 'territories') return Array.isArray(l.territories) ? (l.territories.length ? l.territories.join(' · ') : 'None') : NOT_RECORDED;
  if (key === 'signatory') return l.signatory_name ? `${l.signatory_name}${l.signatory_title ? ` · ${l.signatory_title}` : ''}` : NOT_RECORDED;
  if (key.startsWith('seats.')) {
    const n = l.seats?.[key.slice(6)];
    return n === null || n === undefined ? NOT_RECORDED : String(n);
  }
  return l[key] || NOT_RECORDED;
}

/**
 * A read value for any row. `stored` is the schedule read: `undefined` while
 * it is on its way, `null` when it failed, else `{ terms, sections, revision }`
 * (`terms` null when HQ has recorded no schedule yet).
 */
export function readValue(row, { licence, stored }) {
  if (row.source === 'fixed') return fixedValue(licence, row.key);
  if (row.source === 'core') return coreDisplay(row.key, coreReadForm(licence)[row.key], licence?.currency);
  if (stored === undefined) return 'Reading…';
  if (stored === null) return UNREADABLE;
  return displayValue(SCHEDULE_BY_KEY.get(row.key), stored.terms?.[row.key] ?? null, licence?.currency);
}

/* ------------------------------------------------------------------ *
 * The amendment session (L06)                                         *
 * ------------------------------------------------------------------ */

/**
 * A new session from what is on screen. `stored` null (unreadable) leaves the
 * schedule out: its terms cannot be amended from a read that failed.
 */
export function startSession(licence, stored, at = new Date().toISOString()) {
  const base = coreFormFrom(licence);
  return {
    startedAt: at,
    currency: licence?.currency || '',
    core: { base, form: { ...base }, revision: coreRevision(licence) },
    schedule: stored ? { stored, form: initialForm(stored, undefined, licence?.currency) } : null,
  };
}

/** The schedule keys whose typed text differs from what the session started from. */
export function scheduleDirtyKeys(schedule, currency) {
  if (!schedule) return [];
  return LICENCE_TERM_FIELDS
    .filter((f) => String(schedule.form.values[f.key] ?? '').trim() !== toInput(f, schedule.stored.terms?.[f.key] ?? null, currency))
    .map((f) => f.key);
}

/** Every change in the session, before and after as the schedule reads them, in the read view's row order. */
export function sessionChanges(session) {
  if (!session) return [];
  const c = session.currency;
  const core = new Set(dirtyKeys(session.core.form, session.core.base));
  const sched = new Set(scheduleDirtyKeys(session.schedule, c));
  const out = [];
  for (const g of termsGroups()) {
    for (const row of g.rows) {
      if (row.source === 'core' && core.has(row.key)) {
        out.push({ id: row.id, source: 'core', key: row.key, label: row.label, group: g.title,
          before: coreDisplay(row.key, session.core.base[row.key], session.core.base.currency || c),
          after: coreDisplay(row.key, session.core.form[row.key], session.core.form.currency || c) });
      }
      if (row.source === 'schedule' && sched.has(row.key)) {
        const f = SCHEDULE_BY_KEY.get(row.key);
        const raw = String(session.schedule.form.values[row.key] ?? '').trim();
        out.push({ id: row.id, source: 'schedule', key: row.key, label: row.label, group: g.title,
          before: displayValue(f, session.schedule.stored.terms?.[row.key] ?? null, c),
          after: raw ? afterOfSchedule(f, raw, c) : NOT_RECORDED });
      }
    }
  }
  return out;
}

/** A typed schedule value as it will read once saved; text that will be refused reads as typed. */
function afterOfSchedule(field, raw, currency) {
  const one = buildSave({ terms: {} }, { values: { [field.key]: raw }, sections: { [field.key]: '' } }, 'x', [field], currency);
  return one.ok ? displayValue(field, one.body.terms[field.key], currency) : raw;
}

/**
 * What Apply sends: `{ ok, errors, core, schedule }`. `core` is the PATCH
 * body and `schedule` the PUT body, each null when nothing of its record
 * changed. Errors are keyed by row id (`core.<key>`, `schedule.<key>`), plus
 * `reason` and `form`. With `requireReason` false (Review N changes, before a
 * reason is typed) only the field errors are reported.
 */
export function planApply(session, reason, { requireReason = true } = {}) {
  const errors = {};
  const why = requireReason ? reason : (String(reason ?? '').trim() || 'review');
  let core = null;
  let schedule = null;
  if (session && dirtyKeys(session.core.form, session.core.base).length) {
    const r = buildCoreSave({ form: session.core.form, base: session.core.base, revision: session.core.revision, reason: why });
    if (r.ok) core = r.body;
    else for (const [k, m] of Object.entries(r.errors)) if (k !== 'form') errors[k === 'reason' ? 'reason' : `core.${k}`] = m;
  }
  if (session?.schedule && scheduleDirtyKeys(session.schedule, session.currency).length) {
    const r = buildSave(session.schedule.stored, session.schedule.form, why, undefined, session.currency);
    if (r.ok) schedule = r.body;
    else for (const [k, m] of Object.entries(r.errors)) if (k !== 'form') errors[k === 'reason' ? 'reason' : `schedule.${k}`] = m;
  }
  if (!core && !schedule && !Object.keys(errors).length) errors.form = 'Nothing has changed.';
  return Object.keys(errors).length ? { ok: false, errors, core: null, schedule: null } : { ok: true, errors: {}, core, schedule };
}

/* ------------------------------------------------------------------ *
 * What else this affects                                              *
 * ------------------------------------------------------------------ */

const day = (v) => (v ? String(v).slice(0, 10) : null);

/** The agreement a terms change puts out of step, from `GET /:uid/contract`: executed first, then sent, then a draft. */
export function agreementOf(contracts) {
  const live = (Array.isArray(contracts) ? contracts : []).filter((c) => !c.superseded_at && c.status !== 'void');
  return live.find((c) => c.status === 'signed') || live.find((c) => c.status === 'sent') || live.find((c) => c.status === 'draft') || null;
}

/**
 * The downstream effects the code can actually know, each `{ id, known, text }`.
 * `agreement` is the contract read: `undefined` while it is on its way, `false`
 * when it failed, else the response. Where a fact cannot be read, the effect
 * says it is not known rather than leaving it out.
 */
export function amendmentEffects({ licence, agreement }) {
  const out = [{ id: 'ledger', known: true, text: 'The ledger’s terms change as soon as you apply. The licence’s History records each change with your reason.' }];

  // The write pushes the licence to the branch deployed under it (D272); with no deployment there is nothing to push.
  if (licence?.deployment_available === false) {
    out.push({ id: 'branch', known: false, text: 'Whether a branch receives a new revision is not known: the deployment registry could not be read.' });
  } else if (licence?.deployment?.hostname) {
    out.push({ id: 'branch', known: true, text: `The branch at ${licence.deployment.hostname} is sent a new revision. If it does not land, HQ retries it and the licence shows it as pending.` });
  } else {
    out.push({ id: 'branch', known: true, text: 'No branch is deployed for this licence, so no branch revision is sent.' });
  }

  if (agreement === undefined) {
    out.push({ id: 'agreement', known: false, text: 'Reading the licence’s agreements…' });
  } else if (agreement === false || agreement?.contracts_available === false) {
    out.push({ id: 'agreement', known: false, text: 'Whether an executed agreement is affected is not known: the agreements could not be read.' });
  } else {
    const a = agreementOf(agreement.contracts);
    const name = a ? `${a.template_title || 'The agreement'} (template v${a.template_version})` : '';
    if (!a) {
      out.push({ id: 'agreement', known: true, text: 'No agreement has been issued for this licence, so none falls out of step.' });
    } else if (a.status === 'signed') {
      out.push({ id: 'agreement', known: true, text: `The executed agreement, ${name}${day(a.signed_at) ? `, signed ${day(a.signed_at)}` : ''}, holds the terms as they stood when it was issued. It will no longer match these terms.` });
      out.push({ id: 'replacement', known: true, text: 'A replacement agreement is needed to bind the new terms. It is prepared on the Contract tab.' });
    } else if (a.status === 'sent') {
      out.push({ id: 'agreement', known: true, text: `${name} is out for signature on the terms as they stood when it was issued. It will no longer match these terms.` });
    } else {
      out.push({ id: 'agreement', known: true, text: `The draft agreement, ${name}, was issued from the terms as they stood and does not update itself. Issue it again to carry these.` });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The conflict (L07)                                                  *
 * ------------------------------------------------------------------ */

/** An instant as the conflict sentence reads it, in UTC; text that is not a date is shown as it is. */
export function whenText(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).includes('T') ? String(iso) : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`;
}

/**
 * The sentence that says who changed the terms and when. Only what the 409
 * carries is said (the Worker names a writer only when its record names the
 * revision, D4819); anything else is said to be not recorded.
 */
export function conflictWho(part) {
  const who = part?.changed_by || null;
  const when = whenText(part?.changed_at);
  if (who && when) return `${who} changed them at ${when}.`;
  if (who) return `${who} changed them; when is not recorded.`;
  if (when) return `They were changed at ${when}; who changed them is not recorded.`;
  return 'Who changed them, and when, is not recorded yet. The licence’s History lists every recorded change.';
}

/**
 * The conflict table: one row per term that moved on the server or that you
 * changed, `{ id, label, start, now, mine, theirs }`. `conflict` is
 * `{ core?, schedule? }`, each the 409's body (`current`, `current_revision`).
 */
export function conflictRows(session, conflict) {
  if (!session || !conflict) return [];
  const c = session.currency;
  const rows = [];
  if (conflict.core?.current) {
    const now = coreFormFrom(conflict.core.current);
    const mine = new Set(dirtyKeys(session.core.form, session.core.base));
    for (const t of CORE_TERMS) {
      const start = String(session.core.base[t.key] ?? '');
      const theirs = start !== String(now[t.key] ?? '');
      if (!theirs && !mine.has(t.key)) continue;
      rows.push({ id: `core.${t.key}`, label: t.label, theirs,
        start: coreDisplay(t.key, start, session.core.base.currency || c),
        now: coreDisplay(t.key, now[t.key], now.currency || c),
        mine: mine.has(t.key) ? coreDisplay(t.key, session.core.form[t.key], session.core.form.currency || c) : null });
    }
  }
  if (conflict.schedule?.current && session.schedule) {
    const nowTerms = conflict.schedule.current.terms || {};
    const mine = new Set(scheduleDirtyKeys(session.schedule, c));
    for (const f of LICENCE_TERM_FIELDS) {
      const start = session.schedule.stored.terms?.[f.key] ?? null;
      const theirs = start !== (nowTerms[f.key] ?? null);
      if (!theirs && !mine.has(f.key)) continue;
      const raw = String(session.schedule.form.values[f.key] ?? '').trim();
      rows.push({ id: `schedule.${f.key}`, label: f.label, theirs,
        start: displayValue(f, start, c), now: displayValue(f, nowTerms[f.key] ?? null, c),
        mine: mine.has(f.key) ? (raw ? afterOfSchedule(f, raw, c) : NOT_RECORDED) : null });
    }
  }
  return rows;
}

/**
 * Reapply on the current terms: the session moves to what the 409 says is
 * stored now, at its revision, and every value you changed is typed again on
 * top. A value of yours that now equals the current one is no longer a change.
 * A record the conflict does not name keeps the session's own state.
 */
export function rebaseSession(session, conflict) {
  const next = { ...session };
  if (conflict.core?.current) {
    const mine = dirtyKeys(session.core.form, session.core.base);
    const base = coreFormFrom(conflict.core.current);
    const form = { ...base };
    for (const k of mine) form[k] = session.core.form[k];
    next.core = { base, form, revision: Number(conflict.core.current_revision ?? 0) };
  }
  if (conflict.schedule?.current && session.schedule) {
    const mine = scheduleDirtyKeys(session.schedule, session.currency);
    const stored = { terms: conflict.schedule.current.terms || {}, sections: conflict.schedule.current.sections || {}, revision: Number(conflict.schedule.current_revision ?? 0) };
    const form = initialForm(stored, undefined, session.currency);
    for (const k of mine) form.values[k] = session.schedule.form.values[k];
    next.schedule = { stored, form };
  }
  return next;
}

/** After the core write committed and the schedule's did not: the session's core part is what the PATCH stored. */
export function coreApplied(session, result) {
  const base = coreFormFrom(result);
  return { ...session, core: { base, form: { ...base }, revision: coreRevision(result) } };
}

/** How many changes, said as the canvas says it. */
export const changesWord = (n) => `${n} ${n === 1 ? 'change' : 'changes'}`;

/** The outcome of an apply that committed, with the branch's half said as it ended (D4706). */
export function applyOutcome(results, count) {
  const pushes = results.map((r) => r?.pushed).filter(Boolean);
  const missed = pushes.find((p) => p.ok === false && p.code);
  if (missed) {
    return { outcome: 'partial', message: `${changesWord(count)} applied to HQ’s ledger. Branch ${missed.code} has not received them yet; HQ retries the push, and the licence shows it as pending.` };
  }
  const sent = pushes.find((p) => p.ok && p.code);
  return { outcome: 'committed', message: `${changesWord(count)} applied${sent ? ` and sent to branch ${sent.code}` : ''}. Each is in the licence’s History with your reason.` };
}

export { CORE_BY_KEY, SCHEDULE_BY_KEY };
