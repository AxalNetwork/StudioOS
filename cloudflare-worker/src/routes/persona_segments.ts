/**
 * D1000 (#2815), Persona segments part 3: the segment profiles (migration 559).
 *
 *   GET   /api/personas/segments            every profile           requireAdmin
 *   GET   /api/personas/segments/coverage   needs met, gaps, offers requireAdmin
 *   GET   /api/personas/segments/:key       one profile + history   requireAdmin
 *   PATCH /api/personas/segments/:key       { expected_version, reason?, name?, profile?, status?,
 *                                             who?, typical?, needs?, offers? }   requireSuperAdmin
 *
 * Every write is recorded in `segment_profile_history`, and in the admin
 * audit store. A D1 error is a 503, never an empty list. The status rules
 * that act elsewhere (sign-up, finalize, retag) are in `routes/personas.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { questionCompletion } from '../services/segmentMembership';
import { requireAdmin, requireSuperAdmin } from '../auth';
import {
  SegmentInputError, createProfile, getProfile, historyOf, listProfiles, segmentCoverage, writeProfile,
} from '../services/segmentProfiles';

const segments = new Hono<{ Bindings: Env }>();

const KEY = /^[a-z0-9_]{1,64}$/;

const unreadable = (c: any, what: string, e: unknown) => {
  console.error('[persona-segments]', what, (e as Error)?.message);
  return c.json({ detail: `${what} could not be read. That is not a claim that there are none.`, code: 'unreadable' }, 503);
};

segments.get('/', async (c) => {
  await requireAdmin(c);
  try {
    return c.json({ segments: await listProfiles(c.env) });
  } catch (e) { return unreadable(c, 'The segment profiles', e); }
});

segments.get('/coverage', async (c) => {
  await requireAdmin(c);
  try {
    return c.json(await segmentCoverage(c.env));
  } catch (e) { return unreadable(c, 'The segments’ needs and offers', e); }
});

segments.post('/', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ code: 'invalid_body', detail: 'Send a segment as an object.' }, 400);
  try {
    const segment = await createProfile(c.env, body, { id: Number(admin.id) });
    // The actor and first profile version are already recorded atomically.
    try {
      const { logAdminAction } = await import('../services/adminAudit');
      await logAdminAction(c.env, Number(admin.id), admin.email, 'segment_profile_created', { segment: segment.key });
    } catch { console.error('[persona-segments] create audit copy failed'); }
    return c.json({ segment }, 201);
  } catch (error) {
    if (error instanceof SegmentInputError) return c.json({ code: error.code, detail: error.sentence }, error.status);
    console.error('[persona-segments] create failed');
    return c.json({ code: 'write_failed', detail: 'The segment could not be created. Try again.' }, 503);
  }
});

segments.get('/:key/completion', async (c) => {
  await requireAdmin(c);
  const key = c.req.param('key');
  if (!KEY.test(key)) return c.json({ code: 'not_found', detail: 'No segment is recorded with that key.' }, 404);
  try {
    const completion = await questionCompletion(c.env, key);
    return completion ? c.json(completion) : c.json({ code: 'not_found', detail: 'No segment is recorded with that key.' }, 404);
  } catch {
    return c.json({ code: 'unreadable', detail: 'Question completion could not be read. Try again.' }, 503);
  }
});

segments.get('/:key', async (c) => {
  await requireAdmin(c);
  const key = c.req.param('key');
  if (!KEY.test(key)) return c.json({ detail: 'No segment is recorded with that key.', code: 'not_found' }, 404);
  try {
    const profile = await getProfile(c.env, key);
    if (!profile) return c.json({ detail: 'No segment is recorded with that key.', code: 'not_found' }, 404);
    return c.json({ segment: profile, history: await historyOf(c.env, key) });
  } catch (e) { return unreadable(c, 'The segment profile', e); }
});

segments.patch('/:key', async (c) => {
  const admin = await requireSuperAdmin(c);
  const key = c.req.param('key');
  if (!KEY.test(key)) return c.json({ detail: 'No segment is recorded with that key.', code: 'not_found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ detail: 'Send the changes as an object.', code: 'invalid_body' }, 400);
  let written: Awaited<ReturnType<typeof writeProfile>>;
  try {
    written = await writeProfile(c.env, key, body as Record<string, unknown>, { id: Number(admin.id) });
  } catch (e) {
    if (e instanceof SegmentInputError) return c.json({ detail: e.sentence, code: e.code }, e.status);
    console.error('[persona-segments] write failed:', key, (e as Error)?.message);
    // The profile and its history row are one batch, so a failure changed neither.
    return c.json({ detail: 'The segment could not be saved. Nothing was changed.', code: 'write_failed' }, 503);
  }
  if (written.changed.length) {
    // The history row above is the record; the audit store copies it for Security's feed.
    try {
      const { logAdminAction } = await import('../services/adminAudit');
      await logAdminAction(c.env, Number(admin.id), admin.email, 'segment_profile_edited', { segment: key, fields: written.changed });
    } catch (e) { console.error('[persona-segments] audit copy failed:', key, (e as Error)?.message); }
  }
  return c.json({ segment: written.profile, changed: written.changed });
});

export default segments;
