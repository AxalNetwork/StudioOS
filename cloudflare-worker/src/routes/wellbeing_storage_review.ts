/**
 * D7118 part 4 (#7118): the controlled internal review of how Wellness
 * check-ins and reflections are held at rest, mounted at
 * /api/wellbeing/storage-review.
 *
 *   GET /    counts per store: rows, rows tested, and how many are encrypted,
 *            held without encryption, partly unreadable (ciphertext that no
 *            longer opens) or empty, with the earliest and latest period
 *
 * Who. Super Admin only, at HQ (`requireSuperAdmin`). Each run is recorded in
 * the admin audit (`wellbeing_storage_review`).
 *
 * What it never returns. No member id, no uid, no score, word or topic, and no
 * per-member count: a store's totals only. The values are decrypted to test
 * that they open and are dropped at once (`services/wellbeing/storageReview.ts`).
 * The runbook is documentation/operations/WELLBEING_STORAGE_REVIEW.md.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { reviewWellbeingStorage } from '../services/wellbeing/storageReview';
import { refuse } from '../util/refusal';
import wellbeing from './wellbeing';

const storageReview = new Hono<{ Bindings: Env }>();

storageReview.get('/', async (c) => {
  const admin = await requireSuperAdmin(c);
  let review;
  try {
    review = await reviewWellbeingStorage(c.env);
  } catch (e) {
    return refuse(c, 503, {
      code: 'storage_review_unavailable',
      message: 'The storage review could not be run. Nothing was read out or changed.',
      raw: e,
    });
  }
  await logAdminAction(c.env, admin.id, (admin as any).email || '', 'wellbeing_storage_review', {
    stores: review.stores.map((s) => s.store),
  });
  return c.json({ reviewed_at: new Date().toISOString(), ...review }, 200, { 'Cache-Control': 'no-store' });
});

export default storageReview;
export const mount: RouteMount = { path: '/api/wellbeing/storage-review', router: storageReview, before: [wellbeing] };
