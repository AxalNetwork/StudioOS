/**
 * D690 (#1692) — `evidenceFor`: every piece of evidence behind a venture's
 * claims, in one vocabulary.
 *
 * Two stores feed it:
 *   - pain links (`hypothesis_pain_links`, with their strength since migration
 *     440): one item per interview that names the linked theme, by the read's
 *     own phrase rule (`resolvePhrase`);
 *   - `hypothesis_evidence_links` (migration 460): an interview, a demand
 *     record, a KPI labelled with its latest value in `project_metrics`, or an
 *     experiment with its result.
 *
 * IDS. Each item's `id` names its link, so it is unique across the venture
 * and an interview behind two claims' pain links is two items:
 * `pain-<link id>-<interview id>` for an interview behind a pain link,
 * `evidence-<link id>` for an evidence link. `link` is the link it came from
 * (`pain-<id>` or `evidence-<id>`), which is what `unlink` takes; `kind` and
 * `ref_id` name the record behind it. D693 (#1703) keys a decision's
 * evidence by `id`.
 *
 * Two other modules export an `evidenceFor`: the verdict counter in
 * `routes/_founder_validate_helpers.ts`, and #1702's stub in
 * `services/verdict.ts`, which #1703 points here. Import each from its own
 * module.
 *
 * It reads; it never writes. A label names a theme, a KPI, an experiment or a
 * signal's kind; an interview item names its interview by date, never by the
 * interviewee's words.
 */
import type { Env } from '../types';
import { loadPainGroupModel, normPhrase, resolvePhrase, safeParseStrings } from './painGroups';
import { KPI_KEYS, latestKpis, type KpiKey } from './validateWriters';

export type EvidenceItemFull = {
  id: string;
  link: string;
  kind: 'interview' | 'signal' | 'metric' | 'experiment';
  ref_id: string;
  label: string;
  strength: 'anecdote' | 'pattern' | 'measured' | null;
  direction: 'supports' | 'contradicts';
  date: string | null;
  hypothesis_id: number;
};

export type EvidenceCtx = { env: Env; projectId: number };

const STRENGTHS = new Set(['anecdote', 'pattern', 'measured']);
const strengthOf = (v: unknown) => (STRENGTHS.has(String(v)) ? String(v) as EvidenceItemFull['strength'] : null);
const dirOf = (v: unknown): EvidenceItemFull['direction'] => (v === 'contradicts' ? 'contradicts' : 'supports');
const KPI_LABEL: Record<KpiKey, string> = {
  mrr: 'MRR', arr: 'ARR', cac: 'CAC', ltv: 'LTV', monthly_churn_pct: 'Monthly churn', active_users: 'Active users',
  new_users: 'New users', net_burn: 'Net burn', cash_balance: 'Cash balance', headcount: 'Headcount',
  nrr_pct: 'NRR', paying_accounts: 'Paying accounts',
};
const SIGNAL_KIND: Record<string, string> = {
  loi: 'Letter of intent', pre_sale: 'Pre-sale', waitlist: 'Waitlist sign-up', need_to_have: 'Need-to-have mention', would_pay: 'Would pay',
};
const money = (cents: number | null, currency: string | null) =>
  cents == null ? null : `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${String(currency || 'usd').toUpperCase()}`;

/** Every evidence item on the venture's claims, or on one claim. */
export async function evidenceFor(ctx: EvidenceCtx, opts: { hypothesisId?: number } = {}): Promise<EvidenceItemFull[]> {
  const { env, projectId } = ctx;
  const one = opts.hypothesisId != null;
  const hid = one ? Number(opts.hypothesisId) : 0;
  const out: EvidenceItemFull[] = [];

  // Pain links, and the interviews that name each theme.
  const links = (await env.DB.prepare(
    `SELECT l.id, l.hypothesis_id, l.pain_group_id, l.direction, l.strength, g.title
       FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id
       JOIN pain_groups g ON g.id = l.pain_group_id
      WHERE h.project_id = ? AND g.project_id = ? AND (? = 0 OR l.hypothesis_id = ?)
      ORDER BY l.id`,
  ).bind(projectId, projectId, one ? 1 : 0, hid).all<{ id: number; hypothesis_id: number; pain_group_id: number; direction: string; strength: string | null; title: string }>()).results || [];
  if (links.length) {
    const model = await loadPainGroupModel(env, projectId);
    const ivs = (await env.DB.prepare('SELECT id, interview_date, pains_json FROM discovery_interviews WHERE project_id = ? ORDER BY id')
      .bind(projectId).all<{ id: number; interview_date: string | null; pains_json: string | null }>()).results || [];
    const byGroup = new Map<number, Array<{ id: number; date: string | null }>>();
    for (const iv of ivs) {
      const groups = new Set<number>();
      for (const display of safeParseStrings(iv.pains_json)) {
        const n = normPhrase(display);
        const g = n ? resolvePhrase(n, display, model).groupId : null;
        if (g != null) groups.add(g);
      }
      for (const g of groups) {
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push({ id: Number(iv.id), date: iv.interview_date ? String(iv.interview_date).slice(0, 10) : null });
      }
    }
    for (const l of links) {
      for (const iv of byGroup.get(Number(l.pain_group_id)) || []) {
        out.push({
          id: `pain-${l.id}-${iv.id}`, link: `pain-${l.id}`, kind: 'interview', ref_id: String(iv.id),
          label: `Interview naming ${l.title}`, strength: strengthOf(l.strength), direction: dirOf(l.direction),
          date: iv.date, hypothesis_id: Number(l.hypothesis_id),
        });
      }
    }
  }

  // Evidence links (migration 460).
  const ev = (await env.DB.prepare(
    `SELECT e.id, e.hypothesis_id, e.kind, e.ref_id, e.direction, e.strength, e.created_at
       FROM hypothesis_evidence_links e JOIN hypotheses h ON h.id = e.hypothesis_id
      WHERE e.project_id = ? AND h.project_id = ? AND (? = 0 OR e.hypothesis_id = ?)
      ORDER BY e.id`,
  ).bind(projectId, projectId, one ? 1 : 0, hid).all<{ id: number; hypothesis_id: number; kind: string; ref_id: string; direction: string; strength: string | null; created_at: string | null }>()).results || [];
  if (!ev.length) return out;
  const kpis = ev.some((e) => e.kind === 'metric') ? await latestKpis(env, projectId) : new Map();
  for (const e of ev) {
    let label: string | null = null;
    let date: string | null = e.created_at ? String(e.created_at).slice(0, 10) : null;
    if (e.kind === 'metric') {
      const k = e.ref_id as KpiKey;
      if (!(KPI_KEYS as readonly string[]).includes(k)) continue;
      const v = kpis.get(k);
      label = v ? `${KPI_LABEL[k]} · ${v.value}` : `${KPI_LABEL[k]} · Not recorded`;
      date = v ? v.date : date;
    } else if (e.kind === 'experiment') {
      const x = /^[1-9][0-9]{0,9}$/.test(e.ref_id) ? await env.DB.prepare(
        'SELECT title, status, result FROM hypothesis_experiments WHERE id = ? AND project_id = ?',
      ).bind(Number(e.ref_id), projectId).first<{ title: string; status: string; result: string | null }>() : null;
      if (!x) continue;
      label = `${x.title} · ${x.result || x.status}`;
    } else if (e.kind === 'signal') {
      const m = /^(signal|revenue|waitlist)-([1-9][0-9]{0,9})$/.exec(e.ref_id);
      if (!m) continue;
      const n = Number(m[2]);
      if (m[1] === 'signal') {
        const s = await env.DB.prepare('SELECT kind, amount_cents, currency, signal_date FROM demand_signals WHERE id = ? AND project_id = ?')
          .bind(n, projectId).first<{ kind: string; amount_cents: number | null; currency: string | null; signal_date: string | null }>();
        if (!s) continue;
        label = [SIGNAL_KIND[s.kind] || s.kind, money(s.amount_cents, s.currency)].filter(Boolean).join(' · ');
        date = s.signal_date ?? date;
      } else if (m[1] === 'revenue') {
        const r = await env.DB.prepare('SELECT amount_cents, currency, received_on FROM revenue_entries WHERE id = ? AND project_id = ?')
          .bind(n, projectId).first<{ amount_cents: number | null; currency: string | null; received_on: string | null }>().catch(() => null);
        if (!r) continue;
        label = ['Pre-sale', money(r.amount_cents, r.currency)].filter(Boolean).join(' · ');
        date = r.received_on ?? date;
      } else {
        const w = await env.DB.prepare("SELECT created_at FROM waitlist_signups WHERE id = ? AND project_id = ? AND (audience IS NULL OR audience = 'customer')")
          .bind(n, projectId).first<{ created_at: string | null }>();
        if (!w) continue;
        label = 'Waitlist sign-up';
        date = w.created_at ? String(w.created_at).slice(0, 10) : date;
      }
    } else {
      const iv = /^[1-9][0-9]{0,9}$/.test(e.ref_id) ? await env.DB.prepare(
        'SELECT interview_date FROM discovery_interviews WHERE id = ? AND project_id = ?',
      ).bind(Number(e.ref_id), projectId).first<{ interview_date: string | null }>() : null;
      if (!iv) continue;
      label = 'Interview';
      date = iv.interview_date ? String(iv.interview_date).slice(0, 10) : date;
    }
    out.push({
      id: `evidence-${e.id}`, link: `evidence-${e.id}`, kind: e.kind as EvidenceItemFull['kind'], ref_id: e.ref_id,
      label: label as string, strength: strengthOf(e.strength), direction: dirOf(e.direction), date, hypothesis_id: Number(e.hypothesis_id),
    });
  }
  return out;
}
