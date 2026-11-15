/** D550: quota requests are pending asks, never consent or completed intros. D6260: the quota is shown, a message may go with the ask, and the target is named. */
import { shortDate } from './networkBook';

/** The route keeps the first 2,000 characters (POST /api/introductions/request); the form stops at the same count. */
export const INTRO_MESSAGE_MAX = 2000;
const PLAN_LABEL = { free: 'Free', plus: 'Plus', professional: 'Professional', institutional: 'Institutional' };

export function introTarget(relationship) {
  const other = relationship?.other;
  const id = Number(other?.id);
  if (other?.role === 'founder' && Number.isSafeInteger(id) && id > 0) {
    return { key: `founder_user_id:${id}`, label: other.name || `Founder #${id}`, body: { founder_user_id: id } };
  }
  const projectId = Number(relationship?.project?.id);
  if (Number.isSafeInteger(projectId) && projectId > 0) {
    return { key: `project_id:${projectId}`, label: relationship.project.name || `Project #${projectId}`, body: { project_id: projectId } };
  }
  return null;
}
export function askKey(ask) {
  for (const field of ['founder_user_id', 'project_id', 'founder_id']) {
    if (ask?.[field]) return `${field}:${ask[field]}`;
  }
  return null;
}

const count = (v) => (v !== null && v !== undefined && v !== '' && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/**
 * GET /api/introductions/quota's `{ tier, quarter, used, cap, remaining }` as
 * a readable quota, or null when a count is missing: a quota that cannot be
 * read is unreadable, never zero asks left.
 */
export function quotaFrom(value, previous = null) {
  const used = count(value?.used);
  const cap = count(value?.cap);
  if (used === null || cap === null) return null;
  const remaining = count(value?.remaining) ?? Math.max(0, cap - used);
  return { tier: value?.tier || previous?.tier || null, quarter: value?.quarter || previous?.quarter || null, used, cap, remaining };
}

/** "2 of 3 asks left this quarter". */
export function quotaLine(quota) {
  return `${quota.remaining} of ${quota.cap} ${quota.cap === 1 ? 'ask' : 'asks'} left this quarter`;
}

/** The plan a 402 names (`upgrade_to`), as its label, or null when there is none higher. */
export function upgradeLabel(planKey) {
  return PLAN_LABEL[planKey] || null;
}

/**
 * The name the Asked view shows for an ask. `target` is the Worker's join
 * (D6260): a name only when the reader may still see that founder or project.
 */
export function askTargetName(ask, namesUnreadable = false) {
  if (namesUnreadable || !ask?.target) return 'Target name unreadable';
  if (!ask.target.kind) return 'Target not recorded';
  if (!ask.target.available) return 'Not available';
  return ask.target.name || 'Name not recorded';
}

/** An ask's date, "Nov 10, 2026". The store writes UTC `YYYY-MM-DD HH:MM:SS`. */
export function askDate(value) {
  const s = String(value || '');
  return shortDate(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s) || 'Date not recorded';
}

/**
 * `post(body)` sends one ask; `publish(states)` hands the per-target states
 * to React. `onSpent(result)` and `onRefused(data)` let the page re-read what
 * the answer changed (the quota, the recorded asks).
 */
export function createIntroRequests(post, publish, { onSpent, onRefused } = {}) {
  const states = {};
  const update = (key, value) => { states[key] = value; publish({ ...states }); };
  return async (target, message = '') => {
    if (!target || ['sending', 'pending'].includes(states[target.key]?.status)) return;
    // Synchronous lock also covers two clicks before React renders again, and
    // the same target reached through both its person and organization rows.
    update(target.key, { status: 'sending' });
    const text = String(message || '').trim().slice(0, INTRO_MESSAGE_MAX);
    try {
      const result = await post(text ? { ...target.body, message: text } : target.body);
      if (result?.ok !== true) throw new Error('The request was not confirmed.');
      update(target.key, { status: 'pending', message: 'Request pending. An ask does not record either person’s consent or mean an introduction has been made.' });
      onSpent?.(result);
    } catch (error) {
      const data = error?.data && typeof error.data === 'object' ? error.data : null;
      const code = error?.code || data?.code || data?.error;
      const sentence = data?.message || error?.message;
      const exhausted = error?.status === 402 || data?.code === 'quota_intros_exhausted';
      update(target.key, {
        status: 'refused',
        message: code === 'investor_only'
          ? 'Only investor accounts can request an introduction.'
          : sentence || 'The introduction request could not be read. Check your recorded asks before retrying.',
        ...(exhausted ? { upgrade: { to: data?.upgrade_to ?? null, checkoutPath: data?.checkout_path ?? null } } : {}),
      });
      if (exhausted) onRefused?.(data);
    }
  };
}
