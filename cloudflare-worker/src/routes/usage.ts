/**
 * D642 — caller-only usage reads. Company selectors do not change the owner.
 * D1169 (#3082): the storage read counts every member store, with kinds,
 * companies, the largest files, the plan's allowance and its state.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { readStorageUsage } from '../services/storageUsage';

const usage = new Hono<{ Bindings: Env }>();
usage.get('/storage', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await readStorageUsage(c.env, user));
});
export default usage;
