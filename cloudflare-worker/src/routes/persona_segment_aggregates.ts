/** D1001: mount at /api/personas/segments, before the profile router. */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { PERSONA_BY_ID } from '../personas';
import { segmentAnswers, segmentArchetypes } from '../services/segmentAggregates';

const aggregates = new Hono<{ Bindings: Env }>();
async function readAggregate(c: Context<{ Bindings: Env }>, read: typeof segmentAnswers | typeof segmentArchetypes) {
    await requireAdmin(c);
    // Scope stays on this database. Reject filters rather than create small,
    // request-selected cohorts or suggest that cross-studio data was read.
    if (new URL(c.req.url).search) return c.json({ code: 'invalid_query', detail: 'This read accepts no filters or cross-studio scope.' }, 400);
    const key = c.req.param('key')!;
    if (!Object.hasOwn(PERSONA_BY_ID, key)) return c.json({ code: 'not_found', detail: 'No sign-up questions are recorded for that segment.' }, 404);
    try { return c.json(await read(c.env, key)); }
    catch (e) {
      console.error('[segment-aggregates] read failed', (e as Error)?.message);
      return c.json({ code: 'unreadable', detail: 'These counts could not be read. That is not the same as none.' }, 503);
    }
}
aggregates.get('/:key/answers', (c) => readAggregate(c, segmentAnswers));
aggregates.get('/:key/archetypes', (c) => readAggregate(c, segmentArchetypes));
export default aggregates;
