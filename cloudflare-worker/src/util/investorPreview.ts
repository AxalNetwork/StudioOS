import type { Context } from 'hono';
import { isSuperAdmin } from '../auth';
import type { Env, User } from '../types';
import { refuse } from './refusal';

export const PREVIEW_SHELL_HEADER = 'X-Axal-Preview-Shell';

/** D5915: a browser preview can narrow the authenticated actor's access. */
export function investorPreviewRefusal(c: Context<{ Bindings: Env }>, user: User): Response | null {
  if (c.req.header(PREVIEW_SHELL_HEADER) !== 'investor' || user.support_session || !isSuperAdmin(user)) return null;
  const code = 'investor_preview_read_only';
  return refuse(c, 403, {
    code,
    message: 'Return to HQ to make this change.',
    extra: { code },
  });
}
