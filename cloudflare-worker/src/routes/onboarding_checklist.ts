/**
 * Task #6 (IF) — Onboarding checklist API.
 *
 *   GET  /api/onboarding/checklist
 *   POST /api/onboarding/checklist/:item/complete
 *   POST /api/onboarding/checklist/:item/skip
 *   POST /api/onboarding/checklist/reset           — clear all rows for user
 *   POST /api/onboarding/meta                      — patch tour/celebration/panel state
 *
 * Mounted at /api/onboarding (sibling endpoints inside the same Hono
 * router) in index.ts. See services/onboardingChecklist.ts for the
 * 5×10 catalogue + lazy auto-detect.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { CATALOG, loadChecklist, markItem, resetAll, setMeta } from '../services/onboardingChecklist';

const router = new Hono<{ Bindings: Env }>();

async function getPrimaryPersonaId(env: Env, userId: number): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT persona_id FROM user_personas WHERE user_id = ? AND is_primary = 1`,
    ).bind(userId).first<any>();
    return row?.persona_id || null;
  } catch {
    return null;
  }
}

router.get('/checklist', async (c) => {
  const user = await requireAuth(c);
  const personaId = await getPrimaryPersonaId(c.env, (user as any).id);
  const data = await loadChecklist(c.env, user as any, personaId);
  return c.json(data);
});

router.post('/checklist/reset', async (c) => {
  const user = await requireAuth(c);
  await resetAll(c.env, (user as any).id);
  const personaId = await getPrimaryPersonaId(c.env, (user as any).id);
  const data = await loadChecklist(c.env, user as any, personaId);
  return c.json({ ok: true, ...data });
});

router.post('/checklist/:item/complete', async (c) => {
  const user = await requireAuth(c);
  const item = c.req.param('item');
  if (!isKnownItem(item)) return c.json({ error: 'unknown item' }, 400);
  await markItem(c.env, (user as any).id, item, 'complete');
  return c.json({ ok: true });
});

router.post('/checklist/:item/skip', async (c) => {
  const user = await requireAuth(c);
  const item = c.req.param('item');
  if (!isKnownItem(item)) return c.json({ error: 'unknown item' }, 400);
  await markItem(c.env, (user as any).id, item, 'skip');
  return c.json({ ok: true });
});

router.post('/meta', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  await setMeta(c.env, (user as any).id, {
    tour_seen: typeof body.tour_seen === 'boolean' ? body.tour_seen : undefined,
    rerun_tour: body.rerun_tour === true,
    celebration_shown: typeof body.celebration_shown === 'boolean' ? body.celebration_shown : undefined,
    panel_collapsed: typeof body.panel_collapsed === 'boolean' ? body.panel_collapsed : undefined,
  });
  return c.json({ ok: true });
});

function isKnownItem(key: string): boolean {
  for (const role of Object.keys(CATALOG) as Array<keyof typeof CATALOG>) {
    if (CATALOG[role].some((it) => it.key === key)) return true;
  }
  return false;
}

export default router;
