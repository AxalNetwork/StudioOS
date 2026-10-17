/**
 * D663 — the one writer for each Raise record migration 442 added, and D691
 * (#1700) — the writes behind each Add and Edit form (migration 463's stores).
 *
 * Each writer validates its values against a fixed list and binds every one
 * of them. None decides who may write: `routes/cycle_raise.ts` checks
 * `canWrite` on the project first. Every id a write takes, in its path or its
 * body, is checked here against its own table and this venture (404
 * otherwise) until #1699 adds Raise's `ownedRow` entries, which replace these
 * checks in #1700's closing PR.
 *
 * LOGGING (D691 decision 12). Every write logs one row per record it writes
 * through `logCycleWrite` (D690): `entity_type` is `raise.<module slug>`,
 * `entity_id` the record's id, and no summary holds a holder's or an
 * investor's name. Rows written before this by the old free-text writer are
 * read as they are, never rewritten. Re-score and Edit split each write
 * several records (an item per check, a section per share), so each of those
 * records gets its own row. `addHolder()` / `updateHolder()` log nothing
 * themselves: the cap-table writers here log their row.
 */
import type { Env, User } from '../types';
import { WriterError, isoDateOrNull } from './validateWriters';
import { ensureSpinoutDeckOverridesSchema } from './decks/spinoutDeckOverrides';
import { logCycleWrite } from './cycleActivity';
import { addHolder, updateHolder, HolderError, type AddHolderArgs } from './capTableWrites';
import { SERVED_FUNDS } from './researchFundDirectory';
import { normalizeUseOfFunds } from '../util/useOfFunds';
import { ensureTier } from '../middleware/requireTier';
import { createShareLink, SHARE_NEVER_EXPIRES } from '../routes/decks';
import { createProspect, RAISE_STAGES } from '../routes/contacts';
import {
  READINESS_ITEMS, READINESS_KEYS, EVIDENCE, INVESTOR_TYPES, INVESTOR_TYPE_LABEL, VERSION_MARKER_KEY, CHECKLIST_KEYS, FUND_SECTIONS,
  computeReadiness, checkInputs, consistencyCheck, type Mismatch,
} from './raiseCycle';

export { WriterError };

const trimOrNull = (v: unknown, max = 500): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

/** One row for one Raise record (decision 12). */
async function logRaise(env: Env, userId: number, projectId: number, module: string, entityId: string | number, action: string, summary: string) {
  await logCycleWrite(env, { projectId, userId, cycle: 'raise', module, entityId, action, summary });
}

/** Create the project's seven readiness items if they are missing; returns key → item id. */
export async function ensureReadinessItems(env: Env, projectId: number): Promise<Map<string, number>> {
  for (const [i, item] of READINESS_ITEMS.entries()) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO readiness_items (project_id, item_key, label, position) VALUES (?, ?, ?, ?)`,
    ).bind(projectId, item.key, item.label, i).run();
  }
  const res = await env.DB.prepare('SELECT id, item_key FROM readiness_items WHERE project_id = ?')
    .bind(projectId).all<{ id: number; item_key: string }>();
  return new Map((res.results || []).map((r) => [r.item_key, Number(r.id)]));
}

/** A person's score for one readiness item. */
export async function scoreReadinessItem(env: Env, a: {
  projectId: number; userId: number; key: unknown; score: unknown; evidence: unknown; missing: unknown;
}): Promise<{ ok: true }> {
  const key = String(a.key ?? '');
  if (!READINESS_KEYS.includes(key)) throw new WriterError(400, 'Unknown readiness item');
  const score = Number(a.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new WriterError(400, 'The score is a whole number from 0 to 10');
  const evidence = String(a.evidence ?? '');
  if (!(EVIDENCE as readonly string[]).includes(evidence)) throw new WriterError(400, 'Evidence is anecdote, pattern or measured');
  const ids = await ensureReadinessItems(env, a.projectId);
  await env.DB.prepare(
    `INSERT INTO readiness_scores (item_id, project_id, score, evidence, missing, source, scored_by) VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
  ).bind(ids.get(key), a.projectId, score, evidence, trimOrNull(a.missing), a.userId).run();
  await logRaise(env, a.userId, a.projectId, 'fundraising-readiness', key, 'readiness_scored', `Scored ${score}/10 (${evidence})`);
  return { ok: true };
}

/** The six items a check scores; `team` is scored by a person. */
export const COMPUTED_KEYS: readonly string[] = READINESS_KEYS.filter((k) => k !== 'team');

/**
 * Run the computed readiness checks and store what each found (decision 8).
 * `items` is a subset of the six computed keys; with none, all six. `since`
 * is `'all'` (the default). `'last'`, which skips an item whose stores have
 * not changed since its newest score, reads the inputs #1699 exposes and
 * comes with #1700's closing PR; until then it is refused rather than
 * quietly treated as `'all'`.
 */
export async function rescoreReadiness(env: Env, a: { projectId: number; userId: number; items?: unknown; since?: unknown }): Promise<{ scored: number; items: string[] }> {
  let wanted: string[] = [...COMPUTED_KEYS];
  if (a.items !== undefined && a.items !== null) {
    if (!Array.isArray(a.items) || a.items.some((k) => typeof k !== 'string')) throw new WriterError(400, 'items is a list of readiness item keys');
    if (a.items.includes('team')) throw new WriterError(400, 'Team is scored by a person, not by a check');
    if (a.items.some((k) => !COMPUTED_KEYS.includes(k as string))) throw new WriterError(400, 'Unknown readiness item');
    if (a.items.length) wanted = COMPUTED_KEYS.filter((k) => (a.items as string[]).includes(k));
  }
  const since = a.since === undefined || a.since === null ? 'all' : a.since;
  if (since !== 'all' && since !== 'last') throw new WriterError(400, "since is 'last' or 'all'");
  if (since === 'last') throw new WriterError(501, 'Re-scoring only what changed since the last score is not built yet; send since: all');
  const ids = await ensureReadinessItems(env, a.projectId);
  const computed = (await computeReadiness(env, a.projectId)).filter((c) => wanted.includes(c.key));
  for (const c of computed) {
    await env.DB.prepare(
      `INSERT INTO readiness_scores (item_id, project_id, score, evidence, missing, source, scored_by) VALUES (?, ?, ?, ?, ?, 'computed', ?)`,
    ).bind(ids.get(c.key), a.projectId, c.score, c.evidence, c.missing, a.userId).run();
    await logRaise(env, a.userId, a.projectId, 'fundraising-readiness', c.key, 'readiness_rescored', `Re-scored by its check: ${c.score}/10`);
  }
  return { scored: computed.length, items: computed.map((c) => c.key) };
}

// ---------------------------------------------------------------------------
// Investor narrative (decision 7)
// ---------------------------------------------------------------------------

/** One-liner and The ask live in the version's own deck wording rows. */
const WORD_FIELDS = { one_liner: { key: 'cover.thesis', max: 500 }, ask: { key: 'ask.title', max: 300 } } as const;
export const START_FROM = ['live', 'version', 'blank'] as const;
/** Check against offers the deck and the metrics; the data room is not a check source. */
export const CHECK_SOURCES = ['deck', 'metrics'] as const;

type NarrativeFields = {
  investorType?: unknown; basedOnVersion?: unknown; oneLiner?: unknown; whyNow?: unknown; ask?: unknown; checkAgainst?: unknown;
};

/** A version number of this venture's, or a 404. */
async function ownVersion(env: Env, projectId: number, v: unknown, what: string): Promise<number> {
  const n = posInt(typeof v === 'string' && /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : v);
  const row = n == null ? null : await env.DB.prepare(
    'SELECT version FROM spinout_deck_overrides WHERE project_id = ? AND version = ? LIMIT 1',
  ).bind(projectId, n).first<{ version: number }>();
  if (!row) throw new WriterError(404, `${what} not found`);
  return Number(row.version);
}

function checkSources(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v) || !v.length || v.some((x) => !(CHECK_SOURCES as readonly unknown[]).includes(x))) {
    throw new WriterError(400, 'check_against is a list of deck and metrics');
  }
  return JSON.stringify(CHECK_SOURCES.filter((x) => v.includes(x)));
}

/** Set (or, with an empty value, clear) one wording row of a version. */
async function setWords(env: Env, a: { projectId: number; userId: number; version: number; investorType: string | null; deckVersion: number | null; fieldKey: string; value: string | null }) {
  await env.DB.prepare('DELETE FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key = ?')
    .bind(a.projectId, a.version, a.fieldKey).run();
  if (a.value == null) return;
  await env.DB.prepare(
    `INSERT INTO spinout_deck_overrides (project_id, field_key, value, updated_by, updated_at, version, investor_type, deck_version)
     VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
  ).bind(a.projectId, a.fieldKey, a.value, a.userId, a.version, a.investorType, a.deckVersion).run();
}

/** Run the consistency check on a version and store every mismatch, replacing the version's earlier ones. */
async function runCheck(env: Env, projectId: number, version: number): Promise<Mismatch[]> {
  const { stated, metrics } = await checkInputs(env, projectId, version);
  const mismatches = consistencyCheck(stated, metrics);
  await env.DB.prepare('DELETE FROM narrative_checks WHERE project_id = ? AND version = ?').bind(projectId, version).run();
  for (const m of mismatches) {
    await env.DB.prepare(
      `INSERT INTO narrative_checks (project_id, version, figure, stated_value, stated_source, metric_value, metric_source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(projectId, version, m.figure, m.stated_value, m.stated_source, m.metric_value, m.metric_source).run();
  }
  return mismatches;
}

/**
 * Save narrative version N for an investor type, with the deck version it
 * goes with. Start from is `live` (the default: the live deck wording,
 * version 0, as before), `version` (that version's rows; `based_on_version`
 * must be one of this venture's) or `blank` (nothing). One-liner and The ask
 * then set the version's own `cover.thesis` and `ask.title` rows, Why now and
 * Check against go in `narrative_version_meta`, and the consistency check
 * runs on the result. A body with only `investor_type` (#1652's caller)
 * saves as it always did.
 */
export async function saveNarrativeVersion(env: Env, a: { projectId: number; userId: number; startFrom?: unknown } & NarrativeFields): Promise<{ version: number; mismatches: Mismatch[] }> {
  const investorType = String(a.investorType ?? '');
  if (!(INVESTOR_TYPES as readonly string[]).includes(investorType)) throw new WriterError(400, 'Unknown investor type');
  const startFrom = a.startFrom === undefined || a.startFrom === null ? 'live' : String(a.startFrom);
  if (!(START_FROM as readonly string[]).includes(startFrom)) throw new WriterError(400, 'start_from is live, version or blank');
  await ensureSpinoutDeckOverridesSchema(env);
  let basedOn: number | null = null;
  if (startFrom === 'version') basedOn = await ownVersion(env, a.projectId, a.basedOnVersion, 'The version to start from');
  else if (a.basedOnVersion != null) throw new WriterError(400, 'based_on_version goes with start_from: version');
  const checkAgainst = checkSources(a.checkAgainst);
  const whyNow = a.whyNow === undefined ? null : trimOrNull(a.whyNow, 2000);
  const max = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM spinout_deck_overrides WHERE project_id = ?')
    .bind(a.projectId).first<{ v: number }>();
  const version = Number(max?.v ?? 0) + 1;
  const deck = await env.DB.prepare(
    'SELECT version FROM pitch_decks WHERE project_id = ? ORDER BY COALESCE(is_current, 0) DESC, version DESC, id DESC LIMIT 1',
  ).bind(a.projectId).first<{ version: number }>();
  const deckVersion = deck ? Number(deck.version) : null;
  if (startFrom !== 'blank') {
    await env.DB.prepare(
      `INSERT INTO spinout_deck_overrides (project_id, field_key, value, updated_by, updated_at, version, investor_type, deck_version)
       SELECT project_id, field_key, value, ?, datetime('now'), ?, ?, ? FROM spinout_deck_overrides
        WHERE project_id = ? AND version = ? AND field_key != ?`,
    ).bind(a.userId, version, investorType, deckVersion, a.projectId, startFrom === 'version' ? basedOn : 0, VERSION_MARKER_KEY).run();
  }
  // The marker row: a version saved before any wording was overridden still exists.
  await env.DB.prepare(
    `INSERT INTO spinout_deck_overrides (project_id, field_key, value, updated_by, updated_at, version, investor_type, deck_version)
     VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
  ).bind(a.projectId, VERSION_MARKER_KEY, investorType, a.userId, version, investorType, deckVersion).run();
  for (const [field, spec] of Object.entries(WORD_FIELDS)) {
    const v = field === 'one_liner' ? a.oneLiner : a.ask;
    if (v === undefined) continue;
    await setWords(env, { projectId: a.projectId, userId: a.userId, version, investorType, deckVersion, fieldKey: spec.key, value: trimOrNull(v, spec.max) });
  }
  await env.DB.prepare(
    `INSERT INTO narrative_version_meta (project_id, version, start_from, based_on_version, why_now, check_against_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(a.projectId, version, startFrom, basedOn, whyNow, checkAgainst ?? null, a.userId).run();
  const mismatches = await runCheck(env, a.projectId, version);
  const label = INVESTOR_TYPE_LABEL[investorType] ?? investorType;
  await logRaise(env, a.userId, a.projectId, 'investor-narrative', version, 'narrative_version_created',
    `Version ${version} saved for ${label}; ${mismatches.length} ${mismatches.length === 1 ? 'mismatch' : 'mismatches'}`);
  return { version, mismatches };
}

/**
 * Edit a saved version: the same fields as New version but Start from. The
 * words change in that version's rows, Why now, Based on and Check against in
 * its meta, and the check runs again. A version saved before 463 gets its
 * meta row on its first edit, as `live`: every earlier version copied the
 * live wording.
 */
export async function updateNarrativeVersion(env: Env, a: { projectId: number; userId: number; version: unknown } & NarrativeFields): Promise<{ version: number; mismatches: Mismatch[] }> {
  await ensureSpinoutDeckOverridesSchema(env);
  const version = await ownVersion(env, a.projectId, a.version, 'Version');
  if (version < 1) throw new WriterError(404, 'Version not found');
  const marker = await env.DB.prepare(
    'SELECT investor_type, deck_version FROM spinout_deck_overrides WHERE project_id = ? AND version = ? ORDER BY field_key = ? DESC LIMIT 1',
  ).bind(a.projectId, version, VERSION_MARKER_KEY).first<{ investor_type: string | null; deck_version: number | null }>();
  let investorType = marker?.investor_type ?? null;
  const changed: string[] = [];
  if (a.investorType !== undefined) {
    const t = String(a.investorType ?? '');
    if (!(INVESTOR_TYPES as readonly string[]).includes(t)) throw new WriterError(400, 'Unknown investor type');
    investorType = t;
  }
  let basedOn: number | null | undefined;
  if (a.basedOnVersion !== undefined) {
    basedOn = a.basedOnVersion === null ? null : await ownVersion(env, a.projectId, a.basedOnVersion, 'The version to start from');
    if (basedOn != null && basedOn >= version) throw new WriterError(400, 'A version is based on an earlier one');
  }
  const checkAgainst = checkSources(a.checkAgainst);
  const whyNow = a.whyNow === undefined ? undefined : trimOrNull(a.whyNow, 2000);
  if ([a.investorType, a.basedOnVersion, a.oneLiner, a.whyNow, a.ask, a.checkAgainst].every((v) => v === undefined)) {
    throw new WriterError(400, 'Nothing to change');
  }

  if (a.investorType !== undefined) {
    await env.DB.prepare('UPDATE spinout_deck_overrides SET investor_type = ? WHERE project_id = ? AND version = ?')
      .bind(investorType, a.projectId, version).run();
    await env.DB.prepare('UPDATE spinout_deck_overrides SET value = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE project_id = ? AND version = ? AND field_key = ?')
      .bind(investorType, a.userId, a.projectId, version, VERSION_MARKER_KEY).run();
    changed.push('investor type');
  }
  for (const [field, spec] of Object.entries(WORD_FIELDS)) {
    const v = field === 'one_liner' ? a.oneLiner : a.ask;
    if (v === undefined) continue;
    await setWords(env, { projectId: a.projectId, userId: a.userId, version, investorType, deckVersion: marker?.deck_version ?? null, fieldKey: spec.key, value: trimOrNull(v, spec.max) });
    changed.push(field === 'one_liner' ? 'one-liner' : 'the ask');
  }
  if (basedOn !== undefined || whyNow !== undefined || checkAgainst !== undefined) {
    await env.DB.prepare(
      `INSERT INTO narrative_version_meta (project_id, version, start_from, created_by) VALUES (?, ?, 'live', ?)
       ON CONFLICT (project_id, version) DO NOTHING`,
    ).bind(a.projectId, version, a.userId).run();
    const sets: string[] = []; const params: unknown[] = [];
    if (basedOn !== undefined) { sets.push('based_on_version = ?'); params.push(basedOn); changed.push('based on'); }
    if (whyNow !== undefined) { sets.push('why_now = ?'); params.push(whyNow); changed.push('why now'); }
    if (checkAgainst !== undefined) { sets.push('check_against_json = ?'); params.push(checkAgainst); changed.push('check against'); }
    await env.DB.prepare(`UPDATE narrative_version_meta SET ${sets.join(', ')}, updated_at = datetime('now') WHERE project_id = ? AND version = ?`)
      .bind(...params, a.projectId, version).run();
  }
  const mismatches = await runCheck(env, a.projectId, version);
  await logRaise(env, a.userId, a.projectId, 'investor-narrative', version, 'narrative_version_updated',
    `Version ${version} edited: ${changed.join(', ')}; ${mismatches.length} ${mismatches.length === 1 ? 'mismatch' : 'mismatches'}`);
  return { version, mismatches };
}

// ---------------------------------------------------------------------------
// Pitch deck links (decision 5)
// ---------------------------------------------------------------------------

export const LINK_EXPIRY_DAYS = [7, 14, 30] as const;

/** `expires_days`: 7, 14 or 30, or null for Never. */
function expiryDays(v: unknown): number | null {
  if (v === null) return null;
  if (!(LINK_EXPIRY_DAYS as readonly unknown[]).includes(v)) throw new WriterError(400, 'expires_days is 7, 14, 30 or null (Never)');
  return v as number;
}

function flag(v: unknown, name: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new WriterError(400, `${name} is true or false`);
  return v;
}

/** A prospect of this venture's, or a 404 (until `ownedRow` lands, S1's ruling). */
async function ownProspect(env: Env, projectId: number, v: unknown): Promise<number> {
  const id = posInt(v);
  const row = id == null ? null : await env.DB.prepare('SELECT id FROM raise_prospects WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ id: number }>();
  if (!row) throw new WriterError(404, 'Prospect not found');
  return Number(row.id);
}

/** The investor a link is for: a prospect of this venture, or a name typed in. Never both. */
async function linkInvestor(env: Env, projectId: number, b: Record<string, unknown>): Promise<{ prospectId: number | null; label: string | null } | undefined> {
  const hasP = b.prospect_id != null, hasL = b.investor_label != null && String(b.investor_label).trim() !== '';
  if (!hasP && !hasL) return undefined;
  if (hasP && hasL) throw new WriterError(400, 'Name the investor once: a prospect or a name, not both');
  if (hasP) return { prospectId: await ownProspect(env, projectId, b.prospect_id), label: null };
  return { prospectId: null, label: String(b.investor_label).trim().slice(0, 200) };
}

/**
 * New link: one token for one of this venture's decks, through
 * `createShareLink()`, which logs it. The raw link is returned here once and
 * never read back. The plan gate is the share route's (decision 13).
 */
export async function createDeckLink(env: Env, a: { projectId: number; user: User; body: Record<string, unknown> }) {
  ensureTier(a.user, 'studio');
  const b = a.body;
  const deckId = posInt(b.deck_id);
  const deck = deckId == null ? null : await env.DB.prepare('SELECT id, version FROM pitch_decks WHERE id = ? AND project_id = ?')
    .bind(deckId, a.projectId).first<{ id: number; version: number }>();
  if (!deck) throw new WriterError(404, 'Deck not found');
  const investor = await linkInvestor(env, a.projectId, b);
  if (!investor) throw new WriterError(400, 'Name the investor: a prospect or a name');
  if (!has(b, 'expires_days')) throw new WriterError(400, 'expires_days is 7, 14, 30 or null (Never)');
  const days = expiryDays(b.expires_days);
  const allowDownload = flag(b.allow_download, 'allow_download') ?? true;
  const allowForwarding = flag(b.allow_forwarding, 'allow_forwarding') ?? true;
  const link = await createShareLink(env, {
    deckId: deck.id, deckVersion: Number(deck.version), userId: Number(a.user.id) || null, actorEmail: a.user.email || null,
    ttlSeconds: days == null ? null : days * 86400, prospectId: investor.prospectId, investorLabel: investor.label,
    allowDownload, allowForwarding, projectId: a.projectId,
  });
  if (link.id == null) throw new WriterError(500, 'The link was made but its id was not reported');
  return {
    id: link.id, share_path: `/share/deck/${link.token}`, expires_at: link.expiresAt,
    allow_download: allowDownload, allow_forwarding: allowForwarding,
  };
}

const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Edit a link: its investor, its two settings, and an earlier expiry. An
 * edit can bring the expiry forward, never extend it, so Never is accepted
 * only on a link that never expires already.
 */
export async function updateDeckLink(env: Env, a: { projectId: number; user: User; linkId: unknown; body: Record<string, unknown> }) {
  ensureTier(a.user, 'studio');
  const id = posInt(typeof a.linkId === 'string' && /^[1-9][0-9]{0,9}$/.test(a.linkId) ? Number(a.linkId) : a.linkId);
  const row = id == null ? null : await env.DB.prepare(
    `SELECT t.id, t.expires_at FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
      WHERE t.id = ? AND d.project_id = ?`,
  ).bind(id, a.projectId).first<{ id: number; expires_at: string }>();
  if (!row) throw new WriterError(404, 'Link not found');
  const b = a.body;
  const sets: string[] = []; const params: unknown[] = []; const changed: string[] = [];
  const investor = await linkInvestor(env, a.projectId, b);
  if (investor) {
    sets.push('prospect_id = ?', 'investor_label = ?'); params.push(investor.prospectId, investor.label); changed.push('investor');
  }
  for (const [key, col] of [['allow_download', 'download'], ['allow_forwarding', 'forwarding']] as const) {
    const v = flag(b[key], key);
    if (v === undefined) continue;
    sets.push(`${key} = ?`); params.push(v ? 1 : 0); changed.push(`${col} ${v ? 'on' : 'off'}`);
  }
  if (has(b, 'expires_days')) {
    const days = expiryDays(b.expires_days);
    const next = days == null ? SHARE_NEVER_EXPIRES : sqlTime(Date.now() + days * 86400_000);
    if (next > String(row.expires_at)) throw new WriterError(400, 'An edit can bring the expiry forward, never extend it');
    sets.push('expires_at = ?'); params.push(next); changed.push('expiry');
  }
  if (!sets.length) throw new WriterError(400, 'Nothing to change');
  await env.DB.prepare(`UPDATE pitch_deck_share_tokens SET ${sets.join(', ')} WHERE id = ?`).bind(...params, row.id).run();
  await logRaise(env, Number(a.user.id), a.projectId, 'pitch-deck', row.id, 'deck_link_updated', `Link edited: ${changed.join(', ')}`);
  return { ok: true as const, id: row.id };
}

// ---------------------------------------------------------------------------
// Cap table (decision 4)
// ---------------------------------------------------------------------------

const GROUP_IN: Record<string, string> = { founders: 'founders', investors: 'investors', option_pool: 'option_pool', advisors: 'advisors' };
const INSTRUMENT_IN: Record<string, string> = { common: 'common', safe: 'safe', note: 'note', convertible_note: 'note', options: 'options', preferred: 'preferred' };
const GROUP_TEXT: Record<string, string> = { founders: 'Founders', investors: 'Investors' };
const INSTRUMENT_TEXT: Record<string, string> = { common: 'Common', safe: 'SAFE', note: 'Convertible note' };
const word = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** A refusal from the shared cap-table writes, in this file's shape. */
function holderFailed(e: unknown): never {
  if (e instanceof HolderError) throw new WriterError(e.status, e.sentence);
  throw e;
}

/** The fields `addHolder()` / `updateHolder()` take, from a form body; what a body leaves out stays undefined. */
function holderFields(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'email', 'shares', 'ownership_pct', 'amount_cents', 'cap_cents', 'discount_pct', 'founder_role', 'vesting', 'prospect_id']) {
    if (has(b, k)) out[k] = b[k];
  }
  return out;
}

/**
 * Add holder: Founders · Common, or Investors · SAFE or Convertible note,
 * through `addHolder()`, which keeps the tool's plan gate (its 402 is thrown
 * as a Response) and refuses every other pair with 400.
 */
export async function addCapHolder(env: Env, a: { projectId: number; user: User; body: Record<string, unknown> }) {
  const group = GROUP_IN[word(a.body.group)] ?? word(a.body.group);
  const instrument = INSTRUMENT_IN[word(a.body.instrument)] ?? word(a.body.instrument);
  let out: { id: string };
  try {
    out = await addHolder(env, {
      ...holderFields(a.body), projectId: a.projectId, actor: a.user,
      group: group as AddHolderArgs['group'], instrument: instrument as AddHolderArgs['instrument'],
    } as AddHolderArgs);
  } catch (e) { holderFailed(e); }
  await logRaise(env, Number(a.user.id), a.projectId, 'cap-table', out.id, 'holder_created',
    `Holder added: ${GROUP_TEXT[group]} · ${INSTRUMENT_TEXT[instrument]}`);
  return out;
}

/** Edit holder, on an `h-` or `e-` id, through `updateHolder()`. */
export async function updateCapHolder(env: Env, a: { projectId: number; user: User; id: string; body: Record<string, unknown> }) {
  const fields = holderFields(a.body);
  if (!Object.keys(fields).length) throw new WriterError(400, 'Nothing to change');
  let out: { id: string };
  try {
    out = await updateHolder(env, { ...fields, projectId: a.projectId, actor: a.user, id: a.id } as any);
  } catch (e) { holderFailed(e); }
  await logRaise(env, Number(a.user.id), a.projectId, 'cap-table', out.id, 'holder_updated',
    `Holder edited: ${Object.keys(fields).map((k) => k.replace(/_/g, ' ')).join(', ')}`);
  return out;
}

// ---------------------------------------------------------------------------
// Use of funds (decision 9)
// ---------------------------------------------------------------------------

const MILESTONE_BY = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;

/**
 * Edit split: the five stored sections in `projects.use_of_funds` (through
 * `normalizeUseOfFunds`, so they total 100), the raise in `funding_needed`
 * (that column's dollars), and runway and each section's milestone merged
 * into `use_of_funds_meta`, every other key kept. A change marks the deck's
 * use-of-funds slide out of sync, as the Lab page does: the deck reads the
 * split, and nothing is written to a deck.
 */
export async function saveUseOfFunds(env: Env, a: { projectId: number; userId: number; body: Record<string, unknown> }) {
  const b = a.body;
  if (!Array.isArray(b.sections) || !b.sections.length) throw new WriterError(400, 'sections is a list of { key, pct }');
  const seen = new Set<string>();
  const sections = b.sections.map((x: any) => {
    const s = FUND_SECTIONS.find((f) => f.key === x?.key);
    if (!s) throw new WriterError(400, 'Unknown use-of-funds section');
    if (seen.has(s.key)) throw new WriterError(400, 'Each section appears once');
    seen.add(s.key);
    const pct = x?.pct;
    if (typeof pct !== 'number' || !Number.isInteger(pct) || pct < 0 || pct > 100) throw new WriterError(400, 'Each share is a whole number from 0 to 100');
    const label = x && has(x, 'milestone_label') ? trimOrNull(x.milestone_label, 200) : undefined;
    const by = x && has(x, 'milestone_by') && x.milestone_by != null && x.milestone_by !== '' ? String(x.milestone_by).trim() : null;
    if (by != null && !MILESTONE_BY.test(by)) throw new WriterError(400, 'milestone_by is YYYY-MM or YYYY-MM-DD');
    return { key: s.key, label: s.label, pct, milestone: label === undefined ? undefined : label == null ? null : { label, by } };
  });
  const uof = normalizeUseOfFunds(JSON.stringify(FUND_SECTIONS
    .map((f) => sections.find((s) => s.key === f.key))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ label: s.label, pct: s.pct }))));
  if (uof.error) throw new WriterError(400, uof.error);
  if (uof.value == null) throw new WriterError(400, 'Use of Funds must total exactly 100%.');

  let amount: number | null | undefined;
  if (has(b, 'amount_to_raise_cents')) {
    amount = b.amount_to_raise_cents === null ? null : posInt(b.amount_to_raise_cents);
    if (b.amount_to_raise_cents !== null && amount == null) throw new WriterError(400, 'amount_to_raise_cents is a positive whole number of cents');
  }
  let runway: number | null | undefined;
  if (has(b, 'runway_months')) {
    runway = b.runway_months === null ? null : posInt(b.runway_months);
    if (b.runway_months !== null && (runway == null || runway > 120)) throw new WriterError(400, 'runway_months is a whole number from 1 to 120');
  }

  const { normalizeUofMeta, ensureProjectUofMetaColumn } = await import('../routes/projects');
  await ensureProjectUofMetaColumn(env);
  const p = await env.DB.prepare('SELECT use_of_funds_meta FROM projects WHERE id = ?').bind(a.projectId).first<{ use_of_funds_meta: string | null }>();
  let meta: Record<string, any> = {};
  if (p?.use_of_funds_meta) {
    try { meta = JSON.parse(p.use_of_funds_meta); } catch { meta = null as any; }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new WriterError(409, 'The stored use-of-funds plan could not be read, so it was not overwritten');
  }
  if (runway !== undefined) { if (runway == null) delete meta.runway_months; else meta.runway_months = runway; }
  const milestones: Record<string, unknown> = meta.milestones && typeof meta.milestones === 'object' && !Array.isArray(meta.milestones) ? { ...meta.milestones } : {};
  for (const s of sections) {
    if (s.milestone === undefined) continue;
    if (s.milestone == null) delete milestones[s.key]; else milestones[s.key] = s.milestone;
  }
  meta.milestones = milestones;
  meta.deck_synced_at = null;
  const norm = normalizeUofMeta(meta);
  if (norm.error) throw new WriterError(400, norm.error);

  const sets = ['use_of_funds = ?', 'use_of_funds_meta = ?']; const params: unknown[] = [uof.value, norm.value ?? null];
  if (amount !== undefined) { sets.push('funding_needed = ?'); params.push(amount == null ? null : amount / 100); }
  await env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...params, a.projectId).run();
  for (const s of sections) {
    await logRaise(env, a.userId, a.projectId, 'use-of-funds', s.key, 'split_saved', `Split saved: ${s.pct}% of the raise`);
  }
  return { ok: true as const, use_of_funds: JSON.parse(uof.value), runway_months: meta.runway_months ?? null };
}

// ---------------------------------------------------------------------------
// Capital relationships (decision 10)
// ---------------------------------------------------------------------------

/** Identified is stored `to_contact`; every other stage under its own name. */
function stageIn(v: unknown): string {
  const s = word(v);
  const stored = s === 'identified' ? 'to_contact' : s;
  if (!RAISE_STAGES.includes(stored)) throw new WriterError(400, 'stage is Identified, Contacted, Meeting, Diligence, Committed or Passed');
  return stored;
}

const STAGE_TEXT: Record<string, string> = { to_contact: 'Identified', contacted: 'Contacted', meeting: 'Meeting', diligence: 'Diligence', committed: 'Committed', passed: 'Passed' };

/** A fund from the Research directory, read only through SERVED_FUNDS (D597), or a 404. */
async function servedFund(env: Env, v: unknown): Promise<{ uid: string; name: string }> {
  const uid = typeof v === 'string' ? v.trim() : '';
  const row = !uid || uid.length > 120 ? null : await env.DB.prepare(`SELECT f.uid, f.name FROM ${SERVED_FUNDS} AS f WHERE f.uid = ?`)
    .bind(uid).first<{ uid: string; name: string }>();
  if (!row) throw new WriterError(404, 'Fund not found');
  return row;
}

function dueOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = isoDateOrNull(v);
  if (d == null) throw new WriterError(400, 'The due date is YYYY-MM-DD');
  return d;
}

/** The cycle's own fields on a prospect: what `createProspect` does not take. */
function cycleFields(b: Record<string, unknown>) {
  const sets: string[] = []; const params: unknown[] = [];
  if (has(b, 'warm_path')) { sets.push('warm_path = ?'); params.push(trimOrNull(b.warm_path, 300)); }
  if (has(b, 'next_step')) { sets.push('next_step = ?'); params.push(trimOrNull(b.next_step, 300)); }
  if (has(b, 'next_step_due')) { sets.push('next_step_due = ?'); params.push(dueOrNull(b.next_step_due)); }
  return { sets, params };
}

/**
 * Add investor: `createProspect` (the pipeline's own create, which links the
 * Contacts hub and answers a duplicate email with 409), then the cycle's
 * fields. A fund from the directory names the prospect and its firm.
 */
export async function addProspect(env: Env, a: { projectId: number; userId: number; body: Record<string, unknown> }) {
  const b = a.body;
  const stage = b.stage === undefined || b.stage === null || b.stage === '' ? 'to_contact' : stageIn(b.stage);
  const fund = b.research_fund_uid != null && b.research_fund_uid !== '' ? await servedFund(env, b.research_fund_uid) : null;
  const name = fund ? fund.name : trimOrNull(b.name, 200);
  if (!name) throw new WriterError(400, 'Name the investor, or pick a fund');
  const extra = cycleFields(b);
  const out = await createProspect(env, a.projectId, { name, email: b.email, firm: fund ? fund.name : b.firm, stage, notes: b.notes });
  if (out === 'invalid') throw new WriterError(400, 'A name or a valid email is required');
  if (out === 'duplicate') throw new WriterError(409, 'This project already tracks a prospect with that email');
  const id = Number(out.prospect.id);
  if (fund) { extra.sets.push('research_fund_uid = ?'); extra.params.push(fund.uid); }
  if (extra.sets.length) {
    await env.DB.prepare(`UPDATE raise_prospects SET ${extra.sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
      .bind(...extra.params, id, a.projectId).run();
  }
  await logRaise(env, a.userId, a.projectId, 'capital-relationships', id, 'prospect_created', `Investor added at ${STAGE_TEXT[stage]}`);
  return { id };
}

/** Edit investor: the same fields, each changed only when the body names it. */
export async function updateProspect(env: Env, a: { projectId: number; userId: number; prospectId: number; body: Record<string, unknown> }) {
  const b = a.body;
  const id = await ownProspect(env, a.projectId, a.prospectId);
  const { sets, params } = cycleFields(b);
  const changed: string[] = [];
  if (sets.length) changed.push('next step');
  if (has(b, 'research_fund_uid') && b.research_fund_uid != null && b.research_fund_uid !== '') {
    const fund = await servedFund(env, b.research_fund_uid);
    sets.push('research_fund_uid = ?', 'name = ?', 'firm = ?'); params.push(fund.uid, fund.name, fund.name); changed.push('fund');
  } else if (has(b, 'research_fund_uid')) {
    sets.push('research_fund_uid = ?'); params.push(null); changed.push('fund');
  }
  if (has(b, 'name') && !changed.includes('fund')) {
    const name = trimOrNull(b.name, 200);
    if (!name) throw new WriterError(400, 'Name the investor, or pick a fund');
    sets.push('name = ?'); params.push(name); changed.push('name');
  }
  if (has(b, 'stage')) { sets.push('stage = ?'); params.push(stageIn(b.stage)); changed.push('stage'); }
  if (has(b, 'notes')) { sets.push('notes = ?'); params.push(b.notes == null || b.notes === '' ? null : String(b.notes).slice(0, 4000)); changed.push('notes'); }
  if (has(b, 'email')) {
    const email = b.email == null || b.email === '' ? null : String(b.email).trim().toLowerCase();
    if (email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WriterError(400, 'A valid email is required');
    if (email != null) {
      const dup = await env.DB.prepare('SELECT id FROM raise_prospects WHERE project_id = ? AND email = ? AND id != ?')
        .bind(a.projectId, email, id).first();
      if (dup) throw new WriterError(409, 'This project already tracks a prospect with that email');
    }
    sets.push('email = ?'); params.push(email); changed.push('email');
  }
  if (!sets.length) throw new WriterError(400, 'Nothing to change');
  await env.DB.prepare(`UPDATE raise_prospects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
    .bind(...params, id, a.projectId).run();
  await logRaise(env, a.userId, a.projectId, 'capital-relationships', id, 'prospect_updated', `Investor edited: ${changed.join(', ')}`);
  return { ok: true as const, id };
}

// ---------------------------------------------------------------------------
// The two writes migration 442 added, kept
// ---------------------------------------------------------------------------

/** Which diligence-checklist item a data-room file answers; null clears it. */
export async function setFileChecklistItem(env: Env, a: { projectId: number; userId: number; fileId: number; item: unknown }): Promise<{ ok: true }> {
  const item = a.item == null || a.item === '' ? null : String(a.item);
  if (item != null && !CHECKLIST_KEYS.has(item)) throw new WriterError(400, 'Unknown checklist item');
  const r = await env.DB.prepare(
    `UPDATE data_room_files SET checklist_item = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
  ).bind(item, a.fileId, a.projectId).run();
  if (!Number(r?.meta?.changes ?? 0)) throw new WriterError(404, 'File not found');
  await logRaise(env, a.userId, a.projectId, 'data-room', a.fileId, 'checklist_set', item ? `Answers checklist item ${item}` : 'Checklist item cleared');
  return { ok: true };
}

/** A prospect's next step, when it is due, and its warm path. Each may be cleared with an empty value. */
export async function setProspectNextStep(env: Env, a: {
  projectId: number; userId: number; prospectId: number; next_step: unknown; next_step_due: unknown; warm_path: unknown;
}): Promise<{ ok: true }> {
  const due = a.next_step_due == null || a.next_step_due === '' ? null : isoDateOrNull(a.next_step_due);
  if (a.next_step_due != null && a.next_step_due !== '' && due == null) throw new WriterError(400, 'The due date is YYYY-MM-DD');
  const r = await env.DB.prepare(
    `UPDATE raise_prospects SET next_step = ?, next_step_due = ?, warm_path = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
  ).bind(trimOrNull(a.next_step, 300), due, trimOrNull(a.warm_path, 300), a.prospectId, a.projectId).run();
  if (!Number(r?.meta?.changes ?? 0)) throw new WriterError(404, 'Prospect not found');
  await logRaise(env, a.userId, a.projectId, 'capital-relationships', a.prospectId, 'next_step_set', 'Next step set');
  return { ok: true };
}
