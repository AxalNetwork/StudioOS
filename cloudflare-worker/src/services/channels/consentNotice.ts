/**
 * D756 §1.7 (#1894) — the interviewee recording notice: one version, one page.
 *
 * WHAT THE VERSION COVERS. `CONSENT_NOTICE_VERSION` names the words of the
 * page at `/privacy/interviews` AND the words of every in-chat consent notice
 * that links to it (D754 W2's WhatsApp text, D756's Telegram text). A change
 * to any of them is a new version, and every consent row stores the version
 * its person was shown. The SPA's `frontend/src/lib/interviewNotice.js` keeps
 * the same number, and `frontend/test/interview_notice_d756.test.mjs` fails
 * when the two drift.
 *
 * THE LINK CARRIES ONLY THE VERSION. No thread, name or token: the page
 * learns nothing about who opened it, and a forwarded link gives nothing away.
 *
 * A SENDER MUST REFUSE when `consentNoticeUrl` answers null, rather than send
 * a notice without its link: a notice the person cannot read in full is not a
 * notice.
 */
import type { Env } from '../../types';

export const CONSENT_NOTICE_VERSION = 1;
export const CONSENT_NOTICE_PATH = '/privacy/interviews';

/**
 * The notice's absolute URL, from the same base the webhook route reads
 * (`routes/channels.ts`), or null unless that base is `https://<host>`.
 */
export function consentNoticeUrl(env: Pick<Env, 'PUBLIC_BASE_URL' | 'APP_URL'>): string | null {
  const base = String(env.PUBLIC_BASE_URL || env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)) return null;
  return `${base}${CONSENT_NOTICE_PATH}?n=${CONSENT_NOTICE_VERSION}`;
}
