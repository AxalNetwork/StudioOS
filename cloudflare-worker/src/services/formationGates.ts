/**
 * D6693 (#6693, plan key C3 of #6680): "can this form be ordered?" is
 * computed on every read, never remembered. Each gate is returned with pass or
 * fail, so the reason a form is not orderable is named.
 *
 * LEGACY FORMS. A form whose `legacy_gate` is '1' (the six products the
 * version-1 seed carries over, #6690) keeps today's rule and nothing else:
 *   - a catalogue price for its jurisdiction id (`resolveIncorporationPrice`,
 *     the price `POST /incorporation/order` charges), and
 *   - for Wyoming, the counsel-approved charter body (`LEGACY_COUNSEL`, the
 *     templates `routes/legal.ts` holds in `COUNSEL_REQUIRED_TEMPLATES`),
 *   plus HQ's pause, which applies to every form.
 *
 * EVERY OTHER FORM is orderable only when all hold:
 *   published      its version is the current published one
 *   offer_mode     the form's offer mode is `orderable`
 *   partner        a verified partner has formation coverage on for it
 *   credential     that partner holds an unexpired credential for the country
 *   data_agreement that partner's data agreement is signed
 *   price          the catalogue has a price for the form
 *   templates      every `counsel_required` template is approved, at its
 *                  current version, by a review whose jurisdiction is the
 *                  form's country
 *   facts          every blocking fact has a source and a day within the
 *                  allowed age, and none is disputed
 *   not_paused     HQ has not paused the form (`formation_form_switches`)
 *
 * THE DEFAULT PARTNER for a quote before payment is the coverage row, among
 * those that pass partner, credential and data agreement, with the lowest
 * `priority` number (ties: the oldest row).
 *
 * Read only. All SQL is bound. No model reads or writes catalogue content.
 */
import type { Env } from '../types';
import { currentVersion, type CatalogueVersion } from './formationCatalogue';

/** Owner decision 19 (answer A, #6682): the allowed age of a blocking fact, in days. A config value. */
export const DEFAULT_FACT_MAX_AGE_DAYS = 183;

/** Today's counsel rule for the legacy forms (`routes/legal.ts` COUNSEL_REQUIRED_TEMPLATES, by jurisdiction id). */
export const LEGACY_COUNSEL: Readonly<Record<string, readonly string[]>> = Object.freeze({
  us_wy_ccorp: Object.freeze(['articles_of_incorporation_wy']),
});

export const GATE_KEYS = Object.freeze([
  'published', 'offer_mode', 'partner', 'credential', 'data_agreement', 'price', 'templates', 'facts', 'not_paused',
] as const);
export const LEGACY_GATE_KEYS = Object.freeze(['price', 'counsel', 'not_paused'] as const);
export type GateKey = typeof GATE_KEYS[number] | typeof LEGACY_GATE_KEYS[number];
export type Gate = { key: GateKey; pass: boolean; detail: string | null };
export type DefaultPartner = { coverage_id: number; formation_partner_id: number; priority: number };
export type FormGates = { form_key: string; legacy: boolean; orderable: boolean; gates: Gate[]; default_partner: DefaultPartner | null };

/** The catalogue price lookup. Injectable, so a test needs no Stripe mirror. */
export type PriceOf = (env: Env, form: { form_key: string; legacy: boolean }) => Promise<{ amount_minor: number; currency: string } | null>;

/** The price `POST /incorporation/order` charges for a legacy form; for any other form, a catalogue product tagged `formation_form_key`. */
export const catalogPriceOf: PriceOf = async (env, form) => {
  if (form.legacy) {
    const { resolveIncorporationPrice } = await import('../routes/legal');
    const p = await resolveIncorporationPrice(env, form.form_key);
    return p && p.amountCents > 0 ? { amount_minor: p.amountCents, currency: p.currency } : null;
  }
  const { priceForPlanMetadata } = await import('./catalog');
  const p = await priceForPlanMetadata(env, 'formation_form_key', form.form_key, null);
  return p && typeof p.unit_amount === 'number' && p.unit_amount > 0 ? { amount_minor: p.unit_amount, currency: p.currency || 'usd' } : null;
};

export type GateOptions = { today?: string; maxAgeDays?: number; priceOf?: PriceOf; version?: CatalogueVersion | null };

/** The allowed fact age: `FORMATION_FACT_MAX_AGE_DAYS` when it is a whole number of days from 1 to 3650, else the default. */
export function factMaxAgeDays(env: Env): number {
  const raw = Number((env as unknown as Record<string, unknown>).FORMATION_FACT_MAX_AGE_DAYS);
  return Number.isSafeInteger(raw) && raw >= 1 && raw <= 3650 ? raw : DEFAULT_FACT_MAX_AGE_DAYS;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** The earliest `checked_on` day still fresh on `today`. */
export function freshSince(today: string, maxAgeDays: number): string {
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - maxAgeDays);
  return isoDay(t);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** An active template body with content, or null. */
async function activeBody(env: Env, slug: string): Promise<string | null> {
  const r = await env.DB.prepare(
    `SELECT body_md FROM legal_templates WHERE slug = ? AND is_active = 1 AND is_stub = 0 AND length(trim(body_md)) > 0`,
  ).bind(slug).first<{ body_md: string }>();
  return r?.body_md ?? null;
}

/** A review jurisdiction names the country: 'GB', or a place within it ('US-WY'). */
export function jurisdictionIsCountry(jurisdiction: unknown, country: string): boolean {
  const j = String(jurisdiction ?? '').trim().toUpperCase();
  return j === country || j.startsWith(`${country}-`);
}

/**
 * Whether one template is approved for a country: an active body, and an
 * `approved` review (D4811) bound to that body's current SHA-256 whose
 * jurisdiction is the country. An approval with conditions does not open it.
 */
export async function templateApprovedFor(env: Env, slug: string, country: string): Promise<boolean> {
  const body = await activeBody(env, slug);
  if (!body) return false;
  const sha = await sha256Hex(body);
  const rows = (await env.DB.prepare(
    `SELECT jurisdiction FROM legal_reviews
      WHERE object_kind = 'template' AND object_ref = ? AND version_sha256 = ? AND decision = 'approved'`,
  ).bind(slug, sha).all<{ jurisdiction: string }>()).results || [];
  return rows.some((r) => jurisdictionIsCountry(r.jurisdiction, country));
}

type FormRow = { id: number; form_key: string; offer_mode: string; legacy_gate: string | null; country: string };

/** Whether HQ has paused a form now. */
export async function formPaused(env: Env, formKey: string): Promise<{ paused: boolean; reason: string | null }> {
  const r = await env.DB.prepare('SELECT paused, reason FROM formation_form_switches WHERE form_key = ?').bind(formKey).first<{ paused: number; reason: string }>();
  return { paused: Number(r?.paused) === 1, reason: r && Number(r.paused) === 1 ? r.reason : null };
}

/** Every gate of one form of a version, in order. */
export async function gatesForForm(env: Env, version: CatalogueVersion, form: FormRow, opts: GateOptions = {}): Promise<FormGates> {
  const today = opts.today ?? isoDay(new Date());
  const priceOf = opts.priceOf ?? catalogPriceOf;
  const legacy = String(form.legacy_gate ?? '') === '1';
  const pass = (key: GateKey, ok: boolean, detail: string | null = null): Gate => ({ key, pass: ok, detail: ok ? null : detail });

  if (legacy) {
    const price = await priceOf(env, { form_key: form.form_key, legacy: true });
    const needed = LEGACY_COUNSEL[form.form_key] ?? [];
    const missing: string[] = [];
    for (const slug of needed) if (!(await activeBody(env, slug))) missing.push(slug);
    const paused = await formPaused(env, form.form_key);
    const gates = [
      pass('price', !!price, 'The catalogue has no price for this form.'),
      pass('counsel', missing.length === 0, `Counsel has not approved: ${missing.join(', ')}.`),
      pass('not_paused', !paused.paused, `Paused by HQ: ${paused.reason ?? ''}`.trim()),
    ];
    return { form_key: form.form_key, legacy: true, orderable: gates.every((g) => g.pass), gates, default_partner: null };
  }

  const published = version.status === 'published' && (await currentVersion(env))?.id === version.id;
  // Coverage rows switched on for this form, best first, with what each partner holds.
  const rows = (await env.DB.prepare(
    `SELECT c.id AS coverage_id, c.priority, p.id AS partner_id, p.status, p.dpa_signed_on,
            (SELECT COUNT(*) FROM formation_partner_credentials k
              WHERE k.formation_partner_id = p.id AND k.country = ? AND k.valid_until >= ?) AS current_credentials
       FROM formation_partner_coverage c JOIN formation_partners p ON p.id = c.formation_partner_id
      WHERE c.country = ? AND c.form_key = ? AND c.service = 'formation' AND c.is_on = 1
      ORDER BY c.priority ASC, c.id ASC`,
  ).bind(form.country, today, form.country, form.form_key).all<any>()).results || [];
  const verified = rows.filter((r) => r.status === 'verified');
  const credentialed = verified.filter((r) => Number(r.current_credentials) > 0);
  const signed = credentialed.filter((r) => !!r.dpa_signed_on);
  const best = signed[0] ?? null;

  const price = await priceOf(env, { form_key: form.form_key, legacy: false });

  const items = (await env.DB.prepare(
    `SELECT DISTINCT template_key FROM formation_pack_items
      WHERE version_id = ? AND form_id = ? AND counsel_required = 1 AND template_key IS NOT NULL`,
  ).bind(version.id, form.id).all<{ template_key: string }>()).results || [];
  const unapproved: string[] = [];
  for (const it of items) if (!(await templateApprovedFor(env, it.template_key, form.country))) unapproved.push(it.template_key);

  const since = freshSince(today, opts.maxAgeDays ?? factMaxAgeDays(env));
  const facts = (await env.DB.prepare(
    `SELECT fact_key, status, source_id, checked_on FROM formation_form_facts WHERE version_id = ? AND form_id = ? AND blocking = 1`,
  ).bind(version.id, form.id).all<any>()).results || [];
  const disputed = facts.filter((f) => f.status === 'disputed').map((f) => f.fact_key);
  const stale = facts.filter((f) => f.status !== 'disputed' && (f.source_id == null || !f.checked_on || String(f.checked_on) < since)).map((f) => f.fact_key);

  const paused = await formPaused(env, form.form_key);

  const gates: Gate[] = [
    pass('published', published, 'This version is not the current published catalogue.'),
    pass('offer_mode', form.offer_mode === 'orderable', `The form is offered as ${form.offer_mode}, not orderable.`),
    pass('partner', verified.length > 0, 'No verified partner has formation coverage on for this form.'),
    pass('credential', credentialed.length > 0, `No verified partner holds an unexpired credential for ${form.country}.`),
    pass('data_agreement', signed.length > 0, 'No qualifying partner has a signed data agreement.'),
    pass('price', !!price, 'The catalogue has no price for this form.'),
    pass('templates', unapproved.length === 0, `Not approved by counsel for ${form.country}: ${unapproved.join(', ')}.`),
    pass('facts', disputed.length === 0 && stale.length === 0,
      [disputed.length ? `Disputed: ${disputed.join(', ')}.` : '', stale.length ? `Older than allowed or unsourced: ${stale.join(', ')}.` : ''].filter(Boolean).join(' ')),
    pass('not_paused', !paused.paused, `Paused by HQ: ${paused.reason ?? ''}`.trim()),
  ];
  return {
    form_key: form.form_key, legacy: false, orderable: gates.every((g) => g.pass), gates,
    default_partner: best ? { coverage_id: Number(best.coverage_id), formation_partner_id: Number(best.partner_id), priority: Number(best.priority) } : null,
  };
}

/** The forms of a version (the current one unless given), each with its jurisdiction's country. */
export async function versionForms(env: Env, version: CatalogueVersion): Promise<(FormRow & { label: string; subdivision: string | null; registry_name: string | null })[]> {
  return ((await env.DB.prepare(
    `SELECT f.id, f.form_key, f.label, f.offer_mode, f.legacy_gate, j.country, j.subdivision, j.registry_name
       FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id
      WHERE f.version_id = ? ORDER BY j.country, f.form_key`,
  ).bind(version.id).all<any>()).results || []).map((r) => ({
    id: Number(r.id), form_key: String(r.form_key), label: String(r.label), offer_mode: String(r.offer_mode),
    legacy_gate: r.legacy_gate ?? null, country: String(r.country), subdivision: r.subdivision ?? null, registry_name: r.registry_name ?? null,
  }));
}

/** One form's gates on the current published version, or null when there is no such form. */
export async function formGates(env: Env, formKey: string, opts: GateOptions = {}): Promise<FormGates | null> {
  const v = opts.version === undefined ? await currentVersion(env) : opts.version;
  if (!v) return null;
  const form = (await versionForms(env, v)).find((f) => f.form_key === formKey);
  return form ? gatesForForm(env, v, form, opts) : null;
}
