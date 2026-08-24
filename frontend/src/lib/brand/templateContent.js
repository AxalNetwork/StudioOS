// Shared content model for the brand templates — ONE source of truth for what
// a template's editable sections contain, used by every surface:
//
//   - the schema-driven field editor (components/brand/TemplateContentEditor)
//   - the real preview components (components/brand/templates/*.jsx)
//   - the inline editor on /spinout-lab/brand and the full builder on /build/brand
//
// The accessor below is a deliberate 1:1 port of `landingContent()` in
// `cloudflare-worker/src/services/landingTemplates.ts` — same schema-default
// fallback, same "blank list falls back to the default list", same max clamp,
// same percent coercion. That is what makes the editor preview and the
// published page show the same thing. The only difference: the worker escapes
// to HTML on the way out and React escapes for us, so these return RAW strings.
//
// Pure data + pure helpers. No I/O, no network, no React.

import { TEMPLATE_CONTENT_SCHEMA, SHARED_CONTENT_FIELDS } from './templates.js';

/** The template-specific content fields for a visual template key. */
export function contentFieldsFor(templateKey) {
  return TEMPLATE_CONTENT_SCHEMA[templateKey] || [];
}

/** Shared hero fields + this template's content fields — the full editable set. */
export function editableFieldsFor(templateKey) {
  return { shared: SHARED_CONTENT_FIELDS, content: contentFieldsFor(templateKey) };
}

/** A blank item for a groupList field (every itemField present, empty). */
export function blankItem(field) {
  const o = {};
  for (const itf of field.itemFields || []) o[itf.key] = '';
  return o;
}

/**
 * Schema defaults for one template, deep-copied so callers can mutate the
 * result without writing through to the catalog.
 * @returns {Record<string, string | Array<Record<string,string>>>}
 */
export function defaultsForTemplate(templateKey) {
  const out = {};
  for (const f of contentFieldsFor(templateKey)) {
    out[f.key] = f.kind === 'groupList'
      ? (Array.isArray(f.default) ? f.default.map((it) => ({ ...it })) : [])
      : (typeof f.default === 'string' ? f.default : '');
  }
  return out;
}

/**
 * content_json arrives parsed (dev FastAPI) or as a JSON string (worker row).
 * Always hand back a plain `{ [templateKey]: { field: value } }` object.
 */
export function parseContentJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/**
 * The editable content block for one template: schema defaults with the row's
 * SAVED values layered on top. A saved key always wins — including a
 * deliberately emptied list — so reopening a page never resurrects defaults
 * over the founder's edits. Fields the row has never carried fill in from the
 * schema so the form is never blank on a fresh template.
 *
 * @param {object|string|null} contentJson  the row's content_json
 * @param {string} templateKey
 * @param {string} [fallbackKey]  legacy/kit key to read when the row stored
 *                                its block under template_kit rather than template
 */
export function contentForTemplate(contentJson, templateKey, fallbackKey = null) {
  const all = parseContentJson(contentJson);
  let saved = all[templateKey];
  if ((!saved || typeof saved !== 'object' || Array.isArray(saved)) && fallbackKey) {
    const alt = all[fallbackKey];
    if (alt && typeof alt === 'object' && !Array.isArray(alt)) saved = alt;
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const out = defaultsForTemplate(templateKey);
  for (const f of contentFieldsFor(templateKey)) {
    const v = saved[f.key];
    if (f.kind === 'groupList') {
      if (Array.isArray(v)) out[f.key] = v.map((it) => ({ ...(it && typeof it === 'object' ? it : {}) }));
    } else if (typeof v === 'string') {
      out[f.key] = v;
    }
  }
  return out;
}

/** Clamp a percent-ish value to 0-100, mirroring the worker's `pct()`. */
export function pct(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Read-accessor over a template's content — the frontend twin of the worker's
 * `landingContent()`. Preview components call this so a section shows the
 * founder's live edit, then their saved value, then the schema default —
 * exactly what the published page will show.
 *
 * @param {object|string|null} content  the template's content block (or a whole
 *                                      content_json keyed by template)
 * @param {string} templateKey
 * @returns {{ t(field: string): string, list(field: string): object[] }}
 */
export function templateContent(content, templateKey) {
  const fields = contentFieldsFor(templateKey);
  const byKey = {};
  for (const f of fields) byKey[f.key] = f;

  // Accept either the template's own block or a full content_json map.
  let tc = content && typeof content === 'object' && !Array.isArray(content) ? content : {};
  if (tc[templateKey] && typeof tc[templateKey] === 'object' && !Array.isArray(tc[templateKey])) {
    tc = tc[templateKey];
  }

  return {
    t(field) {
      const spec = byKey[field];
      const def = spec && typeof spec.default === 'string' ? spec.default : '';
      const v = tc[field];
      return typeof v === 'string' && v.trim() ? v : def;
    },
    list(field) {
      const spec = byKey[field];
      const defList = spec && Array.isArray(spec.default) ? spec.default : [];
      const max = (spec && spec.max) || 12;
      let items = Array.isArray(tc[field]) ? tc[field] : [];
      // An item with nothing typed in it is not a row the page should render —
      // same filter the worker applies before falling back to the defaults.
      items = items.filter(
        (it) => it && typeof it === 'object' && Object.values(it).some((x) => typeof x === 'string' && x.trim()),
      );
      if (items.length === 0) items = defList;
      return items.slice(0, max).map((it) => ({ ...it }));
    },
  };
}
