/**
 * D1267 (#3290) — evidence inside each Raise module (VR6) and the deck editor's
 * claim chips (VR7), from the same founder read as the Evidence view
 * (`GET /api/cycles/raise/evidence`, D1263, D1264, D1266). Pure, so
 * `frontend/test/raise_evidence_modules_d1267.test.mjs` holds each rule.
 *
 * A module shows the claims its own surface states, at its newest version, and
 * the pinned evidence of its own areas. Each opens the Evidence view's drawer
 * at its address (`/raise/evidence/claim/:id`, `/item/:id`), so there is one
 * drawer, not a copy per module.
 *
 * A SHARE-LINK DECK CARRIES NO EVIDENCE. The chips live in the editor only.
 * The optional "Sources on Axal" slide is an ordinary card the founder adds
 * and saves: its words are built here from the claims' records, never typed
 * by Eadwyn, and it says nothing a record does not.
 */
import { claimTitle, day, providerWord, sourceWord } from './evidenceView.js';

/** Which surfaces and areas each Raise module shows (D1264 §2; D1263's areas). */
export const MODULE_EVIDENCE = Object.freeze({
  'fundraising-readiness': { surfaces: ['readiness', 'capital_model'], areas: ['Fundraising readiness', 'Legal', 'Capital model'] },
  'investor-narrative': { surfaces: ['narrative'], areas: ['Investor narrative and Pitch deck'] },
  'pitch-deck': { surfaces: ['deck'], areas: [] },
  'data-room': { surfaces: [], areas: ['Data room'] },
  'cap-table': { surfaces: ['cap_table'], areas: ['Cap table'] },
  'use-of-funds': { surfaces: ['use_of_funds'], areas: ['Use of funds'] },
  'capital-relationships': { surfaces: [], areas: ['Capital relationships'] },
});

const versionNo = (v) => { const m = /^v(\d+)$/.exec(String(v || '')); return m ? Number(m[1]) : null; };

/** The newest version a surface's claims carry: "v3", or "current", or null. */
export function newestVersion(claims, surface) {
  const own = (claims || []).filter((c) => c.surface === surface);
  if (!own.length) return null;
  const numbered = own.map((c) => versionNo(c.surface_version)).filter((n) => n != null);
  return numbered.length ? `v${Math.max(...numbered)}` : own[0].surface_version;
}

/** One module's part: its claims at their newest version, and its pinned items. Null blocks stay null (Unreadable). */
export function moduleEvidence(read, slug) {
  const spec = MODULE_EVIDENCE[slug];
  if (!spec) return null;
  const ok = (b) => b && b.state === 'recorded';
  const claimsAll = ok(read?.claims) ? read.claims.rows : null;
  const items = ok(read?.items) ? read.items.rows.filter((i) => i.state === 'pinned' && spec.areas.includes(i.area)) : null;
  const versions = Object.fromEntries(spec.surfaces.map((s) => [s, newestVersion(claimsAll, s)]));
  const claims = claimsAll ? claimsAll.filter((c) => spec.surfaces.includes(c.surface) && c.surface_version === versions[c.surface]) : null;
  const shown = spec.surfaces.map((s) => versions[s]).find((v) => v && v !== 'current') || null;
  return { spec, claims, items, version: shown, hasClaims: spec.surfaces.length > 0, hasItems: spec.areas.length > 0 };
}

/** VR7: the claims one slide states, for the deck version the editor has open. */
export function slideClaims(read, version, slide) {
  if (read?.claims?.state !== 'recorded') return null;
  const v = `v${Number(version) || 0}`;
  return read.claims.rows.filter((c) => c.surface === 'deck' && c.surface_version === v && String(c.field_key).startsWith(`slide:${Number(slide)}#`));
}
/** Whether the claim check has read this version at all: it reads the current deck only (D1264 §2). */
export function deckChecked(read, version) {
  if (read?.claims?.state !== 'recorded') return null;
  return read.claims.rows.some((c) => c.surface === 'deck' && c.surface_version === `v${Number(version) || 0}`);
}

/** "Sources on Axal": one line per figure the deck states — the figure, its source, its date. A figure with no record says so. */
export function sourcesLines(read, version) {
  if (read?.claims?.state !== 'recorded') return null;
  const v = `v${Number(version) || 0}`;
  const seen = new Set();
  const lines = [];
  for (const c of read.claims.rows.filter((x) => x.surface === 'deck' && x.surface_version === v)) {
    const name = claimTitle(c);
    if (seen.has(name)) continue;
    seen.add(name);
    const r = c.record;
    const src = r ? [sourceWord(r.source_label), providerWord(r.provider)].filter(Boolean).join(' · ') : 'No record on StudioOS';
    const when = r ? day(r.observed_on) || 'date not recorded' : null;
    lines.push(`${name} — ${src}${c.state === 'mismatch' ? ', which differs' : ''}${when ? ` — ${when}` : ''}`);
  }
  return lines;
}
export const SOURCES_TITLE = 'Sources on Axal';
