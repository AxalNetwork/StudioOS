/**
 * D6689 (#6689, plan key C1 of #6680) — the formation catalogue's read
 * service: the current catalogue version, and one entity form with its
 * jurisdiction, facts, fee lines and pack, read from the tables of migration
 * 202611151923_6689_formation_catalogue.sql.
 *
 * NOTHING READS THIS IN PRODUCTION YET. The seed is #6690 (C2), the first
 * reader #6691 (E8), the editor #6699 (H3). Until then the store is empty and
 * every read answers null.
 *
 * WHAT A READ NEVER INVENTS. A fact's value is returned only with its status;
 * a fee line with no amount reads `amount_cents: null` ("Not recorded"),
 * never 0; a source is returned as stored, with the day it was checked. The
 * store's CHECKs already refuse a `recorded` fact or an amount without a
 * source and a day (D4357), so a read cannot carry one.
 *
 * Read only. All SQL is bound.
 */
import type { Env } from '../types';

export const CATALOGUE_STATUSES = Object.freeze(['draft', 'in_review', 'published', 'retired'] as const);
export const OFFER_MODES = Object.freeze(['orderable', 'guided', 'information_only', 'off'] as const);
export const FACT_STATUSES = Object.freeze(['recorded', 'provisional', 'not_recorded', 'disputed'] as const);

export type CatalogueVersion = { id: number; version: number; status: string; published_at: string | null };
export type SourceRef = { id: number; kind: string; title: string; url: string | null } | null;
export type FormFact = { key: string; value: string | null; status: string; blocking: boolean; source: SourceRef; checked_on: string | null };
export type FeeLine = {
  key: string; label: string; payee: string; collected_by: string; currency: string;
  amount_cents: number | null; timing: string; source: SourceRef; checked_on: string | null;
};
export type PackItem = {
  key: string; phase: string; kind: string; acting_party: string; title: string;
  template_key: string | null; counsel_required: boolean;
};
export type CatalogueForm = {
  version: CatalogueVersion;
  jurisdiction: { country: string; subdivision: string | null; registry_name: string | null; vocabulary: Record<string, unknown> };
  form: {
    key: string; label: string; offer_mode: string; legal_form_family: string | null; legacy_gate: string | null;
    legacy_display: unknown; allow_axal_collection: boolean;
  };
  facts: FormFact[];
  fees: FeeLine[];
  pack: PackItem[];
};

const json = (s: unknown, fallback: unknown) => {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
const source = (r: any): SourceRef => (r.source_id == null ? null
  : { id: Number(r.source_id), kind: String(r.source_kind), title: String(r.source_title), url: r.source_url ?? null });

/** The current catalogue version (published, at most one), or null when none is current. */
export async function currentVersion(env: Env): Promise<CatalogueVersion | null> {
  const r = await env.DB.prepare(
    "SELECT id, version, status, published_at FROM formation_catalogue_versions WHERE is_current = 1 AND status = 'published' LIMIT 1",
  ).first<{ id: number; version: number; status: string; published_at: string | null }>();
  return r ? { id: Number(r.id), version: Number(r.version), status: r.status, published_at: r.published_at ?? null } : null;
}

/** A version by its number, any status (for review and the editor), or null. */
export async function versionByNumber(env: Env, version: number): Promise<CatalogueVersion | null> {
  if (!Number.isSafeInteger(version) || version < 1) return null;
  const r = await env.DB.prepare('SELECT id, version, status, published_at FROM formation_catalogue_versions WHERE version = ?')
    .bind(version).first<{ id: number; version: number; status: string; published_at: string | null }>();
  return r ? { id: Number(r.id), version: Number(r.version), status: r.status, published_at: r.published_at ?? null } : null;
}

/**
 * One entity form of a version (the current one unless `version` is given),
 * with its jurisdiction, facts, fee lines and pack in order; null when there
 * is no such version or form.
 */
export async function catalogueForm(env: Env, formKey: string, opts: { version?: CatalogueVersion | null } = {}): Promise<CatalogueForm | null> {
  const v = opts.version === undefined ? await currentVersion(env) : opts.version;
  if (!v || typeof formKey !== 'string' || !formKey) return null;
  const f = await env.DB.prepare(
    `SELECT f.id, f.form_key, f.label, f.offer_mode, f.legal_form_family, f.legacy_gate, f.legacy_display_json, f.allow_axal_collection,
            j.country, j.subdivision, j.registry_name, j.vocabulary_json
       FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id
      WHERE f.version_id = ? AND f.form_key = ?`,
  ).bind(v.id, formKey).first<any>();
  if (!f) return null;
  const formId = Number(f.id);
  const [facts, fees, pack] = await Promise.all([
    env.DB.prepare(
      `SELECT x.fact_key, x.value, x.status, x.blocking, x.checked_on, x.source_id, s.kind AS source_kind, s.title AS source_title, s.url AS source_url
         FROM formation_form_facts x LEFT JOIN formation_sources s ON s.id = x.source_id
        WHERE x.version_id = ? AND x.form_id = ? ORDER BY x.fact_key`,
    ).bind(v.id, formId).all<any>(),
    env.DB.prepare(
      `SELECT x.line_key, x.label, x.payee, x.collected_by, x.currency, x.amount_cents, x.timing, x.checked_on, x.source_id,
              s.kind AS source_kind, s.title AS source_title, s.url AS source_url
         FROM formation_fee_lines x LEFT JOIN formation_sources s ON s.id = x.source_id
        WHERE x.version_id = ? AND x.form_id = ? ORDER BY x.id`,
    ).bind(v.id, formId).all<any>(),
    env.DB.prepare(
      `SELECT item_key, phase, kind, acting_party, title, template_key, counsel_required
         FROM formation_pack_items WHERE version_id = ? AND form_id = ? ORDER BY position, id`,
    ).bind(v.id, formId).all<any>(),
  ]);
  return {
    version: v,
    jurisdiction: {
      country: String(f.country), subdivision: f.subdivision ?? null, registry_name: f.registry_name ?? null,
      vocabulary: json(f.vocabulary_json, {}) as Record<string, unknown>,
    },
    form: {
      key: String(f.form_key), label: String(f.label), offer_mode: String(f.offer_mode),
      legal_form_family: f.legal_form_family ?? null, legacy_gate: f.legacy_gate ?? null,
      legacy_display: json(f.legacy_display_json, null), allow_axal_collection: Number(f.allow_axal_collection) === 1,
    },
    facts: (facts.results || []).map((r: any) => ({
      key: String(r.fact_key), value: r.value ?? null, status: String(r.status), blocking: Number(r.blocking) === 1,
      source: source(r), checked_on: r.checked_on ?? null,
    })),
    fees: (fees.results || []).map((r: any) => ({
      key: String(r.line_key), label: String(r.label), payee: String(r.payee), collected_by: String(r.collected_by),
      currency: String(r.currency), amount_cents: r.amount_cents == null ? null : Number(r.amount_cents),
      timing: String(r.timing), source: source(r), checked_on: r.checked_on ?? null,
    })),
    pack: (pack.results || []).map((r: any) => ({
      key: String(r.item_key), phase: String(r.phase), kind: String(r.kind), acting_party: String(r.acting_party),
      title: String(r.title), template_key: r.template_key ?? null, counsel_required: Number(r.counsel_required) === 1,
    })),
  };
}
