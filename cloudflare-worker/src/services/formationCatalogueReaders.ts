/**
 * D6691 (#6691, plan key E8 of #6680) — the incorporation readers' view of the
 * formation catalogue: the jurisdiction list, the wizard's handoff steps and
 * the place a name check asks, each read from the catalogue and each falling
 * back to the frozen code array when the catalogue cannot answer.
 *
 * WHICH VERSION. HQ reads the current published version. A branch studio
 * reads version 1 only, and only once it is published (owner decision 8:
 * after version 1, versions are written in HQ's database only).
 *
 * WHICH FORMS. Only a form the legacy order path knows: a `legacy_gate`, a
 * `legacy_display_json` and a key among the frozen ids. A form the catalogue
 * adds beyond those is not listed here; ordering it is later work (#6707).
 * `offer_mode` is not read here (decision 11 for uk_ltd, sg_pte and ee_oy is
 * #8836), so the three non-US forms keep today's behaviour.
 *
 * THE FALLBACK. For one release the frozen arrays stay (they go in #6716).
 * Every fallback hit is logged with `console.warn` as one JSON line,
 * `{"event":"formation_catalogue_fallback","reader":…,"reason":…}`, so the
 * release shows how often the catalogue did not answer. A read never throws.
 *
 * Read only. All SQL is bound.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { currentVersion, versionByNumber, type CatalogueVersion } from './formationCatalogue';

export const FALLBACK_EVENT = 'formation_catalogue_fallback';
export type CatalogueReader = 'jurisdictions' | 'wizard_handoff' | 'name_check';
export type FallbackReason = 'read_failed' | 'no_version' | 'no_forms' | 'no_form' | 'unreadable_form';

/** One fallback hit, logged as a single JSON line. */
export function logCatalogueFallback(reader: CatalogueReader, reason: FallbackReason, formKey?: string | null): void {
  console.warn(JSON.stringify({ event: FALLBACK_EVENT, reader, reason, ...(formKey ? { form_key: formKey } : {}) }));
}

/** The version these readers serve: the current one on HQ, version 1 (published) on a branch. */
export async function readerVersion(env: Env): Promise<CatalogueVersion | null> {
  if (branchOf(env)) {
    const v1 = await versionByNumber(env, 1);
    return v1 && v1.status === 'published' ? v1 : null;
  }
  return currentVersion(env);
}

/** A jurisdiction entry as `GET /api/legal/jurisdictions` returns it. */
export type LegacyJurisdiction = { id: string; label: string; templates: string[]; [field: string]: unknown };

/**
 * The jurisdiction list, from the catalogue: each legacy form in the
 * version's order, as `{ id, label, ...legacy display fields, templates }`,
 * the templates being the form's document pack items in order. Falls back to
 * `frozen` (logged) when the read fails, there is no version, no legacy form,
 * or a form's display fields cannot be read.
 */
export async function catalogueJurisdictions<T extends { id: string }>(env: Env, frozen: readonly T[]): Promise<Array<T | LegacyJurisdiction>> {
  const known = new Set(frozen.map((j) => j.id));
  try {
    const v = await readerVersion(env);
    if (!v) { logCatalogueFallback('jurisdictions', 'no_version'); return [...frozen]; }
    const forms = ((await env.DB.prepare(
      `SELECT id, form_key, label, legacy_display_json FROM formation_entity_forms
        WHERE version_id = ? AND legacy_gate IS NOT NULL AND legacy_display_json IS NOT NULL ORDER BY id`,
    ).bind(v.id).all<any>()).results || []).filter((f: any) => known.has(String(f.form_key)));
    if (!forms.length) { logCatalogueFallback('jurisdictions', 'no_forms'); return [...frozen]; }
    const docs = (await env.DB.prepare(
      `SELECT form_id, template_key FROM formation_pack_items
        WHERE version_id = ? AND kind = 'document' AND template_key IS NOT NULL ORDER BY form_id, position, id`,
    ).bind(v.id).all<any>()).results || [];
    const out: LegacyJurisdiction[] = [];
    for (const f of forms) {
      let display: unknown;
      try { display = JSON.parse(String(f.legacy_display_json)); } catch { display = null; }
      if (!display || typeof display !== 'object' || Array.isArray(display)) {
        logCatalogueFallback('jurisdictions', 'unreadable_form', String(f.form_key));
        return [...frozen];
      }
      const { id: _i, label: _l, templates: _t, ...fields } = display as Record<string, unknown>;
      out.push({
        id: String(f.form_key), label: String(f.label), ...fields,
        templates: docs.filter((d: any) => Number(d.form_id) === Number(f.id)).map((d: any) => String(d.template_key)),
      });
    }
    return out;
  } catch {
    logCatalogueFallback('jurisdictions', 'read_failed');
    return [...frozen];
  }
}

/**
 * The wizard's handoff steps for one form, from the catalogue: its
 * `after_filing` founder steps in order (none for a form that has none, as
 * Delaware C-Corp today). Falls back to `frozen[formKey]` (logged) when the
 * read fails, there is no version, or the version has no such form.
 */
export async function catalogueHandoffSteps(env: Env, formKey: string, frozen: Readonly<Record<string, readonly string[]>>): Promise<string[]> {
  const fallback = (reason: FallbackReason) => { logCatalogueFallback('wizard_handoff', reason, formKey); return [...(frozen[formKey] ?? [])]; };
  try {
    const v = await readerVersion(env);
    if (!v) return fallback('no_version');
    const f = await env.DB.prepare('SELECT id FROM formation_entity_forms WHERE version_id = ? AND form_key = ?')
      .bind(v.id, formKey).first<{ id: number }>();
    if (!f) return fallback('no_form');
    const steps = (await env.DB.prepare(
      `SELECT title FROM formation_pack_items
        WHERE version_id = ? AND form_id = ? AND phase = 'after_filing' AND kind = 'step' ORDER BY position, id`,
    ).bind(v.id, Number(f.id)).all<{ title: string }>()).results || [];
    return steps.map((s) => String(s.title));
  } catch {
    return fallback('read_failed');
  }
}

/**
 * The place a form is registered in, from the catalogue (`US-DE`, `GB`),
 * or null after a logged fallback (read failed, no version, no such form),
 * so the caller uses its frozen map.
 */
export async function cataloguePlace(env: Env, formKey: string): Promise<string | null> {
  try {
    const v = await readerVersion(env);
    if (!v) { logCatalogueFallback('name_check', 'no_version', formKey); return null; }
    const r = await env.DB.prepare(
      `SELECT j.country, j.subdivision FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id
        WHERE f.version_id = ? AND f.form_key = ?`,
    ).bind(v.id, formKey).first<{ country: string; subdivision: string | null }>();
    if (!r) { logCatalogueFallback('name_check', 'no_form', formKey); return null; }
    return r.subdivision ? `${r.country}-${r.subdivision}` : String(r.country);
  } catch {
    logCatalogueFallback('name_check', 'read_failed', formKey);
    return null;
  }
}
