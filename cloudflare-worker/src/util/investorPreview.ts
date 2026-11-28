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

/**
 * D8730 (#8730): the Founder and Exploring previews are a role, not a person.
 * The browser marks every write it sends from one with the same header, and
 * the advisor routes refuse it for an admin, so nothing typed in a preview is
 * saved to the operator's own interview. A support session is a person and is
 * never refused here; a member who sends the header is not an admin and is not
 * refused either: the header narrows, it never grants.
 */
export const ROLE_PREVIEW_SHELLS: ReadonlySet<string> = new Set(['founder', 'exploring']);
export const ROLE_PREVIEW_REFUSED = 'role_preview_read_only';
export const ROLE_PREVIEW_MESSAGE = 'Answers are not saved in a preview. Back to HQ to keep working as yourself.';

export function rolePreviewShell(c: Context<{ Bindings: Env }>): string | null {
  const shell = String(c.req.header(PREVIEW_SHELL_HEADER) || '').toLowerCase();
  return ROLE_PREVIEW_SHELLS.has(shell) ? shell : null;
}

export function rolePreviewRefusal(c: Context<{ Bindings: Env }>, user: User): Response | null {
  const shell = rolePreviewShell(c);
  if (!shell || user.support_session || String(user.role || '').toLowerCase() !== 'admin') return null;
  return refuse(c, 403, {
    code: ROLE_PREVIEW_REFUSED,
    message: ROLE_PREVIEW_MESSAGE,
    extra: { code: ROLE_PREVIEW_REFUSED, shell },
  });
}
