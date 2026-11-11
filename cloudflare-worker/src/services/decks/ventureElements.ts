/**
 * D1543 (#3781, deck v2 B5) — the venture-record elements: what the picker's
 * Venture records group (and Team bios, and Graphics' Logo wall) places on a
 * card, read from the venture's own records, each with its gate.
 *
 *   team_grid        founders and roles (cap_table_holders.founder_role)
 *   team_bios        one line per founder, and the team's recorded skills and
 *                    published archetypes (`sources.ts` team adapter). v0 is
 *                    record-only: no model writes a bio here.
 *   use_of_funds     the recorded split, one bound cell per section
 *                    (`recordSources.ts` use_of_funds_sections)
 *   round_terms      pre-money, post-money, dilution and the instrument, each
 *                    bound; "Proposed, subject to counsel" unless every one is
 *                    graded Reviewed (counsel's approval, D1520 / D1546)
 *   cap_table        totals only: one header row and one Total row; never a
 *                    holder's row. Off unless the request includes it.
 *   logo_wall        migration 732's logos whose customer gave permission
 *   interview_quote  the founder's manual pick of one consented line, through
 *                    D1556's `quoteRetrieval.pickQuote`, by role, never by name
 *
 * NO MODEL RUNS HERE. Every value is a record the code read, and every figure
 * travels as a D896 binding (source key, record, date, grade, snapshot) with
 * its Source and grade from `sources.ts`'s one mapping. Nothing is written.
 *
 * GATES. A gate that does not pass is a refusal with a stable code and the
 * canvas's own line (dk-boards §3, pd9r), which `deckV2Adapter.through()`
 * carries to the picker. `GATE_CODES` lists them; D1543 documents each.
 */
import type { Env } from '../../types';
import { readSources, type SourceItem } from './sources';
import { ROUND_TERMS_LABEL } from './compliance';
import { QUOTE_CONSENT_LINE, REASONS, pickQuote } from './quoteRetrieval';

export const VENTURE_ELEMENTS = ['team_grid', 'team_bios', 'use_of_funds', 'round_terms', 'cap_table', 'logo_wall', 'interview_quote'] as const;
export type VentureElement = (typeof VENTURE_ELEMENTS)[number];
export const isVentureElement = (v: unknown): v is VentureElement => typeof v === 'string' && (VENTURE_ELEMENTS as readonly string[]).includes(v);

/** The canvas's gate lines (dk-boards §3, pd9r). */
export const TOTALS_LINE = 'Totals only · never shown in shared links unless you include it';
export const PERMISSION_LINE = (customer: string) => `${customer} hasn't given permission to show their logo.`;
export const PICK_LINE = 'Pick a line from a session with recorded consent.';
export const UNREADABLE_LINE = 'Your records could not be read right now.';

/**
 * Every refusal an element answers, by code. 409 unless said: the element
 * exists and the gate did not pass, so a surface never draws it as off.
 */
export const GATE_CODES = Object.freeze({
  no_consent: 'The picked line is not from a session with recorded consent and consent to quote.',
  no_permission: 'A logo whose customer has not given permission.',
  totals_only: 'A cap table is shown as totals only; a holder\'s row is never placed.',
  not_included: 'The cap-table summary is off until the founder includes it.',
  subject_to_counsel: 'Round terms counsel has not approved cannot be placed without "Proposed, subject to counsel".',
  quotes_not_switched_on: 'Quote retrieval (D1556) is not switched on until the owner approves its index.',
  pick_required: 'An interview quote is the founder\'s manual pick; the one-click run leaves it out.',
  not_recorded: 'The venture has not recorded what this element shows.',
  unreadable: 'The records behind this element could not be read right now (503).',
});
export type GateCode = keyof typeof GATE_CODES;

/** A figure as an element carries it: the item, minus what a block does not need. */
export type ElementBinding = Pick<SourceItem, 'source_key' | 'label' | 'value' | 'unit' | 'source' | 'grade' | 'as_of' | 'record_ref' | 'snapshot_hash'>;
export type ElementAnswer =
  | { element: VentureElement; available: true; blocks: Array<Record<string, unknown>>; bindings: ElementBinding[]; model: null; label: string | null; [k: string]: unknown }
  | { element: VentureElement; available: false; code: GateCode; line: string; module?: string; href?: string };

export type ElementOpts = {
  /** cap_table: the founder included it (`include=cap_table`). */
  includeCapTable?: boolean;
  /** cap_table: a holder-level view was asked for; always refused. */
  holders?: boolean;
  /** round_terms: placed without the "Proposed" label; refused unless counsel approved. */
  final?: boolean;
  /** logo_wall: the logos asked for, by key; all permitted ones when absent. */
  logos?: string[] | null;
  /** interview_quote: the picked transcript line. */
  segment?: number | null;
  /** interview_quote: D1556's index (`env.DECK_QUOTES`); null where it is not bound. */
  quoteIndex?: unknown;
  /** logo_wall: the app URL of one of the venture's kept images. */
  imageUrl?: (uid: string) => string;
  today?: string;
};

const refused = (element: VentureElement, code: GateCode, line: string, where?: { module: string; href: string }): ElementAnswer =>
  ({ element, available: false, code, line, ...(where ? { module: where.module, href: where.href } : {}) });

const bindingOf = (it: SourceItem) => ({ source_key: it.source_key, record_ref: it.record_ref, as_of: it.as_of, grade: it.grade, snapshot_hash: it.snapshot_hash });
const elementBinding = (it: SourceItem): ElementBinding => ({
  source_key: it.source_key, label: it.label, value: it.value, unit: it.unit, source: it.source, grade: it.grade, as_of: it.as_of, record_ref: it.record_ref, snapshot_hash: it.snapshot_hash,
});
const recorded = (items: SourceItem[]) => items.filter((it) => it.state === 'recorded' && it.value != null);

/** A figure as a metric tile shows it; null for a value that is not a number. */
export function formatFigure(value: unknown, unit: string): string | null {
  if (unit === 'text') return typeof value === 'string' && value.trim() ? value.trim() : null;
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return null;
  if (unit === 'percent') return `${Math.round(n * 10) / 10}%`;
  if (unit === 'usd') {
    const abs = Math.abs(n);
    const [div, suffix] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
    return `$${Math.round((n / div) * 10) / 10}${suffix}`;
  }
  return n.toLocaleString('en-US');
}

const text = (t: string) => ({ text: t.slice(0, 120) });

async function itemsOf(env: Env, projectId: number, only: string[], today: string): Promise<SourceItem[]> {
  return (await readSources({ env, projectId, today, mercury: null }, { only })).items;
}

const notRecorded = (element: VentureElement, items: SourceItem[], fallback: { module: string; href: string }) => {
  const it = items[0];
  return refused(element, 'not_recorded', `Not recorded · add it in ${it?.module ?? fallback.module}.`, it ? { module: it.module, href: it.href } : fallback);
};

type Founder = { name: string; role: string };
async function foundersOf(env: Env, projectId: number): Promise<Founder[]> {
  const r = await env.DB.prepare(
    `SELECT name, founder_role FROM cap_table_holders
      WHERE project_id = ? AND founder_role IS NOT NULL AND trim(founder_role) <> '' AND trim(name) <> ''
      ORDER BY id LIMIT 12`,
  ).bind(projectId).all<{ name: string; founder_role: string }>();
  return (r.results || []).map((f) => ({ name: String(f.name).trim().slice(0, 80), role: String(f.founder_role).trim().slice(0, 80) }));
}

const TEAM_WHERE = (pid: number) => ({ module: 'Build › Founding team', href: `/build/founding-team?project=${pid}` });

/** One element for one venture. Reads only; writes nothing; runs no model. */
export async function ventureElement(env: Env, projectId: number, element: VentureElement, opts: ElementOpts = {}): Promise<ElementAnswer> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ok = (blocks: Array<Record<string, unknown>>, items: SourceItem[], extra: Record<string, unknown> = {}): ElementAnswer =>
    ({ element, available: true, blocks, bindings: items.map(elementBinding), model: null, label: null, ...extra });

  switch (element) {
    case 'team_grid':
    case 'team_bios': {
      const founders = await foundersOf(env, projectId);
      const items = recorded(await itemsOf(env, projectId, ['team'], today));
      if (!founders.length) return refused(element, 'not_recorded', 'Not recorded · add the founders and their roles in Build › Founding team.', TEAM_WHERE(projectId));
      const founderItem = items.find((it) => it.source_key === 'team.founders');
      if (element === 'team_grid') {
        const rows = [[text('Name'), text('Role')], ...founders.map((f) => [text(f.name), text(f.role)])];
        return ok([{ kind: 'table', element, header: true, rows }], founderItem ? [founderItem] : []);
      }
      const lines = founders.map((f) => `${f.name} — ${f.role}`);
      const skills = items.find((it) => it.source_key === 'team.skills');
      const arch = items.find((it) => it.source_key === 'team.archetypes');
      if (skills) lines.push(`Skills: ${String(skills.value)}`);
      if (arch) lines.push(`Archetypes: ${String(arch.value)}`);
      return ok([{ kind: 'text', element, style: 'list', text: lines.join('\n'), ...(founderItem ? { binding: bindingOf(founderItem) } : {}) }], items);
    }

    case 'use_of_funds': {
      const all = await itemsOf(env, projectId, ['use_of_funds_sections'], today);
      const items = recorded(all);
      if (!items.length) return notRecorded(element, all, { module: 'Raise › Use of funds', href: `/raise/use-of-funds?project=${projectId}` });
      const shown = items.filter((it) => Number(it.value) > 0);
      const rows = [[text('Use'), text('Share')], ...shown.map((it) => [text(it.label), { binding: bindingOf(it) }])];
      return ok([{ kind: 'table', element, header: true, rows }], items);
    }

    case 'round_terms': {
      const all = await itemsOf(env, projectId, ['round_terms', 'round'], today);
      const keys = ['raise.pre_money', 'raise.post_money', 'raise.dilution_pct', 'raise.round_terms'];
      const items = recorded(all).filter((it) => keys.includes(it.source_key));
      if (!items.length) return notRecorded(element, all.filter((it) => keys.includes(it.source_key)), { module: 'Raise › Round planner', href: `/raise/capital-relationships/calls?project=${projectId}` });
      // `Reviewed` is counsel's approval of the terms (D1520); anything less is proposed.
      const proposed = items.some((it) => it.grade !== 'Reviewed');
      if (proposed && opts.final) return refused(element, 'subject_to_counsel', ROUND_TERMS_LABEL);
      const blocks = items.map((it) => (it.unit === 'text'
        ? { kind: 'text', element, style: 'paragraph', text: `${it.label}: ${String(it.value)}`, binding: bindingOf(it) }
        : { kind: 'metric', element, label: it.label, value: formatFigure(it.value, it.unit), binding: bindingOf(it) }));
      return ok(blocks, items, { label: proposed ? ROUND_TERMS_LABEL : null, proposed });
    }

    case 'cap_table': {
      if (opts.holders) return refused(element, 'totals_only', TOTALS_LINE);
      if (!opts.includeCapTable) return refused(element, 'not_included', TOTALS_LINE);
      const all = await itemsOf(env, projectId, ['cap_table'], today);
      const holders = recorded(all).find((it) => it.source_key === 'raise.cap_table');
      if (!holders) return notRecorded(element, all, { module: 'Raise › Cap table', href: `/raise/cap-table?project=${projectId}` });
      // Totals only: a count and a sum, never a holder's name, row, email or stake.
      const t = await env.DB.prepare(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN h.shares > 0 THEN h.shares ELSE 0 END) AS shares FROM cap_table_holders h
          WHERE h.project_id = ? OR (h.project_id IS NULL AND h.user_id IN (SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ?))`,
      ).bind(projectId, projectId).first<{ n: number; shares: number | null }>();
      const shares = Number(t?.shares) > 0 ? Number(t!.shares) : null;
      const header = [text(''), text('Holders'), ...(shares != null ? [text('Shares')] : [])];
      const total = [text('Total'), { binding: bindingOf(holders) }, ...(shares != null ? [text(formatFigure(shares, 'count')!)] : [])];
      return ok([{ kind: 'table', element, header: true, rows: [header, total] }], [holders], { totals_only: true, share: { include: 'cap_table', default: false } });
    }

    case 'logo_wall': {
      const rows = ((await env.DB.prepare(
        `SELECT l.logo_key, l.customer_name, l.image_uid, l.permitted, l.permitted_at, l.permission_reference
           FROM deck_logos l JOIN deck_images i ON i.uid = l.image_uid AND i.project_id = l.project_id AND i.state = 'kept'
          WHERE l.project_id = ? ORDER BY l.id LIMIT 48`,
      ).bind(projectId).all<{ logo_key: string; customer_name: string; image_uid: string; permitted: number; permitted_at: string | null; permission_reference: string | null }>()).results || []);
      const permittedRow = (r: (typeof rows)[number]) => Number(r.permitted) === 1 && !!r.permitted_at && !!r.permission_reference;
      const asked = opts.logos?.length ? opts.logos : null;
      const picked = asked ? asked.map((k) => rows.find((r) => r.logo_key === k) ?? null) : rows;
      if (asked && picked.some((r) => !r)) return refused(element, 'not_recorded', 'Not recorded · that logo is not one of this venture\'s.');
      const chosen = picked as typeof rows;
      const blocked = chosen.find((r) => !permittedRow(r));
      // Asked for by key: one unpermitted logo refuses the wall. Unasked: the permitted ones, or the first refusal when none is.
      if (blocked && (asked || !chosen.some(permittedRow))) return refused(element, 'no_permission', PERMISSION_LINE(blocked.customer_name));
      const shown = chosen.filter(permittedRow);
      if (!shown.length) return refused(element, 'not_recorded', 'Not recorded · add a customer\'s logo with their permission.');
      const url = opts.imageUrl ?? ((uid: string) => `/api/decks/images/${uid}/file`);
      const blocks = shown.map((r) => ({ kind: 'image', element, image_url: url(r.image_uid), image_id: r.image_uid, alt: `${r.customer_name} logo`, tag: 'logo', fit: 'contain', logo_key: r.logo_key }));
      const logos = shown.map((r) => ({ logo_key: r.logo_key, customer_name: r.customer_name, permitted_at: String(r.permitted_at).slice(0, 10), source: 'Typed', grade: 'Stated' }));
      return ok(blocks, [], { logos });
    }

    case 'interview_quote': {
      if (!opts.quoteIndex) return refused(element, 'quotes_not_switched_on', REASONS.not_set_up);
      if (!opts.segment) return refused(element, 'pick_required', PICK_LINE);
      const got = await pickQuote(env, projectId, opts.segment, { index: opts.quoteIndex as any });
      if (!got.ok) return refused(element, got.code, got.code === 'no_consent' ? QUOTE_CONSENT_LINE : got.reason);
      const q = got.quote;
      const block = { kind: 'text', element, style: 'paragraph', text: `“${q.text}” — ${q.attribution}`, session_uid: q.provenance.session_uid };
      // A recorded session's own words: Recorded, Measured (`sourceAndGrade('recorded_session')`).
      return ok([block], [], {
        quote: { attribution: q.attribution, role_recorded: q.role_recorded, held_on: q.provenance.held_on, segment_id: q.provenance.segment_id, consent: q.provenance.consent, source: 'Recorded', grade: 'Measured' },
      });
    }
  }
}

/**
 * Every element at once, for the one-click run: what passes its gate is
 * there, and what does not is its refusal, so the run leaves it out with no
 * placeholder. The quote is a manual pick, so here it is never placed.
 */
export async function ventureElements(env: Env, projectId: number, opts: ElementOpts = {}): Promise<Record<VentureElement, ElementAnswer>> {
  const out = {} as Record<VentureElement, ElementAnswer>;
  for (const el of VENTURE_ELEMENTS) {
    try {
      out[el] = await ventureElement(env, projectId, el, { ...opts, final: false, holders: false, logos: null, segment: null });
    } catch (e) {
      console.warn('[deck_venture_elements] element unreadable', el, String((e as Error)?.message || e).slice(0, 200));
      out[el] = refused(el, 'unreadable', UNREADABLE_LINE);
    }
  }
  return out;
}
