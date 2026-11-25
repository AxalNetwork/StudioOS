/**
 * D8259 (#8259, Build v2 BD28, the brief's Q3 answer A) — the filings a
 * founder's company likely needs, offered on Company creation as suggestions
 * with "Add to my filings" and "Not now".
 *
 * WHERE THEY COME FROM. Axal's filing packs for US Delaware C-Corps and LLCs
 * (`entityObligations.ts` US_PACKS, read from `compliance.ts` STANDARD_EVENTS,
 * the one ruleset the founder calendar and the entity calendar already run
 * on), dated by `packObligations`: a fixed date takes its next occurrence, a
 * rule "N days after formation" needs the formation date and is offered
 * without a date, with its reason, when none is recorded. Every other
 * jurisdiction has no pack (BD28 B): the read says so and offers nothing.
 *
 * WHICH PACK. The incorporation order's jurisdiction when it is one of the
 * packs, else the company record's jurisdiction and legal form (US-DE with
 * c_corp or llc, as `incorporationCompany.ts` JURISDICTION_MAP writes them).
 * An entity record alone does not say C-Corp or LLC, so it names no pack.
 *
 * WHAT IS LEFT OUT. A suggestion the venture already has as a filing, by its
 * title (a filing added from a suggestion keeps the suggestion's title) or,
 * for one Axal set on the entity calendar, by its pack key; and one the
 * venture dismissed with "Not now" (`company_filing_suggestion_dismissals`),
 * which stays dismissed.
 *
 * Adding one creates nothing here: the page opens the existing Add filing form
 * with the suggestion's values, and the filing it saves is the venture's own
 * Build filing. Nothing is filed.
 */
import type { Env } from '../types';
import { STANDARD_EVENTS } from '../routes/compliance';
import { US_PACKS, isoDate, packObligations, type UsPack } from './entityObligations';

export const PACK_LABEL: Readonly<Record<UsPack, string>> = Object.freeze({
  us_de_ccorp: 'US Delaware C-Corp',
  us_de_llc: 'US Delaware LLC',
});

/** A suggestion's key: the pack and the rule, as `entity_obligations.pack_key` names a seeded one. */
export const SUGGESTION_KEY = /^(us_de_ccorp|us_de_llc):([a-z_]{1,40})$/;

/** True when `key` names a rule one of the packs holds. */
export function isSuggestionKey(key: unknown): key is string {
  const m = typeof key === 'string' ? SUGGESTION_KEY.exec(key) : null;
  return !!m && (STANDARD_EVENTS[m[1]] || []).some(spec => spec.event_type === m[2]);
}

/** Build's filing kinds (`routes/cycle_build.ts` FILING_KINDS) a pack rule's type maps to; the rest are Other. */
const FILING_KIND: Readonly<Record<string, string>> = Object.freeze({ franchise_tax: 'franchise_tax', annual_report: 'annual_report' });
/** A rule filed with the IRS, not the state: the form's Federal chip. Every other rule's jurisdiction is chosen in the form. */
const FEDERAL: ReadonlySet<string> = new Set(['us_de_ccorp:annual_report']);
const CADENCE: Readonly<Record<string, string>> = Object.freeze({ annual: 'Yearly', quarterly: 'Quarterly', monthly: 'Monthly', one_time: 'Once' });

type Order = { jurisdiction_id: string | null; status: string; filed_on: string | null } | null;
type ProjectRef = { id: number; company_id: number | null; entity_id: number | null };

/** The pack for this venture and where it was read, or null with the jurisdiction's words when there is none. */
export function packFor(order: Order, company: { jurisdiction?: string | null; legal_form?: string | null } | null):
  { pack: UsPack; source: string } | { pack: null; jurisdiction: string | null } {
  const ordered = order?.jurisdiction_id ?? null;
  if (ordered && (US_PACKS as readonly string[]).includes(ordered)) return { pack: ordered as UsPack, source: 'the incorporation order' };
  const j = typeof company?.jurisdiction === 'string' ? company.jurisdiction.trim().toUpperCase() : '';
  const form = company?.legal_form ?? null;
  if (j === 'US-DE' && form === 'c_corp') return { pack: 'us_de_ccorp', source: 'the company record' };
  if (j === 'US-DE' && form === 'llc') return { pack: 'us_de_llc', source: 'the company record' };
  return { pack: null, jurisdiction: ordered || (j || null) };
}

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const today = () => new Date().toISOString().slice(0, 10);

/**
 * BD28's read for the module page. `order` is the read `company()` already
 * made; `steps` its formation steps (their titles). Fails on its own: an
 * unreadable store says `unreadable`, never "no suggestions".
 */
export async function suggestedFilings(env: Env, p: ProjectRef, order: Order, steps: { title: string | null }[], on: string = today()) {
  try {
    const company = p.company_id == null ? null : await env.DB.prepare(
      'SELECT jurisdiction, legal_form, incorporation_date FROM company_profiles WHERE id = ?',
    ).bind(p.company_id).first<{ jurisdiction: string | null; legal_form: string | null; incorporation_date: string | null }>();
    const found = packFor(order, company);
    if (found.pack == null) {
      return { state: 'no_pack' as const, pack: null, jurisdiction: found.jurisdiction, rows: [],
        reason: 'Axal has filing packs for US Delaware LLCs and C-Corps only. Add your own filings with Add another filing.' };
    }
    const pack = found.pack;
    const entity = p.entity_id == null ? null : await env.DB.prepare('SELECT incorporation_date FROM entities WHERE id = ?')
      .bind(p.entity_id).first<{ incorporation_date: string | null }>();
    const formed = (order?.status === 'filed' ? isoDate(String(order.filed_on ?? '').slice(0, 10)) : null)
      ?? isoDate(String(company?.incorporation_date ?? '').slice(0, 10))
      ?? isoDate(String(entity?.incorporation_date ?? '').slice(0, 10));
    const dismissed = new Set(((await env.DB.prepare(
      'SELECT suggestion_key FROM company_filing_suggestion_dismissals WHERE project_id = ?',
    ).bind(p.id).all<{ suggestion_key: string }>()).results ?? []).map(r => r.suggestion_key));
    const obligations = p.entity_id == null ? [] : (await env.DB.prepare(
      'SELECT title, pack_key FROM entity_obligations WHERE entity_id = ?',
    ).bind(p.entity_id).all<{ title: string | null; pack_key: string | null }>()).results ?? [];
    const titles = new Set([...steps.map(s => norm(s.title)), ...obligations.map(o => norm(o.title))]);
    const keys = new Set(obligations.map(o => o.pack_key).filter((k): k is string => typeof k === 'string'));
    const { rows: dated, skipped } = packObligations(pack, on, formed);
    const specs = STANDARD_EVENTS[pack] || [];
    const rows = specs.map(spec => {
      const key = `${pack}:${spec.event_type}`;
      const due = dated.find(r => r.pack_key === key)?.due_date ?? null;
      const why = skipped.find(s => s.title === spec.title) ? 'Dated from the company’s formation date, which is not recorded.' : null;
      return {
        key, title: spec.title, kind: FILING_KIND[spec.event_type] ?? 'other', jurisdiction: FEDERAL.has(key) ? 'Federal' : null, cadence: CADENCE[spec.recurrence] ?? null,
        due, due_reason: due ? null : why ?? 'No due date is recorded.', note: spec.description ?? null,
        added: titles.has(norm(spec.title)) || keys.has(key), dismissed: dismissed.has(key),
      };
    });
    return {
      state: 'ok' as const, pack, pack_label: PACK_LABEL[pack], source: found.source,
      rows: rows.filter(r => !r.added && !r.dismissed).map(({ added, dismissed, ...r }) => r),
      already_added: rows.filter(r => r.added).length, dismissed: rows.filter(r => !r.added && r.dismissed).length,
    };
  } catch (error) {
    console.error('[cycle_build] company_creation suggested filings read failed', (error as Error)?.message);
    return { state: 'unreadable' as const, pack: null, rows: [], reason: 'Suggested filings could not be read. Your filings still read.' };
  }
}
