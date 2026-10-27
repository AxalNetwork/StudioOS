/**
 * D1259 (#3282, part 6 of #2428) — HQ › Scoring's reads and writes: model
 * versions and Publish, and the country index import. Mounted at
 * `/api/venture-scores` beside part 3's `venture_scores.ts` (#3279), with
 * paths that cannot meet its `/:projectId` routes:
 *
 *   GET  /api/venture-scores/hq/models                 HQ admin   versions, the live one, the draft's changes
 *   POST /api/venture-scores/models/:version/publish   Super Admin, authenticator code
 *   GET  /api/venture-scores/hq/indices                HQ admin   every source, its licence and editions
 *   POST /api/venture-scores/hq/indices/:source/import Super Admin, authenticator code
 *
 * HQ only: a branch is refused by the gates. A publication recomputes every
 * venture in the every-minute job (`services/ventureScoring/publish.ts`). An
 * index import is refused for a source whose licence is not recorded
 * (`services/ventureScoring/countryIndex.ts`). Every write is audited with
 * its version or source and counts only. Each refusal is a code and our
 * sentence; nothing provider-side reaches the body.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireHqAdmin, requireSuperAdminWriteBar } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { IndexRefused, importList, importWgi, indexSources, isSourceKey } from '../services/ventureScoring/countryIndex';
import { PublishRefused, modelVersions, publishModel } from '../services/ventureScoring/publish';

const r = new Hono<{ Bindings: Env }>();

const VERSION = /^\d{1,3}\.\d{1,3}$/;

r.get('/hq/models', async (c) => {
  await requireHqAdmin(c);
  try {
    return c.json(await modelVersions(c.env));
  } catch (e) {
    return refuse(c, 503, { code: 'models_unreadable', message: 'The model versions could not be read. That is not the same as none. Try again in a moment.', raw: e });
  }
});

r.post('/models/:version/publish', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const version = c.req.param('version');
  if (!VERSION.test(version)) return refuse(c, 404, { code: 'model_unknown', message: 'No model version has that number.' });
  try {
    const out = await publishModel(c.env, version, user.id);
    await logAdminAction(c.env, user.id, user.email, 'venture_model.published', { version, ventures_total: out.ventures_total });
    return c.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof PublishRefused) return refuse(c, e.status, { code: e.code, message: e.sentence });
    return refuse(c, 503, { code: 'publish_unreadable', message: 'The model could not be published. Nothing changed. Try again in a moment.', raw: e });
  }
});

r.get('/hq/indices', async (c) => {
  await requireHqAdmin(c);
  try {
    return c.json({ sources: await indexSources(c.env) });
  } catch (e) {
    return refuse(c, 503, { code: 'indices_unreadable', message: 'The country index sources could not be read. That is not the same as none. Try again in a moment.', raw: e });
  }
});

r.post('/hq/indices/:source/import', async (c) => {
  const user = await requireSuperAdminWriteBar(c);
  const source = c.req.param('source');
  if (!isSourceKey(source)) return refuse(c, 404, { code: 'index_unknown', message: 'No country index source has that name.' });
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return refuse(c, 400, { code: 'invalid_body', message: 'Send the edition as JSON.' });
  }
  try {
    const out = source === 'wgi' ? await importWgi(c.env, body, user.id) : await importList(c.env, source, body, user.id);
    await logAdminAction(c.env, user.id, user.email, 'country_index.imported', { source, edition: out.edition, value_count: out.value_count });
    return c.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof IndexRefused) return refuse(c, e.status, { code: e.code, message: e.sentence });
    return refuse(c, 503, { code: 'import_unreadable', message: 'The edition could not be imported. Nothing was written. Try again in a moment.', raw: e });
  }
});

export default r;
