/**
 * D6042 (#6042): the material for Eadwyn's two record-only drafts on Build's
 * Founding team and Company creation modules — the `build/founding` and
 * `build/company` surfaces in `routes/research.ts`'s `DRAFT_SURFACES`.
 *
 * Each reads one project the caller's ownership check already resolved
 * (`founderProject` in the route), and nothing else: the same stores the
 * module's own read draws (`cycle_build.ts` `founding()` and `company()`). No
 * outside knowledge reaches the model, so every gap is spelled into the
 * material as NOT RECORDED rather than left as a silence a model fills with a
 * market norm or a jurisdiction rule. An empty record returns [], which the
 * route answers as `nothing_to_draft` before any model runs.
 *
 * The arithmetic is done here, not by the model: the split's total and each
 * filing's day count arrive as figures, so the draft reads them back instead
 * of computing its own.
 */
import type { Env } from '../types';

type Db = { env: Pick<Env, 'DB'> };

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
const day = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const FOUNDING_INSTRUCTION = [
  'Check the founding team\'s equity split and vesting below, from the record and nothing else.',
  'Say what the recorded founder ownership adds up to, using the total given, and whether it is 100%. Never complete, round off or redistribute a split that does not add up.',
  'For each founder, say whether vesting is recorded and read back its start, cliff and length as given. A founder with no vesting recorded has none RECORDED, which is not the same as having none: never call them fully vested or unvested.',
  'Then list every item marked NOT RECORDED, by founder, as what is still to record.',
  'Do not say what the split or the vesting should be, and do not cite typical cliffs, market norms or anything else that is not in front of you.',
  'State plainly that accepting this changes nothing in the cap table.',
].join(' ');

export const COMPANY_INSTRUCTION = [
  'Summarise where this company\'s formation stands and what is due next, from the records below and nothing else.',
  'Explain the formation state in plain words: which steps are recorded as done and which are not. Where the material says something is not recorded, say so, and never infer that a step happened because a later one did.',
  'List the open filings with their due dates and the timing given (overdue, due in N days, no due date recorded), and name the one marked NEXT DUE. Use the day counts given; do not compute your own.',
  'Do not state any filing requirement, deadline, fee or jurisdiction rule the records do not carry, and give no legal advice: nothing outside the record is in front of you.',
  'State plainly that accepting this files nothing and changes no filing.',
].join(' ');

/** `build/founding`: each founder's split, vesting and agreement, the split's total, and what is not recorded. */
export async function foundingMaterial(c: Db, projectId: number): Promise<string[]> {
  // The module's own read (`cycle_build.ts` `founding()`): founders only, and
  // vesting joined on both keys so another company's schedule is never read.
  const read = await c.env.DB.prepare(
    `SELECT h.id, h.name, h.founder_role, h.ownership_pct, h.shares,
            v.start_date, v.cliff_months, v.total_months, v.vested_shares,
            (SELECT d.status FROM documents d
              JOIN cofounder_agreement_parties party ON party.document_id = d.id
             WHERE d.project_id = h.project_id AND d.template_name = 'cofounder_agreement'
               AND party.user_id = h.user_id
             ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS agreement_status
       FROM cap_table_holders h
       LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
      WHERE h.project_id = ? AND h.founder_role IS NOT NULL
      ORDER BY h.id LIMIT 30`,
  ).bind(projectId).all<{
    id: number; name: string | null; founder_role: string | null; ownership_pct: number | null; shares: number | null;
    start_date: string | null; cliff_months: number | null; total_months: number | null; vested_shares: number | null;
    agreement_status: string | null;
  }>();
  const founders = read.results || [];
  if (!founders.length) return [];
  const missing: string[] = [];
  const lines = founders.map((h) => {
    const name = String(h.name || '').trim() || `Founder ${h.id}`;
    const gaps: string[] = [];
    if (h.ownership_pct == null) gaps.push('ownership');
    const start = day(h.start_date);
    let vesting: string;
    if (!start) {
      gaps.push('vesting');
      vesting = 'VESTING NOT RECORDED';
    } else {
      if (h.cliff_months == null) gaps.push('vesting cliff');
      if (h.total_months == null) gaps.push('vesting length');
      vesting = `vesting starts ${start}`
        + `, ${h.cliff_months == null ? 'CLIFF NOT RECORDED' : Number(h.cliff_months) === 0 ? 'no cliff' : `${h.cliff_months}-month cliff`}`
        + `, ${h.total_months == null ? 'LENGTH NOT RECORDED' : `${h.total_months} months in all`}`
        + `, ${h.vested_shares == null ? 'vested shares not recorded' : `${h.vested_shares} shares vested`}`;
    }
    if (h.agreement_status == null) gaps.push('cofounder agreement');
    if (gaps.length) missing.push(`${name}: ${gaps.join(', ')}`);
    return `FOUNDER: ${name} — role ${h.founder_role}`
      + `; ownership ${h.ownership_pct == null ? 'NOT RECORDED' : pct(Number(h.ownership_pct))}`
      + `; shares ${h.shares == null ? 'not recorded' : h.shares}`
      + `; ${vesting}`
      + `; cofounder agreement ${h.agreement_status == null ? 'NOT RECORDED' : h.agreement_status === 'signed' ? 'signed' : `latest document ${h.agreement_status}`}`;
  });
  const known = founders.filter((h) => h.ownership_pct != null);
  const sum = known.reduce((s, h) => s + Number(h.ownership_pct), 0);
  lines.push(known.length === founders.length
    ? `RECORDED FOUNDER OWNERSHIP TOTALS ${pct(sum)} across ${founders.length} founder${founders.length === 1 ? '' : 's'}.`
    : `THE SPLIT CANNOT BE TOTALLED: ownership is NOT RECORDED for ${founders.length - known.length} of ${founders.length} founders; the ${known.length} recorded add up to ${pct(sum)}.`);
  lines.push('Only holders recorded with a founder role are read here: investors, option holders and the option pool are not in front of you.');
  lines.push(missing.length ? `NOT RECORDED: ${missing.join('; ')}.` : 'Nothing this record asks of a founder is missing.');
  return lines;
}

const STEP_STATE: Record<string, string> = { todo: 'to do', doing: 'in progress', done: 'done' };
const STEP_KIND: Record<string, string> = { formation: 'formation', ein: 'EIN', '83b': '83(b) election', annual_report: 'annual report', franchise_tax: 'franchise tax', other: 'other' };

/** `build/company`: the formation order, the formation steps, the entity and its open obligations, with each open filing's timing and the next one due. */
export async function companyMaterial(c: Db, projectId: number, today: string = new Date().toISOString().slice(0, 10)): Promise<string[]> {
  const project = await c.env.DB.prepare('SELECT entity_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<{ entity_id: number | null }>();
  if (!project) return [];
  const [order, stepsRead, entity, obligationsRead] = await Promise.all([
    c.env.DB.prepare(
      `SELECT jurisdiction_id, company_name, status, paid_at, packet_ready_at, filed_on
         FROM incorporations WHERE project_id = ? AND status != 'pending_payment'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).bind(projectId).first<{ jurisdiction_id: string | null; company_name: string | null; status: string | null; paid_at: string | null; packet_ready_at: string | null; filed_on: string | null }>(),
    c.env.DB.prepare(
      `SELECT title, due_date, state, proof_file_key, kind, jurisdiction, COUNT(*) OVER () AS matched
         FROM formation_steps WHERE project_id = ? ORDER BY sort_order, id LIMIT 40`,
    ).bind(projectId).all<{ title: string; due_date: string | null; state: string; proof_file_key: string | null; kind: string | null; jurisdiction: string | null; matched: number }>(),
    project.entity_id == null ? Promise.resolve(null) : c.env.DB.prepare(
      'SELECT name, jurisdiction, incorporation_date, status FROM entities WHERE id = ?',
    ).bind(project.entity_id).first<{ name: string | null; jurisdiction: string | null; incorporation_date: string | null; status: string | null }>(),
    project.entity_id == null ? Promise.resolve({ results: [] as never[] }) : c.env.DB.prepare(
      `SELECT title, kind, due_date, COUNT(*) OVER () AS matched
         FROM entity_obligations WHERE entity_id = ? AND status = 'open'
        ORDER BY due_date IS NULL, due_date, id LIMIT 40`,
    ).bind(project.entity_id).all<{ title: string; kind: string | null; due_date: string | null; matched: number }>(),
  ]);
  const steps = stepsRead.results || [];
  const obligations = (obligationsRead as { results?: Array<{ title: string; kind: string | null; due_date: string | null; matched: number }> }).results || [];
  if (!order && !steps.length && !entity) return [];

  const timing = (due: string | null) => {
    if (!due) return 'NO DUE DATE RECORDED';
    const n = daysBetween(today, due);
    return n < 0 ? `OVERDUE by ${-n} day${n === -1 ? '' : 's'}` : n === 0 ? 'due today' : `due in ${n} day${n === 1 ? '' : 's'}`;
  };
  const open: Array<{ label: string; due: string | null }> = [];
  const lines: string[] = [`Today is ${today}.`];

  if (order) {
    const paid = day(order.paid_at), packet = day(order.packet_ready_at), filed = day(order.filed_on);
    lines.push(`FORMATION ORDER: ${order.company_name || 'company name not recorded'}`
      + `; jurisdiction ${order.jurisdiction_id || 'not recorded'}; order status ${order.status || 'not recorded'}`
      + `; order paid ${paid ?? 'NOT RECORDED'}; formation packet ready ${packet ?? 'NOT RECORDED'}; filed with the state ${filed ?? 'NOT RECORDED'}`);
    for (const [label, done] of [['Order paid', paid], ['Formation packet ready', packet], ['Filed with the state', filed]] as const) {
      if (!done) open.push({ label: `${label} (formation order)`, due: null });
    }
  } else {
    lines.push('NO FORMATION ORDER IS RECORDED.');
  }

  if (steps.length) {
    for (const s of steps) {
      const due = day(s.due_date);
      const done = s.state === 'done';
      lines.push(`FORMATION STEP: ${s.title}`
        + `; kind ${s.kind ? STEP_KIND[s.kind] ?? s.kind : 'not recorded'}`
        + `; jurisdiction ${s.jurisdiction || 'not recorded'}`
        + `; ${STEP_STATE[s.state] ?? s.state}`
        + `; ${done ? `due date ${due ?? 'not recorded'}` : timing(due)}`
        + `; proof ${s.proof_file_key ? 'stored' : 'not recorded'}`);
      if (!done) open.push({ label: s.title, due });
    }
    const more = Number(steps[0].matched) - steps.length;
    if (more > 0) lines.push(`${more} more formation step${more === 1 ? ' is' : 's are'} recorded and not listed here: only the first ${steps.length} are.`);
  } else {
    lines.push('NO FORMATION STEP IS RECORDED.');
  }

  if (entity) {
    lines.push(`ENTITY: ${entity.name || 'name not recorded'}; jurisdiction ${entity.jurisdiction || 'not recorded'}`
      + `; incorporated ${day(entity.incorporation_date) ?? 'date NOT RECORDED'}; status ${entity.status || 'not recorded'}`);
    for (const o of obligations) {
      const due = day(o.due_date);
      lines.push(`OPEN OBLIGATION: ${o.title}; kind ${o.kind ? o.kind.replace(/_/g, ' ') : 'not recorded'}; ${timing(due)}`);
      open.push({ label: o.title, due });
    }
    const more = obligations.length ? Number(obligations[0].matched) - obligations.length : 0;
    if (more > 0) lines.push(`${more} more open obligation${more === 1 ? ' is' : 's are'} recorded and not listed here: only the ${obligations.length} due soonest are.`);
    if (!obligations.length) lines.push('No open obligation is recorded against the entity.');
  } else {
    lines.push('NO ENTITY RECORD IS LINKED to this company, so no entity obligation is in front of you.');
  }

  // The next one due is the open filing with the earliest recorded date —
  // which puts the overdue first, then the due soon, as the module's own
  // next action does (`cycle_build.ts` `company()`); an undated one is never
  // named next, since nothing records when it falls.
  const dated = open.filter((o) => o.due).sort((a, b) => a.due!.localeCompare(b.due!));
  if (!open.length) lines.push('NOTHING IS OPEN: every recorded step is done and no obligation is open.');
  else if (dated.length) lines.push(`NEXT DUE: ${dated[0].label}, ${timing(dated[0].due)} (${dated[0].due}).`);
  else lines.push(`NO OPEN FILING CARRIES A DUE DATE: ${open.length} ${open.length === 1 ? 'is' : 'are'} open with no date recorded, so none can be named as next.`);
  return lines;
}
