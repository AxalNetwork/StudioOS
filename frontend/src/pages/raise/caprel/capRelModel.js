/**
 * D1188 (#2457) — the Capital relationships tool's addresses and words, kept
 * pure so the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/capital-relationships` is CycleRoute's module
 * page (Overview), and every `/raise/capital-relationships/<word>` is its
 * record route (`/raise/:slug/:id`). An investor record's id is its number, so
 * the tool's tabs are words CycleRoute reads as tabs, never records
 * (`isCapRelTab`), as D1101 did for the Data room. No route is added.
 *
 * WHAT IS READ TODAY. `GET /api/cycles/raise/modules/capital-relationships`
 * draws Overview as today, Pipeline's investors (as a list; the board is
 * part 4's) and Calls' history. Commitments draws today's closes and pro-rata
 * (`/api/contacts/raise-closes`, `/raise-pro-rata`), the panels the old
 * pipeline page draws. D1193 (#3127): Match, Outreach, Commitments and
 * Activity each draw their own read, whose rules are `capRelTabsModel.js`.
 */

export const SLUG = 'capital-relationships';
export const HOME_PATH = `/raise/${SLUG}`;
export const TITLE = 'Capital relationships';
export const LINE = 'Every investor you are raising from: where each stands, what is next, and what they committed.';

/** The canvas's tab strip, in its order (CRL1). */
export const TABS = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'pipeline', label: 'Pipeline', path: '/pipeline' },
  { id: 'match', label: 'Match', path: '/match' },
  { id: 'outreach', label: 'Outreach', path: '/outreach' },
  { id: 'commitments', label: 'Commitments', path: '/commitments' },
  { id: 'calls', label: 'Calls', path: '/calls' },
  { id: 'activity', label: 'Activity', path: '/activity' },
];
/**
 * D1213 (#2424): the round's closing room, the canvas's "Raise › Capital
 * relationships › Closing" (CP1). An address under the tool, opened from
 * Commitments; not one of the canvas's seven tabs.
 */
export const CLOSING = Object.freeze({ id: 'closing', label: 'Closing', path: '/closing' });

const TAB_WORDS = new Set([...TABS.filter((t) => t.path).map((t) => t.id), CLOSING.id]);

/** True when CycleRoute's record id under this module is a tab, not an investor. */
export const isCapRelTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

/** A block with no read yet (Overview's, D1192 §5). */
export const NOT_YET = 'Not read here yet';

/* ------------------------------------------------------------------ *
 * D1192 (#3126) — Overview, the Pipeline board and list, the dialogs.
 * Pure, so `frontend/test/caprel_pipeline_d1192.test.mjs` holds each rule.
 * The prospects are `GET /api/contacts/raise-prospects`' rows; every write
 * goes through `services/raiseWriters.ts` (`cyclesWrite.raise.*`).
 * ------------------------------------------------------------------ */

/** The board's five columns (CRL2), and Passed, collapsed at the right. */
export const STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed'];
export const PASSED = 'passed';
export const STAGE_LABEL = {
  to_contact: 'Identified', contacted: 'Contacted', meeting: 'Meeting', diligence: 'Diligence', committed: 'Committed', passed: 'Passed',
};
export const stageLabel = (s) => STAGE_LABEL[s] || 'Stage not recorded';

/** A committed investor's status (CRL6). No status is "Status not recorded", and it never counts. */
export const STATUS_OPTIONS = [
  { value: 'soft', label: 'Soft', counts: false },
  { value: 'signed', label: 'Signed', counts: true },
  { value: 'wired', label: 'Wired', counts: true },
];
export const NO_STATUS = 'Status not recorded';
export const statusLabel = (s) => STATUS_OPTIONS.find((o) => o.value === s)?.label || NO_STATUS;
export const statusCounts = (s) => STATUS_OPTIONS.find((o) => o.value === s)?.counts === true;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The board's columns: each stage's investors, the most recently changed first; Passed apart. */
export function boardColumns(prospects = []) {
  const list = Array.isArray(prospects) ? prospects : [];
  const byStage = (s) => list.filter((p) => p.stage === s)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return {
    columns: STAGES.map((s) => ({ stage: s, label: STAGE_LABEL[s], items: byStage(s) })),
    passed: byStage(PASSED),
    unknown: list.filter((p) => !STAGES.includes(p.stage) && p.stage !== PASSED),
  };
}

/** Where a card can move: every other stage, Passed last. */
export const moveTargets = (from) => [...STAGES, PASSED].filter((s) => s !== from);

/** Moving onto Committed asks for the status (CRL6); nothing else does. */
export const asksStatus = (from, to) => to === 'committed' && from !== 'committed';

/**
 * The body the one writer takes for a move (`PATCH /cycles/raise/prospects/:id`).
 * Onto Committed it carries the status the founder chose, or null: "Status
 * not recorded", which is stored as such and never counted.
 */
export function moveBody(to, status) {
  if (to === 'committed') return { stage: 'committed', commit_status: STATUS_OPTIONS.some((o) => o.value === status) ? status : null };
  return { stage: to };
}

/** What a move dialog says it changes. */
export function moveSentence(names, from, to) {
  const who = names.length === 1 ? (names[0] || 'This investor') : `${names.length} investors`;
  const was = from ? ` from ${stageLabel(from)}` : '';
  return `${who} will move${was} to ${stageLabel(to)}.${to === PASSED ? ' Their history stays on the record.' : ''}`;
}

const MONEY = (cents, currency = 'USD') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100); }
  catch { return `${currency} ${Math.round(cents / 100).toLocaleString('en-US')}`; }
};
/** An amount in dollars (the prospect row's `amount`), or null: "Amount not recorded", never $0 for a missing one. */
export const amountText = (amount, currency = 'USD') => (num(amount) == null ? null : MONEY(Math.round(num(amount) * 100), currency));
export const centsText = (cents, currency = 'USD') => (num(cents) == null ? null : MONEY(num(cents), currency));

const day = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Overview (CRL1) from the prospects: the pipeline by stage, who is in
 * conversation, and the follow-ups (due, overdue, none set) in due order.
 */
export function overviewFigures(prospects = [], today = new Date().toISOString().slice(0, 10)) {
  const list = Array.isArray(prospects) ? prospects : [];
  const byStage = [...STAGES, PASSED].map((s) => ({ stage: s, label: STAGE_LABEL[s], n: list.filter((p) => p.stage === s).length }));
  const open = list.filter((p) => ['contacted', 'meeting', 'diligence'].includes(p.stage));
  const live = list.filter((p) => p.stage !== PASSED);
  const withDue = live.filter((p) => p.next_step && day(p.next_step_due));
  const overdue = withDue.filter((p) => day(p.next_step_due) < today);
  const dueToday = withDue.filter((p) => day(p.next_step_due) === today);
  const followUps = withDue.slice().sort((a, b) => day(a.next_step_due).localeCompare(day(b.next_step_due)))
    .map((p) => ({ id: p.id, name: [p.name, p.firm].filter(Boolean).join(' · ') || 'Investor', step: p.next_step, due: day(p.next_step_due), overdue: day(p.next_step_due) < today }));
  const committed = list.filter((p) => p.stage === 'committed');
  return {
    total: list.length,
    byStage,
    inConversation: open.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    noNextStep: open.filter((p) => !p.next_step).length,
    followUps,
    committedNoStatus: committed.filter((p) => !STATUS_OPTIONS.some((o) => o.value === p.commit_status)).length,
  };
}

/** Needs you (CRL1): overdue follow-ups, a conversation with no next step, a committed card with no status. */
export function needsYou(f) {
  const out = [];
  if (f.overdue) out.push({ key: 'overdue', text: `${f.overdue} ${f.overdue === 1 ? 'follow-up is' : 'follow-ups are'} overdue`, action: 'Open Pipeline', tab: 'pipeline' });
  if (f.dueToday) out.push({ key: 'today', text: `${f.dueToday} ${f.dueToday === 1 ? 'follow-up is' : 'follow-ups are'} due today`, action: 'Open Pipeline', tab: 'pipeline' });
  if (f.noNextStep) out.push({ key: 'no-step', text: `${f.noNextStep} ${f.noNextStep === 1 ? 'investor in conversation has' : 'investors in conversation have'} no next step`, action: 'Open Pipeline', tab: 'pipeline' });
  if (f.committedNoStatus) out.push({ key: 'no-status', text: `${f.committedNoStatus} committed ${f.committedNoStatus === 1 ? 'investor has' : 'investors have'} no status, so ${f.committedNoStatus === 1 ? 'it is' : 'they are'} not counted`, action: 'Open Commitments', tab: 'commitments' });
  return out;
}

/* Import (CRL5) */

/** At most this many rows a request; a bigger file is sent in chunks. */
export const IMPORT_CHUNK = 50;

const COLUMNS = {
  name: ['name', 'investor', 'investor name', 'full name'],
  email: ['email', 'e-mail', 'email address'],
  firm: ['firm', 'fund', 'company', 'organization'],
  amount: ['amount', 'check size', 'check', 'commitment'],
  stage: ['stage', 'status in pipeline'],
  notes: ['notes', 'note', 'context'],
};

/**
 * A parsed CSV (`parseCsv`'s rows) as the writer's rows, with the column map
 * it found. Every data row is kept, even an empty-looking one, so the writer
 * reports it as skipped with its own row number rather than it vanishing.
 */
export function importRows(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: 'The file is empty' };
  const header = parsed[0].map((h) => String(h || '').trim().toLowerCase());
  const map = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  if (map.name === -1 && map.email === -1) return { error: 'The header row needs a name or an email column' };
  const cell = (r, k) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
  const rows = parsed.slice(1).map((r) => {
    const amount = cell(r, 'amount').replace(/[$,\s]/g, '');
    return {
      name: cell(r, 'name'), email: cell(r, 'email'), firm: cell(r, 'firm'), notes: cell(r, 'notes'),
      ...(cell(r, 'stage') ? { stage: cell(r, 'stage') } : {}),
      ...(amount !== '' && Number.isFinite(Number(amount)) ? { amount: Number(amount) } : {}),
    };
  });
  const mapped = Object.entries(map).filter(([, i]) => i >= 0).map(([k, i]) => ({ field: k, column: parsed[0][i] }));
  const ignored = parsed[0].filter((_, i) => !Object.values(map).includes(i));
  return { rows, mapped, ignored };
}

export const chunks = (rows, size = IMPORT_CHUNK) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/** The writer's answers for each chunk, as one: the skipped rows renumbered to the file's own rows. */
export function mergeImport(answers, size = IMPORT_CHUNK) {
  let created = 0; let total = 0; const skipped = [];
  answers.forEach((a, i) => {
    if (a?.failed) { skipped.push(...Array.from({ length: a.count }, (_, j) => ({ row: i * size + j + 1, reason: a.reason || 'This part of the file could not be sent' }))); total += a.count; return; }
    created += Number(a?.created) || 0; total += Number(a?.total) || 0;
    for (const s of a?.skipped || []) skipped.push({ row: i * size + Number(s.row), reason: s.reason });
  });
  return { created, total, skipped };
}

/**
 * D1194 (#3128): where an old address lands. The query and the hash are kept;
 * `?project=` becomes `?project_id=`, the tool's word, and `moved` names the
 * notice the tool shows (`MOVED`).
 */
export function capRelMovedTo(tab, search = '', moved = null) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (q.has('project')) {
    if (!q.has('project_id')) q.set('project_id', q.get('project'));
    q.delete('project');
  }
  if (moved) q.set('moved', moved);
  const out = q.toString();
  const path = TABS.find((t) => t.id === tab)?.path ?? '';
  return { pathname: `${HOME_PATH}${path}`, search: out ? `?${out}` : '' };
}

/**
 * D1194: the quote-aware CSV parser the Pipeline's Import reads with (quoted
 * fields, `""` escapes, CRLF). It lived in the retired RaisePipelinePage.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** The moved notices (CRL13), in the canvas's words, by `?moved=`. */
export const MOVED = {
  pipeline: 'The investor pipeline is now Capital relationships › Pipeline.',
  match: 'Investor match is now Capital relationships › Match.',
};
