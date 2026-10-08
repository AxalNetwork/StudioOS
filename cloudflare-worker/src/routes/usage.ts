/** D642 — caller-only usage reads. Company selectors do not change the owner. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { readStorageUsage } from '../services/storageUsage';

const usage = new Hono<{ Bindings: Env }>();
usage.get('/storage', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await readStorageUsage(c.env.DB, user.id));
});
export default usage;
