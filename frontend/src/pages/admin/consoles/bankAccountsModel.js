/**
 * D1185 (#3114, part 4 of #2389) — Bank accounts' Accounts tab, its account
 * lightbox and its dialogs, from the canvas "Bank Accounts" (BNK1, BNK2,
 * BNK6, BNK7). Pure, so `frontend/test/bank_accounts_d1185.test.mjs` holds
 * each rule.
 *
 * Every figure comes from a read: the registry's `list` (D708, with D1184's
 * `mercury` facts and `notice_preview` per account), the Mercury connections,
 * and Mercury's stored accounts. Nothing here computes a balance, and an
 * unknown is "Not recorded" with its reason or "Could not be read", never 0.
 * Account numbers are only ever `••••NNNN`; the full number is Reveal's.
 */
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat';
import { formatCents } from '../../investor/fundCallsModel.js';

export const BASE = '/admin/platform/bank-accounts';
export const ENTITY_ORDER = ['holdings', 'management', 'gp', 'fund'];

/** The canvas's short names; the legal name stays AXAL_ENTITIES'. */
export const ENTITY_SHORT = Object.freeze({ holdings: 'Holdings', management: 'Management', gp: 'GP', fund: 'Fund I' });
export const shortName = (key) => ENTITY_SHORT[key] || key;
export const legalName = (key) => AXAL_ENTITIES[key]?.name || key;

/** The Worker's `PAYMENT_PURPOSES` (`services/payInstructions.ts`): each purpose, the one entity it pays, and what prints it. */
export const PAYMENT_PURPOSE_OPTIONS = [
  { value: 'capital_contribution', label: 'Capital contributions', payee: 'fund', prints: 'capital-call notices', doc: 'notice' },
  { value: 'gp_commitment', label: 'GP commitment', payee: 'fund', prints: 'GP-commitment calls', doc: 'notice' },
  { value: 'management_fee', label: 'Management fee', payee: 'gp', prints: 'management-fee invoices', doc: 'invoice' },
  { value: 'platform_licence_fee', label: 'Platform licence fee', payee: 'holdings', prints: 'licence-fee invoices', doc: 'invoice' },
  { value: 'territory_licence_fee', label: 'Territory licence fee', payee: 'holdings', prints: 'licence-fee invoices', doc: 'invoice' },
];
const purposeOf = (p) => PAYMENT_PURPOSE_OPTIONS.find((o) => o.value === p) || null;
export const purposeLabel = (p) => purposeOf(p)?.label || p;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const list = (v) => (Array.isArray(v) ? v : []);
const pad = (n) => String(n).padStart(2, '0');

/** One account's lightbox address, and the uid an address names (null off it). */
export const accountPath = (uid) => `${BASE}/account/${encodeURIComponent(uid)}`;
export function accountUidOf(pathname = '') {
  const m = /^\/admin\/platform\/bank-accounts\/account\/([^/]+)\/?$/.exec(String(pathname));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** A stored time as "21 Oct 2026, 08:00 UTC"; null for anything unreadable. */
export function dateTime(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
/** A stored day or time as "12 Oct 2026"; null for anything unreadable. */
export function dayOf(iso) {
  const t = dateTime(typeof iso === 'string' && /^\d{4}-\d\d-\d\d$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return t ? t.split(',')[0] : null;
}

const KIND_WORDS = { checking: 'Checking', savings: 'Savings' };
export const kindWord = (k) => KIND_WORDS[k] || 'Not recorded';

/** "Holdings · Operating checking ••••4821", the dialogs' name for an account. */
export const accountName = (a) => `${shortName(a?.entity_key)} · ${a?.label} ${String(a?.account_kind || '').toLowerCase()} ${a?.account_masked}`.replace(/\s+/g, ' ').trim();
/** "Holdings · Operating ••••4821", the dialogs' titles. */
export const accountTitle = (a) => `${shortName(a?.entity_key)} · ${a?.label} ${a?.account_masked}`;

// ── The registry ↔ Mercury join (D1184) ──────────────────────────────────────

const MONEY_REASON = {
  not_recorded: 'Mercury sent no balance for this account',
  unmatched: 'Mercury reads no account with this ending for this entity',
  ambiguous: 'Mercury reads more than one account with this ending for this entity',
};

/**
 * The Balance cell: Current from D1184's `mercury`, with when it was read. A
 * retired account has none; a failed read is "Could not be read"; a missing
 * figure is "Not recorded" with its reason. A measured zero stays $0.00.
 */
export function balanceCell(account, field = 'current') {
  if (account?.status === 'retired') return { text: '—', tone: 'muted' };
  const m = account?.mercury;
  if (!m || typeof m !== 'object') return { text: 'Not read', tone: 'muted', tip: 'The registry read carried no Mercury facts' };
  const money = m[field] || {};
  if (m.reason === 'unreadable' || money.reason === 'unreadable') return { text: 'Could not be read', tone: 'muted' };
  const figure = Number.isSafeInteger(money.cents) ? formatCents(money.cents) : null;
  if (figure) return { text: figure, tone: 'figure', sub: dateTime(m.read_at) ? `as of ${dateTime(m.read_at)}` : 'Read time not recorded' };
  return { text: 'Not recorded', tone: 'muted', tip: MONEY_REASON[money.reason] || MONEY_REASON[m.reason] || MONEY_REASON.not_recorded };
}

/** The Mercury cell: whether the registry account is one Mercury reads. */
export function mercuryPill(account, row) {
  const m = account?.mercury;
  if (!m || m.reason === 'unreadable') return { tone: 'neutral', text: 'Not read' };
  if (m.reason === 'ambiguous') return { tone: 'warn', text: 'More than one in Mercury' };
  if (m.reason === 'unmatched') {
    if (row && !row.connected) return { tone: 'neutral', text: 'Not connected' };
    return { tone: 'warn', text: 'Not seen in Mercury' };
  }
  return { tone: 'ok', text: 'Matched' };
}

/**
 * Mercury's stored accounts the registry does not hold, per entity: matched by
 * entity and ending against the registry's active accounts, as D1184 joins,
 * never by the cached `registered` flag.
 */
export function notInRegistry(accounts, mercuryItems) {
  const held = new Set(list(accounts).filter((a) => a?.status === 'active').map((a) => `${a.entity_key}:${a.account_last4}`));
  return list(mercuryItems).filter((m) => m && /^\d{4}$/.test(String(m.last_four || ''))
    && ENTITY_ORDER.includes(m.entity_key) && !held.has(`${m.entity_key}:${m.last_four}`));
}

/** The row's Balance for a Mercury account the registry does not hold. */
export function mercuryOnlyBalance(item) {
  const c = item?.current || {};
  const figure = Number.isSafeInteger(c.cents) ? formatCents(c.cents) : null;
  if (figure) return { text: figure, tone: 'figure', sub: dateTime(item.balance_read_at) ? `as of ${dateTime(item.balance_read_at)}` : 'Read time not recorded' };
  return { text: c.reason === 'unreadable' ? 'Could not be read' : 'Not recorded', tone: 'muted', tip: MONEY_REASON.not_recorded };
}

export const NOT_IN_REGISTRY_SUB = 'It is not in the registry, so no notice prints it and no receipt is matched to it.';

// ── Where each payment goes (BNK1) ───────────────────────────────────────────

/** The coverage card's head: how many purposes can print, and the warning line. */
export function coverageSummary(coverage) {
  const rows = list(coverage);
  const ok = rows.filter((c) => c?.ok).length;
  const refused = rows.length - ok;
  const fundMissing = rows.some((c) => !c?.ok && c?.code === 'fund_account_missing');
  return {
    meta: `${ok} of ${rows.length} can print`,
    warning: refused
      ? `${refused} of ${rows.length} ${rows.length === 1 ? 'payment' : 'payments'} cannot be printed.${fundMissing ? ' Fund I capital calls cannot issue until the Fund has an account.' : ''}`
      : null,
    fundMissing,
  };
}

/** One purpose's row: where it is paid, or the sentence a notice prints instead. */
export function coverageRow(c, accounts) {
  const held = list(accounts).find((a) => a?.uid === c?.account_uid);
  if (c?.ok) {
    return { label: c.label, where: `${shortName(c.payee)} · ${held ? `${held.label} ` : ''}${c.account_masked}`, pill: { tone: 'ok', text: 'Paid here' }, sub: null };
  }
  const unread = c?.code === 'account_unreadable';
  return { label: c?.label, where: `${shortName(c?.payee)} · —`, pill: unread ? { tone: 'neutral', text: 'Not read' } : { tone: 'warn', text: 'Refused' }, sub: c?.message ? `A notice reads: ${c.message}` : null };
}

// ── What a change does (BNK6) ────────────────────────────────────────────────

const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Change payments' effect, line by line, before it is saved: what each added
 * purpose will print, and what each removed one will refuse. A purpose another
 * active account of the entity already takes is `blocked`: the Worker refuses
 * it (`purpose_taken`), so the dialog says so and does not send it.
 */
export function paymentsEffect(account, next, accounts = []) {
  const prev = list(account?.purposes);
  const want = list(next);
  const added = want.filter((p) => !prev.includes(p));
  const removed = prev.filter((p) => !want.includes(p));
  const lines = [];
  const blocked = [];
  for (const p of added) {
    const o = purposeOf(p);
    const other = list(accounts).find((a) => a?.uid !== account?.uid && a?.status === 'active' && a?.entity_key === account?.entity_key && list(a.purposes).includes(p));
    if (other) {
      blocked.push(p);
      lines.push({ tone: 'warn', text: `Adding ${o?.label || p}: ${other.label} ${other.account_masked} takes it now. Remove it there first.` });
    } else {
      lines.push({ tone: 'info', text: `Adding ${o?.label || p}: ${o?.prints || 'its notices'} will print ${account?.account_masked}.` });
    }
  }
  for (const p of removed) {
    const o = purposeOf(p);
    lines.push({ tone: 'warn', text: `Removing ${o?.label || p}: ${o?.prints || 'its notices'} refuse to print until another ${shortName(account?.entity_key)} checking account takes it.` });
  }
  return { added, removed, lines, blocked, changed: added.length + removed.length > 0 };
}

/** Retire's warning when the account carries purposes: those notices refuse until another account takes them. */
export function retireEffect(account) {
  const ps = account?.status === 'active' ? list(account?.purposes) : [];
  if (!ps.length) return null;
  const docs = new Set(ps.map((p) => purposeOf(p)?.doc || 'notice'));
  const word = docs.size > 1 ? 'those notices and invoices' : docs.has('invoice') ? (ps.length > 1 ? 'those invoices' : 'its invoices') : (ps.length > 1 ? 'those notices' : 'its notices');
  return `This account takes ${andList(ps.map(purposeLabel))}. After you retire it, ${word} refuse to print until another account takes ${ps.length > 1 ? 'them' : 'it'}.`;
}

/** A label is 1 to 60 characters (the Worker's rule); null when it is fine. */
export function labelError(label) {
  const s = String(label ?? '').trim();
  if (!s) return 'Write a label.';
  if (s.length > 60) return 'A label is at most 60 characters.';
  return null;
}
/** A reason is 1 to 200 characters; null when it is fine. */
export function reasonError(reason) {
  const s = String(reason ?? '').trim();
  if (!s) return 'Write a reason.';
  if (s.length > 200) return 'A reason is at most 200 characters.';
  return null;
}
/** The label a kind fills in; the owner can change it. */
export const labelForKind = (kind) => (kind === 'savings' ? 'Reserve' : 'Operating');

/** Add from Mercury: the typed number must end in the Mercury account's four. */
export function fromMercuryError(number, confirm, lastFour) {
  const n = String(number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{4,17}$/.test(n)) return 'The account number is 4 to 17 digits.';
  if (n.slice(-4) !== lastFour) return `It must end in ${lastFour}.`;
  if (String(confirm ?? '').replace(/[\s-]/g, '') !== n) return 'The two copies of the account number differ. Type it again.';
  return null;
}

// ── One account (BNK2) ───────────────────────────────────────────────────────

/** The payment instructions, which never change once saved. */
export function instructionFacts(a) {
  const nr = (v) => (v ? String(v) : 'Not recorded');
  return [
    ['Beneficiary', nr(a?.beneficiary_name)],
    ['Beneficiary address', nr(a?.beneficiary_address)],
    ['Bank', nr(a?.bank_name)],
    ['Bank address', nr(a?.bank_address)],
    ['ABA', nr(a?.routing_number)],
    ['Alternate ABA', nr(a?.routing_number_alt)],
    ['SWIFT', nr(a?.swift_code)],
    ['Intermediary SWIFT', nr(a?.intermediary_swift_code)],
    ['Account', nr(a?.account_masked)],
    ['Added', `${dayOf(a?.created_at) || 'Date not recorded'} · ${a?.recorded_by_name ? `by ${a.recorded_by_name}` : 'who added it is not recorded'}`],
  ];
}

/** "Payments it takes" in words. */
export function paymentsLine(a) {
  if (a?.account_kind === 'savings') return 'Reserve: never printed on a notice. A savings account takes no payments.';
  const ps = list(a?.purposes);
  if (!ps.length) return 'No notice purpose. No notice or invoice prints this account.';
  const docs = [...new Set(ps.map((p) => purposeOf(p)?.prints).filter(Boolean))];
  return `${ps.map(purposeLabel).join(' · ')}. ${docs.length ? `${docs.join(' and ').replace(/^./, (c) => c.toUpperCase())} print this account.` : ''}`.trim();
}

const PREVIEW_REASON = {
  account_retired: 'A retired account prints on no notice.',
  no_notice_purpose: 'No notice prints this account: it takes no payment.',
};

/**
 * "How a notice prints it", from D1184's `notice_preview`: each purpose's
 * masked instructions, or the refusal a notice prints instead.
 */
export function noticePreview(a) {
  if (!a || !Array.isArray(a.notice_preview)) return { kind: 'unread', line: 'The notice preview was not read.' };
  if (!a.notice_preview.length) return { kind: 'none', line: PREVIEW_REASON[a.notice_preview_reason] || 'No notice prints this account.' };
  const items = a.notice_preview.map((p, i) => {
    const purpose = p?.purpose || list(a.purposes)[i];
    if (p?.ok && p.instructions) {
      const s = p.instructions;
      return {
        ok: true, purpose: purposeLabel(purpose),
        rows: [['Pay to', s.beneficiary_name], ['Bank', s.bank_name], ['ABA', s.routing_number], ['SWIFT', s.swift_code], ['Account', s.account_masked]]
          .map(([k, v]) => [k, v ? String(v) : 'Not recorded']).concat([['Reference', 'Each notice’s own reference']]),
        warning: typeof p.warning === 'string' ? p.warning : null,
      };
    }
    return { ok: false, purpose: purposeLabel(purpose), line: p?.message ? `A notice reads: ${p.message}` : 'A notice refuses to print this account.' };
  });
  return { kind: 'items', items };
}

/** A Mercury line's state on the account's latest lines. */
export function lineState(t) {
  if (t?.not_ours) return { tone: 'neutral', text: 'Not ours' };
  if (t?.match?.state === 'confirmed') return { tone: 'ok', text: 'Matched' };
  if (t?.match) return { tone: 'neutral', text: 'Proposed' };
  if (Number(t?.amount_cents) < 0) return { tone: 'neutral', text: 'Not a receipt' };
  return { tone: 'warn', text: 'Unmatched' };
}
/** A signed amount: "+$25,000.00", "−$1,240.00"; "Not recorded" when unreadable. */
export function signedAmount(cents) {
  const f = Number.isSafeInteger(Number(cents)) && cents !== null ? formatCents(Math.abs(Number(cents))) : null;
  if (!f) return 'Not recorded';
  return `${Number(cents) < 0 ? '−' : '+'}${f}`;
}

const HISTORY_WORDS = {
  bank_account_added: 'Added', bank_account_updated: 'Changed', bank_account_retired: 'Retired',
  bank_account_revealed: 'Reveal', reveal: 'Reveal',
};
/** This account's rows of D1182's history, newest first, as the lightbox draws them. */
export function accountHistory(rows, uid, limit = 3) {
  return list(rows).filter((r) => r?.account_uid && r.account_uid === uid).slice(0, limit).map((r) => ({
    id: r.id,
    when: dateTime(r.time) || 'Time not recorded',
    event: HISTORY_WORDS[r.action] || HISTORY_WORDS[r.kind] || 'Recorded',
    by: r.actor_name || 'Who is not recorded',
    detail: r.detail_unreadable ? 'The detail could not be read.' : (r.context && r.context !== 'admin' ? String(r.context) : null),
  }));
}

/**
 * The balance sparkline over D1183's daily points (`date`, `current`): one per
 * stored day, the line broken where a day has none. Null under two points.
 */
export function sparkPath(points, w = 520, h = 64) {
  const pts = list(points).filter((p) => p && /^\d{4}-\d\d-\d\d$/.test(String(p.date || '')) && Number.isSafeInteger(p.current?.cents));
  if (pts.length < 2) return null;
  const t = pts.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const v = pts.map((p) => p.current.cents);
  const [t0, t1] = [Math.min(...t), Math.max(...t)];
  const [lo, hi] = [Math.min(...v), Math.max(...v)];
  const X = (x) => +(2 + ((x - t0) / ((t1 - t0) || 1)) * (w - 4)).toFixed(1);
  const Y = (y) => +(h - 6 - ((y - lo) / ((hi - lo) || 1)) * (h - 14)).toFixed(1);
  let d = '';
  let gaps = 0;
  pts.forEach((_, i) => {
    const jump = i > 0 && t[i] - t[i - 1] > 1.5 * 86_400_000;
    if (jump) gaps += 1;
    d += `${i === 0 || jump ? 'M' : 'L'}${X(t[i])} ${Y(v[i])}`;
  });
  return { d, gaps, w, h, first: pts[0].date, last: pts[pts.length - 1].date };
}

/** One account's series from D1183's read, by its Mercury uid; undefined when absent. */
export const seriesOf = (read, mercuryUid) => list(read?.items).find((s) => s?.account_uid === mercuryUid)?.points;

// ── The entity card's state (BNK7) ───────────────────────────────────────────

/** The line under an entity card's title, from `entityRows`; null while unread. */
export function cardLine(row) {
  if (!row) return null;
  if (!row.connected) return 'Connect Mercury to see this entity’s balances. The registry works without it.';
  if (row.error) return row.error;
  if (row.state?.text === 'Connected') return row.lastSyncedAt && dateTime(row.lastSyncedAt) ? `Last synced ${dateTime(row.lastSyncedAt)}.` : 'Not synced yet.';
  return null;
}

// ── The rail (D768) ──────────────────────────────────────────────────────────

/** The rail's sentence on every Bank accounts tab (BNK1): what Eadwyn can and cannot see. */
export const RAIL_NOTE = 'Eadwyn can see which entities have an account and which payments are refused. It never sees an account number, a balance or a transaction.';

/** What the registry draws while its first read is in flight; not the console's words. */
export const READING = 'Reading the bank accounts…';

/** A refusal in words: the Worker's sentence, or the step-up's when the code was not entered. */
export function refusalText(e, fallback = 'That did not save. Nothing changed.') {
  const code = e?.code || e?.data?.code;
  if (Number(e?.status) === 403 && code === 'step_up_required') return 'The authenticator code was not entered, so nothing changed.';
  return e?.data?.message || e?.message || fallback;
}

/**
 * D1187 (BNK12): the phone the canvas draws at 390 wide, below Tailwind's `sm`
 * (640px), where the `max-sm:` classes on these pages apply. Not the lens's
 * 1024px rule: a tablet keeps the table rows.
 */
export const PHONE_BELOW_SM = '(max-width: 639px)';
