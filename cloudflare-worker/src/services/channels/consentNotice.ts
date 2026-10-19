/**
 * D756 §1.7 (#1894), D754 §5 (#1893) — the version of what an interviewee is
 * told, and the page that tells them.
 *
 * ONE VERSION COVERS EVERY WORD AN INTERVIEWEE READS: the recording-notice
 * page at /privacy/interviews and every in-chat notice that links to it
 * (WhatsApp's in `consent.ts`, Telegram's from D756). A change to any of them
 * is a new version, and every consent row stores the version it was asked
 * under (`channel_consents.notice_version`).
 *
 * The link carries the version only — never a thread, a name or a token — so
 * the page learns nothing about who opened it.
 *
 * A SENDER MUST REFUSE TO SEND A NOTICE WHEN `consentNoticeUrl` IS NULL, rather
 * than send one without the link.
 */
import type { Env } from '../../types';

export const CONSENT_NOTICE_VERSION = 1;
export const CONSENT_NOTICE_PATH = '/privacy/interviews';

/** The page's address for the current version, or null unless the base is `https://<host>`. */
export function consentNoticeUrl(env: Pick<Env, 'PUBLIC_BASE_URL' | 'APP_URL'>): string | null {
  const base = String(env.PUBLIC_BASE_URL || env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(base)) return null;
  return `${base}${CONSENT_NOTICE_PATH}?n=${CONSENT_NOTICE_VERSION}`;
}
