/**
 * D4819 part 5 (#5931) — the rules of New licence steps 1 and 3 to 6 (Licences v2 boards L41 to L47), as pure
 * functions: what each step sends, which field a refusal belongs to, the review's five groups and the Issue step's
 * four questions. `NewLicenceSteps.jsx` draws them.
 *
 * Every write is a route that already exists (D5930, "Backend required: none"): `POST /admin/licences` creates the
 * draft, `PATCH /:uid/entity`, `PUT /:uid/brand`, `PUT /:uid/seats`, `PATCH /:uid/terms`, `POST /:uid/admins`,
 * `POST /:uid/contract` and `POST /:uid/activate`. The Worker stays the authority on ranges: the checks here refuse
 * only what the board draws as the field's own check, and a Worker refusal is shown on its field in its own words.
 */
import { CORE_FIELDS, buildCoreSave, coreFormFrom, coreRevision } from '../../../lib/licenceCoreTermsForm.js';
import { bpsPercent } from '../../../lib/bps.js';
import { codeAmount } from '../../../lib/money.js';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { TOKEN_SPLIT_HQ_LABEL } from '../../../lib/tokenSplit.js';
import { CONSEQUENCE_QUESTIONS, licenceConsequence } from '../licenceConsequenceModel.js';

/** L21's six steps, in order. Territory (index 1) is L21's own step. */
export const NEW_LICENCE_STEPS = Object.freeze(['Legal entity', 'Territory', 'Commercial terms', 'Administrators', 'Agreement', 'Issue']);

/** "Step 3 of 6 · Commercial terms". */
export const stepLine = (i) => `Step ${i + 1} of ${NEW_LICENCE_STEPS.length} · ${NEW_LICENCE_STEPS[i]}`;

/** The two kinds `POST /admin/licences` admits (`LICENCE_KINDS`), as step 1's radio cards. */
export const KIND_CARDS = Object.freeze([
  { k: 'subsidiary', label: 'Axal subsidiary', line: 'An Axal-branded territory.' },
  { k: 'white_label', label: 'White-label', line: 'Their brand on the same console. A white-label needs its brand kit colours before it can be issued.' },
]);
export const kindLabel = (k) => (KIND_CARDS.find((c) => c.k === k)?.label) || NOT_RECORDED;

/** The step 1 fields the agreement names. Optional here; `PATCH /:uid/entity` refuses to blank a recorded one. */
export const ENTITY_KEYS = Object.freeze(['legal_entity_name', 'brand_name', 'registered_address', 'signatory_name', 'signatory_title']);
const OPTIONAL_KEYS = ['registered_address', 'signatory_name', 'signatory_title'];

/** The reason appointing (and, as drawn on L42, saving the money terms) asks for. */
export const REASON_MIN = 10;
export const REASON_SHORT = 'A reason of at least 10 characters is required';

/** Step 1 before the draft exists. */
export function blankEntityForm() {
  return { licence_ref: '', legal_entity_name: '', brand_name: '', kind: 'subsidiary', registered_address: '', signatory_name: '', signatory_title: '' };
}

/** Step 1 once the draft exists: what the licence holds, plus its brand kit colours. */
export function entityFormFrom(l) {
  const s = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    licence_ref: s(l?.licence_ref), kind: s(l?.kind) || 'subsidiary',
    ...Object.fromEntries(ENTITY_KEYS.map((k) => [k, s(l?.[k])])),
    primary_hex: s(l?.brand_kit?.primary_hex), accent_hex: s(l?.brand_kit?.accent_hex),
  };
}

/**
 * Step 1's create: the field errors the board draws as the step's own (reference and legal name are required, the
 * reference is at most 40 characters), else the `POST /admin/licences` body. The address and signatory go with it,
 * which today's inline form does not send (D5930, Frontend only).
 */
export function planCreate(form) {
  const f = form || {};
  const errors = {};
  const ref = String(f.licence_ref ?? '').trim();
  const name = String(f.legal_entity_name ?? '').trim();
  if (!ref) errors.licence_ref = 'Enter a licence reference';
  else if (ref.length > 40) errors.licence_ref = 'A licence reference is at most 40 characters';
  if (!name) errors.legal_entity_name = 'Enter the legal entity name';
  if (Object.keys(errors).length) return { ok: false, errors };
  const body = { licence_ref: ref.toUpperCase(), legal_entity_name: name, brand_name: String(f.brand_name ?? '').trim(), kind: f.kind === 'white_label' ? 'white_label' : 'subsidiary' };
  for (const k of OPTIONAL_KEYS) { const v = String(f[k] ?? '').trim(); if (v) body[k] = v; }
  return { ok: true, body };
}

/**
 * Step 1 after the draft exists: only the fields that changed. A recorded value cleared is refused here in the
 * Worker's own words ("signatory_title cannot be blank"), because the route would refuse it the same way.
 */
export function planEntity(form, licence) {
  const errors = {};
  const body = {};
  for (const k of ENTITY_KEYS) {
    const now = String(form?.[k] ?? '').trim();
    const was = String(licence?.[k] ?? '').trim();
    if (now === was) continue;
    if (!now) { if (was) errors[k] = `${k} cannot be blank`; continue; }
    body[k] = now;
  }
  return { ok: !Object.keys(errors).length, errors, body };
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const COLOURS_REQUIRED = 'Both a primary and an accent colour are required, each as a hex value such as #0f766e';

/** The brand kit block (white-label only): nothing to send, the two colours, or the Worker's own refusal. */
export function planBrand(form, licence) {
  if (licence?.kind !== 'white_label') return { send: false };
  const p = String(form?.primary_hex ?? '').trim();
  const a = String(form?.accent_hex ?? '').trim();
  const kit = licence?.brand_kit || {};
  if (p === String(kit.primary_hex ?? '') && a === String(kit.accent_hex ?? '')) return { send: false };
  if (!p && !a) return { send: false };
  if (!HEX.test(p) || !HEX.test(a)) return { send: false, errors: { [HEX.test(p) ? 'accent_hex' : 'primary_hex']: COLOURS_REQUIRED } };
  return { send: true, body: { primary_hex: p, accent_hex: a } };
}

/* ---------------------------------------------------------------- step 3 */

/**
 * A percentage typed on step 3 as basis points, exactly: "12.5" is 1250. The arithmetic is on the decimal text, so
 * no float rounding moves a share. A value outside 0 to 100 is the field's own check; a value that is not whole
 * basis points ("12.505") is sent as it is, for the Worker to refuse in its words.
 */
export function percentToBps(text) {
  const t = String(text ?? '').trim();
  if (t === '') return { ok: true, value: null };
  const m = /^(\d{1,3})(?:\.(\d+))?$/.exec(t);
  if (!m) return { ok: false, message: 'Enter a percentage from 0 to 100' };
  const whole = Number(m[1]);
  const frac = m[2] || '';
  if (whole > 100 || (whole === 100 && /[1-9]/.test(frac))) return { ok: false, message: 'Enter a percentage from 0 to 100' };
  // The digits are joined as text ("12" and "50" make 1250), so no factor is applied to a number.
  const head = Number(`${whole}${(frac + '00').slice(0, 2)}`);
  const rest = frac.slice(2);
  return { ok: true, value: rest && /[1-9]/.test(rest) ? Number(`${head}.${rest}`) : head };
}

/** Basis points as the text step 3's percentage field shows ("1250" → "12.5"), through the one bps helper. */
export function bpsToPercentText(bps) {
  const p = bpsPercent(bps);
  return p === null ? '' : p.replaceAll('%', '');
}

/** Step 3's form: seats per type, then the money terms with the shares in percent. */
export function termsFormFrom(licence, seatTypes) {
  const core = coreFormFrom(licence);
  const seats = {};
  for (const t of seatTypes) seats[t.k] = licence?.seats && t.k in licence.seats ? String(licence.seats[t.k]) : '';
  return {
    seats,
    ...core,
    revenue_share_pct: bpsToPercentText(licence?.revenue_share_bps),
    token_split_pct: bpsToPercentText(licence?.token_split_bps),
    reason: 'Terms recorded at issue',
  };
}

/** The seats line under the four fields: "24 seats across 4 types". */
export function seatsTotalLine(seats, seatTypes) {
  const n = seatTypes.map((t) => Number(seats?.[t.k]) || 0);
  const total = n.reduce((a, b) => a + b, 0);
  const types = n.filter((x) => x > 0).length;
  if (!total) return '0 seats licensed';
  return `${total.toLocaleString('en-GB')} seats across ${types} ${types === 1 ? 'type' : 'types'}`;
}

/** Start + whole years → the renewal date Eadwyn proposes, or null. Nothing is filled until the person accepts. */
export function proposeRenewal(startsOn, termYears) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startsOn ?? '').trim());
  const years = Number(String(termYears ?? '').trim());
  if (!m || !Number.isInteger(years) || years < 1) return null;
  const d = new Date(Date.UTC(Number(m[1]) + years, Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null; // 29 Feb into a common year: no proposal rather than a guess
  return d.toISOString().slice(0, 10);
}

/** "2030-01-01" → "1 Jan 2030"; anything else as it is. */
export function dayText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Step 3's save, in the order the board draws it: the seats (`PUT /:uid/seats`, no code), then the money terms
 * (`PATCH /:uid/terms`, with a reason and the revision the form was read at). The terms body is
 * `buildCoreSave`'s, the Terms section's own (`lib/licenceCoreTermsForm.js`), so only changed fields travel.
 */
export function planTerms(form, licence, seatTypes) {
  const errors = {};
  const seats = {};
  for (const t of seatTypes) {
    const v = String(form?.seats?.[t.k] ?? '').trim();
    if (v === '') { seats[t.k] = 0; continue; }
    if (!/^-?\d+$/.test(v)) { errors[`seat_${t.k}`] = 'Enter a whole number of seats, 0 or more'; continue; }
    const n = Number(v);
    if (n < 0) { errors[`seat_${t.k}`] = `${t.k} seats cannot be negative`; continue; }
    seats[t.k] = n;
  }
  const core = { ...form };
  // "120,000" as typed on L42: grouped thousands are read as the amount they spell (as `parseMinor` reads them).
  const fee = String(form?.annual_fee ?? '').trim();
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(fee)) core.annual_fee = fee.replace(/,/g, '');
  for (const [pct, key] of [['revenue_share_pct', 'revenue_share_bps'], ['token_split_pct', 'token_split_bps']]) {
    const r = percentToBps(form?.[pct]);
    if (!r.ok) errors[key] = r.message;
    else core[key] = r.value === null ? '' : String(r.value);
  }
  const why = String(form?.reason ?? '').trim();
  if (why.length < REASON_MIN) errors.reason = REASON_SHORT;
  const base = coreFormFrom(licence);
  const touched = CORE_FIELDS.some((k) => String(core[k] ?? '') !== String(base[k] ?? ''));
  let terms = null;
  if (touched) {
    const built = buildCoreSave({ form: core, base, revision: coreRevision(licence), reason: why });
    if (!built.ok) for (const [k, m] of Object.entries(built.errors)) if (k !== 'reason' && k !== 'form') errors[k] = m;
    if (built.ok) terms = built.body;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, seats, terms };
}

/** Which step 3 field a terms refusal names (`errors[].field` is the wire key; the fee travels as cents). */
const TERMS_FIELD = { annual_fee_cents: 'annual_fee' };

/* ---------------------------------------------------------------- refusals */

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The sentence a refusal is shown with when it belongs to no field. A missing Super Admin and a session not signed
 * in with an authenticator get the board's sentences (L46 Refused); everything else is the Worker's own.
 */
export function refusalSentence(e, fallback) {
  const msg = String(e?.message || '');
  if (e?.status === 403 && /super admin required/i.test(msg)) return 'Only HQ Super Admins can issue licences; ask a Super Admin.';
  if (e?.status === 403 && /totp required/i.test(msg)) return 'Sign in again with your authenticator app to make this change.';
  if (e?.status === 403 && e?.code === 'step_up_required') return 'Nothing was saved: this change asks for your authenticator code. Every value is still on this step.';
  return msg || fallback;
}

/**
 * A refusal, placed: `{ field, message }` when the Worker named a field the step draws, else `{ message }`.
 * `step` is 'create' | 'entity' | 'brand' | 'seats' | 'terms' | 'admin'.
 */
export function placeRefusal(step, e) {
  const msg = String(e?.message || '');
  const data = e?.data || {};
  if (step === 'create' && e?.status === 409 && /already in use/.test(msg)) return { field: 'licence_ref', message: msg };
  if (step === 'entity' && (data.field || e?.field)) {
    const f = data.field || e.field;
    return { field: f, message: msg.replace(/\.$/, '') };
  }
  if (step === 'brand' && (e?.code === 'invalid_colours' || /primary and an accent/.test(msg))) return { field: 'primary_hex', message: COLOURS_REQUIRED };
  if (step === 'seats') { const m = /^(\w+) seats cannot be negative/.exec(msg); if (m) return { field: `seat_${m[1]}`, message: msg }; }
  if (step === 'terms' && Array.isArray(data.errors) && data.errors.length) {
    const fields = {};
    for (const x of data.errors) {
      const k = TERMS_FIELD[x.field] || x.field;
      fields[k] = `${x.field} ${x.message}`;
    }
    return { fields, message: msg };
  }
  if (step === 'admin') {
    if (e?.status === 404 && /no account/i.test(msg)) return { field: 'email', message: 'No account with that address' };
    if (e?.status === 409 && /already administers/i.test(msg)) return { field: 'email', message: cap(msg) };
    if (e?.code === 'reason_too_short' || /at least 10 characters/.test(msg)) return { field: 'reason', message: REASON_SHORT };
    if (/email address is required/.test(msg)) return { field: 'email', message: cap(msg) };
  }
  return { message: refusalSentence(e, 'That was not saved.') };
}

/* ---------------------------------------------------------------- step 5 */

const STEP1 = new Set(['licence_ref', 'legal_entity_name', 'brand_name', 'registered_address', 'signatory_name', 'signatory_title']);
const STEP2 = new Set(['territories', 'territory', 'territory_count']);
const STEP3 = new Set(['seats', 'seats_total', 'seats_licensed', 'annual_fee', 'currency', 'revenue_share', 'token_split', 'term_years', 'starts_on', 'renews_on']);

/**
 * Where an unfilled contract field is set, in words (L44): `{ text, step }`, where `step` is the flow step that sets
 * it, or null when it is set on the licence's own page after issuing. The merge field names are
 * `services/licenceContract.ts`'s `mergeValues`: flat, `licence.<name>`, `terms.<key>` and `exclusivity.<name>`.
 */
export function unfilledWhere(field) {
  const f = String(field || '').replace(/^\{\{|\}\}$/g, '').trim();
  const bare = f.replace(/^licence\./, '');
  const seat = /^seats?_/.test(bare) || /^seats\./.test(bare);
  if (STEP1.has(bare)) return { text: 'set in step 1', step: 0 };
  if (STEP2.has(bare)) return { text: 'set in step 2', step: 1 };
  if (STEP3.has(bare) || seat) return { text: 'set in step 3', step: 2 };
  if (f.startsWith('terms.')) return { text: 'set on the licence’s Terms page after issuing', step: null };
  if (f.startsWith('exclusivity.')) return { text: 'set on the licence’s Exclusivity page after issuing', step: null };
  return { text: 'not a field in this flow', step: null };
}

/** A template's state on the step 5 picker: usable, or why not (D4811's safety overlay, D803's counsel review). */
export function templateState(t) {
  if (t?.safety?.restricted) return { usable: false, tag: 'Legal review required' };
  if (t?.safety?.incomplete) return { usable: false, tag: 'No text yet' };
  return { usable: true, tag: t?.counsel_review ? 'Counsel review pending' : null };
}

/** A short hash for the document card: "7a3e…c41b". */
export const shortHash = (h) => (h && String(h).length > 8 ? `${String(h).slice(0, 4)}…${String(h).slice(-4)}` : (h || null));

/* ---------------------------------------------------------------- step 6 */

const rowOf = (label, text, o = {}) => ({ label, text, state: o.state || 'value', mono: Boolean(o.mono) });
const nrec = (label) => rowOf(label, NOT_RECORDED, { state: 'not_recorded' });
const opt = (label, v, o) => (v === null || v === undefined || String(v).trim() === '' ? nrec(label) : rowOf(label, String(v), o));

/** The licence's countries as the review and the four questions say them. */
export function countriesText(l) {
  const t = Array.isArray(l?.territories) ? l.territories : [];
  if (!t.length) return null;
  return `${t.join(', ')} · ${t.length} ${t.length === 1 ? 'country' : 'countries'}`;
}

function seatsRow(l, seatTypes) {
  const s = l?.seats && typeof l.seats === 'object' ? l.seats : {};
  if (!seatTypes.some((t) => t.k in s)) return nrec('Seats');
  const total = seatTypes.reduce((a, t) => a + (Number(s[t.k]) || 0), 0);
  return rowOf('Seats', `${total} licensed · ${seatTypes.map((t) => `${t.label} ${Number(s[t.k]) || 0}`).join(' · ')}`);
}

const shareRow = (label, bps) => (bps === null || bps === undefined ? nrec(label) : rowOf(label, `${bpsPercent(bps)} · ${Number(bps).toLocaleString('en-GB')} bp`));

/**
 * The review's five groups (L45), each `{ step, title, rows }`. An optional value left blank reads Not recorded, a
 * read that succeeded with nothing reads None, a read that failed reads Unreadable: three different things.
 * `admins` and `contract` are the step 4 and step 5 reads: undefined while reading, false when the read failed.
 */
export function reviewGroups(l, { admins, contract, seatTypes = [] } = {}) {
  const entity = [
    rowOf('Reference', l?.licence_ref || NOT_RECORDED, { mono: true }),
    opt('Legal entity', l?.legal_entity_name),
    opt('Brand name', l?.brand_name),
    rowOf('Kind', kindLabel(l?.kind)),
    opt('Registered address', l?.registered_address),
    opt('Signatory', l?.signatory_name),
    opt('Signatory title', l?.signatory_title),
  ];
  if (l?.kind === 'white_label') {
    if (l?.brand_kit_available === false) entity.push(rowOf('Brand kit', 'Unreadable', { state: 'unreadable' }));
    else if (l?.brand_kit?.primary_hex && l?.brand_kit?.accent_hex) entity.push(rowOf('Brand kit', `${l.brand_kit.primary_hex} primary · ${l.brand_kit.accent_hex} accent`, { mono: true }));
    else entity.push(nrec('Brand kit'));
  }
  const fee = l?.annual_fee_cents === null || l?.annual_fee_cents === undefined ? nrec('Annual fee')
    : rowOf('Annual fee', `${codeAmount(l.annual_fee_cents, l.currency || 'EUR')} per licence year`);
  const terms = [
    seatsRow(l, seatTypes), fee,
    shareRow('Revenue share', l?.revenue_share_bps), shareRow(TOKEN_SPLIT_HQ_LABEL, l?.token_split_bps),
    l?.term_years ? rowOf('Term', `${l.term_years} ${Number(l.term_years) === 1 ? 'year' : 'years'}`) : nrec('Term'),
    l?.starts_on ? rowOf('Start', dayText(l.starts_on)) : nrec('Start'),
    l?.renews_on ? rowOf('Renewal', dayText(l.renews_on)) : nrec('Renewal'),
  ];
  let adminRows;
  if (admins === undefined) adminRows = [rowOf('Appointed', 'Reading…', { state: 'pending' })];
  else if (admins === false || admins === null) adminRows = [rowOf('Appointed', 'Unreadable', { state: 'unreadable' })];
  else if (!admins.length) adminRows = [rowOf('Appointed', 'None', { state: 'none' })];
  else adminRows = admins.map((a) => rowOf('Appointed', `${a.name || a.email} · ${a.admin_role === 'delegate' ? 'Delegate' : 'Principal'} · ${Number(a.is_active ?? 0) === 1 ? 'Active' : 'Deactivated'}`));
  let agreement;
  if (contract === undefined) agreement = [rowOf('Draft contract', 'Reading…', { state: 'pending' })];
  else if (contract === false || contract?.available === false) agreement = [rowOf('Draft contract', 'Unreadable', { state: 'unreadable' })];
  else if (!contract?.current) agreement = [rowOf('Draft contract', 'None', { state: 'none' })];
  else {
    const c = contract.current;
    const unf = Array.isArray(c.unfilled_fields) ? c.unfilled_fields : [];
    agreement = [
      rowOf('Draft contract', `${c.template_title || c.template_slug} v${c.template_version} · ${c.status === 'draft' ? 'Draft' : c.status}`),
      c.body_sha256 ? rowOf('Hash', shortHash(c.body_sha256), { mono: true }) : nrec('Hash'),
      rowOf('Unfilled fields', unf.length ? `${unf.length} · ${unf.join(', ')}` : 'None', { state: unf.length ? 'value' : 'none' }),
      rowOf('Signature', c.sent_at ? 'Sent' : 'Not sent · does not block issuing'),
    ];
  }
  return [
    { step: 0, title: 'Legal entity', rows: entity },
    { step: 1, title: 'Territory', rows: [countriesText(l) ? rowOf('Countries', countriesText(l)) : nrec('Countries')] },
    { step: 2, title: 'Commercial terms', rows: terms },
    { step: 3, title: 'Administrators', rows: adminRows },
    { step: 4, title: 'Agreement', rows: agreement },
  ];
}

/**
 * The Issue step's four questions (L45), headed as the consequence sheet heads them (L17,
 * `CONSEQUENCE_QUESTIONS`). The branch sentence and the reason statement are the activate sheet's own
 * (`licenceConsequence('activate', …)`), so the review and the sheet cannot tell the operator different things.
 */
export function issueConsequence(l) {
  const sheet = licenceConsequence('activate', l);
  const ref = l?.licence_ref || 'This licence';
  const t = Array.isArray(l?.territories) ? l.territories : [];
  const where = t.length ? t.join(', ') : 'no country yet';
  const seats = l?.seats && typeof l.seats === 'object' ? Object.values(l.seats).reduce((a, n) => a + (Number(n) || 0), 0) : 0;
  return [
    { title: CONSEQUENCE_QUESTIONS[0], lines: [`${ref} becomes Active for ${where}; its studio can use ${seats} ${seats === 1 ? 'seat' : 'seats'}.`] },
    {
      title: CONSEQUENCE_QUESTIONS[1],
      lines: [
        t.length ? `${t.join(', ')} ${t.length === 1 ? 'has' : 'have'} been held by this draft since step 2, and issuing keeps ${t.length === 1 ? 'it' : 'them'}.` : 'No country is held yet; this blocks issuing.',
        l?.renews_on ? `Renewal is tracked from ${dayText(l.renews_on)}.` : 'No renewal date is set yet, so renewal cannot be tracked; this blocks issuing.',
        `${sheet.affects[0].text}. ${sheet.affects[0].note}`,
        sheet.affects[1].text,
      ],
    },
    { title: CONSEQUENCE_QUESTIONS[2], lines: [sheet.reason.statement] },
    { title: CONSEQUENCE_QUESTIONS[3], lines: ['No. It can be suspended or terminated later; termination releases the territory.'], reversible: false },
  ];
}

/** The step a blocker from `activationBlockers` is fixed on (L45B, L47), or null. */
export function blockerStep(text) {
  const s = String(text || '');
  if (/brand kit/i.test(s)) return 0;
  if (/territory/i.test(s)) return 1;
  if (/seats|commercial terms|fee|revenue share|renewal date/i.test(s)) return 2;
  return null;
}

/** What the Issue refusal says (L47): blocked with its list, or the Worker's sentence. */
export function issueRefusal(e) {
  if (e?.code === 'blocked' || (e?.status === 409 && Array.isArray(e?.data?.blockers))) {
    const blockers = Array.isArray(e?.data?.blockers) ? e.data.blockers : [];
    return { kind: 'blocked', blockers, message: `Not issued · ${blockers.length} ${blockers.length === 1 ? 'thing blocks' : 'things block'} issuing` };
  }
  return { kind: 'refused', message: refusalSentence(e, 'The licence was not issued.') };
}

/**
 * How issuing ended (L47, after L18): the activate answer's `pushed` says whether the branch has its copy. Partial
 * never reads as full success.
 */
export function issueOutcome(result) {
  const p = result?.pushed;
  if (p?.ok === true) return { outcome: 'committed', title: 'Issued and copied to its branch', line: 'The Active copy was delivered to its branch.' };
  if (p?.no_deployment) return { outcome: 'committed', title: 'Issued · no branch deployed yet', line: 'No branch is deployed for this licence yet. The Active copy goes when the branch is deployed.' };
  return { outcome: 'partial', title: 'Issued at HQ · branch copy not delivered yet', line: `The licence is Active at HQ. The branch has not received its copy. HQ retries automatically.${p?.reason ? ` ${p.reason}` : ''}` };
}
