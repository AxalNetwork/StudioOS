/**
 * Send persona invitations (Set A broadcast / Set B GP personal) via Gmail.
 */
import type { Env } from '../../types';
import { renderInvite, type RenderInviteOpts } from './personaInviteRender';
import { deliverNow } from './send';

export interface SendPersonaInviteOpts extends RenderInviteOpts {
  userId?: number;
  /** Immediate delivery (skip queue). Default false. */
  immediate?: boolean;
}

export async function sendPersonaInvite(
  env: Env,
  opts: SendPersonaInviteOpts,
): Promise<{ ok: boolean; reason?: string }> {
  const rendered = renderInvite(opts);
  const variant = opts.variant;
  const delivered = await deliverNow(env, {
    template_key: variant === 'broadcast' ? 'persona_invite_broadcast' : 'persona_invite_personal',
    to: opts.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    from: 'Axal VC <noreply@axal.vc>',
    reply_to: variant === 'personal' ? 'guillaume.lauzier@axal.vc' : 'support@axal.vc',
    category: 'marketing',
    list_unsubscribe: variant === 'broadcast' ? (opts.unsubscribeUrl ?? null) : null,
    user_id: opts.userId ?? null,
    log_id: null,
  });
  return delivered ? { ok: true } : { ok: false, reason: 'deliver_failed' };
}

export { renderInvite };
