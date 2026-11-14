/**
 * D1259 (#3282, part 6 of #2428) — publishing a venture model version, and
 * the recompute it starts (migration 627).
 *
 * A version is code (`model.ts` `VENTURE_MODELS`). Publishing records that a
 * Super Admin made it live; the route asks for the authenticator code first
 * (`requireSuperAdminWriteBar`). Only a version newer than the live one can
 * be published: a published version is never published again, and the live
 * model never moves back.
 *
 * EVERY VENTURE RECOMPUTES, AND OLD ROWS STAY. The every-minute job takes the
 * next batch of ventures by id (`cursor_project_id`) and rescores each with
 * the live model. Each scope whose result rests on the new model writes a new
 * row (the hash names the model version); the rows earlier versions wrote are
 * never touched, so a venture's history keeps them. A batch is claimed by
 * moving the cursor before it is scored, so two runs never score one batch
 * twice. A venture that fails is counted, never retried in the same pass, and
 * never named in a log.
 *
 * No score sets a deal or venture status, and nothing here is advice.
 */
import type { Env } from '../../types';
import { DEFAULT_MODEL_VERSION, VENTURE_MODELS, modelFor, type ModelInput, type ScopeKey, type VentureModel, SCORED_SCOPES } from './model';
import { liveModel, scoreVenture } from './store';

/** Ventures rescored a minute. A batch of 25 keeps one run well inside a Worker's limits. */
export const BATCH = 25;

/** A refusal with its code and our own sentence (`sentence`), never a provider's text. */
export class PublishRefused extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

const rank = (version: string) => VENTURE_MODELS.findIndex((m) => m.version === version);

type Publication = {
  id: number; version: string; published_by: number; published_at: string; ventures_total: number; ventures_done: number;
  ventures_failed: number; cursor_project_id: number; finished_at: string | null;
};

/** Makes `version` live and opens its recompute. Returns the publication. */
export async function publishModel(env: Env, version: string, actorId: number) {
  const model = modelFor(version);
  if (!model) throw new PublishRefused(404, 'model_unknown', 'No model version has that number.');
  const live = await liveModel(env);
  if (rank(version) <= rank(live.version)) {
    throw new PublishRefused(409, 'model_not_newer', `Model v${version} is not newer than the live v${live.version}. A published version is never published again.`);
  }
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>();
  const at = new Date().toISOString();
  // The UNIQUE version and the NOT EXISTS make two Publish presses one publication.
  const res = await env.DB.prepare(`INSERT INTO venture_model_publications (version, published_by, published_at, ventures_total)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM venture_model_publications WHERE version = ?)`)
    .bind(version, actorId, at, Number(total?.n ?? 0), version).run();
  if (!res.meta?.changes) throw new PublishRefused(409, 'model_not_newer', `Model v${version} is already published.`);
  return { version, published_at: at, ventures_total: Number(total?.n ?? 0) };
}

/**
 * One batch of the open publication's recompute. Called every minute; does
 * nothing when no publication is open. `today` is the scoring day.
 */
export async function continuePublication(env: Env, today: string, limit: number = BATCH) {
  const open = await env.DB.prepare(`SELECT * FROM venture_model_publications WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1`).first<Publication>();
  if (!open) return { open: false as const, scored: 0, failed: 0 };
  const live = await liveModel(env);
  if (live.version !== open.version) {
    // A newer publication superseded this one before it finished; its own recompute covers every venture.
    await env.DB.prepare('UPDATE venture_model_publications SET finished_at = ? WHERE id = ? AND finished_at IS NULL').bind(new Date().toISOString(), open.id).run();
    return { open: false as const, scored: 0, failed: 0 };
  }
  const ids = ((await env.DB.prepare('SELECT id FROM projects WHERE id > ? ORDER BY id LIMIT ?').bind(open.cursor_project_id, limit).all<{ id: number }>()).results || [])
    .map((r) => Number(r.id));
  if (!ids.length) {
    await env.DB.prepare('UPDATE venture_model_publications SET finished_at = ? WHERE id = ? AND finished_at IS NULL').bind(new Date().toISOString(), open.id).run();
    return { open: false as const, scored: 0, failed: 0 };
  }
  // Claim the batch: only the run that moves the cursor scores it.
  const claim = await env.DB.prepare('UPDATE venture_model_publications SET cursor_project_id = ? WHERE id = ? AND cursor_project_id = ?')
    .bind(ids[ids.length - 1], open.id, open.cursor_project_id).run();
  if (!claim.meta?.changes) return { open: true as const, scored: 0, failed: 0 };
  let scored = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await scoreVenture(env, id, { actorId: open.published_by, trigger: 'publish', today });
      scored += 1;
    } catch {
      failed += 1;
    }
  }
  await env.DB.prepare('UPDATE venture_model_publications SET ventures_done = ventures_done + ?, ventures_failed = ventures_failed + ? WHERE id = ?')
    .bind(scored, failed, open.id).run();
  if (failed) console.warn(`[ventureScoring] publish batch version=${open.version} scored=${scored} failed=${failed}`);
  return { open: true as const, scored, failed };
}

type Change = { scope: ScopeKey; scope_label: string; input: string; from: Pick<ModelInput, 'weight' | 'source' | 'freshness'> | null; to: Pick<ModelInput, 'weight' | 'source' | 'freshness'> | null; reads: string };

/** What `to` changes against `from`: each input whose weight, store or window differs, or that one of them lacks. */
export function modelChanges(from: VentureModel, to: VentureModel): Change[] {
  const out: Change[] = [];
  const pick = (i: ModelInput | undefined) => (i ? { weight: i.weight, source: i.source, freshness: i.freshness } : null);
  for (const scope of SCORED_SCOPES) {
    const a = from.scopes[scope].inputs;
    const b = to.scopes[scope].inputs;
    for (const key of [...new Set([...a.map((i) => i.key), ...b.map((i) => i.key)])]) {
      const x = a.find((i) => i.key === key);
      const y = b.find((i) => i.key === key);
      if (x && y && x.weight === y.weight && x.source === y.source && x.freshness === y.freshness) continue;
      out.push({ scope, scope_label: to.scopes[scope].label, input: (y ?? x)!.label, from: pick(x), to: pick(y), reads: (y ?? x)!.reads });
    }
  }
  return out;
}

/** HQ › Scoring's model card: each version, its state, who published it, the ventures it scored, and the next draft's changes. */
export async function modelVersions(env: Env) {
  const live = await liveModel(env);
  const pubs = (await env.DB.prepare(`SELECT p.*, u.name AS published_by_name FROM venture_model_publications p
      LEFT JOIN users u ON u.id = p.published_by ORDER BY p.id`).all<Publication & { published_by_name: string | null }>()).results || [];
  const counts = (await env.DB.prepare(`SELECT model_version, COUNT(DISTINCT project_id) AS n FROM venture_scorecards
      WHERE scope <> 'pmf' GROUP BY model_version`).all<{ model_version: string; n: number }>()).results || [];
  const liveRank = rank(live.version);
  const versions = VENTURE_MODELS.map((m, i) => {
    const pub = pubs.find((p) => p.version === m.version) ?? null;
    const state = m.version === live.version ? 'live' : i < liveRank ? 'retired' : 'draft';
    return {
      version: m.version, state,
      // v1 scored before any publication was recorded: it is live by default, with no publisher.
      default_live: !pub && m.version === DEFAULT_MODEL_VERSION && state === 'live',
      published_at: pub?.published_at ?? null, published_by: pub ? (pub.published_by_name ?? 'Not recorded') : null,
      ventures_scored: Number(counts.find((c) => c.model_version === m.version)?.n ?? 0),
      recompute: pub ? { total: pub.ventures_total, done: pub.ventures_done, failed: pub.ventures_failed, finished_at: pub.finished_at } : null,
    };
  }).reverse();
  const draft = VENTURE_MODELS.find((m, i) => i > liveRank) ?? null;
  const ventures = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>();
  return {
    live: live.version,
    draft: draft ? { version: draft.version, changes: modelChanges(live, draft), ventures: Number(ventures?.n ?? 0), minutes: Math.max(1, Math.ceil(Number(ventures?.n ?? 0) / BATCH)) } : null,
    versions,
  };
}
