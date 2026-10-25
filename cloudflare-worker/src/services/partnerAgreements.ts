/**
 * D993 (#2804) — the first agreements HQ can propose on a partner profile,
 * and whether each is ready to send.
 *
 * THE LIST. The fifteen document types the review's select has always offered
 * (PartnerProfilesConsole's AGREEMENT_OPTIONS), in its five groups, now held
 * here so the page draws them from the Worker instead of its own copy. The
 * value is the `document_type` the verify send passes to `createAndSendEnvelope`
 * and stores on `partner_profiles.agreement_type`, so it must not change
 * spelling: a renamed value would orphan every profile that already carries it.
 *
 * READY means the send would find text. Each value goes through
 * `templateBodyFor` (routes/esign.ts), the resolver the send itself uses
 * (D758): the library row under the value's slug, else its bundled file. No
 * body anywhere is "Not ready: no text in the library yet", which is what the
 * send would refuse with. A library that cannot be read throws, so a caller
 * never reads "unreadable" as "not ready".
 */
import type { Env } from '../types';
import { templateBodyFor } from '../routes/esign';

export interface AgreementOption { value: string; label: string }
export interface AgreementGroup { label: string; options: AgreementOption[] }

export const AGREEMENT_GROUPS: readonly AgreementGroup[] = [
  { label: 'Investors', options: [
    { value: 'Subscription Booklet & LPA', label: 'Subscription Booklet & LPA (LP)' },
    { value: 'SPV Joinder Agreement', label: 'SPV Joinder Agreement (Syndicate)' },
    { value: 'Co-Investment Side Letter', label: 'Co-Investment Side Letter' },
    { value: 'Strategic Side Letter / Focused SPV', label: 'Strategic Side Letter / Focused SPV (Sector LP)' },
  ] },
  { label: 'Founders · New venture', options: [
    { value: 'Founder Collaboration Agreement', label: 'Founder Collaboration Agreement' },
    { value: 'Spin-Out Subsidiary SPA + IP Transfer', label: 'Spin-Out Subsidiary SPA (Founder)' },
  ] },
  { label: 'Founders · Strategic scale', options: [
    { value: 'Strategic Scale Partnership Agreement', label: 'Strategic Scale Partnership Agreement' },
    { value: 'Technology Integration / JV Agreement', label: 'Technology Integration / JV (StudioOS AI)' },
    { value: 'Referral / Agency Agreement', label: 'Referral / Agency Agreement (Distribution / GTM)' },
    { value: 'M&A Advisory Mandate', label: 'M&A Advisory Mandate' },
  ] },
  { label: 'Operators and service partners', options: [
    { value: 'Venture Share Agreement (FAST)', label: 'Venture Share Agreement / FAST (Advisor)' },
    { value: 'MSA + Equity-for-Services', label: 'MSA + Equity-for-Services (Operating Partner)' },
    { value: 'Engagement Letter (Spin-Out Package)', label: 'Engagement Letter (Legal Counsel)' },
    { value: 'White-Label Service Agreement', label: 'White-Label Service Agreement (Technical Partner)' },
  ] },
  { label: 'Liquidity', options: [
    { value: 'Secondary Purchase Agreement', label: 'Secondary Purchase Agreement (Liquidity)' },
  ] },
];

/** The words for an option with no text, as the send's own refusal puts it. */
export const NOT_READY = 'Not ready: no text in the library yet';

/**
 * Every option with its readiness: `ready`, the words to draw, and where the
 * text comes from (`store`, the library row; `template`, its bundled file).
 * Throws when the library cannot be read.
 */
export async function agreementOptions(env: Env) {
  const groups = [];
  for (const g of AGREEMENT_GROUPS) {
    const options = [];
    for (const o of g.options) {
      const found = await templateBodyFor(env, o.value);
      const ready = !!found && found.body.trim().length > 0;
      options.push({ ...o, ready, readiness: ready ? 'Ready' : NOT_READY, source: ready ? found!.source : null });
    }
    groups.push({ label: g.label, options });
  }
  return { groups };
}
