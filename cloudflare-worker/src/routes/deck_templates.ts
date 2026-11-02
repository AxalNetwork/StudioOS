/**
 * D1535 (#3782, deck v2 B6) — the template store behind the Gallery and
 * "Save as my template". Migration 725 (`deck_templates`).
 *
 *   GET  /api/decks/templates?stage=&audience=&style=   HQ's templates, filtered  → { templates: [Meta], filters }
 *   GET  /api/decks/templates/mine                      the caller's own          → { templates: [Meta] }
 *   GET  /api/decks/templates/pick?stage=&audience=&sector=   the one-click pick  → { template_id, reason }
 *   GET  /api/decks/templates/:uid                      one, with its cards       → { template: Meta, cards, theme }
 *   POST /api/decks/templates/:uid/apply   { project_id }  → { proposal, template_id }: a proposal, nothing kept
 *   POST /api/decks/:id/save-as-template   { name }        → 201 { template: Meta }
 *
 * `Meta` is `{ uid, name, description, stage, audience_tags, deck_audience,
 * style, swatch, card_count }`. The Audience filter is New deck's seven
 * audiences. Q5 (#3876): apply has its own route and writes the proposal with
 * `method_id` `tpl:<uid>`, so v1's `apply-method` ids and its "Use this
 * template" label stay as they are.
 *
 * HQ's templates come from `services/decks/templateSeeds.ts` (#3876's
 * content), written into the table on the first read (`INSERT OR IGNORE` by
 * uid). A seed that fails `templateProblems` is never written. Who: reading
 * is for anyone signed in; apply and save are the deck routes' `projectOwned`,
 * write. Nothing here runs a model.
 *
 * Mounted before `decks`, so `/templates` never reaches `GET /api/decks/:id`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import { newUid } from './_t13t14t15_helpers';
import { getDeckRow, proposeFill, rowToDeck, sanitizeSlides, themeOfRow } from './decks';
import { AUDIENCES } from '../services/decks/slideModel';
import {
  ATTESTATION, AUDIENCE_LABEL, CONTRACT, STAGES, STAGE_LABEL, STYLES, TEMPLATE_METHOD, metaOf, pickTemplate, stripDeck, templateProblems, toSlides,
  type TemplateMeta,
} from '../services/decks/templates';
import { HQ_TEMPLATES } from '../services/decks/templateSeeds';

const deckTemplates = new Hono<{ Bindings: Env }>();
type Row = { uid: string; scope: 'hq' | 'user'; owner_id: number | null; name: string; description: string | null; stage: string | null; audience_tags: string;
  deck_audience: string | null; style: string | null; swatch: string | null; card_count: number; structure_json: string; theme_json: string | null };

const metaRow = (r: Row): TemplateMeta => ({
  uid: r.uid, name: r.name, description: r.description, stage: (r.stage as any) ?? null, audience_tags: (() => { try { return JSON.parse(r.audience_tags); } catch { return []; } })(),
  deck_audience: r.deck_audience, style: r.style, swatch: r.swatch, card_count: Number(r.card_count),
});

/** HQ's seeds into the table, once each; a seed that fails its contract is skipped and logged. */
let seeded = false;
async function seedHq(env: Env): Promise<void> {
  if (seeded) return;
  for (const t of HQ_TEMPLATES as any[]) {
    const p = templateProblems(t);
    if (p.length) { console.warn('[deck_templates] seed refused', { uid: t?.uid, first: p[0] }); continue; }
    const m = metaOf(t);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO deck_templates (uid, scope, owner_id, name, description, stage, audience_tags, deck_audience, style, swatch, card_count, structure_json, theme_json, provenance_json)
       VALUES (?, 'hq', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(m.uid, m.name, m.description, m.stage, JSON.stringify(m.audience_tags), m.deck_audience, m.style, m.swatch, m.card_count,
      JSON.stringify(t), t.theme ? JSON.stringify(t.theme) : null, JSON.stringify(t.provenance)).run();
  }
  seeded = true;
}
export const __resetSeedForTest = () => { seeded = false; };

async function hqRows(env: Env, f: { stage?: string | null; audience?: string | null; style?: string | null } = {}): Promise<Row[]> {
  await seedHq(env);
  const r = await env.DB.prepare(
    `SELECT * FROM deck_templates WHERE scope = 'hq'
       AND (?1 IS NULL OR stage = ?1) AND (?2 IS NULL OR style = ?2)
       AND (?3 IS NULL OR EXISTS (SELECT 1 FROM json_each(audience_tags) WHERE value = ?3))
     ORDER BY uid`,
  ).bind(f.stage ?? null, f.style ?? null, f.audience ?? null).all<Row>();
  return r.results ?? [];
}

const pickOf = (v: string | undefined, list: readonly string[]) => (v && list.includes(v) ? v : null);
const say = (c: any, status: number, code: string, message: string) => refuse(c, status, { code, message });

deckTemplates.get('/templates', async (c) => {
  await requireAuth(c);
  const q = (k: string) => c.req.query(k) || undefined;
  for (const [k, list] of [['stage', STAGES], ['audience', AUDIENCES], ['style', STYLES]] as const) {
    if (q(k) && !pickOf(q(k), list)) return say(c, 400, `invalid_${k}`, `That is not a ${k} the Gallery filters by.`);
  }
  const rows = await hqRows(c.env, { stage: q('stage'), audience: q('audience'), style: q('style') });
  return c.json({
    templates: rows.map(metaRow),
    filters: {
      stages: STAGES.map((k) => ({ key: k, label: STAGE_LABEL[k] })),
      audiences: AUDIENCES.map((k) => ({ key: k, label: AUDIENCE_LABEL[k] ?? k })),
      styles: STYLES.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) })),
    },
  });
});

deckTemplates.get('/templates/mine', async (c) => {
  const user = await requireAuth(c);
  const r = await c.env.DB.prepare("SELECT * FROM deck_templates WHERE scope = 'user' AND owner_id = ? ORDER BY id DESC LIMIT 100").bind(user.id).all<Row>();
  return c.json({ templates: (r.results ?? []).map(metaRow) });
});

deckTemplates.get('/templates/pick', async (c) => {
  await requireAuth(c);
  const rows = await hqRows(c.env);
  return c.json(pickTemplate(rows.map(metaRow), { stage: c.req.query('stage'), audience: c.req.query('audience'), sector: c.req.query('sector') }));
});

/** A template the caller may read: HQ's, or their own. */
async function readable(env: Env, user: User, uid: string): Promise<Row | null> {
  if (!/^tpl_[a-z0-9_]{1,60}$/.test(uid)) return null;
  await seedHq(env);
  return env.DB.prepare("SELECT * FROM deck_templates WHERE uid = ? AND (scope = 'hq' OR owner_id = ?)").bind(uid, user.id).first<Row>();
}

deckTemplates.get('/templates/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await readable(c.env, user, c.req.param('uid'));
  if (!row) return say(c, 404, 'not_found', 'There is no such template.');
  const t = JSON.parse(row.structure_json);
  return c.json({ template: metaRow(row), cards: sanitizeSlides(toSlides(t)), theme: row.theme_json ? JSON.parse(row.theme_json) : null });
});

deckTemplates.post('/templates/:uid/apply', async (c) => {
  const user = await requireAuth(c);
  const row = await readable(c.env, user, c.req.param('uid'));
  if (!row) return say(c, 404, 'not_found', 'There is no such template.');
  const b = await c.req.json().catch(() => ({} as any));
  const pid = Number(b?.project_id);
  if (!Number.isSafeInteger(pid) || pid <= 0) return say(c, 400, 'project_required', 'Say which venture the deck is for.');
  try { await projectOwned(c, user, pid, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? say(c, 404, 'not_found', 'There is no such venture.') : say(c, 403, 'forbidden', 'Only the venture\'s founders can start its deck.');
  }
  const proj = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(pid).first<{ name: string }>();
  const slides = sanitizeSlides(toSlides(JSON.parse(row.structure_json)));
  const current = await c.env.DB.prepare('SELECT id FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').bind(pid).first<{ id: number }>();
  // A proposal, as every fill is: nothing is a version until the founder keeps it.
  const proposal = await proposeFill(c.env, { id: Number(current?.id) || 0, project_id: pid, title: `${proj?.name ?? 'Deck'} — ${row.name}` }, slides, `${TEMPLATE_METHOD}${row.uid}`, Number(user.id));
  return c.json({ proposal, template_id: row.uid });
});

deckTemplates.post('/:id{[0-9]+}/save-as-template', async (c) => {
  const user = await requireAuth(c);
  let deck: any;
  try { deck = await getDeckRow(c.env, Number(c.req.param('id'))); } catch { return say(c, 404, 'not_found', 'There is no such deck.'); }
  try { await projectOwned(c, user, Number(deck.project_id), { write: true }); } catch { return say(c, 403, 'forbidden', 'Only the venture\'s founders can save its deck as a template.'); }
  const b = await c.req.json().catch(() => ({} as any));
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 40) return say(c, 400, 'invalid_name', 'Name the template in up to 40 characters.');
  const slides = stripDeck(rowToDeck(deck).slides ?? []);
  const theme = themeOfRow(deck);
  const t = {
    contract: CONTRACT, uid: `tpl_user_${newUid().slice(0, 24)}`, name, description: null, stage: null, audience_tags: [], deck_audience: null,
    style: null, swatch: null, length: 'full', aspect: theme?.aspect ?? '16:9', card_count: slides.length, theme,
    cards: slides, pending_cards: [],
    provenance: { origin: 'member', saved_from_deck: Number(deck.id), attestation: ATTESTATION },
  };
  const p = templateProblems(t);
  if (p.length) return say(c, 422, 'not_a_template', `It could not be saved as a template: ${p[0]}.`);
  await c.env.DB.prepare(
    `INSERT INTO deck_templates (uid, scope, owner_id, name, description, stage, audience_tags, deck_audience, style, swatch, card_count, structure_json, theme_json, provenance_json)
     VALUES (?, 'user', ?, ?, NULL, NULL, '[]', NULL, NULL, NULL, ?, ?, ?, ?)`,
  ).bind(t.uid, user.id, name, t.card_count, JSON.stringify(t), theme ? JSON.stringify(theme) : null, JSON.stringify(t.provenance)).run();
  return c.json({ template: metaOf(t) }, 201);
});

export default deckTemplates;
