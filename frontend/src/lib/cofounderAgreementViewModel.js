// Co-founder Agreement — pure view-model adapter.
//
// This file has NO React, NO imports from ../lib/api, and NO side effects.
// Every export is deterministic given its arguments.
//
// DATA HONESTY CONTRACT (this is a legal-document tool):
//   Every string this module emits is either (a) read out of a real stored
//   record, (b) a value the founder typed into the builder, (c) fixed template
//   language, or (d) our own UI copy describing what a clause does. Nothing
//   here asserts a fact about the user's situation that Axal cannot verify.
//   In particular there is NO clause-acceptance store, NO per-signer signature
//   state, and NO document version column — so this module never emits an
//   "Accepted" status, a per-signer pill, or a version number.

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/**
 * Number|null — never NaN, and never a fake zero.
 *
 * `Number('')`, `Number(null)` and `Number(' ')` are all 0, so a naive
 * Number.isFinite() check turns a CLEARED input into the concrete term
 * "0-year vest". On a legal document that is a fabricated term, so empty /
 * blank / null / undefined map to null and render as the em-dash placeholder.
 */
export const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Human date, or the em-dash placeholder. Never "Invalid Date". */
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Percent to 1dp. Accepts a number or a founder row. Never emits NaN. */
export function pct1(v) {
  const raw = v && typeof v === 'object' ? v.equity_pct : v;
  const n = num(raw);
  return n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** Up to two uppercase initials. '' → '?'. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase() || '?';
}

const s = (v) => (v === null || v === undefined ? '' : String(v));
const trimmed = (v) => s(v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

/** Deterministic, cosmetic-only avatar tint (never encodes status). */
const AVATAR_TONES = [
  'bg-violet-500', 'bg-indigo-500', 'bg-cyan-600', 'bg-emerald-600',
  'bg-amber-600', 'bg-rose-500', 'bg-sky-600', 'bg-teal-600',
];
function avatarTone(name) {
  const str = s(name);
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/* ------------------------------------------------------------------ *
 * Shared constants (also consumed by the page's generate() body)
 * ------------------------------------------------------------------ */

export const DEFAULT_UNANIMOUS = [
  'Sale or merger of the Company',
  'Issuance of new equity above 10% dilution',
  'Removal of a founder',
  'Material change to this Agreement',
];

export const ACCELERATION = [
  { v: 'none', label: 'None', desc: 'No acceleration on a change of control.' },
  { v: 'single_trigger', label: 'Single-trigger', desc: '100% vests on a change of control.' },
  { v: 'double_trigger', label: 'Double-trigger', desc: 'Vests only if terminated without cause within 12 months of a change of control.' },
];

export const DISPUTE = [
  {
    v: 'Mediation followed by binding arbitration.',
    label: 'Mediation first',
    desc: 'Founders must attempt non-binding mediation before arbitration — preserves the relationship and is faster to invoke.',
  },
  {
    v: 'Binding arbitration.',
    label: 'Binding arbitration',
    desc: 'Disputes go straight to binding arbitration at the venue below.',
  },
];

export const THRESHOLDS = [
  { v: 'majority', label: 'Majority' },
  { v: 'supermajority', label: 'Supermajority (66%)' },
  { v: 'unanimous', label: 'Unanimous' },
];

/**
 * The builder's starting values — the single definition the page seeds its
 * state from AND the baseline this module diffs against to tell an untouched
 * default apart from a value the founder actually chose. Keep the two in sync
 * by construction: the page must not re-declare these literals.
 *
 * `companyName` and `founders` are intentionally empty — they are prefilled
 * from real records (project name, cap-table split), never from a literal.
 */
export const DEFAULT_DRAFT = Object.freeze({
  companyName: '',
  founders: [],
  vestingYears: 4,
  cliffMonths: 12,
  cliffPct: 25,
  acceleration: 'single_trigger',
  ipExclusions: '',
  decisionDayToDay: 'the CEO',
  decisionThreshold: 'majority',
  unanimousMatters: DEFAULT_UNANIMOUS,
  deadlock: DISPUTE[0].v,
  commitment: 'full-time',
  confidentialityYears: 3,
  governingLaw: 'Delaware, USA',
  arbitrationVenue: 'Wilmington, Delaware',
});

/** Fresh, mutable copy of the starting draft (arrays cloned). */
export const newDraft = () => ({ ...DEFAULT_DRAFT, founders: [], unanimousMatters: [...DEFAULT_UNANIMOUS] });

/**
 * Jurisdiction id → human label, mirroring the Worker's read-only catalogue
 * (cloudflare-worker/src/routes/legal.ts JURISDICTIONS). Used only to name a
 * jurisdiction the user's own formation order already carries — never to
 * invent one. Unknown ids fall through to the raw id.
 */
export const JURISDICTION_LABELS = {
  us_de_ccorp: 'Delaware C-Corp (United States)',
  us_de_llc: 'Delaware LLC (United States)',
  uk_ltd: 'UK Private Limited (Ltd)',
  sg_pte: 'Singapore Pte Ltd',
  ee_oy: 'Estonia OÜ',
};
export const jurisdictionLabel = (id) => JURISDICTION_LABELS[s(id)] || (s(id) || '');

/**
 * The six statuses. Each names a checkable predicate — see CLAUSE_SPEC and
 * the rows.* derivations below for where each one is assigned.
 *
 * There is deliberately no "Accepted": nothing in Axal records a clause
 * acceptance, so displaying one would be a fabricated legal fact.
 *
 * `untouched` vs `draft` matters on a legal tool: a value the builder supplied
 * for you is NOT a term you chose. Until a field is changed it keeps the
 * `untouched` pill, so no pill ever asserts authorship the user does not have.
 */
export const STATUS = {
  sourced: {
    label: 'Sourced',
    tone: 'emerald',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    meaning: 'Read out of a stored Axal record.',
  },
  draft: {
    label: 'Your input',
    tone: 'violet',
    cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    meaning: 'A value you changed in this builder — not stored anywhere until you generate.',
  },
  untouched: {
    label: 'Default — not reviewed',
    tone: 'gray',
    cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    meaning: 'A starting value this builder supplied. You have not changed it, so it is not your choice yet — review it before generating.',
  },
  template: {
    label: 'Template default',
    tone: 'gray',
    cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    meaning: 'Fixed template language — not editable, not an input.',
  },
  review: {
    label: 'Needs review',
    tone: 'amber',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    meaning: 'An upstream tool is incomplete. Does not block generation.',
  },
  blocked: {
    label: 'Blocked',
    tone: 'rose',
    cls: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
    meaning: 'A required generator input is empty or invalid.',
  },
};

const statusKeys = Object.keys(STATUS);
const st = (key) => (statusKeys.includes(key) ? key : 'template');

/**
 * Static per-clause metadata. Section numbers are taken from the actual
 * template body (backend/app/api/routes/legal.py, the CO-FOUNDER AGREEMENT
 * template) — §4.2 amendment matters, §4.4 deadlock, §10.1–10.2 law/disputes.
 *
 * `explain` is our own plain-English description of what the clause DOES.
 * It never asserts anything about the reader's situation.
 */
export const CLAUSE_SPEC = [
  {
    key: 'company', label: 'Company', section: 'preamble', critical: false, editor: 'CompanyEditor',
    explain: 'Names the entity that every other clause binds. It is written into the preamble of the generated document.',
  },
  {
    key: 'equity', label: 'Equity split', section: '§1', critical: true, editor: 'EquityEditor',
    explain: 'Sets each founder’s percentage of founder common stock, before any option pool. The generator rejects a total above 100%.',
  },
  {
    key: 'vesting', label: 'Vesting schedule', section: '§2', critical: true, editor: 'VestingEditor',
    explain: 'Decides how founder stock is earned over time, and what happens on a change of control. A cliff means nothing vests before that date.',
  },
  {
    key: 'ip', label: 'IP assignment', section: '§3', critical: true, editor: 'IpEditor',
    explain: 'Assigns prior and future work product to the Company rather than to a founder personally. Exclusions carve out pre-existing IP you want to keep.',
  },
  {
    key: 'roles', label: 'Founder roles & authority', section: '§§4.1, 5', critical: false, editor: 'RolesEditor',
    explain: 'Separates day-to-day operating authority from strategic decisions, and sets the vote required for the strategic ones.',
  },
  {
    key: 'commitment', label: 'Commitment & compensation', section: '§6', critical: false, editor: 'CommitmentEditor',
    explain: 'States how much working time each founder owes the Company and how outside activities are handled.',
  },
  {
    key: 'departure', label: 'Departure & repurchase', section: '§7', critical: true, editor: null,
    explain: 'Fixed leaver mechanics: unvested equity is forfeited on departure, and the Company holds a repurchase right and a right of first refusal.',
  },
  {
    key: 'confidentiality', label: 'Confidentiality', section: '§8.1', critical: false, editor: 'ConfidentialityEditor',
    explain: 'Binds every founder to keep Company information confidential, for a period that survives their involvement ending.',
  },
  {
    key: 'covenants', label: 'Restrictive covenants', section: '§8.2', critical: false, editor: null,
    explain: 'Fixed template language. Non-competes are unenforceable in several states, so this template uses a narrower non-solicit instead.',
  },
  {
    key: 's83b', label: 'Section 83(b)', section: '§9', critical: false, editor: null,
    explain: 'Obligates each founder to file an 83(b) election within 30 days of their stock purchase. The deadline is statutory and cannot be extended.',
  },
  {
    key: 'amend', label: 'Amendment mechanics', section: '§4.2', critical: false, editor: 'AmendmentEditor',
    explain: 'Lists the reserved matters that need unanimous founder consent, so no founder can change them alone.',
  },
  {
    key: 'dispute', label: 'Dispute resolution', section: '§4.4', critical: false, editor: 'DisputeEditor',
    explain: 'Sets what happens when founders deadlock — either mediation first, or straight to binding arbitration.',
  },
  {
    key: 'exec', label: 'Governing law & execution', section: '§10.1–10.2', critical: true, editor: 'LawEditor',
    explain: 'Picks the law that interprets the agreement and the venue where disputes are heard. It should match the jurisdiction the entity is formed in.',
  },
];

export const RACI_REASON =
  'The design’s per-domain responsibility matrix (Accountable / Supporting / Approval) is deliberately not shown: Axal stores no per-domain data — project members carry only owner/cofounder/advisor — so every cell would be invented. What is below is what exists: the founders you named, the titles you typed, and the decision rules written into §§4.1–4.2.';

export const IP_RIDER_NOTE =
  'Axal does not track university tech-transfer or sponsored-research obligations — confirm those separately before signing.';

export const SIGNATORY_NOTE =
  'Axal records one status per document, not per signer. The generated document carries wet-ink signature blocks for each person below.';

export const EXECUTION_DISABLED_REASON =
  'Axal has no in-app signing flow wired into this page — the generated copy carries wet-ink signature blocks. Sign it outside Axal and store it with your legal records.';

export const SOLO_BODY =
  'A solo-founder path means one person holds the founder equity, all business IP is assigned to the entity, and no co-founder rights are granted. There is no counterparty, so there is no agreement to negotiate — what it takes instead is 100% ownership recorded in the Cap Table and an IP assignment signed into the entity at formation.';

export const SOLO_REASON =
  'There is no solo-founder declaration document in Axal — the agreement generator requires two or more named founders.';

export const SOLO_CAVEAT =
  'These signals show that no co-founder is on record. Axal does not store a “chose solo” decision, so none of them confirm one.';

export const READONLY_REASON =
  'This startup belongs to another founder — you can review the draft, but not edit or generate.';

/* ------------------------------------------------------------------ *
 * Cap table
 * ------------------------------------------------------------------ */

/** Relative founder split from a cap-table scenario's founder shares. */
export function capTableSplit(scenarioInputs) {
  const founders = arr(scenarioInputs?.founders).filter((f) => f?.name && num(f.shares) > 0);
  const total = founders.reduce((a, f) => a + Number(f.shares), 0);
  if (!founders.length || total <= 0) return [];
  return founders.map((f) => ({
    name: String(f.name),
    equity_pct: Math.round((Number(f.shares) / total) * 10000) / 100,
  }));
}

/* ------------------------------------------------------------------ *
 * Adapter
 * ------------------------------------------------------------------ */

function foundersLabelOf(names) {
  if (!names.length) return 'No founders named yet';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function buildCofounderAgreementViewModel(input) {
  const inp = input && typeof input === 'object' ? input : {};
  const user = inp.user || null;
  const project = inp.project || null;
  const labState = inp.labState || null;
  const docs = arr(inp.docs);
  const capSplit = arr(inp.capSplit);
  const members = arr(inp.members);
  const orders = arr(inp.orders);
  const trackers = arr(inp.trackers);
  const connections = arr(inp.connections);
  const envUnavailable = inp.envUnavailable === true;
  const path = inp.path === 'solo' ? 'solo' : 'multi';

  const d = inp.draft && typeof inp.draft === 'object' ? inp.draft : {};
  const draftFounders = arr(d.founders);
  const companyName = trimmed(d.companyName);
  const unanimousMatters = arr(d.unanimousMatters).map(s);
  const reservedMatters = unanimousMatters.filter((m) => m.trim());

  /* ---- permission (fixes the admin/partner lockout bug) ---------------- */
  const ownFid = user?.founder_id === null || user?.founder_id === undefined ? NaN : Number(user.founder_id);
  const projFid = project?.founder_id === null || project?.founder_id === undefined ? NaN : Number(project.founder_id);
  const isOwner = Number.isFinite(ownFid) && Number.isFinite(projFid) && ownFid === projFid;
  const byRole = !isOwner && (user?.role === 'admin' || user?.role === 'partner');
  const canEdit = !!(user && project && (isOwner || byRole));
  // Admin/partner write access is granted by ROLE, not ownership — the server
  // agrees (_check_project_write_access). pickLabProject picks deterministically
  // but not necessarily YOUR record, so a privileged user can land on someone
  // else's startup. Say so out loud and make them confirm before generating.
  const actingForOther = !!(canEdit && byRole && project);
  const actingForOtherText = actingForOther
    ? `You are editing “${trimmed(project?.name) || 'this startup'}”, which is not your own startup record — you have ${s(user?.role)} access to it. Generating writes a real legal document onto that founder's project.`
    : '';

  /* ---- preconditions --------------------------------------------------- */
  const named = draftFounders.filter((f) => trimmed(f?.name));
  const anyRowUnnamed = draftFounders.some((f) => !trimmed(f?.name));
  const totalEquity = draftFounders.reduce((a, f) => a + (Number(f?.equity_pct) || 0), 0);
  const matchesCap = capSplit.length > 0
    && capSplit.length === draftFounders.length
    && capSplit.every((c, i) => c.name === trimmed(draftFounders[i]?.name)
      && Math.abs(Number(c.equity_pct) - (Number(draftFounders[i]?.equity_pct) || 0)) < 0.005);

  const cofounderMembers = members.filter((m) => s(m?.role) === 'cofounder');
  const memberNames = new Set(members.map((m) => trimmed(m?.name || m?.full_name)).filter(Boolean).map((n) => n.toLowerCase()));

  const paidOrder = orders.find((o) => Number(o?.project_id) === Number(project?.id)
    && ['paid', 'packet_processing', 'packet_ready'].includes(s(o?.status)));

  const milestoneKeys = new Set(
    arr(labState?.milestones)
      .filter((m) => (typeof m === 'string' ? true : !!(m && m.completed_at)))
      .map((m) => (typeof m === 'string' ? m : m.key || m.milestone_key))
      .filter(Boolean),
  );

  // `users.is_incorporated` and the `incorporation_completed` milestone are
  // USER-level columns — a founder with two projects carries both on the
  // second project too. Only `project.entity_id` and a project-scoped order
  // say anything about THIS project, so "formed" requires the entity row and
  // the user-level flag degrades to a weaker "elsewhere" signal.
  const formedElsewhere = user?.is_incorporated === 1 || milestoneKeys.has('incorporation_completed');
  const incState = project?.entity_id
    ? 'formed'
    : paidOrder ? 'in_progress' : formedElsewhere ? 'elsewhere' : 'none';
  const orderJurisdiction = jurisdictionLabel(paidOrder?.jurisdiction_id);

  const trk = {
    total: trackers.length,
    confirmed: trackers.filter((t) => s(t?.status) === 'confirmed').length,
    overdue: trackers.filter((t) => t?.overdue === true).length,
  };

  const vestingYears = num(d.vestingYears);
  const cliffMonths = num(d.cliffMonths);
  const cliffPct = num(d.cliffPct);
  const confYears = num(d.confidentialityYears);
  const accel = ACCELERATION.find((a) => a.v === d.acceleration) || ACCELERATION[0];
  const disputeOpt = DISPUTE.find((o) => o.v === d.deadlock) || DISPUTE[0];
  const thresholdOpt = THRESHOLDS.find((t) => t.v === d.decisionThreshold) || THRESHOLDS[0];
  const dayToDay = trimmed(d.decisionDayToDay);
  const governingLaw = trimmed(d.governingLaw);
  const arbitrationVenue = trimmed(d.arbitrationVenue);
  const ipExclusions = trimmed(d.ipExclusions);
  const commitment = trimmed(d.commitment) || 'full-time';

  /* ---- untouched-default detection -------------------------------------
   * A value the builder supplied for you is not a term you chose. Every
   * clause fed only by DEFAULT_DRAFT literals reports `untouched` until the
   * founder actually changes one of its fields, so no pill ever claims
   * authorship the user does not have. Compared as strings so the numeric
   * inputs (which arrive as strings from <input type="number">) diff cleanly.
   */
  const sameAsDefault = (key) => {
    const base = DEFAULT_DRAFT[key];
    const cur = d[key];
    if (Array.isArray(base)) {
      const a = arr(cur).map(s);
      return a.length === base.length && a.every((v, i) => v === s(base[i]));
    }
    if (cur === undefined) return true;
    return s(cur).trim() === s(base).trim();
  };
  /** true when EVERY listed field still holds its starting value. */
  const untouched = (...keys) => keys.every(sameAsDefault);
  /** 'untouched' while all listed fields are defaults, otherwise 'draft'. */
  const inputStatus = (...keys) => (untouched(...keys) ? 'untouched' : 'draft');

  /* ---- clause derivation ---------------------------------------------- */
  const rows = {};

  // 1 — company
  rows.company = (() => {
    if (!companyName) {
      return { status: 'blocked', value: 'Not set', note: 'The generator requires a company name.', source: 'this builder', sourceTo: null };
    }
    if (companyName === trimmed(project?.name)) {
      return { status: 'sourced', value: companyName, note: null, source: 'from Startups', sourceTo: '/spinout-lab/startup' };
    }
    return { status: 'draft', value: companyName, note: null, source: 'this builder', sourceTo: null };
  })();

  // 2 — equity split
  rows.equity = (() => {
    const valueLine = named.length
      ? named.map((f) => `${trimmed(f.name)} ${pct1(f.equity_pct)}%`).join(' · ')
      : 'No founders named yet';
    const src = matchesCap
      ? { source: 'from Cap Table', sourceTo: '/spinout-lab/captable' }
      : { source: 'manual entry', sourceTo: null };
    if (named.length < 2) {
      return { status: 'blocked', value: valueLine, note: 'A co-founder agreement needs two or more named founders (the generator rejects fewer).', ...src };
    }
    if (anyRowUnnamed) {
      return { status: 'blocked', value: valueLine, note: 'Every founder row must have a name.', ...src };
    }
    if (totalEquity > 100.001) {
      return { status: 'blocked', value: valueLine, note: `Total equity is ${totalEquity.toFixed(2)}% — the generator rejects anything over 100%.`, ...src };
    }
    if (matchesCap) {
      return { status: 'sourced', value: valueLine, note: null, ...src };
    }
    return { status: 'draft', value: valueLine, note: null, ...src };
  })();

  // 3 — vesting. NEVER "from Cap Table": no vesting field exists anywhere in Axal.
  rows.vesting = (() => {
    // An empty input renders as "— year vest", never as a fake "0-year vest".
    const yrs = vestingYears === null ? '— year' : `${vestingYears}-year`;
    const mos = cliffMonths === null ? '— month' : `${cliffMonths}-month`;
    const cpc = cliffPct === null ? '—' : `${cliffPct}%`;
    const value = `${yrs} vest · ${mos} cliff vesting ${cpc} · ${accel.label} acceleration`;
    const note = 'Vesting terms are not stored in Axal — they exist only inside the generated document.';
    const bad = !(vestingYears >= 1) || !(cliffMonths >= 0) || !(cliffPct >= 0 && cliffPct <= 100);
    const status = bad ? 'blocked' : inputStatus('vestingYears', 'cliffMonths', 'cliffPct', 'acceleration');
    return {
      status,
      value,
      note: bad
        ? `Vesting inputs are out of range — years must be at least 1, cliff months at least 0, and cliff vest between 0 and 100%. Generation is blocked until they are valid. ${note}`
        : status === 'untouched'
          ? `This is the builder's starting 4-year / 1-year-cliff schedule, not a term you picked. ${note}`
          : note,
      source: status === 'untouched' ? 'builder default' : 'this builder',
      sourceTo: null,
    };
  })();

  // 4 — IP assignment
  rows.ip = {
    status: ipExclusions ? 'draft' : 'untouched',
    value: ipExclusions
      ? `All prior and future business IP assigned to the Company; exclusions listed (${ipExclusions.length} characters).`
      : 'All prior and future business IP assigned to the Company; no exclusions listed.',
    note: ipExclusions ? null : 'No exclusions typed yet — §3.3 generates as “None.”, assigning everything.',
    source: ipExclusions ? 'this builder' : 'builder default',
    sourceTo: null,
  };

  // 5 — roles & authority.
  // NEVER "from Team members": every character of the value below comes from
  // the two builder inputs. Team membership corroborates WHO the founders are,
  // it does not source the decision rules, so it is surfaced as a note only.
  rows.roles = (() => {
    const value = `Day-to-day decisions by ${dayToDay || 'not set'} · strategic matters by ${thresholdOpt.label.toLowerCase()} vote`;
    const teamNote = cofounderMembers.length >= 1
      ? ` ${cofounderMembers.length} co-founder(s) are on this project's team record — that corroborates who the founders are, not these decision rules.`
      : '';
    if (!dayToDay) {
      return { status: 'review', value, note: `No day-to-day decision-maker set — §4.1 will generate incomplete.${teamNote}`, source: 'this builder', sourceTo: null };
    }
    const status = inputStatus('decisionDayToDay', 'decisionThreshold');
    const base = status === 'untouched'
      ? 'These are the builder’s starting decision rules, not choices you have made.'
      : '';
    const note = `${base}${teamNote}`.trim() || null;
    return { status, value, note, source: status === 'untouched' ? 'builder default' : 'this builder', sourceTo: null };
  })();

  // 6 — commitment & compensation
  rows.commitment = (() => {
    const status = inputStatus('commitment');
    return {
      status,
      value: `${commitment === 'part-time' ? 'Part-time' : 'Full-time'} working time commitment`,
      note: `${status === 'untouched' ? 'Full-time is the builder’s starting value — confirm it. ' : ''}Cash compensation is not part of this template — add it by amendment once you have payroll.`,
      source: status === 'untouched' ? 'builder default' : 'this builder',
      sourceTo: null,
    };
  })();

  // 7 — departure & repurchase (template-fixed)
  rows.departure = {
    status: 'template',
    value: 'Unvested equity is forfeited on departure; the Company holds a repurchase right and a right of first refusal.',
    note: null,
    source: 'template default',
    sourceTo: null,
  };

  // 8 — confidentiality
  rows.confidentiality = (() => {
    const bad = !(confYears >= 1);
    const status = bad ? 'blocked' : inputStatus('confidentialityYears');
    return {
      status,
      value: `${confYears === null ? '—' : confYears} year(s) of confidentiality, surviving termination`,
      note: bad
        ? 'Confidentiality must be at least 1 year — generation is blocked until it is.'
        : status === 'untouched' ? 'Three years is the builder’s starting value, not a term you picked.' : null,
      source: status === 'untouched' ? 'builder default' : 'this builder',
      sourceTo: null,
    };
  })();

  // 9 — restrictive covenants (template-fixed)
  rows.covenants = {
    status: 'template',
    value: '12-month non-solicit of employees and customers; no non-compete.',
    note: null,
    source: 'template default',
    sourceTo: null,
  };

  // 10 — Section 83(b)
  rows.s83b = (() => {
    if (trk.overdue > 0) {
      return {
        status: 'review',
        value: `${trk.total} tracker(s) · ${trk.confirmed} confirmed`,
        note: `${trk.overdue} 83(b) filing deadline(s) are past due.`,
        source: 'from 83(b) tracker', sourceTo: '/incorporate/83b',
      };
    }
    if (trk.total > 0) {
      return {
        status: 'sourced',
        value: `${trk.total} tracker(s) · ${trk.confirmed} confirmed`,
        note: null,
        source: 'from 83(b) tracker', sourceTo: '/incorporate/83b',
      };
    }
    return {
      status: 'template',
      value: 'Each founder must file their 83(b) election within 30 days of stock purchase.',
      note: 'No 83(b) trackers on this project yet.',
      source: 'template default', sourceTo: null,
    };
  })();

  // 11 — amendment mechanics
  rows.amend = (() => {
    const value = reservedMatters.length
      ? `${reservedMatters.length} matter(s) require unanimous founder consent`
      : 'No matters listed as requiring unanimous consent';
    if (reservedMatters.length === 0) {
      return { status: 'review', value, note: 'No reserved matters listed — §4.2 will generate with an empty list.', source: 'this builder', sourceTo: null };
    }
    const status = inputStatus('unanimousMatters');
    return {
      status,
      value,
      note: status === 'untouched' ? 'This is the builder’s starting list of reserved matters — edit it to match what you agreed.' : null,
      source: status === 'untouched' ? 'builder default' : 'this builder',
      sourceTo: null,
    };
  })();

  // 12 — dispute resolution
  rows.dispute = (() => {
    const status = inputStatus('deadlock');
    return {
      status,
      value: disputeOpt.label,
      note: status === 'untouched' ? 'Mediation-first is the builder’s starting choice, not one you have made.' : null,
      source: status === 'untouched' ? 'builder default' : 'this builder',
      sourceTo: null,
    };
  })();

  // 13 — governing law & execution.
  //
  // NEVER "Sourced" / "from Incorporate": the value is 100% typed builder
  // input — the adapter reads no jurisdiction out of any record and prefills
  // nothing from one. Claiming Incorporate as the source of the jurisdiction
  // clause of a legal agreement would be a fabricated provenance. Formation
  // state is used only to word an advisory note, and where a real formation
  // order carries a jurisdiction we name it so a UK/SG/EE founder is not left
  // staring at a Delaware default that matches nothing they filed.
  rows.exec = (() => {
    const value = `Governed by ${governingLaw || '—'} · arbitration in ${arbitrationVenue || '—'}`;
    const status = inputStatus('governingLaw', 'arbitrationVenue');
    const src = { source: status === 'untouched' ? 'builder default' : 'this builder', sourceTo: null };
    const link = { linkTo: '/spinout-lab/incorporate', linkLabel: 'Open Incorporate' };
    const defaultCaveat = status === 'untouched'
      ? 'Delaware law and a Wilmington venue are this builder’s starting values, not your entity’s jurisdiction. '
      : '';
    if (!governingLaw || !arbitrationVenue) {
      return {
        status: 'blocked',
        value,
        note: 'Governing law and arbitration venue are both empty. The generator does not reject them — it would write §10.1 and §10.2 with blanks — so generation is blocked here until both are filled in.',
        ...src,
        ...link,
      };
    }
    if (incState === 'formed') {
      return { status: 'review', value, note: `${defaultCaveat}This project has a formed entity on record — confirm the governing law matches the jurisdiction it was formed in.`, ...src, ...link };
    }
    if (incState === 'in_progress') {
      const j = orderJurisdiction ? ` Your formation order is for ${orderJurisdiction}.` : '';
      return { status: 'review', value, note: `${defaultCaveat}Formation is in progress (order status: ${s(paidOrder?.status) || 'unknown'}).${j} Governing law should match the formed entity before signature.`, ...src, ...link };
    }
    if (incState === 'elsewhere') {
      return { status: 'review', value, note: `${defaultCaveat}You have an incorporation recorded on another record, but not on this project — Axal has no jurisdiction on file here.`, ...src, ...link };
    }
    return { status: 'review', value, note: `${defaultCaveat}No formed entity or paid formation order on this project — the value below is your input, not a jurisdiction Axal has on record.`, ...src, ...link };
  })();

  const clauses = CLAUSE_SPEC.map((c) => {
    const r = rows[c.key] || { status: 'template', value: '—', note: null, source: 'template default', sourceTo: null };
    const key = st(r.status);
    return {
      key: c.key,
      testid: `clause-${c.key}`,
      label: c.label,
      section: c.section,
      value: s(r.value) || '—',
      explain: c.explain,
      source: s(r.source) || 'template default',
      sourceTo: r.sourceTo || null,
      // Advisory cross-link, independent of `sourceTo` — a link the reader may
      // want WITHOUT the row asserting that link as the value's provenance.
      linkTo: r.linkTo || null,
      linkLabel: s(r.linkLabel) || '',
      status: key,
      statusLabel: STATUS[key].label,
      tone: STATUS[key].tone,
      critical: !!c.critical,
      note: r.note ? s(r.note) : null,
      editor: c.editor || null,
      blocking: key === 'blocked',
    };
  });

  const byKey = (k) => clauses.find((c) => c.key === k) || clauses[0];
  const unresolvedCount = clauses.filter((c) => c.status === 'review' || c.status === 'blocked').length;
  const firstBlocked = clauses.find((c) => c.status === 'blocked') || null;

  /* ---- readiness -------------------------------------------------------
   * Counts clauses that are SETTLED — read from a record, changed by the
   * founder, or fixed template language. An untouched builder default is NOT
   * settled: "13 of 13 clauses have a value" was true of a form nobody had
   * looked at, and a full progress bar reads as review completeness.
   */
  const untouchedCount = clauses.filter((c) => c.status === 'untouched').length;
  const doneCount = clauses.filter((c) => ['sourced', 'draft', 'template'].includes(c.status)).length;
  const moduleProgress = {
    done: doneCount,
    total: clauses.length,
    untouched: untouchedCount,
    pct: clauses.length ? Math.round((doneCount / clauses.length) * 100) : 0,
    label: `${doneCount} of ${clauses.length} clauses reviewed`,
    title: 'Counts clauses read from a record, changed by you, or fixed by the template. Untouched builder defaults are not counted.',
  };

  /* ---- founders / summary --------------------------------------------- */
  const foundersOut = named.map((f) => {
    const name = trimmed(f.name);
    const eq = num(f.equity_pct);
    return {
      name,
      initials: initials(name),
      role: trimmed(f.role) || 'Role not set',
      email: trimmed(f.email),
      equityPct: eq === null ? 0 : eq,
      equityLabel: eq === null ? '—' : `${pct1(eq)}%`,
      startDate: fmtDate(f.start_date),
      matchedMember: memberNames.has(name.toLowerCase()),
    };
  });
  const foundersLabel = foundersLabelOf(foundersOut.map((f) => f.name));

  // Void documents are not pending execution — excluding them keeps the
  // "x/y signed" denominator from counting cancelled paper as outstanding.
  const activeDocs = docs.filter((doc) => s(doc?.status).toLowerCase() !== 'void');
  const signedDocs = docs.filter((doc) => s(doc?.status).toLowerCase() === 'signed');
  const signedCount = signedDocs.length;
  const signerTotal = activeDocs.length;

  const hasBlocker = !!firstBlocked || !canEdit || envUnavailable;
  let blockerText = '';
  if (!canEdit) blockerText = READONLY_REASON;
  else if (envUnavailable) blockerText = 'Agreement generation isn’t available in this environment. Existing documents and their status are unaffected.';
  else if (firstBlocked) blockerText = `“${firstBlocked.label}” is blocked — ${firstBlocked.note || 'a required input is missing.'}`;

  let statusLabel;
  if (signedCount > 0) statusLabel = 'Signed copy on record';
  else if (activeDocs.length > 0) statusLabel = 'Generated — execution happens outside Axal';
  else if (docs.length > 0) statusLabel = 'Previous draft voided';
  else if (hasBlocker) statusLabel = 'Draft — required inputs missing';
  else if (untouchedCount > 0) statusLabel = 'Draft — builder defaults not yet reviewed';
  else statusLabel = 'Draft — ready to generate';

  /**
   * Generation gate. It MUST cover every blocked clause: the page shows a
   * blocker while generate() sends its own coerced values, so a `blocked`
   * vesting or confidentiality row used to produce a document whose terms the
   * founder never saw. `blocking` is exactly `status === 'blocked'`, and the
   * company / founder-count / equity rules already feed those rows, so this
   * single predicate subsumes the old one and adds the missing terms.
   */
  const blockingClauses = clauses.filter((c) => c.blocking);
  const canGenerate = !!(canEdit && !envUnavailable && blockingClauses.length === 0);

  /* ---- snapshot -------------------------------------------------------- */
  const snapTile = (key, testid, label, value, sub, clauseKey) => {
    const c = byKey(clauseKey);
    return { key, testid, label, value: s(value) || '—', sub: s(sub), status: c.status, statusLabel: c.statusLabel, tone: c.tone };
  };
  // The four tiles the design specifies: Equity / Vesting / Compensation /
  // Execution. Each `sub` states the tile's provenance, and a tile fed by an
  // untouched builder default says so rather than presenting it as a term.
  const defaultSub = (key, otherwise) => (byKey(key).status === 'untouched' ? 'builder default — not reviewed' : otherwise);
  const snapshot = [
    snapTile('equity', 'snap-equity', 'Equity split',
      named.length >= 2 ? named.map(pct1).join(' / ') : '—',
      `${named.length} founder(s) · ${matchesCap ? 'from Cap Table' : 'manual entry'}`, 'equity'),
    snapTile('vesting', 'snap-vesting', 'Vesting',
      `${vestingYears === null ? '—' : vestingYears}yr / ${cliffMonths === null ? '—' : cliffMonths}mo cliff`,
      defaultSub('vesting', `${accel.label} acceleration`), 'vesting'),
    snapTile('compensation', 'snap-compensation', 'Compensation',
      commitment === 'part-time' ? 'Part-time' : 'Full-time',
      defaultSub('commitment', 'cash comp not in template'), 'commitment'),
    snapTile('law', 'snap-law', 'Execution',
      governingLaw || '—',
      defaultSub('exec', `arbitration: ${arbitrationVenue || '—'}`), 'exec'),
  ];

  /* ---- roles (replaces the design's RACI matrix) ----------------------- */
  const roles = {
    rows: named.map((f) => ({
      name: trimmed(f.name),
      title: trimmed(f.role) || 'Not set',
      // Titles are never prefilled — cap-table row order carries no officer
      // semantics, so a positional CEO/CTO guess would be an invented officer
      // title on a real person, written verbatim into §5 of the document.
      titleSource: trimmed(f.role) ? 'you typed it' : 'not set — generates as “TBD”',
      matchedMember: memberNames.has(trimmed(f.name).toLowerCase()),
    })),
    dayToDay: dayToDay || 'not set',
    threshold: thresholdOpt.v,
    thresholdLabel: thresholdOpt.label,
    reservedMatters,
    memberCofounderCount: cofounderMembers.length,
    note: cofounderMembers.length
      ? `${cofounderMembers.length} co-founder(s) are on this project's team record.`
      : null,
  };

  /* ---- IP rider -------------------------------------------------------- */
  const ipItems = [
    {
      label: 'Prior inventions disclosed',
      status: ipExclusions ? 'Exclusions listed' : 'None listed',
      tone: 'violet',
      detail: ipExclusions
        ? 'You listed pre-existing IP to carve out of the assignment. It is written into §3.3 verbatim.'
        : 'No exclusions typed into the builder — §3.3 will generate as "None".',
    },
    { label: 'Future inventions assignment', status: 'In §3.1', tone: 'gray', detail: 'Fixed template language assigning future business IP to the Company.' },
    { label: 'Work-product ownership', status: 'In §3.2', tone: 'gray', detail: 'Fixed template representation that no third party holds a claim to the assigned work.' },
    { label: 'Open-source dependency review', status: 'Not tracked in Axal', tone: 'gray', detail: 'No dependency-scanning data feeds this page.' },
  ];
  const ipNote = IP_RIDER_NOTE;

  /* ---- dispute --------------------------------------------------------- */
  const dispute = {
    mode: disputeOpt === DISPUTE[1] ? 'arbitration' : 'mediation',
    explain: disputeOpt.desc,
    clauseSentence: disputeOpt.v,
  };

  /* ---- execution console ----------------------------------------------
   * DocumentStatus has five members (draft | generated | sent | signed |
   * void). Collapsing all four non-signed states into "Awaiting signature"
   * presented a VOIDED agreement as a live document pending execution, so
   * every status is mapped explicitly and anything unrecognised says so.
   */
  const DOC_STATUS = {
    signed: { label: 'Signed', tone: 'emerald' },
    void: { label: 'Void', tone: 'gray' },
    sent: { label: 'Sent for signature', tone: 'amber' },
    generated: { label: 'Generated — not signed', tone: 'amber' },
    draft: { label: 'Draft — not signed', tone: 'gray' },
  };
  const documents = docs.map((doc, i) => {
    const raw = s(doc?.status).toLowerCase() || 'generated';
    const isSigned = raw === 'signed';
    const meta = DOC_STATUS[raw] || { label: `Status: ${raw}`, tone: 'gray' };
    return {
      id: doc?.id ?? i,
      title: s(doc?.title) || 'Co-Founder Agreement',
      draftLabel: `Draft ${docs.length - i} of ${docs.length}`,
      createdLabel: fmtDate(doc?.created_at),
      statusRaw: raw,
      statusLabel: meta.label,
      tone: meta.tone,
      signedByLabel: isSigned && doc?.signed_by ? `signed by ${s(doc.signed_by)}` : '',
    };
  });

  let readyLabel; let readyTone;
  if (hasBlocker) { readyLabel = 'Blocked — required inputs missing'; readyTone = 'rose'; }
  else if (docs.length === 0) { readyLabel = 'Not generated yet'; readyTone = 'gray'; }
  else if (signedCount > 0) { readyLabel = 'Signed copy on record'; readyTone = 'emerald'; }
  else if (activeDocs.length === 0) { readyLabel = 'All drafts voided'; readyTone = 'gray'; }
  else { readyLabel = 'Generated — awaiting wet-ink signature'; readyTone = 'amber'; }

  const execution = {
    draftCount: docs.length,
    versionLabel: docs.length > 0 ? `Draft ${docs.length}` : 'No draft generated yet',
    // The design put the version AND the gating reason on one subtitle line.
    // The gate here is real but external, so the reason states that rather
    // than implying an in-app signature gate that does not exist.
    subtitle: `${docs.length > 0 ? `Draft ${docs.length}` : 'No draft generated yet'} · execution happens outside Axal — the document generates with wet-ink signature blocks`,
    documents,
    signatories: foundersOut.map((f) => ({
      name: f.name,
      initials: f.initials,
      role: f.role,
      email: f.email,
      avatarTone: avatarTone(f.name),
    })),
    signatoryNote: SIGNATORY_NOTE,
    ready: false,
    readyLabel,
    readyTone,
    finalizeLabel: 'Execution happens outside Axal',
    disabledReason: EXECUTION_DISABLED_REASON,
  };

  /* ---- solo path ------------------------------------------------------- */
  const displayName = trimmed(user?.name) || trimmed(user?.full_name);
  const activeConnections = connections.filter((c) => s(c?.status) === 'active').length;
  const solo = {
    headline: displayName ? `${displayName} — sole founder path` : 'Sole founder path',
    items: [
      {
        label: 'Co-founders on this project record',
        value: `${cofounderMembers.length} recorded`,
        tone: cofounderMembers.length ? 'violet' : 'gray',
        detail: 'From your project team. Zero means no co-founder has been added — it does not mean you decided to go solo.',
      },
      {
        label: 'Active co-founder connections',
        value: `${activeConnections} active`,
        tone: activeConnections ? 'violet' : 'gray',
        detail: 'Mutually-NDA’d matches from Co-founder Match.',
      },
      {
        label: 'Week-3 outreach milestone',
        value: milestoneKeys.has('cofounder_request_sent') ? 'Recorded' : 'Not recorded',
        tone: milestoneKeys.has('cofounder_request_sent') ? 'emerald' : 'gray',
        detail: 'Week 3 can also be satisfied by booking an advisor meeting, so “Not recorded” is not evidence either way.',
      },
      {
        label: 'Solo-founder declaration document',
        value: 'Not available',
        tone: 'gray',
        detail: 'Axal has no solo-founder declaration template. Nothing here can be generated or executed.',
      },
    ],
    body: SOLO_BODY,
    caveat: SOLO_CAVEAT,
    canExecute: false,
    reason: SOLO_REASON,
    nextSteps: [
      { label: 'Find a co-founder', to: '/cofounder' },
      { label: 'Set 100% ownership in Cap Table', to: '/spinout-lab/captable' },
      { label: 'Back to Workspace', to: '/spinout-lab' },
    ],
  };

  /* ---- quick actions --------------------------------------------------- */
  const quickActions = [
    { key: 'share', testid: 'qa-share', label: 'Share', enabled: false, disabledReason: 'Sharing a draft agreement isn’t supported — Axal has no share link for legal documents.' },
    { key: 'export', testid: 'button-export', label: 'Export', enabled: true, disabledReason: '' },
    { key: 'copy', testid: 'button-copy-link', label: 'Copy link', enabled: true, disabledReason: '' },
    { key: 'investor', testid: 'qa-preview', label: 'Preview as investor', enabled: false, disabledReason: 'A co-founder agreement is a founder-only document — there’s no investor-facing view.' },
  ];

  /* ---- header ----------------------------------------------------------
   * The design's chip reads "Unlocked · Wk 4". Two separate honesty problems
   * with binding it to the viewer: the week fell back to a hardcoded 4 when
   * no record carried one, and "Unlocked" was a literal shown even to an
   * admin who had bypassed the unlock gate. So: the WEEK is a fact about the
   * MODULE (it unlocks in week 4 — the same number the lock screen states),
   * and the unlock word is derived from the real unlocked_features list.
   */
  const UNLOCK_WEEK = 4;
  const week = num(user?.spinout_lab_week) ?? num(labState?.week) ?? null;
  const isUnlocked = arr(labState?.unlocked_features).includes('cofounder-agreement');
  const unlockPill = isUnlocked
    ? { label: `Unlocked · Wk ${UNLOCK_WEEK}`, tone: 'violet', title: 'This module is in your unlocked features. It unlocks in Week 4 of the program.' }
    : { label: `Admin preview · Wk ${UNLOCK_WEEK}`, tone: 'gray', title: 'This module is not in your unlocked features — you are seeing it because you have admin access. It unlocks in Week 4 of the program.' };
  const activePill = labState?.active === true
    ? { label: 'Active', tone: 'emerald' }
    : { label: 'Admin view', tone: 'gray' };

  return {
    path,
    permission: {
      canEdit,
      canGenerate,
      isOwner,
      actingForOther,
      actingForOtherText,
      reason: canEdit ? '' : READONLY_REASON,
      blockedReason: canGenerate
        ? ''
        : !canEdit ? READONLY_REASON
          : envUnavailable ? 'Agreement generation isn’t available in this environment.'
            : `Blocked: ${blockingClauses.map((c) => c.label).join(', ')} — fix the blocked clause(s) above before generating.`,
    },
    week,
    unlockPill,
    activePill,
    statusLabel,
    moduleProgress,
    founders: foundersOut,
    foundersLabel,
    unresolvedCount,
    unresolvedLabel: 'Needs attention',
    // The design pairs a red unresolved figure against a green signed figure.
    // Red is reserved for the genuinely blocking case so the colour keeps its
    // meaning next to the amber blocker row directly below it.
    unresolvedTone: blockingClauses.length > 0 ? 'rose' : 'amber',
    signedCount,
    signerTotal,
    signedLabel: signerTotal === 0 ? '—' : `${signedCount}/${signerTotal}`,
    signedSub: signerTotal === 0
      ? (docs.length > 0 ? 'no active document' : 'no document generated yet')
      : 'active documents signed',
    hasBlocker,
    blockerText,
    snapshot,
    clauses,
    raci: [],
    raciReason: RACI_REASON,
    roles,
    ipItems,
    ipNote,
    dispute,
    execution,
    solo,
    quickActions,
  };
}

export default buildCofounderAgreementViewModel;
